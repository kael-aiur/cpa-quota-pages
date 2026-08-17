import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTimeline } from '../../src/ui/renderTimeline';
import type {
  TimelineHandlers,
  TimelineModel,
  TimelineProjectedLane,
} from '../../src/ui/renderTimeline';
import type {
  TimelineLane,
  TimelineSpan,
  TimelineWindow,
} from '../../src/quota/timelineModel';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0); // 2026-08-13 12:00 UTC
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function span(overrides: Partial<TimelineSpan> = {}): TimelineSpan {
  return {
    startMs: NOW - 7 * DAY,
    endMs: NOW + 7 * DAY,
    days: 14,
    isCurrentPeriod: true,
    nowPositionPercent: 50,
    ...overrides,
  };
}

function lane(overrides: Partial<TimelineLane> = {}): TimelineLane {
  return {
    name: 'claude-a',
    displayName: 'Claude A',
    provider: 'claude',
    anchorMs: NOW + 6 * DAY,
    periodHours: 168,
    remaining: 60,
    limits: [{ label: 'Weekly', remaining: 60 }],
    resetCredits: [],
    ...overrides,
  };
}

function win(overrides: Partial<TimelineWindow> = {}): TimelineWindow {
  return {
    startMs: NOW - DAY,
    endMs: NOW + 6 * DAY,
    leftPercent: 30,
    widthPercent: 25,
    state: 'live',
    remaining: 60,
    ...overrides,
  };
}

function projectedLane(
  overrides: Partial<TimelineProjectedLane> = {},
): TimelineProjectedLane {
  return {
    lane: lane(),
    windows: [win()],
    credits: [],
    label: 'Claude · ABC123',
    ...overrides,
  };
}

function model(overrides: Partial<TimelineModel> = {}): TimelineModel {
  return {
    mode: 'weekly',
    nowMs: NOW,
    span: span(),
    lanes: [projectedLane()],
    ...overrides,
  };
}

function handlers(): TimelineHandlers {
  return {
    setMode: vi.fn(),
    shiftPeriod: vi.fn(),
    goToday: vi.fn(),
  };
}

beforeEach(() => {
  delete (window as unknown as { __pwnedTimeline?: number }).__pwnedTimeline;
});

afterEach(() => {
  delete (window as unknown as { __pwnedTimeline?: number }).__pwnedTimeline;
});

describe('renderTimeline empty state', () => {
  it('keeps the mode shell when there are no lanes', () => {
    const root = renderTimeline(model({ lanes: [] }), handlers());
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.querySelector('.timelineModeTabs')).not.toBeNull();
    expect(root.querySelector('[data-reason="not-loaded"]')).not.toBeNull();
  });

  it('keeps the mode shell when no lane is compatible with the selected mode', () => {
    const emptyProjected = projectedLane({ windows: [], credits: [] });
    const root = renderTimeline(model({ lanes: [emptyProjected] }), handlers());
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.querySelector('[data-reason="no-compatible-window"]')).not.toBeNull();
  });

  it('keeps lanes that still project windows and drops the empty ones', () => {
    const good = projectedLane({ label: 'Claude · KEEP' });
    const empty = projectedLane({ label: 'Codex · DROP', windows: [], credits: [] });
    const root = renderTimeline(model({ lanes: [good, empty] }), handlers());
    expect(root).not.toBeNull();
    const names = Array.from(root!.querySelectorAll('.timelineLaneName')).map((el) => el.textContent ?? '');
    expect(names).toContain('【Claude】Claude · KEEP');
    expect(names).not.toContain('【Codex】Codex · DROP');
  });
});

describe('renderTimeline mode tabs', () => {
  it('renders Weekly and Session tabs and marks the active mode', () => {
    const root = renderTimeline(model({ mode: 'weekly' }), handlers());
    const tabs = root!.querySelectorAll('.timelineModeTab');
    expect(tabs.length).toBe(2);
    const weekly = root!.querySelector('.timelineModeTab[data-mode="weekly"]') as HTMLElement;
    const session = root!.querySelector('.timelineModeTab[data-mode="session"]') as HTMLElement;
    expect(weekly.getAttribute('aria-selected')).toBe('true');
    expect(session.getAttribute('aria-selected')).toBe('false');
  });

  it('invokes setMode when the inactive tab is activated', () => {
    const h = handlers();
    const root = renderTimeline(model({ mode: 'weekly' }), h);
    const session = root!.querySelector('.timelineModeTab[data-mode="session"]') as HTMLElement;
    session.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.setMode).toHaveBeenCalledWith('session');
  });

  it('does not invoke setMode when clicking the already-active tab', () => {
    const h = handlers();
    const root = renderTimeline(model({ mode: 'weekly' }), h);
    const weekly = root!.querySelector('.timelineModeTab[data-mode="weekly"]') as HTMLElement;
    weekly.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.setMode).not.toHaveBeenCalled();
  });
});

describe('renderTimeline period controls', () => {
  it('renders prior, next and Today controls wired to the handlers', () => {
    const h = handlers();
    const root = renderTimeline(model({ span: span({ isCurrentPeriod: true }) }), h);
    const prior = root!.querySelector('[data-action="prior"]') as HTMLElement;
    const next = root!.querySelector('[data-action="next"]') as HTMLElement;
    const today = root!.querySelector('[data-action="today"]') as HTMLElement;
    expect(prior).not.toBeNull();
    expect(next).not.toBeNull();
    expect(today).not.toBeNull();

    prior.dispatchEvent(new Event('click', { bubbles: true }));
    next.dispatchEvent(new Event('click', { bubbles: true }));
    today.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.shiftPeriod).toHaveBeenCalledWith(-1);
    expect(h.shiftPeriod).toHaveBeenCalledWith(1);
    expect(h.goToday).toHaveBeenCalledTimes(1);
  });

  it('disables Today while already on the current period', () => {
    const root = renderTimeline(model({ span: span({ isCurrentPeriod: true }) }), handlers());
    const today = root!.querySelector('[data-action="today"]') as HTMLButtonElement;
    expect(today.disabled).toBe(true);
  });

  it('enables Today when viewing a period away from today', () => {
    const root = renderTimeline(model({ span: span({ isCurrentPeriod: false }) }), handlers());
    const today = root!.querySelector('[data-action="today"]') as HTMLButtonElement;
    expect(today.disabled).toBe(false);
  });
});

describe('renderTimeline plot structure', () => {
  it('renders an independently scrollable track region separate from the labels', () => {
    const root = renderTimeline(model(), handlers());
    const viewport = root!.querySelector('.timelineViewport');
    const labelCol = root!.querySelector('.timelineLabelColumn');
    const trackScroll = root!.querySelector('.timelineTrackScroll');
    expect(viewport).not.toBeNull();
    expect(labelCol).not.toBeNull();
    expect(trackScroll).not.toBeNull();
    // Labels live outside the scroll region so only the plot scrolls.
    expect(trackScroll!.contains(labelCol!)).toBe(false);
    expect(labelCol!.parentElement).toBe(viewport);
    expect(trackScroll!.parentElement).toBe(viewport);
  });

  it('shows a provider identity dot and the account label per lane', () => {
    const root = renderTimeline(model(), handlers());
    const labelRow = root!.querySelector('.timelineLaneLabel');
    expect(labelRow).not.toBeNull();
    const dot = labelRow!.querySelector('.timelineProviderDot[data-provider="claude"]');
    expect(dot).not.toBeNull();
    expect(labelRow!.querySelector('.timelineLaneName')?.textContent).toContain('Claude · ABC123');
  });
});

describe('renderTimeline window states', () => {
  it('emits past/live/upcoming classes and the matching status text labels', () => {
    const windows: TimelineWindow[] = [
      win({ state: 'past', leftPercent: 5, widthPercent: 20, remaining: null }),
      win({ state: 'live', leftPercent: 30, widthPercent: 25, remaining: 60 }),
      win({ state: 'upcoming', leftPercent: 60, widthPercent: 25, remaining: null }),
    ];
    const root = renderTimeline(
      model({ lanes: [projectedLane({ windows })] }),
      handlers(),
    );
    const states = Array.from(root!.querySelectorAll('.timelineWindow')).map((el) =>
      el.getAttribute('data-state'),
    );
    expect(states).toEqual(expect.arrayContaining(['past', 'live', 'upcoming']));

    const legend = root!.querySelector('.timelineLegend');
    expect(legend).not.toBeNull();
    const legendText = legend!.textContent ?? '';
    // Status is never color alone: each state ships a text word.
    expect(legendText).toContain('已重置');
    expect(legendText).toContain('进行中');
    expect(legendText).toContain('待开始');
  });

  it('positions windows by numeric left/width percent from the model', () => {
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            windows: [win({ state: 'live', leftPercent: 33.5, widthPercent: 24.5, remaining: 42 })],
          }),
        ],
      }),
      handlers(),
    );
    const mark = root!.querySelector('.timelineWindow[data-state="live"]') as HTMLElement;
    expect(mark.style.getPropertyValue('left')).toBe('33.5%');
    expect(mark.style.getPropertyValue('width')).toBe('24.5%');
  });
});

describe('renderTimeline now line', () => {
  it('renders the now marker at the current-time percent', () => {
    const root = renderTimeline(
      model({ span: span({ nowPositionPercent: 47.5 }) }),
      handlers(),
    );
    const now = root!.querySelector('.timelineNow') as HTMLElement;
    expect(now).not.toBeNull();
    expect(now.style.getPropertyValue('left')).toBe('47.5%');
  });

  it('omits the now marker when now is outside the span', () => {
    const root = renderTimeline(
      model({ span: span({ nowPositionPercent: null }) }),
      handlers(),
    );
    expect(root!.querySelector('.timelineNow')).toBeNull();
  });
});

describe('renderTimeline credit tick', () => {
  it('renders a focusable Codex credit-expiry tick on the lane', () => {
    const credits = [
      { id: 'cred-1', grantedAtMs: NOW, expiresAtMs: NOW + 2 * DAY, leftPercent: 18 },
    ];
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            lane: lane({ provider: 'codex', name: 'codex-b', displayName: 'Codex B' }),
            label: 'Codex · DEF456',
            credits,
          }),
        ],
      }),
      handlers(),
    );
    const tick = root!.querySelector('.timelineCredit[data-id="cred-1"]') as HTMLElement;
    expect(tick).not.toBeNull();
    expect(tick.getAttribute('tabindex')).toBe('0');
    expect(tick.style.getPropertyValue('left')).toBe('18%');
    // The tick is Codex credit-specific and carries descriptive text.
    expect(tick.getAttribute('aria-label') ?? '').toContain('额度重置券');
  });
});

describe('renderTimeline accessibility', () => {
  it('makes every window keyboard-focusable with an aria-label of the details', () => {
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            label: 'Claude · ABC123',
            windows: [win({ state: 'live', remaining: 60 })],
          }),
        ],
      }),
      handlers(),
    );
    const mark = root!.querySelector('.timelineWindow[data-state="live"]') as HTMLElement;
    expect(mark.getAttribute('tabindex')).toBe('0');
    const aria = mark.getAttribute('aria-label') ?? '';
    expect(aria).toContain('Claude · ABC123');
    expect(aria).toContain('进行中');
    expect(aria).toContain('剩余');
    expect(aria).toContain('60');
  });

  it('exposes a visually-hidden table equivalent with account/window/state/remaining/reset columns', () => {
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            label: 'Claude · ABC123',
            windows: [win({ state: 'live', remaining: 60 })],
          }),
        ],
      }),
      handlers(),
    );
    const table = root!.querySelector('table.timelineTable') as HTMLTableElement;
    expect(table).not.toBeNull();
    const headers = Array.from(table.querySelectorAll('thead th')).map((el) => el.textContent ?? '');
    for (const required of ['账号', '窗口', '状态', '剩余', '重置时间']) {
      expect(headers, `missing column ${required}`).toEqual(expect.arrayContaining([required]));
    }
    const firstRow = table.querySelector('tbody tr');
    expect(firstRow).not.toBeNull();
    const cells = Array.from(firstRow!.querySelectorAll('td')).map((el) => el.textContent ?? '');
    const rowText = cells.join('|');
    expect(rowText).toContain('Claude · ABC123');
    expect(rowText).toContain('进行中');
  });
});

describe('renderTimeline tooltip layer', () => {
  it('reveals a text-node tooltip with the details on focus and hides it on blur', () => {
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            label: 'Claude · ABC123',
            windows: [win({ state: 'live', remaining: 60 })],
          }),
        ],
      }),
      handlers(),
    );
    const tooltip = root!.querySelector('.timelineTooltip') as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.hasAttribute('hidden')).toBe(true);

    const mark = root!.querySelector('.timelineWindow[data-state="live"]') as HTMLElement;
    mark.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    expect(tooltip.hasAttribute('hidden')).toBe(false);
    const text = tooltip.textContent ?? '';
    expect(text).toContain('Claude · ABC123');
    expect(text).toContain('进行中');

    mark.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(tooltip.hasAttribute('hidden')).toBe(true);
  });

  it('never injects dynamic label text as executable markup', () => {
    const payload = '<img src=x onerror="window.__pwnedTimeline=1">';
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            label: payload,
            windows: [win({ state: 'live', remaining: 60 })],
          }),
        ],
      }),
      handlers(),
    );
    // The raw payload survives as inert text somewhere in the tree...
    expect(root!.textContent ?? '').toContain(payload);
    // ...but never as a real element, and the handler never fires.
    expect(root!.querySelectorAll('img').length).toBe(0);
    expect(root!.querySelectorAll('script').length).toBe(0);
    expect((window as unknown as { __pwnedTimeline?: number }).__pwnedTimeline).toBeUndefined();

    const mark = root!.querySelector('.timelineWindow[data-state="live"]') as HTMLElement;
    mark.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    const tooltip = root!.querySelector('.timelineTooltip') as HTMLElement;
    expect(tooltip.querySelectorAll('img').length).toBe(0);
    expect(tooltip.textContent ?? '').toContain(payload);
    expect((window as unknown as { __pwnedTimeline?: number }).__pwnedTimeline).toBeUndefined();
  });
});

describe('renderTimeline provider identity as text (a11y)', () => {
  it('renders provider and account together in the timeline lane label', () => {
    // Timeline labels intentionally use the explicit 【provider】account form;
    // the card itself already has a separate provider badge.
    const root = renderTimeline(
      model({
        lanes: [
          projectedLane({
            lane: lane({ provider: 'codex', name: 'codex-b', displayName: 'Codex B' }),
            label: 'DEF456',
            windows: [win({ state: 'live', remaining: 60 })],
          }),
        ],
      }),
      handlers(),
    );
    const labelRow = root!.querySelector('.timelineLaneLabel');
    expect(labelRow).not.toBeNull();
    expect(labelRow!.querySelector('.timelineLaneName')?.textContent).toBe('【Codex】DEF456');
  });
});
