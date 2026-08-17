/**
 * Application orchestration root.
 *
 * `createQuotaApp` owns every long-lived resource the quota page needs — the
 * Sub2API auth session, the CPA api, the quota store + actions, the shared
 * minute clock, the theme listener, the rendered shell and its DOM listeners —
 * and wires them into the two entry points (`src/entries/user.ts`,
 * `src/entries/admin.ts`).
 *
 * Interaction contracts enforced here:
 *  - **Auth before auth-files**: `start()` bootstraps identity, renders the
 *    auth gate, and only then loads auth-files. No quota `api-call` is issued
 *    during start — quota is strictly user-initiated.
 *  - **Full-list rendering and querying**: provider filtering and sorting only
 *    affect presentation; the batch query always includes every account.
 *  - **List refresh issues no quota query**: the refresh handler reloads
 *    auth-files only.
 *  - **Auth invalidation hides quota**: a session abort invalidates the store
 *    and re-renders the auth gate, so quota never survives a lost session.
 *  - **Destroy is idempotent**: clock, in-flight work, listeners, theme, DOM
 *    and session are cleaned exactly once.
 *
 * Reset capability isolation: the user entry passes NO reset capability; the
 * admin entry is the only caller that imports `consumeCodexResetCredit` and
 * injects it here with `revealAccountIdentity: true`, together with the admin
 * reset flow (`onResetRequest`, from `src/admin/resetFlow`) that owns the
 * confirm dialog + consume call. Neither the consume endpoint string nor the
 * dialog copy appears in this module, so none of it can reach the user bundle.
 */

import { createCpaApi } from '../api/apiCall';
import type { CpaApi } from '../api/types';
import { bootstrapSub2ApiAuth } from '../auth/bootstrap';
import type { AuthenticatedSession } from '../auth/types';
import { createMinuteClock } from '../quota/minuteClock';
import type { MinuteClock } from '../quota/minuteClock';
import { readUiPreferences, writeProviderPreference, writeSortModePreference } from '../quota/uiPreferences';
import type { AccountEntry } from '../quota/types';
import type { ProviderQueryContext } from '../providers/types';
import { createQuotaActions } from './actions';
import type { QuotaActions } from './actions';
import { createQuotaStore } from './state';
import type { QuotaErrorInfo, QuotaLoadState, QuotaStore } from './state';
import type { QuotaAppController, QuotaAppOptions, QuotaResetBridge } from './types';
import {
  initialUiState,
  renderApp,
  type AuthPhase,
  type QuotaUiState,
  type QuotaViewHandlers,
} from '../ui/renderApp';
import { applyTheme } from '../ui/theme';

function toErrorInfo(error: unknown): QuotaErrorInfo {
  if (error instanceof Error) {
    const maybeStatus = (error as { statusCode?: unknown }).statusCode;
    const statusCode = typeof maybeStatus === 'number' ? maybeStatus : undefined;
    return statusCode === undefined
      ? { name: error.name, message: error.message }
      : { name: error.name, message: error.message, statusCode };
  }
  return { name: 'Error', message: String(error) };
}

function accountDisplayName(entry: AccountEntry): string {
  const file = entry.file;
  for (const value of [file.email, file.account, file.name]) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return entry.id;
}

export function createQuotaApp(options: QuotaAppOptions): QuotaAppController {
  const { root, mode, revealAccountIdentity } = options;
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const timeoutMs = options.timeoutMs;

  const store: QuotaStore = options.store ?? createQuotaStore();
  const clock: MinuteClock = options.clock ?? createMinuteClock(doc ? { document: doc } : {});
  const destroyController = new AbortController();

  let destroyed = false;
  let started = false;
  let authPhase: AuthPhase = 'loading';
  let session: AuthenticatedSession | undefined = options.session;
  let api: CpaApi | undefined = options.api;
  let actions: QuotaActions | undefined;
  let themeCleanup: (() => void) | undefined;
  // Session-scoped UI preferences: seed the provider/sort selections from
  // sessionStorage (validated + clamped inside readUiPreferences; corrupt or
  // missing data degrades to the defaults). Never token/quota/auth material.
  const preferences = readUiPreferences();
  const uiState: QuotaUiState = {
    ...initialUiState(),
    ...(preferences.sortMode !== undefined ? { sortMode: preferences.sortMode } : {}),
  };

  // Theme: URL ?theme= wins; otherwise track the system preference.
  if (doc) {
    const media = options.media
      ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined);
    if (media) {
      const requested = (options.url ? options.url.searchParams.get('theme') : null)
        ?? (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('theme') : null);
      themeCleanup = applyTheme({ requestedTheme: requested, media });
    }
  }

  const resolveLabel = (entry: AccountEntry): string => accountDisplayName(entry);

  const render = (): void => {
    renderHandle.render(store.getState(), uiState, authPhase);
  };

  const reconcileSelectedProvider = (): void => {
    if (uiState.selectedProvider === 'all') return;
    const hasProvider = store.getState().accounts.some((account) => account.provider === uiState.selectedProvider);
    if (hasProvider) return;
    uiState.selectedProvider = 'all';
  };

  const handleQueryAll = async (): Promise<void> => {
    if (!actions || destroyed) return;
    const accountIds = store.getState().accounts.map((account) => account.id);
    try {
      await actions.queryAccounts(accountIds);
    } catch {
      // A batch-level failure is surfaced per-card through the store.
    }
  };

  const handleReset = (accountId: string): void => {
    if (!options.onResetRequest || destroyed || !api) return;
    const account = store.getState().accounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    const context: ProviderQueryContext = {
      apiCall: api.apiCall,
      downloadAuthFile: api.downloadAuthFile,
      signal: destroyController.signal,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
    const bridge: QuotaResetBridge = {
      account,
      context,
      publish: (result) => {
        if (destroyed) return;
        store.setQuota(
          accountId,
          store.getState().generation,
          (result.status === 'success'
            ? { status: 'success', data: result.data }
            : { status: 'error', error: toErrorInfo(result.error) }) as QuotaLoadState,
        );
      },
    };
    options.onResetRequest(bridge);
  };

  const viewHandlers: QuotaViewHandlers = {
    onRefreshAccounts: () => {
      if (!actions || destroyed) return;
      void (async () => {
        try {
          await actions.reloadAccounts();
          reconcileSelectedProvider();
        } catch {
          // Reload failures clear loading state via the store; nothing to surface here.
        }
      })();
    },
    onQueryAll: () => { void handleQueryAll(); },
    onQueryOne: (accountId) => { if (actions && !destroyed) void actions.queryOne(accountId); },
    ...(mode === 'admin' && options.onResetRequest ? { onReset: (accountId: string) => handleReset(accountId) } : {}),
    onSelectProvider: (selection) => {
      uiState.selectedProvider = selection;
      if (selection !== 'all') {
        try { writeProviderPreference(selection); } catch { /* storage unavailable; preference is optional */ }
      }
      if (!destroyed) render();
    },
    onSelectSort: (sortMode) => {
      uiState.sortMode = sortMode;
      try { writeSortModePreference(sortMode); } catch { /* storage unavailable; preference is optional */ }
      if (!destroyed) render();
    },
    onTimelineMode: (timelineMode) => {
      uiState.timelineMode = timelineMode;
      uiState.timelineOffset = 0;
      if (!destroyed) render();
    },
    onTimelineShift: (delta) => {
      uiState.timelineOffset += delta;
      if (!destroyed) render();
    },
    onTimelineToday: () => {
      uiState.timelineOffset = 0;
      if (!destroyed) render();
    },
  };

  const renderHandle = renderApp({
    root,
    mode,
    revealAccountIdentity,
    resetAction: mode === 'admin' && options.onResetRequest ? { label: options.resetButtonLabel ?? '重置' } : null,
    pageSize: options.pageSize ?? 20,
    now: () => clock.getSnapshot(),
    clock,
    handlers: viewHandlers,
    resolveLabel,
  });

  const unsubStore = store.subscribe(() => { if (!destroyed) render(); });

  const onSessionAbort = (): void => {
    if (destroyed) return;
    authPhase = 'invalid';
    store.invalidateAuth(); // publishes → subscriber re-renders the invalid gate
  };

  // Initial loading gate.
  render();

  const start = async (): Promise<void> => {
    if (started || destroyed) return;
    started = true;
    authPhase = 'loading';
    render();

    try {
      if (!session) {
        const url = options.url ?? new URL((doc ? doc.location : location).href);
        session = await bootstrapSub2ApiAuth({
          url,
          history: options.history ?? history,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
      }
    } catch (error) {
      if (destroyed) return;
      authPhase = 'error';
      render();
      throw error;
    }

    if (destroyed) return;

    if (session.signal.aborted) {
      authPhase = 'invalid';
      store.invalidateAuth();
      return;
    }
    session.signal.addEventListener('abort', onSessionAbort, { once: true });

    if (!api) api = createCpaApi(session.request);
    actions = createQuotaActions({
      api,
      store,
      signal: destroyController.signal,
      ...(options.providerQueries ? { providerQueries: options.providerQueries } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });

    authPhase = 'authenticated';
    render();
    try {
      await actions.reloadAccounts();
      reconcileSelectedProvider();
    } catch (error) {
      if (destroyed) return;
      // Auth succeeded but the account list failed to load; surface the error
      // through the empty store state and propagate so callers can react.
      throw error;
    }
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    try { unsubStore(); } catch { /* noop */ }
    try { session?.signal.removeEventListener('abort', onSessionAbort); } catch { /* noop */ }
    try { actions?.destroy(); } catch { /* noop */ }
    try { destroyController.abort(new Error('应用已销毁')); } catch { /* noop */ }
    try { session?.destroy(); } catch { /* noop */ }
    try { renderHandle.destroy(); } catch { /* noop */ }
    try { clock.destroy(); } catch { /* noop */ }
    try { themeCleanup?.(); } catch { /* noop */ }
    try { while (root.lastChild) root.removeChild(root.lastChild); } catch { /* noop */ }
  };

  return { start, destroy, getState: () => store.getState() };
}
