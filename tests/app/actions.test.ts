import { describe, expect, it, vi } from 'vitest';
import type { CpaApi } from '../../src/api/types';
import { createQuotaActions } from '../../src/app/actions';
import { createQuotaStore } from '../../src/app/state';
import type { AccountEntry } from '../../src/quota/types';
import type { ProviderQuery, ProviderQuotaResult } from '../../src/providers/types';

const account = (id: string, provider: AccountEntry['provider']): AccountEntry => ({ id, provider, file: { name: id, provider } });
const result = (id: string, calls: string[], delay = 0): ProviderQuery => async (_file, context) => {
  calls.push(`start:${id}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(context.signal?.reason); }, { once: true });
  });
  calls.push(`end:${id}`);
  return { windows: [{ id, label: id, usedPercent: 1, remainingPercent: 99, resetAtMs: null, periodHours: null }] } as ProviderQuotaResult;
};

function api(files: AccountEntry[], _calls: string[]): CpaApi {
  return {
    listAuthFiles: vi.fn(async () => files.map(({ file }) => file)),
    downloadAuthFile: vi.fn(async () => ''),
    apiCall: vi.fn(),
  };
}

describe('quota actions', () => {
  it('loads one card once and ignores a duplicate while loading', async () => {
    const calls: string[] = [];
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const actions = createQuotaActions({ api: api([a], calls), store, providerQueries: { claude: result('a', calls, 10) } });
    const first = actions.queryOne('a');
    await expect(actions.queryOne('a')).resolves.toBeUndefined();
    await first;
    expect(calls.filter((value) => value === 'start:a')).toHaveLength(1);
  });

  it('runs a page in Provider groups and isolates account failures', async () => {
    const calls: string[] = [];
    const store = createQuotaStore();
    const accounts = [account('c1', 'claude'), account('c2', 'claude'), account('k1', 'kimi')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const queries: Record<string, ProviderQuery> = {
      claude: async (file) => {
        calls.push(`start:${file.name}`);
        if (file.name === 'c2') throw new Error('bad');
        return { windows: [] } as ProviderQuotaResult;
      },
      kimi: result('k1', calls),
    };
    const actions = createQuotaActions({ api: api(accounts, calls), store, providerQueries: queries });
    await actions.queryCurrentPage(['c1', 'c2', 'k1']);
    expect(store.getState().quotaCache.get('c1')?.status).toBe('success');
    expect(store.getState().quotaCache.get('c2')?.status).toBe('error');
    expect(store.getState().quotaCache.get('k1')?.status).toBe('success');
    expect(calls).toContain('start:k1');
  });

  it('rejects batches larger than twenty and passes the caller abort signal', async () => {
    const store = createQuotaStore();
    const accounts = Array.from({ length: 21 }, (_, index) => account(`a${index}`, 'claude'));
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const controller = new AbortController();
    const query = vi.fn(async (_file, context) => {
      expect(context.signal).not.toBe(controller.signal);
      expect(context.signal?.aborted).toBe(false);
      return { windows: [] } as ProviderQuotaResult;
    });
    const actions = createQuotaActions({ api: api(accounts, []), store, signal: controller.signal, providerQueries: { claude: query } });
    await expect(actions.queryCurrentPage(accounts.slice(0, 20).map(({ id }) => id))).resolves.toBeUndefined();
    await expect(actions.queryCurrentPage(['a0'])).resolves.toBeUndefined();
    await expect(actions.queryCurrentPage(accounts.map(({ id }) => id))).rejects.toThrow(/20/);
    actions.destroy();
    expect(controller.signal.aborted).toBe(false);
  });

  it('propagates caller abort and waits for all groups before releasing batch guard', async () => {
    const controller = new AbortController();
    const store = createQuotaStore();
    const accounts = [account('c1', 'claude'), account('k1', 'kimi')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    let releaseClaude: (() => void) | undefined;
    let releaseKimi: (() => void) | undefined;
    const waiting = (release: (fn: () => void) => void, context: { signal?: AbortSignal }) => new Promise<void>((resolve, reject) => {
      release(() => resolve());
      context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true });
    });
    const queries: Record<string, ProviderQuery> = {
      claude: async (_file, context) => { await waiting((fn) => { releaseClaude = fn; }, context); return { windows: [] } as ProviderQuotaResult; },
      kimi: async (_file, context) => { await waiting((fn) => { releaseKimi = fn; }, context); return { windows: [] } as ProviderQuotaResult; },
    };
    const actions = createQuotaActions({ api: api(accounts, []), store, signal: controller.signal, providerQueries: queries });
    const batch = actions.queryCurrentPage(['c1', 'k1']);
    await vi.waitFor(() => expect(store.getState().batchLoading).toBe(true));
    controller.abort(new Error('cancelled'));
    expect(store.getState().batchLoading).toBe(true);
    releaseClaude?.();
    releaseKimi?.();
    await expect(batch).rejects.toThrow('cancelled');
    expect(store.getState().batchLoading).toBe(false);
    actions.destroy();
  });

  it('clears loading state when account reload fails and allows a new query', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const first = store.beginAccountGeneration();
    store.replaceAccounts(first, [a]);
    store.setQuota('a', first, { status: 'loading' });
    const reloadError = new Error('reload failed');
    const actions = createQuotaActions({
      api: { ...api([a], []), listAuthFiles: vi.fn(async () => { throw reloadError; }) },
      store,
      providerQueries: { claude: async () => ({ windows: [] }) as never },
    });
    await expect(actions.reloadAccounts()).rejects.toBe(reloadError);
    expect(store.getState().quotaCache.has('a')).toBe(false);
    await expect(actions.queryOne('a')).resolves.toBeUndefined();
  });

  it('converts invalid single-card data to safe error and clears its loading guard', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const query = vi.fn(async () => ({ windows: [], bad: new Date() }) as never);
    const actions = createQuotaActions({ api: api([a], []), store, providerQueries: { claude: query } });
    await actions.queryOne('a');
    expect(store.getState().quotaCache.get('a')?.status).toBe('error');
    await actions.queryOne('a');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('isolates invalid batch group data and commits other groups', async () => {
    const store = createQuotaStore();
    const accounts = [account('bad', 'claude'), account('good', 'kimi')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const actions = createQuotaActions({
      api: api(accounts, []),
      store,
      providerQueries: {
        claude: async () => ({ windows: [], bad: new Map([['x', 1]]) }) as never,
        kimi: async () => ({ windows: [] }) as never,
      },
    });
    await actions.queryCurrentPage(['bad', 'good']);
    expect(store.getState().quotaCache.get('bad')?.status).toBe('error');
    expect(store.getState().quotaCache.get('good')?.status).toBe('success');
    expect(store.getState().batchLoading).toBe(false);
    await actions.queryCurrentPage(['bad', 'good']);
    expect(store.getState().batchLoading).toBe(false);
  });

  it('does not partially commit a group when batch validation fails', async () => {
    const store = createQuotaStore();
    const accounts = [account('first', 'claude'), account('second', 'claude')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const actions = createQuotaActions({
      api: api(accounts, []),
      store,
      providerQueries: {
        claude: async (file) => file.name === 'first' ? ({ windows: [], bad: new Date() }) as never : ({ windows: [] }) as never,
      },
    });
    await actions.queryCurrentPage(['first', 'second']);
    expect(store.getState().quotaCache.get('first')?.status).toBe('error');
    expect(store.getState().quotaCache.get('second')?.status).toBe('error');
  });

  it('clears batch loading immediately when destroyed during an active batch', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const actions = createQuotaActions({
      api: api([a], []),
      store,
      providerQueries: { claude: async (_file, context) => new Promise((_resolve, reject) => context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true })) },
    });
    const batch = actions.queryCurrentPage(['a']);
    await vi.waitFor(() => expect(store.getState().batchLoading).toBe(true));
    actions.destroy();
    expect(store.getState().batchLoading).toBe(false);
    await expect(batch).rejects.toThrow();
    expect(store.getState().batchLoading).toBe(false);
  });

  it('does not let another actions instance clear the shared batch owner', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const first = createQuotaActions({ api: api([a], []), store });
    const second = createQuotaActions({
      api: api([a], []),
      store,
      providerQueries: { claude: async (_file, context) => new Promise((_resolve, reject) => context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true })) },
    });

    const batch = second.queryCurrentPage(['a']);
    await vi.waitFor(() => expect(store.getState().batchLoading).toBe(true));
    first.destroy();
    expect(store.getState().batchLoading).toBe(true);
    second.destroy();
    expect(store.getState().batchLoading).toBe(false);
    await expect(batch).rejects.toThrow();
  });

  it('does not let an old batch finally clear a newer shared-store owner', async () => {
    const store = createQuotaStore();
    const accounts = [account('old', 'claude'), account('new', 'kimi')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    let releaseOld!: () => void;
    const oldActions = createQuotaActions({
      api: api(accounts, []),
      store,
      providerQueries: { claude: async () => new Promise((resolve) => { releaseOld = () => resolve({ windows: [] } as never); }) },
    });
    const newActions = createQuotaActions({
      api: api(accounts, []),
      store,
      providerQueries: { kimi: async (_file, context) => new Promise((_resolve, reject) => context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true })) },
    });

    const oldBatch = oldActions.queryCurrentPage(['old']);
    const oldSettled = oldBatch.catch((error: unknown) => error);
    await vi.waitFor(() => expect(store.getState().batchLoading).toBe(true));
    oldActions.destroy();
    expect(store.getState().batchLoading).toBe(false);

    const newBatch = newActions.queryCurrentPage(['new']);
    await vi.waitFor(() => expect(store.getState().batchLoading).toBe(true));
    releaseOld();
    await oldSettled;
    expect(store.getState().batchLoading).toBe(true);

    newActions.destroy();
    await expect(newBatch).rejects.toThrow();
    expect(store.getState().batchLoading).toBe(false);
  });

  it('waits for all groups and releases guards when commit and fallback both throw', async () => {
    const baseStore = createQuotaStore();
    const accounts = [account('bad', 'claude'), account('good', 'kimi')];
    const generation = baseStore.beginAccountGeneration();
    baseStore.replaceAccounts(generation, accounts);
    const commitError = new Error('batch commit failed');
    const fallbackError = new Error('fallback commit failed');
    const store = {
      ...baseStore,
      setQuotaBatch(currentGeneration: number, updates: ReadonlyMap<string, import('../../src/app/state').QuotaLoadState>) {
        if (updates.has('bad')) throw commitError;
        return baseStore.setQuotaBatch(currentGeneration, updates);
      },
      setQuotaErrors(currentGeneration: number, accountIds: readonly string[], error: import('../../src/app/state').QuotaErrorInfo) {
        if (accountIds.includes('bad')) throw fallbackError;
        return baseStore.setQuotaErrors(currentGeneration, accountIds, error);
      },
    };
    let releaseGood!: () => void;
    let goodCalls = 0;
    const actions = createQuotaActions({
      api: api(accounts, []),
      store,
      providerQueries: {
        claude: async () => ({ windows: [] }) as never,
        kimi: async () => {
          goodCalls += 1;
          if (goodCalls === 1) await new Promise<void>((resolve) => { releaseGood = resolve; });
          return { windows: [] } as never;
        },
      },
    });

    let settled = false;
    const batch = actions.queryCurrentPage(['bad', 'good']);
    const observed = batch.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    ).finally(() => { settled = true; });
    await vi.waitFor(() => expect(releaseGood).toBeTypeOf('function'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(store.getState().batchLoading).toBe(true);

    releaseGood();
    const outcome = await observed;
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('expected rejection');
    expect(outcome.error).toBeInstanceOf(AggregateError);
    expect((outcome.error as AggregateError).errors).toEqual([commitError, fallbackError]);
    expect(store.getState().quotaCache.get('good')?.status).toBe('success');
    expect(store.getState().batchLoading).toBe(false);

    await expect(actions.queryCurrentPage(['good'])).resolves.toBeUndefined();
    expect(store.getState().batchLoading).toBe(false);
  });

  it('does not publish failed reload cleanup after destroy', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    let rejectReload!: (error: Error) => void;
    const actions = createQuotaActions({
      api: { ...api([a], []), listAuthFiles: vi.fn(() => new Promise<never>((_resolve, reject) => { rejectReload = reject; })) },
      store,
    });
    const states: number[] = [];
    store.subscribe((state) => states.push(state.generation));
    states.length = 0;
    const reload = actions.reloadAccounts();
    states.length = 0;
    actions.destroy();
    rejectReload(new Error('cancelled'));
    await expect(reload).rejects.toThrow('cancelled');
    expect(states).toHaveLength(0);
  });

  it('keeps a newer operation loading guard when an older operation settles', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    let releaseOld!: () => void;
    let calls = 0;
    const actions = createQuotaActions({
      api: api([a], []),
      store,
      providerQueries: { claude: async () => {
        calls += 1;
        if (calls === 1) await new Promise<void>((resolve) => { releaseOld = resolve; });
        return { windows: [] } as never;
      } },
    });
    const oldQuery = actions.queryOne('a');
    await vi.waitFor(() => expect(calls).toBe(1));
    store.beginAccountGeneration();
    store.replaceAccounts(store.getState().generation, [a]);
    const newQuery = actions.queryOne('a');
    await vi.waitFor(() => expect(calls).toBe(2));
    releaseOld();
    await Promise.all([oldQuery, newQuery]);
    expect(calls).toBe(2);
  });

  it('does not retry a failed provider query or persist quota outside the store', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const query = vi.fn(async () => { throw new Error('failed'); });
    const actions = createQuotaActions({ api: api([a], []), store, providerQueries: { claude: query } });
    await actions.queryOne('a');
    expect(query).toHaveBeenCalledTimes(1);
    expect(store.getState().quotaCache.get('a')?.status).toBe('error');
  });
});
