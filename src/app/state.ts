import type { AccountEntry, Provider } from '../quota/types';
import type { ProviderQuotaData } from '../providers/types';

export type QuotaLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ProviderQuotaData | unknown }
  | { status: 'error'; error: unknown };

export type AuthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'authenticated' }
  | { status: 'invalid'; reason?: unknown }
  | { status: 'error'; error: unknown };

export interface AppState {
  auth: AuthState;
  accounts: ReadonlyArray<AccountEntry>;
  selectedProvider: Provider | 'all';
  sortMode: 'default' | 'soonest';
  currentPage: number;
  quotaCache: ReadonlyMap<string, QuotaLoadState>;
  generation: number;
  batchLoading: boolean;
}

export interface QuotaStore {
  getState(): Readonly<AppState>;
  subscribe(listener: (state: Readonly<AppState>) => void): () => void;
  beginAccountGeneration(): number;
  replaceAccounts(generation: number, accounts: AccountEntry[]): boolean;
  setQuota(accountId: string, generation: number, quota: QuotaLoadState): boolean;
  setBatchLoading(loading: boolean): void;
  invalidateAuth(): void;
  destroy(): void;
}

function readonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const copy = new Map(source);
  return {
    get size() { return copy.size; },
    get(key: K) { return copy.get(key); },
    has(key: K) { return copy.has(key); },
    entries() { return copy.entries(); },
    keys() { return copy.keys(); },
    values() { return copy.values(); },
    forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      copy.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
    },
    [Symbol.iterator]() { return copy[Symbol.iterator](); },
  };
}

function snapshot(state: AppState): Readonly<AppState> {
  const accounts = state.accounts.map((account) => Object.freeze({ ...account, file: { ...account.file } }));
  const quotaCache = readonlyMap(state.quotaCache);
  return Object.freeze({
    ...state,
    auth: Object.freeze({ ...state.auth }),
    accounts: Object.freeze(accounts),
    quotaCache,
  });
}

export function createQuotaStore(): QuotaStore {
  let state: AppState = {
    auth: { status: 'authenticated' },
    accounts: [],
    selectedProvider: 'all',
    sortMode: 'default',
    currentPage: 1,
    quotaCache: new Map(),
    generation: 0,
    batchLoading: false,
  };
  let currentSnapshot = snapshot(state);
  const listeners = new Set<(state: Readonly<AppState>) => void>();
  let destroyed = false;

  const publish = (): void => {
    if (destroyed) return;
    currentSnapshot = snapshot(state);
    for (const listener of listeners) listener(currentSnapshot);
  };

  return {
    getState() {
      return currentSnapshot;
    },
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginAccountGeneration() {
      if (destroyed) return state.generation;
      state = { ...state, generation: state.generation + 1 };
      publish();
      return state.generation;
    },
    replaceAccounts(generation, accounts) {
      if (destroyed || generation !== state.generation) return false;
      const ids = new Set(accounts.map((account) => account.id));
      const quotaCache = new Map<string, QuotaLoadState>();
      for (const [id, quota] of state.quotaCache) {
        if (ids.has(id)) quotaCache.set(id, quota);
      }
      state = { ...state, accounts: [...accounts], quotaCache };
      publish();
      return true;
    },
    setQuota(accountId, generation, quota) {
      if (destroyed || generation !== state.generation || !state.accounts.some((account) => account.id === accountId)) {
        return false;
      }
      const quotaCache = new Map(state.quotaCache);
      quotaCache.set(accountId, quota);
      state = { ...state, quotaCache };
      publish();
      return true;
    },
    setBatchLoading(loading) {
      if (destroyed || state.batchLoading === loading) return;
      state = { ...state, batchLoading: loading };
      publish();
    },
    invalidateAuth() {
      if (destroyed) return;
      state = {
        ...state,
        auth: { status: 'invalid' },
        accounts: [],
        quotaCache: new Map(),
        generation: state.generation + 1,
        batchLoading: false,
      };
      publish();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      state = { ...state, accounts: [], quotaCache: new Map(), batchLoading: false };
      currentSnapshot = snapshot(state);
    },
  };
}
