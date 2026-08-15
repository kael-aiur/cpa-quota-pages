import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../src/ui/renderApp';
import type { QuotaViewHandlers, QuotaUiState } from '../../src/ui/renderApp';
import { createQuotaStore } from '../../src/app/state';
import type { QuotaLoadState } from '../../src/app/state';
import type { AccountEntry } from '../../src/quota/types';

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

  it('renders only the current page of cards', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    const accounts = [account('a', 'claude'), account('b', 'claude'), account('c', 'claude'), account('d', 'claude')];
    handle.render(authenticatedState(accounts), ui({ currentPage: 2 }), 'authenticated');
    expect(root.querySelectorAll('.card').length).toBe(2);
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('2');
  });

  it('clamps the displayed page when the page number exceeds total pages', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    // 4 accounts, pageSize 2 → 2 pages; request page 5 must clamp to 2.
    handle.render(authenticatedState([account('a', 'claude'), account('b', 'claude'), account('c', 'claude'), account('d', 'claude')]), ui({ currentPage: 5 }), 'authenticated');
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('2');
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

  it('disables the next-page control on the last page', () => {
    const root = newRoot();
    const clock = fakeClock();
    const handle = renderApp({
      root, mode: 'user', revealAccountIdentity: false, resetAction: null,
      pageSize: 2, now: () => clock.getSnapshot(), clock, handlers: handlers(),
    });
    handles.push(handle);
    handle.render(authenticatedState([account('a', 'claude'), account('b', 'claude')]), ui(), 'authenticated');
    expect((root.querySelector('[data-action="page-next"]') as HTMLButtonElement)?.disabled).toBe(true);
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

  it('wires the query, refresh, page and provider handlers to DOM controls', () => {
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
    root.querySelector<HTMLElement>('[data-action="page-next"]')!.click();
    root.querySelector<HTMLElement>('[data-provider="claude"]')!.click();
    root.querySelector<HTMLElement>('.card [data-action="query"]')!.click();

    expect(h.onRefreshAccounts).toHaveBeenCalledTimes(1);
    expect(h.onQueryAll).toHaveBeenCalledTimes(1);
    expect(h.onPageChange).toHaveBeenCalledWith(2);
    expect(h.onSelectProvider).toHaveBeenCalledWith('claude');
    expect(h.onQueryOne).toHaveBeenCalledWith('a');
  });
});
