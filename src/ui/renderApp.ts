/**
 * Top-level quota page shell.
 *
 * `renderApp` is a PURE view: it derives the entire visible structure (tabs,
 * stats, the current page of cards, pagination and the recovery timeline) from
 * an {@link AppState} snapshot plus a small {@link QuotaUiState} describing the
 * user's selection. It owns no network or selection state — the orchestration
 * root (`createQuotaApp`) drives both and calls `render()` on every change.
 *
 * The shared minute clock is injected so a clock tick can refresh relative
 * reset labels without the orchestrator mediating; the view caches its last
 * arguments and re-renders on tick. Auth gates (loading / error / invalid) are
 * rendered in place of protected content so quota is never exposed before auth
 * completes or after it is invalidated.
 */

import type { AppState, QuotaLoadState } from '../app/state';
import { sortAccounts } from '../quota/logic';
import { nextRecoveryMs, urgentRecoveryId } from '../quota/resetSchedule';
import type { AccountEntry, SortMode } from '../quota/types';
import {
  buildTimelineLane,
  projectLane,
  projectResetCredits,
  timelineSpan,
  type TimelineLane,
} from '../quota/timelineModel';
import type { Provider, ProviderSelection } from '../providers/types';
import type { MinuteClock } from '../quota/minuteClock';
import { renderHeader } from './renderHeader';
import { renderTabs } from './renderTabs';
import { renderQuotaCard, type CardHandlers, type RenderOptions } from './renderCard';
import { renderTimeline, type TimelineHandlers, type TimelineModel, type TimelineProjectedLane } from './renderTimeline';
import { h } from './dom';

export type AuthPhase = 'loading' | 'authenticated' | 'invalid' | 'error';

export interface QuotaUiState {
  selectedProvider: ProviderSelection;
  sortMode: SortMode;
  currentPage: number;
  timelineMode: 'weekly' | 'session';
  timelineOffset: number;
}

export interface QuotaViewHandlers {
  onRefreshAccounts(): void;
  onQueryAll(): void;
  onQueryOne(accountId: string): void;
  onReset?(accountId: string): void;
  onSelectProvider(selection: ProviderSelection): void;
  onSelectSort(mode: SortMode): void;
  /** @deprecated Pagination was removed; retained for compatibility. */
  onPageChange?(page: number): void;
  /** @deprecated Theme is controlled externally; no in-page toggle is rendered. */
  onToggleTheme?(): void;
  onTimelineMode?(mode: 'weekly' | 'session'): void;
  onTimelineShift?(delta: -1 | 1): void;
  onTimelineToday?(): void;
}

export interface RenderAppOptions {
  root: HTMLElement;
  mode: 'user' | 'admin';
  revealAccountIdentity: boolean;
  /** Admin-owned reset capability flag + button label; `null` hides the reset button. */
  resetAction: { label: string } | null;
  /** @deprecated Kept for callers compiled against the old paged view. */
  pageSize: number;
  now(): number;
  clock: MinuteClock;
  handlers: QuotaViewHandlers;
  /** Resolve the per-card account label (anonymous hash for user, identity handled inside the card for admin). */
  resolveLabel?(entry: AccountEntry): string;
}

export interface RenderAppHandle {
  render(state: Readonly<AppState>, ui: QuotaUiState, auth: AuthPhase): void;
  destroy(): void;
}

const PRESENT_PROVIDERS: Provider[] = ['claude', 'antigravity', 'codex', 'xai', 'kimi'];

export function initialUiState(): QuotaUiState {
  return { selectedProvider: 'all', sortMode: 'default', currentPage: 1, timelineMode: 'weekly', timelineOffset: 0 };
}

/**
 * Soonest-recovery sort key (spec §9), delegated to the canonical recovery
 * schedule: Antigravity buckets, xAI weekly billing and Codex available reset
 * credits all count; past/invalid instants are excluded; unloaded, failed or
 * window-less accounts sink with `null`, preserving their default order.
 */
function recoveryAt(state: Readonly<AppState>, entry: AccountEntry, nowMs: number): number | null {
  const quota = state.quotaCache.get(entry.id);
  if (!quota || quota.status !== 'success') return null;
  return nextRecoveryMs(entry.provider, quota.data, nowMs);
}

/** Accounts after applying the provider filter (preserves canonical classification order). */
export function deriveVisibleAccounts(state: Readonly<AppState>, ui: QuotaUiState): AccountEntry[] {
  const accounts = state.accounts;
  if (ui.selectedProvider === 'all') return [...accounts];
  return accounts.filter((account) => account.provider === ui.selectedProvider);
}

/** Accounts after applying the provider filter and canonical sort. */
export function derivePage(
  state: Readonly<AppState>,
  ui: QuotaUiState,
  _pageSize: number,
  nowMs: number,
): { items: AccountEntry[]; page: number; totalPages: number; totalItems: number } {
  const visible = deriveVisibleAccounts(state, ui);
  const items = sortAccounts(visible, ui.sortMode, (entry) => recoveryAt(state, entry, nowMs));
  // The page metadata is retained for source compatibility with consumers that
  // used the old helper; the view itself no longer renders pagination.
  return { items, page: 1, totalPages: 1, totalItems: items.length };
}

function providerCounts(accounts: ReadonlyArray<AccountEntry>): Partial<Record<ProviderSelection, number>> {
  const counts: Partial<Record<ProviderSelection, number>> = { all: accounts.length };
  for (const account of accounts) counts[account.provider] = (counts[account.provider] ?? 0) + 1;
  return counts;
}

function presentProviders(accounts: ReadonlyArray<AccountEntry>): Provider[] {
  const present = new Set(accounts.map((account) => account.provider));
  return PRESENT_PROVIDERS.filter((provider) => present.has(provider));
}

function authGate(text: string): HTMLElement {
  return h('div', { class: 'authGate', attrs: { role: 'status' }, children: [h('p', { text })] });
}

function buildStats(accounts: ReadonlyArray<AccountEntry>, state: Readonly<AppState>): HTMLElement {
  let success = 0;
  let error = 0;
  for (const account of accounts) {
    const quota = state.quotaCache.get(account.id);
    if (quota?.status === 'success') success += 1;
    else if (quota?.status === 'error') error += 1;
  }
  const stats = h('div', {
    class: 'statsBar',
    data: { role: 'stats' },
    aria: { label: `共 ${accounts.length} 个账号，成功 ${success}，失败 ${error}` },
  });
  for (const [kind, label, value] of [
    ['total', '账号总数', accounts.length],
    ['success', '查询成功', success],
    ['error', '查询失败', error],
  ] as const) {
    stats.append(h('span', {
      class: `stat stat-${kind}`,
      data: { kind },
      children: [
        h('span', { class: 'statLabel', text: label }),
        h('strong', { class: 'statValue', text: String(value) }),
      ],
    }));
  }
  return stats;
}

function buildTimeline(
  state: Readonly<AppState>,
  ui: QuotaUiState,
  pageAccounts: ReadonlyArray<AccountEntry>,
  resolveLabel: (entry: AccountEntry) => string,
  nowMs: number,
  handlers: QuotaViewHandlers,
): HTMLElement {
  const lanes: Array<{ lane: TimelineLane; label: string }> = [];
  for (const account of pageAccounts) {
    const quota = state.quotaCache.get(account.id);
    if (quota?.status !== 'success') continue;
    const lane = buildTimelineLane({
      name: account.id,
      displayName: resolveLabel(account),
      provider: account.provider,
      quota: quota.data,
      ...(ui.timelineMode === 'session' ? { maxPeriodHours: 5 } : {}),
    });
    lanes.push({ lane, label: resolveLabel(account) });
  }
  const span = timelineSpan(ui.timelineMode, ui.timelineOffset, nowMs);
  const projected: TimelineProjectedLane[] = lanes.map(({ lane, label }) => ({
    lane,
    label,
    windows: projectLane(lane, span.startMs, span.endMs, nowMs, ui.timelineMode),
    credits: projectResetCredits(lane, span.startMs, span.endMs, nowMs),
  }));
  const timelineHandlers: TimelineHandlers = {
    setMode: (mode) => handlers.onTimelineMode?.(mode),
    shiftPeriod: (delta) => handlers.onTimelineShift?.(delta),
    goToday: () => handlers.onTimelineToday?.(),
  };
  const model: TimelineModel = { mode: ui.timelineMode, nowMs, span, lanes: projected };
  return renderTimeline(model, timelineHandlers);
}

function clearChildren(root: HTMLElement): void {
  while (root.lastChild) root.removeChild(root.lastChild);
}

export function renderApp(options: RenderAppOptions): RenderAppHandle {
  const { root, handlers, clock } = options;
  let destroyed = false;
  let lastState: Readonly<AppState> | null = null;
  let lastUi: QuotaUiState | null = null;
  let lastAuth: AuthPhase = 'loading';

  const resolveLabel = (entry: AccountEntry): string => options.resolveLabel?.(entry) ?? entry.id;

  const render = (state: Readonly<AppState>, uiState: QuotaUiState, auth: AuthPhase): void => {
    if (destroyed) return;
    lastState = state;
    lastUi = uiState;
    lastAuth = auth;
    clearChildren(root);

    if (auth === 'loading') { root.append(authGate('正在验证身份…')); return; }
    if (auth === 'error') { root.append(authGate('身份验证失败，请重新进入页面。')); return; }
    if (auth === 'invalid') { root.append(authGate('登录已失效，请重新进入页面。')); return; }

    const nowMs = options.now();
    const headerHandlers = {
      onRefreshAccounts: () => handlers.onRefreshAccounts(),
      onQueryAll: () => handlers.onQueryAll(),
    };
    root.append(renderHeader({
      mode: options.mode,
      handlers: headerHandlers,
    }));

    const accounts = state.accounts;
    root.append(renderTabs({
      providers: presentProviders(accounts),
      selected: uiState.selectedProvider,
      sortMode: uiState.sortMode,
      counts: providerCounts(accounts),
      handlers: {
        onSelectProvider: (selection) => handlers.onSelectProvider(selection),
        onSelectSort: (mode) => handlers.onSelectSort(mode),
      },
    }));

    const { items } = derivePage(state, uiState, options.pageSize, nowMs);
    root.append(buildStats(accounts, state));

    // Spec §7.1 "一小时内最早恢复项强调": per card, the earliest recovering item
    // strictly less than one hour away is marked urgent and its meter row gets
    // a TEXT badge + emphasis class (never color alone).
    const urgentWindowIds = new Map<string, string>();
    for (const account of items) {
      const quota = state.quotaCache.get(account.id);
      if (quota?.status !== 'success') continue;
      const urgentId = urgentRecoveryId(account.provider, quota.data, nowMs);
      if (urgentId !== null) urgentWindowIds.set(account.id, urgentId);
    }

    const grid = h('div', { class: 'cardsGrid' });
    const cardOptions: RenderOptions = {
      mode: options.mode,
      revealAccountIdentity: options.revealAccountIdentity,
      resetAction: options.resetAction,
      anonymousLabel: '',
      nowMs,
      ...(urgentWindowIds.size > 0 ? { urgentWindowIds } : {}),
    };
    const cardHandlers: CardHandlers = {
      onQuery: (accountId) => handlers.onQueryOne(accountId),
      ...(handlers.onReset ? { onReset: (accountId) => handlers.onReset?.(accountId) } : {}),
    };
    for (const account of items) {
      const quota = state.quotaCache.get(account.id) ?? ({ status: 'idle' } as QuotaLoadState);
      const perCardOptions = { ...cardOptions, anonymousLabel: resolveLabel(account) };
      grid.append(renderQuotaCard(account, quota, perCardOptions, cardHandlers));
    }
    if (items.length === 0) {
      grid.append(h('div', { class: 'quotaMessage', text: '暂无账号' }));
    }
    root.append(grid);

    root.append(buildTimeline(state, uiState, items, resolveLabel, nowMs, handlers));
  };

  const unsubscribeClock = clock.subscribe(() => {
    if (destroyed || !lastState || !lastUi) return;
    render(lastState, lastUi, lastAuth);
  });

  return {
    render,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribeClock();
      clearChildren(root);
    },
  };
}
