import type { AccountEntry, Provider } from '../quota/types';
import type { AntigravityQuotaData } from '../providers/antigravity/parser';
import type { ClaudeQuotaData } from '../providers/claude/types';
import type { CodexQuotaData } from '../providers/codex/parser';
import type { KimiQuotaData } from '../providers/kimi/parser';
import type { XaiQuotaData } from '../providers/xai/parser';

export type ProviderQuotaResult =
  | ClaudeQuotaData
  | AntigravityQuotaData
  | CodexQuotaData
  | KimiQuotaData
  | XaiQuotaData;

export type QuotaLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ProviderQuotaResult | Record<string, unknown> }
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
  setQuotaBatch(generation: number, updates: ReadonlyMap<string, QuotaLoadState>): boolean;
  setBatchLoading(loading: boolean): void;
  invalidateAuth(): void;
  destroy(): void;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: object): value is PlainObject {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(object, copy);
    for (const item of value) copy.push(deepClone(item, seen));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(object, copy);
    for (const [key, item] of value) copy.set(deepClone(key, seen), deepClone(item, seen));
    return copy as T;
  }
  if (!isPlainObject(object)) return value;
  const copy: PlainObject = Object.create(Object.getPrototypeOf(object));
  seen.set(object, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = deepClone(item, seen);
  return copy as T;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else if (value instanceof Map) {
    for (const [key, item] of value) {
      deepFreeze(key, seen);
      deepFreeze(item, seen);
    }
  } else if (isPlainObject(object)) {
    for (const item of Object.values(value)) deepFreeze(item, seen);
  }
  return Object.freeze(value);
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

function accountFingerprint(account: AccountEntry): string {
  const file = account.file;
  const authIndex = file.authIndex ?? file.auth_index ?? '';
  return JSON.stringify([
    account.provider,
    String(authIndex),
    file.path ?? '',
    file.id ?? '',
    file.projectId ?? file.project_id ?? '',
    file.email ?? file.account ?? '',
  ]);
}

function snapshot(state: AppState): Readonly<AppState> {
  const cloned = deepClone(state);
  cloned.accounts = deepFreeze(cloned.accounts);
  cloned.auth = deepFreeze(cloned.auth);
  const quotaCache = new Map<string, QuotaLoadState>();
  for (const [id, quota] of cloned.quotaCache) quotaCache.set(id, deepFreeze(quota));
  cloned.quotaCache = readonlyMap(quotaCache);
  return Object.freeze(cloned);
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
  const fingerprints = new Map<string, string>();
  let destroyed = false;
  let publishing = false;
  let pendingPublish = false;

  const publish = (): void => {
    if (destroyed) return;
    currentSnapshot = snapshot(state);
    if (publishing) {
      pendingPublish = true;
      return;
    }
    publishing = true;
    try {
      do {
        pendingPublish = false;
        const published = currentSnapshot;
        for (const listener of Array.from(listeners)) {
          try {
            listener(published);
          } catch {
            // Listener errors must not affect state mutations or other listeners.
          }
          if (pendingPublish) break;
        }
      } while (pendingPublish && !destroyed);
    } finally {
      publishing = false;
    }
  };

  return {
    getState() { return currentSnapshot; },
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
      const nextFingerprints = new Map(accounts.map((account) => [account.id, accountFingerprint(account)]));
      const quotaCache = new Map<string, QuotaLoadState>();
      for (const [id, quota] of state.quotaCache) {
        if (fingerprints.get(id) === nextFingerprints.get(id)) quotaCache.set(id, deepClone(quota));
      }
      state = { ...state, accounts: deepClone(accounts), quotaCache };
      fingerprints.clear();
      for (const [id, fingerprint] of nextFingerprints) fingerprints.set(id, fingerprint);
      publish();
      return true;
    },
    setQuota(accountId, generation, quota) {
      if (destroyed || generation !== state.generation || !state.accounts.some((account) => account.id === accountId)) return false;
      const quotaCache = new Map(state.quotaCache);
      quotaCache.set(accountId, deepClone(quota));
      state = { ...state, quotaCache };
      publish();
      return true;
    },
    setQuotaBatch(generation, updates) {
      if (destroyed || generation !== state.generation) return false;
      const quotaCache = new Map(state.quotaCache);
      for (const [accountId, quota] of updates) {
        if (state.accounts.some((account) => account.id === accountId)) quotaCache.set(accountId, deepClone(quota));
      }
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
      state = { ...state, auth: { status: 'invalid' }, accounts: [], quotaCache: new Map(), generation: state.generation + 1, batchLoading: false };
      fingerprints.clear();
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
