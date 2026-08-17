import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../src/ui/renderApp';
import type { QuotaViewHandlers, QuotaUiState } from '../../src/ui/renderApp';
import { createQuotaStore } from '../../src/app/state';
import type { QuotaLoadState } from '../../src/app/state';
import type { AccountEntry } from '../../src/quota/types';
import type { AntigravityQuotaData } from '../../src/providers/antigravity/parser';
import type { CodexQuotaData } from '../../src/providers/codex/parser';
import type { XaiQuotaData } from '../../src/providers/xai/parser';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function fakeClock(start = NOW) {
  const listeners = new Set<() => void>();
  let snapshot = start;
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot,
    destroy: vi.fn(() => listeners.clear()),
    tick: () => { snapshot += 60_000; listeners.forEach((l) => l()); },
  };
}

function account(id: string, provider: AccountEntry['provider']): AccountEntry {
  return { id, provider, file: { name: id, provider } };
}

function handlers(): QuotaViewHandlers {
  return {
    onRefreshAccounts: vi.fn(),
    onQueryAll: vi.fn(),
    onQueryOne: vi.fn(),
    onReset: vi.fn(),
    onSelectProvider: vi.fn(),
    onSelectSort: vi.fn(),
    onPageChange: vi.fn(),
    onToggleTheme: vi.fn(),
    onTimelineMode: vi.fn(),
    onTimelineShift: vi.fn(),
    onTimelineToday: vi.fn(),
  };
}

function ui(overrides: Partial<QuotaUiState> = {}): QuotaUiState {
  return {
    selectedProvider: 'all',
    sortMode: 'default',
    currentPage: 1,
    timelineMode: 'weekly',
    timelineOffset: 0,
    ...overrides,
  };
}

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

const handles: ReturnType<typeof renderApp>[] = [];
const roots: HTMLElement[] = [];

afterEach(() => {
  for (const h of handles) h.destroy();
  handles.length = 0;
  for (const r of roots) r.remove();
  roots.length = 0;
  document.body.innerHTML = '';
});

function newRoot(): HTMLElement {
  const root = mount();
  roots.push(root);
  return root;
}

function authenticatedState(accounts: AccountEntry[], quota: Record<string, QuotaLoadState> = {}) {
  const store = createQuotaStore();
  const generation = store.beginAccountGeneration();
  store.replaceAccounts(generation, accounts);
  for (const [id, state] of Object.entries(quota)) store.setQuota(id, generation, state);
  return store.getState();
}

describe('renderApp auth gate', () => {
  it('renders a loading gate and no cards before authentication', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    const store = createQuotaStore();
    handle.render(store.getState(), ui(), 'loading');
    expect(root.querySelector('.card')).toBeNull();
    expect(root.textContent).toContain('身份');
  });

  it('renders an error gate when auth fails', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'claude')]), ui(), 'error');
    expect(root.querySelector('.card')).toBeNull();
    expect(root.textContent).toContain('身份');
  });

  it('hides quota behind an invalid-auth gate', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'claude')]), ui(), 'invalid');
    expect(root.querySelector('.card')).toBeNull();
    expect(root.textContent).toContain('失效');
  });
});

describe('renderApp authenticated shell', () => {
  it('renders tabs with per-provider and total counts', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('c1', 'claude'), account('c2', 'claude'), account('k1', 'kimi')]), ui(), 'authenticated');
    expect(root.querySelector('[data-provider="all"]')?.textContent).toContain('3');
    expect(root.querySelector('[data-provider="claude"]')?.textContent).toContain('2');
    expect(root.querySelector('[data-provider="kimi"]')?.textContent).toContain('1');
  });

  it('renders every card and no pagination controls', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    const accounts = [account('a', 'claude'), account('b', 'claude'), account('c', 'claude'), account('d', 'claude')];
    handle.render(authenticatedState(accounts), ui({ currentPage: 2 }), 'authenticated');
    expect(root.querySelectorAll('.card').length).toBe(4);
    expect(root.querySelector('.pagination')).toBeNull();
  });

  it('ignores legacy page state when rendering the full account list', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'claude'), account('b', 'claude'), account('c', 'claude'), account('d', 'claude')]), ui({ currentPage: 5 }), 'authenticated');
    expect(root.querySelectorAll('.card').length).toBe(4);
  });

  it('marks the selected provider tab active and the others inactive', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('c1', 'claude'), account('k1', 'kimi')]), ui({ selectedProvider: 'kimi' }), 'authenticated');
    expect(root.querySelector('[data-provider="kimi"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('[data-provider="claude"]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('does not render page navigation controls', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'claude'), account('b', 'claude')]), ui(), 'authenticated');
    expect(root.querySelector('[data-action="page-next"]')).toBeNull();
    expect(root.querySelector('[data-action="page-prev"]')).toBeNull();
  });

  it('renders stats totals for the visible set', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    const accounts = [account('c1', 'claude'), account('c2', 'claude'), account('k1', 'kimi')];
    const success: QuotaLoadState = { status: 'success', data: { windows: [{ id: 'x', label: 'x', usedPercent: 10, remainingPercent: 90, resetAtMs: NOW + HOUR, periodHours: 5 }] } as never };
    handle.render(authenticatedState(accounts, { c1: success, c2: { status: 'loading' }, k1: { status: 'error', error: { name: 'E', message: 'bad' } } }), ui(), 'authenticated');
    const stats = root.querySelector('[data-role="stats"]')!.textContent!;
    expect(stats).toContain('3');
    expect(stats).toMatch(/1/); // one success
  });

  it('re-renders relative times when the shared clock ticks', () => {
    const root = newRoot();
    const clock = fakeClock(NOW);
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    const success: QuotaLoadState = { status: 'success', data: { windows: [{ id: 'x', label: 'x', usedPercent: 0, remainingPercent: 100, resetAtMs: NOW + 2 * HOUR, periodHours: 5 }] } as never };
    handle.render(authenticatedState([account('a', 'claude')], { a: success }), ui(), 'authenticated');
    const before = root.querySelector('.quotaReset')?.textContent ?? '';
    clock.tick();
    const after = root.querySelector('.quotaReset')?.textContent ?? '';
    expect(before).not.toBe('');
    expect(after).not.toBe(before);
  });

  it('destroy clears the DOM and unsubscribes the clock', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handle.render(authenticatedState([account('a', 'claude')]), ui(), 'authenticated');
    handle.destroy();
    expect(root.children.length).toBe(0);
    // Clock still has its own destroy; a tick after destroy must not throw and
    // must not touch the detached root.
    expect(() => clock.tick()).not.toThrow();
    expect(root.children.length).toBe(0);
    expect(clock.destroy).toHaveBeenCalledTimes(0); // renderApp must not destroy the injected clock itself on every render
  });

  it('wires the query, refresh and provider handlers to DOM controls', () => {
    const root = newRoot();
    const clock = fakeClock();
    const h = handlers();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: h,
    });
    handles.push(handle);
    const accounts = [account('a', 'claude'), account('b', 'claude'), account('c', 'claude')];
    handle.render(authenticatedState(accounts), ui(), 'authenticated');

    root.querySelector<HTMLElement>('[data-action="refresh-accounts"]')!.click();
    root.querySelector<HTMLElement>('[data-action="query-all"]')!.click();
    expect(root.querySelector('[data-action="page-next"]')).toBeNull();
    root.querySelector<HTMLElement>('[data-provider="claude"]')!.click();
    root.querySelector<HTMLElement>('.card [data-action="query"]')!.click();

    expect(h.onRefreshAccounts).toHaveBeenCalledTimes(1);
    expect(h.onQueryAll).toHaveBeenCalledTimes(1);
    expect(h.onPageChange).not.toHaveBeenCalled();
    expect(h.onSelectProvider).toHaveBeenCalledWith('claude');
    expect(h.onQueryOne).toHaveBeenCalledWith('a');

    expect(root.querySelector<HTMLElement>('[data-action="query-all"]')!.textContent).toContain('查询全部账号额度');
    expect(root.querySelector('[data-action="toggle-theme"]')).toBeNull();
    expect(root.querySelector('.pageTitle')).toBeNull();
  });
});

/**
 * Spec §9 "最快恢复排序" via the canonical resetSchedule module, plus §7.1
 * "一小时内最早恢复项强调" (urgent recovery emphasis). The view must derive the
 * sort key from nextRecoveryMs (Antigravity buckets, xAI weekly billing,
 * Codex available credits) instead of only data.windows[].resetAtMs, must
 * never let a past reset time win, and must badge the earliest item that is
 * strictly less than one hour away with TEXT + class (never color alone).
 */
describe('renderApp soonest sort recovery semantics (spec §9)', () => {
  function renderSoonest(accounts: AccountEntry[], quota: Record<string, QuotaLoadState>): HTMLElement {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState(accounts, quota), ui({ sortMode: 'soonest' }), 'authenticated');
    return root;
  }

  function cardOrder(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('.card')).map((card) => card.querySelector('.fileName')?.textContent ?? '');
  }

  function antigravityBucket(resetAtMs: number): AntigravityQuotaData {
    return {
      groups: [{ id: 'g', label: 'Group', buckets: [{ id: 'b1', label: '5h', window: '5h', remainingFraction: 0.5, resetTime: null, resetAtMs, periodHours: 5 }] }],
      subscription: null,
      serverTimeOffsetMs: null,
    };
  }

  function xaiWeekly(resetAtMs: number): XaiQuotaData {
    return {
      windows: [],
      billing: {
        mode: 'billing', periodType: 'weekly', usagePercent: 10, resetAtMs, periodHours: 168,
        productUsage: [], monthlyLimitCents: null, usedCents: null, includedUsedCents: null,
        onDemandCapCents: null, onDemandUsedCents: null, onDemandUsedPercent: null, usedPercent: 10,
      },
    };
  }

  it('sorts an Antigravity bucket recovery before unloaded accounts', () => {
    // 'ag' sits LAST in the default order; its bucket recovery (2h) must lift
    // it above both unloaded accounts (spec §9: 未加载账号沉底).
    const accounts = [account('u1', 'claude'), account('u2', 'kimi'), account('ag', 'antigravity')];
    const root = renderSoonest(accounts, { ag: { status: 'success', data: antigravityBucket(NOW + 2 * HOUR) } });
    expect(cardOrder(root)).toEqual(['ag', 'u1', 'u2']);
  });

  it('sorts xAI weekly billing recovery from windows:[] billing data', () => {
    const accounts = [account('u1', 'claude'), account('u2', 'kimi'), account('x', 'xai')];
    const root = renderSoonest(accounts, { x: { status: 'success', data: xaiWeekly(NOW + 3 * HOUR) } });
    expect(cardOrder(root)).toEqual(['x', 'u1', 'u2']);
  });

  it('counts a Codex available reset credit as the soonest recovery', () => {
    // Codex windows recover at +5h — LATER than claude's window (+2h) — but its
    // available reset credit expires at +30m, which spec §9 counts as recovery.
    const codex: CodexQuotaData = {
      windows: [{ id: 'w', label: 'Weekly', usedPercent: 10, remainingPercent: 90, resetAtMs: NOW + 5 * HOUR, periodHours: 168 }],
      credits: [{ id: 'credit', resetType: 'codex_rate_limits', status: 'available', grantedAtMs: null, expiresAtMs: NOW + 30 * 60 * 1000 }],
      accountId: null, planType: null, subscriptionActiveUntil: null,
      availableCreditCount: 1, applicableAvailableCreditCount: 1,
    };
    const claude = { windows: [{ id: 'w', label: '5h', usedPercent: 10, remainingPercent: 90, resetAtMs: NOW + 2 * HOUR, periodHours: 5 }] } as never;
    const accounts = [account('cx', 'codex'), account('cl', 'claude')];
    const root = renderSoonest(accounts, { cx: { status: 'success', data: codex }, cl: { status: 'success', data: claude } });
    expect(cardOrder(root)).toEqual(['cx', 'cl']);
  });

  it('never lets a past reset time win the soonest slot', () => {
    // 'ag' only has a PAST bucket reset (ad-hoc Math.min would report it as
    // earliest); 'x' has a future weekly billing reset. The past instant must
    // be ignored, so 'x' sorts above 'ag'.
    const accounts = [account('ag', 'antigravity'), account('x', 'xai')];
    const root = renderSoonest(accounts, {
      ag: { status: 'success', data: antigravityBucket(NOW - HOUR) },
      x: { status: 'success', data: xaiWeekly(NOW + 3 * HOUR) },
    });
    expect(cardOrder(root)).toEqual(['x', 'ag']);
  });
});

describe('renderApp urgent recovery emphasis (spec §7.1, strictly < 1h)', () => {
  function urgentRoot(quota: Record<string, QuotaLoadState>): HTMLElement {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 20, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'antigravity')], quota), ui(), 'authenticated');
    return root;
  }

  function antigravityBucket(resetAtMs: number): AntigravityQuotaData {
    return {
      groups: [{ id: 'g', label: 'Group', buckets: [{ id: 'b1', label: '5h', window: '5h', remainingFraction: 0.5, resetTime: null, resetAtMs, periodHours: 5 }] }],
      subscription: null,
      serverTimeOffsetMs: null,
    };
  }

  it('badges the earliest window recovering in under one hour with text + class', () => {
    const root = urgentRoot({ a: { status: 'success', data: antigravityBucket(NOW + 30 * 60 * 1000) } });
    const urgentRow = root.querySelector('.quotaRow.urgent');
    expect(urgentRow).not.toBeNull();
    expect(urgentRow!.textContent).toContain('即将恢复');
  });

  it('does not badge a recovery exactly one hour away', () => {
    const root = urgentRoot({ a: { status: 'success', data: antigravityBucket(NOW + HOUR) } });
    expect(root.querySelector('.quotaRow.urgent')).toBeNull();
    expect(root.textContent).not.toContain('即将恢复');
  });

  it('does not badge a recovery in the past', () => {
    const root = urgentRoot({ a: { status: 'success', data: antigravityBucket(NOW - HOUR) } });
    expect(root.querySelector('.quotaRow.urgent')).toBeNull();
    expect(root.textContent).not.toContain('即将恢复');
  });

  it('badges only the earliest urgent window, not every window under one hour', () => {
    const data: AntigravityQuotaData = {
      groups: [{
        id: 'g',
        label: 'Group',
        buckets: [
          { id: 'later', label: 'Later', window: '5h', remainingFraction: 0.5, resetTime: null, resetAtMs: NOW + 40 * 60 * 1000, periodHours: 5 },
          { id: 'sooner', label: 'Sooner', window: 'weekly', remainingFraction: 0.5, resetTime: null, resetAtMs: NOW + 10 * 60 * 1000, periodHours: 168 },
        ],
      }],
      subscription: null,
      serverTimeOffsetMs: null,
    };
    const root = urgentRoot({ a: { status: 'success', data } });
    const urgentRows = root.querySelectorAll('.quotaRow.urgent');
    expect(urgentRows.length).toBe(1);
    expect(urgentRows[0].getAttribute('data-window-id')).toBe('sooner');
  });
});
