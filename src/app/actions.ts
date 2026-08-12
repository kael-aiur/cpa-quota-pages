import type { CpaApi } from '../api/types';
import { classifyAccounts } from '../quota/logic';
import type { AccountEntry, Provider } from '../quota/types';
import { providerQueries } from '../providers';
import type { ProviderQuery, ProviderQueryContext } from '../providers/types';
import { createPageLifecycle, type PageLifecycle } from './lifecycle';
import type { QuotaLoadState, QuotaStore } from './state';

const MAX_BATCH_SIZE = 20;

type QueryMap = Partial<Record<Provider, ProviderQuery>>;

export interface QuotaActionsOptions {
  api: CpaApi;
  store: QuotaStore;
  providerQueries?: QueryMap;
  signal?: AbortSignal;
  lifecycle?: PageLifecycle;
  timeoutMs?: number;
}

export interface QuotaActions {
  reloadAccounts(): Promise<void>;
  queryOne(accountId: string): Promise<void>;
  queryCurrentPage(accountIds: string[]): Promise<void>;
  resetCodex?(accountId: string): Promise<void>;
}

function errorState(error: unknown): QuotaLoadState {
  return { status: 'error', error };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

export function createQuotaActions(options: QuotaActionsOptions): QuotaActions {
  const lifecycle = options.lifecycle ?? createPageLifecycle(options.signal);
  const queries: QueryMap = { ...providerQueries, ...options.providerQueries };
  const loading = new Set<string>();
  let batchInFlight = false;
  let destroyed = false;

  const accountById = (accountId: string): AccountEntry | undefined =>
    options.store.getState().accounts.find((account) => account.id === accountId);

  const queryAccount = async (account: AccountEntry): Promise<QuotaLoadState> => {
    const query = queries[account.provider];
    if (!query) return errorState(new Error(`未实现 Provider: ${account.provider}`));
    const context: ProviderQueryContext = {
      apiCall: options.api.apiCall,
      downloadAuthFile: options.api.downloadAuthFile,
      signal: lifecycle.signal,
      timeoutMs: options.timeoutMs,
    };
    try {
      return { status: 'success', data: await query(account.file, context) };
    } catch (error) {
      if (lifecycle.signal.aborted) throw abortError(lifecycle.signal);
      return errorState(error);
    }
  };

  const queryOneAccount = async (account: AccountEntry, generation: number): Promise<void> => {
    options.store.setQuota(account.id, generation, { status: 'loading' });
    options.store.setQuota(account.id, generation, await queryAccount(account));
  };

  const runOne = async (account: AccountEntry, generation: number): Promise<void> => {
    if (loading.has(account.id)) return;
    loading.add(account.id);
    try {
      await queryOneAccount(account, generation);
    } finally {
      loading.delete(account.id);
    }
  };

  const reloadAccounts = async (): Promise<void> => {
    if (destroyed) return;
    const generation = options.store.beginAccountGeneration();
    const files = await options.api.listAuthFiles(lifecycle.signal);
    if (lifecycle.signal.aborted) throw abortError(lifecycle.signal);
    options.store.replaceAccounts(generation, classifyAccounts(files));
  };

  const queryOne = async (accountId: string): Promise<void> => {
    if (destroyed || lifecycle.signal.aborted) return;
    const account = accountById(accountId);
    if (!account) return;
    await runOne(account, options.store.getState().generation);
  };

  const queryCurrentPage = async (accountIds: string[]): Promise<void> => {
    if (accountIds.length > MAX_BATCH_SIZE) throw new RangeError(`最多查询 ${MAX_BATCH_SIZE} 个账号`);
    if (destroyed || lifecycle.signal.aborted || batchInFlight) return;
    batchInFlight = true;
    options.store.setBatchLoading(true);
    const generation = options.store.getState().generation;
    try {
      const accounts = accountIds
        .map((id) => accountById(id))
        .filter((account): account is AccountEntry => account !== undefined);
      const groups = new Map<Provider, AccountEntry[]>();
      for (const account of accounts) {
        const group = groups.get(account.provider);
        if (group) group.push(account);
        else groups.set(account.provider, [account]);
      }
      await Promise.all(Array.from(groups.values()).map(async (group) => {
        const results = await Promise.allSettled(group.map((account) => runOne(account, generation)));
        if (lifecycle.signal.aborted) throw abortError(lifecycle.signal);
        return results;
      }));
    } finally {
      batchInFlight = false;
      options.store.setBatchLoading(false);
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    lifecycle.destroy();
    loading.clear();
  };
  void destroy;

  return { reloadAccounts, queryOne, queryCurrentPage };
}
