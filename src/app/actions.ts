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
  destroy(): void;
  resetCodex?(accountId: string): Promise<void>;
}

function errorInfo(error: unknown): { name: string; message: string; statusCode?: number } {
  if (error instanceof Error) {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as unknown as { statusCode: number }).statusCode
      : undefined;
    return statusCode === undefined ? { name: error.name, message: error.message } : { name: error.name, message: error.message, statusCode };
  }
  return { name: 'Error', message: String(error) };
}
function errorState(error: unknown): QuotaLoadState { return { status: 'error', error: errorInfo(error) }; }
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

export function createQuotaActions(options: QuotaActionsOptions): QuotaActions {
  const parentSignal = options.lifecycle?.signal ?? options.signal;
  const lifecycle = createPageLifecycle(parentSignal);
  const queries: QueryMap = { ...providerQueries, ...options.providerQueries };
  const loading = new Map<string, number>();
  let operationToken = 0;
  let batchToken = 0;
  let batchInFlight = false;
  let destroyed = false;

  const accountById = (id: string): AccountEntry | undefined =>
    options.store.getState().accounts.find((account) => account.id === id);
  const loadingKey = (generation: number, id: string): string => `${generation}:${id}`;

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

  const queryOne = async (accountId: string): Promise<void> => {
    if (destroyed || lifecycle.signal.aborted) return;
    const account = accountById(accountId);
    if (!account) return;
    const generation = options.store.getState().generation;
    const key = loadingKey(generation, account.id);
    if (loading.has(key)) return;
    const operation = ++operationToken;
    loading.set(key, operation);
    options.store.setQuota(account.id, generation, { status: 'loading' });
    try {
      const result = await queryAccount(account);
      if (!destroyed && loading.get(key) === operation) {
        try {
          options.store.setQuota(account.id, generation, result);
        } catch (error) {
          options.store.setQuota(account.id, generation, errorState(error));
        }
      }
    } finally {
      if (loading.get(key) === operation) loading.delete(key);
    }
  };

  const reloadAccounts = async (): Promise<void> => {
    if (destroyed) return;
    const generation = options.store.beginAccountGeneration();
    try {
      const files = await options.api.listAuthFiles(lifecycle.signal);
      if (lifecycle.signal.aborted) throw abortError(lifecycle.signal);
      options.store.replaceAccounts(generation, classifyAccounts(files));
    } catch (error) {
      if (!destroyed) options.store.failAccountGeneration(generation);
      throw error;
    }
  };

  const queryCurrentPage = async (accountIds: string[]): Promise<void> => {
    if (accountIds.length > MAX_BATCH_SIZE) throw new RangeError(`最多查询 ${MAX_BATCH_SIZE} 个账号`);
    if (destroyed || lifecycle.signal.aborted || batchInFlight) return;
    batchInFlight = true;
    const token = ++batchToken;
    const generation = options.store.getState().generation;
    options.store.setBatchLoading(true);
    try {
      const accounts = accountIds.map(accountById).filter((account): account is AccountEntry => account !== undefined);
      const groups = new Map<Provider, AccountEntry[]>();
      for (const account of accounts) {
        const group = groups.get(account.provider);
        if (group) group.push(account);
        else groups.set(account.provider, [account]);
      }
      await Promise.all(Array.from(groups.values()).map(async (group) => {
        const operations = new Map<string, number>();
        const groupAccounts = group.filter((account) => {
          const key = loadingKey(generation, account.id);
          if (loading.has(key)) return false;
          const operation = ++operationToken;
          loading.set(key, operation);
          operations.set(key, operation);
          return true;
        });
        try {
          for (const account of groupAccounts) options.store.setQuota(account.id, generation, { status: 'loading' });
          const settled = await Promise.allSettled(groupAccounts.map((account) => queryAccount(account)));
          const updates = new Map<string, QuotaLoadState>();
          for (let index = 0; index < settled.length; index += 1) {
            const account = groupAccounts[index];
            const result = settled[index];
            if (result.status === 'fulfilled') updates.set(account.id, result.value);
            else updates.set(account.id, errorState(result.reason));
          }
          if (token === batchToken && !destroyed && !lifecycle.signal.aborted) {
            try {
              options.store.setQuotaBatch(generation, updates);
            } catch (error) {
              options.store.setQuotaErrors(generation, groupAccounts.map(({ id }) => id), errorInfo(error));
            }
          }
        } finally {
          for (const [key, operation] of operations) if (loading.get(key) === operation) loading.delete(key);
        }
      }));
      if (lifecycle.signal.aborted) throw abortError(lifecycle.signal);
    } finally {
      batchInFlight = false;
      if (token === batchToken) options.store.setBatchLoading(false);
    }
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    batchToken += 1;
    lifecycle.destroy();
    loading.clear();
    options.store.setBatchLoading(false);
  };

  return { reloadAccounts, queryOne, queryCurrentPage, destroy };
}
