import { describe, expect, it, vi } from 'vitest';
import type { AccountEntry } from '../../src/quota/types';
import { createQuotaStore, type QuotaLoadState } from '../../src/app/state';

const account = (id: string, provider: AccountEntry['provider'] = 'claude'): AccountEntry => ({
  id, provider, file: { name: id, provider },
});
const success = (value: unknown): QuotaLoadState => ({ status: 'success', data: value as never });

describe('quota store', () => {
  it('increments account generations and rejects stale writes', () => {
    const store = createQuotaStore();
    const first = store.beginAccountGeneration();
    expect(first).toBe(1);
    expect(store.replaceAccounts(first, [account('a')])).toBe(true);
    const second = store.beginAccountGeneration();
    expect(second).toBe(2);
    expect(store.setQuota('a', first, success({ old: true }))).toBe(false);
    expect(store.replaceAccounts(first, [account('b')])).toBe(false);
    expect(store.getState().generation).toBe(2);
  });

  it('retains unchanged account cache and prunes removed accounts', () => {
    const store = createQuotaStore();
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [account('a'), account('b')]);
    store.setQuota('a', generation, success({ value: 1 }));
    const next = store.beginAccountGeneration();
    store.replaceAccounts(next, [account('a'), account('c')]);
    expect(store.getState().quotaCache.get('a')).toEqual(success({ value: 1 }));
    expect(store.getState().quotaCache.has('b')).toBe(false);
  });

  it('invalidates auth by clearing data and notifying subscribers', () => {
    const store = createQuotaStore();
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [account('a')]);
    store.setQuota('a', generation, success({ value: 1 }));
    const states: Readonly<ReturnType<typeof store.getState>>[] = [];
    store.subscribe((state) => states.push(state));
    store.invalidateAuth();
    expect(store.getState().accounts).toEqual([]);
    expect(store.getState().quotaCache.size).toBe(0);
    expect(store.getState().auth.status).toBe('invalid');
    expect(states).toHaveLength(1);
  });

  it('stops notifying after destroy and returns immutable snapshots', () => {
    const store = createQuotaStore();
    const snapshot = store.getState();
    expect(() => (snapshot as { generation: number }).generation = 99).toThrow();
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    store.destroy();
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [account('a')]);
    expect(calls).toBe(0);
    expect(store.getState().accounts).toEqual([]);
  });

  it('deeply freezes snapshots and defensively clones quota data', () => {
    const store = createQuotaStore();
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [account('a')]);
    const data = { windows: [{ label: 'window' }], nested: { values: [1] }, attributes: { tier: 'pro' } };
    store.setQuota('a', generation, success(data));
    data.windows[0].label = 'changed outside';
    const state = store.getState();
    const cached = state.quotaCache.get('a');
    expect(cached?.status).toBe('success');
    if (cached?.status !== 'success') throw new Error('expected success');
    expect((cached.data as { windows: { label: string }[] }).windows[0].label).toBe('window');
    expect(() => ((cached.data as unknown as { nested: { values: number[] } }).nested.values[0] = 2)).toThrow();
  });

  it('does not retain quota when an account fingerprint changes', () => {
    const store = createQuotaStore();
    const first = store.beginAccountGeneration();
    store.replaceAccounts(first, [{ ...account('a'), file: { name: 'a', provider: 'claude', authIndex: 'one' } }]);
    store.setQuota('a', first, success({ value: 1 }));
    const second = store.beginAccountGeneration();
    store.replaceAccounts(second, [{ ...account('a'), file: { name: 'a', provider: 'claude', authIndex: 'two' } }]);
    expect(store.getState().quotaCache.has('a')).toBe(false);
  });

  it('isolates listener failures and publishes the newest state after reentrant mutation', () => {
    const store = createQuotaStore();
    const seen: number[] = [];
    let nested = false;
    store.subscribe(() => { throw new Error('listener failure'); });
    store.subscribe((state) => {
      seen.push(state.generation);
      if (!nested) {
        nested = true;
        store.beginAccountGeneration();
      }
    });
    expect(() => store.beginAccountGeneration()).not.toThrow();
    expect(seen.at(-1)).toBe(2);
  });

  it('does not retain a loading quota across account generations', () => {
    const store = createQuotaStore();
    const first = store.beginAccountGeneration();
    const firstAccount = { ...account('a'), file: { name: 'a', provider: 'claude', authIndex: 'one' } };
    store.replaceAccounts(first, [firstAccount]);
    store.setQuota('a', first, { status: 'loading' });
    const second = store.beginAccountGeneration();
    store.replaceAccounts(second, [firstAccount]);
    expect(store.getState().quotaCache.has('a')).toBe(false);
    expect(store.setQuota('a', first, success({ value: 1 }))).toBe(false);
  });

  it('rejects unsupported nested quota values without changing state', () => {
    const store = createQuotaStore();
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [account('a')]);
    expect(() => store.setQuota('a', generation, success({ windows: [new Date()] }))).toThrow(TypeError);
    expect(store.getState().quotaCache.has('a')).toBe(false);
    expect(() => store.setQuota('a', generation, success({ windows: [new Map([['value', 1]])] }))).toThrow(TypeError);
    expect(store.getState().quotaCache.has('a')).toBe(false);
  });

  it('continues capped reentrant publishing in a microtask and remains usable', async () => {
    const store = createQuotaStore();
    const seen: number[] = [];
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
      if (calls < 105) store.beginAccountGeneration();
    });
    store.subscribe((state) => seen.push(state.generation));

    expect(() => store.beginAccountGeneration()).not.toThrow();
    expect(calls).toBe(100);
    expect(seen).toHaveLength(0);

    await vi.waitFor(() => expect(seen.at(-1)).toBe(105));
    expect(store.beginAccountGeneration()).toBe(106);
  });

  it('allows only the current batch owner to clear batch loading', () => {
    const store = createQuotaStore();
    const firstOwner = Symbol('first');
    const secondOwner = Symbol('second');

    expect(store.beginBatch(firstOwner)).toBe(true);
    expect(store.beginBatch(secondOwner)).toBe(false);
    expect(store.endBatch(secondOwner)).toBe(false);
    expect(store.getState().batchLoading).toBe(true);
    expect(store.endBatch(firstOwner)).toBe(true);
    expect(store.getState().batchLoading).toBe(false);

    expect(store.beginBatch(secondOwner)).toBe(true);
    expect(store.endBatch(firstOwner)).toBe(false);
    expect(store.getState().batchLoading).toBe(true);
    expect(store.endBatch(secondOwner)).toBe(true);
  });
});
