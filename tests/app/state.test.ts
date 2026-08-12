import { describe, expect, it } from 'vitest';
import type { AccountEntry } from '../../src/quota/types';
import { createQuotaStore, type QuotaLoadState } from '../../src/app/state';

const account = (id: string, provider: AccountEntry['provider'] = 'claude'): AccountEntry => ({
  id, provider, file: { name: id, provider },
});
const success = (value: unknown): QuotaLoadState => ({ status: 'success', data: value });

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
});
