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
 *  - **Tabs / sort / pagination**: selection lives in this controller; changing
 *    provider or sort resets the page to 1, and the rendered page is clamped to
 *    the valid range by the pure view.
 *  - **List refresh issues no quota query**: the refresh handler reloads
 *    auth-files only.
 *  - **Current-page batch (max 20)**: "query all" chunks the visible accounts
 *    into page-sized batches so `actions.queryCurrentPage` (which rejects >20)
 *    never overflows; a single card failure never aborts its siblings.
 *  - **Auth invalidation hides quota**: a session abort invalidates the store
 *    and re-renders the auth gate, so quota never survives a lost session.
 *  - **Destroy is idempotent**: clock, in-flight work, listeners, theme, DOM
 *    and session are cleaned exactly once.
 *
 * Reset capability isolation: the user entry passes NO reset capability; the
 * admin entry is the only caller that imports `consumeCodexResetCredit` and
 * injects it here with `revealAccountIdentity: true`. The consume endpoint
 * string never appears in this module.
 */

import { createCpaApi } from '../api/apiCall';
import type { CpaApi } from '../api/types';
import { bootstrapSub2ApiAuth } from '../auth/bootstrap';
import type { AuthenticatedSession } from '../auth/types';
import { createMinuteClock } from '../quota/minuteClock';
import type { MinuteClock } from '../quota/minuteClock';
import { buildAnonymousAccountLabel } from '../quota/identity';
import type { AccountEntry } from '../quota/types';
import type { ProviderQueryContext } from '../providers/types';
import { createQuotaActions } from './actions';
import type { QuotaActions } from './actions';
import { createQuotaStore } from './state';
import type { QuotaErrorInfo, QuotaLoadState, QuotaStore } from './state';
import type { CodexResetCapability, QuotaAppController, QuotaAppOptions } from './types';
import { openConfirmDialog } from '../ui/confirmDialog';
import {
  deriveVisibleAccounts,
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

function stableIdentifier(entry: AccountEntry): string {
  const file = entry.file;
  return String(file.path ?? file.id ?? file.email ?? file.account ?? file.name ?? entry.id);
}

export function createQuotaApp(options: QuotaAppOptions): QuotaAppController {
  const { root, mode, revealAccountIdentity } = options;
  const consumeCodexResetCredit: CodexResetCapability | undefined = options.consumeCodexResetCredit;
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const pageSize = options.pageSize ?? 20;
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
  const labelCache = new Map<string, string>();
  const uiState: QuotaUiState = initialUiState();

  // Theme: URL ?theme= wins; otherwise track the system preference.
  if (doc) {
    const media = options.media
      ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: light)')
        : undefined);
    if (media) {
      const requested = (options.url ? options.url.searchParams.get('theme') : null)
        ?? (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('theme') : null);
      themeCleanup = applyTheme({ requestedTheme: requested, media });
    }
  }

  const resolveLabel = (entry: AccountEntry): string => {
    if (mode === 'admin' && revealAccountIdentity) return entry.id; // card renders the identity itself
    return labelCache.get(entry.id) ?? entry.id;
  };

  const render = (): void => {
    renderHandle.render(store.getState(), uiState, authPhase);
  };

  const refreshLabels = async (): Promise<void> => {
    if (mode === 'admin' && revealAccountIdentity) return;
    const accounts = store.getState().accounts;
    const missing = accounts.filter((account) => !labelCache.has(account.id));
    if (missing.length === 0) {
      if (!destroyed) render();
      return;
    }
    await Promise.all(
      missing.map(async (account) => {
        labelCache.set(account.id, await buildAnonymousAccountLabel(account.provider, stableIdentifier(account)));
      }),
    );
    if (!destroyed) render();
  };

  const handleQueryAll = async (): Promise<void> => {
    if (!actions || destroyed) return;
    const visible = deriveVisibleAccounts(store.getState(), uiState);
    for (let offset = 0; offset < visible.length; offset += pageSize) {
      if (destroyed || destroyController.signal.aborted) return;
      const chunk = visible.slice(offset, offset + pageSize).map((account) => account.id);
      try {
        await actions.queryCurrentPage(chunk);
      } catch {
        // A batch-level failure is surfaced per-card through the store; keep querying the rest.
      }
    }
  };

  const handleReset = (accountId: string): void => {
    if (!consumeCodexResetCredit || !api || destroyed) return;
    const account = store.getState().accounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    const trigger = doc && doc.activeElement instanceof HTMLElement ? doc.activeElement : root;
    const context: ProviderQueryContext = {
      apiCall: api.apiCall,
      downloadAuthFile: api.downloadAuthFile,
      signal: destroyController.signal,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
    const dialog = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '将消耗一次额度重置券以重置该账号额度，确认继续？',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm: async () => {
        try {
          const data = await consumeCodexResetCredit(account.file, context);
          if (!destroyed) store.setQuota(accountId, store.getState().generation, { status: 'success', data });
        } catch (error) {
          if (!destroyed) {
            store.setQuota(accountId, store.getState().generation, { status: 'error', error: toErrorInfo(error) } as QuotaLoadState);
          }
          throw error;
        }
      },
    });
    // Handoff constraint (Task 14): DialogController.closed rejects when
    // onConfirm fails. Attach a handler so the rejection is never unhandled;
    // the failure is already surfaced per-card via the store above.
    dialog.closed.catch(() => { /* reset failure already recorded on the card */ });
  };

  const viewHandlers: QuotaViewHandlers = {
    onRefreshAccounts: () => {
      if (!actions || destroyed) return;
      void (async () => {
        try {
          await actions.reloadAccounts();
          await refreshLabels();
        } catch {
          // Reload failures clear loading state via the store; nothing to surface here.
        }
      })();
    },
    onQueryAll: () => { void handleQueryAll(); },
    onQueryOne: (accountId) => { if (actions && !destroyed) void actions.queryOne(accountId); },
    ...(mode === 'admin' && consumeCodexResetCredit ? { onReset: (accountId: string) => handleReset(accountId) } : {}),
    onSelectProvider: (selection) => {
      uiState.selectedProvider = selection;
      uiState.currentPage = 1;
      if (!destroyed) render();
    },
    onSelectSort: (sortMode) => {
      uiState.sortMode = sortMode;
      uiState.currentPage = 1;
      if (!destroyed) render();
    },
    onPageChange: (page) => {
      uiState.currentPage = page;
      if (!destroyed) render();
    },
    onToggleTheme: () => {
      if (!doc) return;
      const current = doc.documentElement.getAttribute('data-theme');
      doc.documentElement.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
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
    canConsumeCodexReset: mode === 'admin' && Boolean(consumeCodexResetCredit),
    pageSize,
    now: () => clock.getSnapshot(),
    clock,
    handlers: viewHandlers,
    resolveLabel,
    ...(options.title !== undefined || options.description !== undefined
      ? { labels: { ...(options.title !== undefined ? { title: options.title } : {}), ...(options.description !== undefined ? { description: options.description } : {}) } }
      : {}),
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
      await refreshLabels();
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
