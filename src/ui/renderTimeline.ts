/**
 * Recovery timeline view (Weekly / Session).
 *
 * This is a pure view over the {@link TimelineModel} produced by the timeline
 * model layer (Task 10). It owns no state and performs no fetching — the app
 * orchestration (Task 15) builds the model and supplies the handlers.
 *
 * Dataviz contract honored here:
 *  - Provider identity uses a FIXED categorical color order keyed by provider
 *    (never cycled, never re-derived from rank). The color appears only on the
 *    small identity dot beside the lane label; all text wears text tokens.
 *  - past / live / upcoming are STATUS: each carries a state class, a shape/
 *    texture treatment, AND a text label — never color alone.
 *  - Every window/credit mark is keyboard-focusable and exposes its full detail
 *    via aria-label. A shared tooltip surfaces the same detail for sighted
 *    users, and ALL dynamic text is placed through textContent / text nodes —
 *    there is no innerHTML of dynamic text anywhere.
 *  - A visually-hidden <table> mirrors the plotted data for assistive tech.
 *  - Only `.timelineTrackScroll` may scroll horizontally; the page itself never
 *    overflows, even at 420px.
 */

import type { Provider } from '../providers/types';
import type {
  TimelineCredit,
  TimelineLane,
  TimelineSpan,
  TimelineWindow,
} from '../quota/timelineModel';
import { formatResetLabel } from '../quota/relativeTime';
import { h } from './dom';

export interface TimelineHandlers {
  setMode(mode: 'weekly' | 'session'): void;
  shiftPeriod(delta: -1 | 1): void;
  goToday(): void;
}

/** A single lane after projection: the source lane plus its ready-to-render windows/credits. */
export interface TimelineProjectedLane {
  lane: TimelineLane;
  windows: TimelineWindow[];
  credits: Array<TimelineCredit & { leftPercent: number }>;
  /** Anonymous or revealed account label (already resolved upstream). */
  label: string;
}

export interface TimelineModel {
  mode: 'weekly' | 'session';
  /** Snapshot time used for relative/state projection; defaults to Date.now() upstream. */
  nowMs: number;
  span: TimelineSpan;
  lanes: TimelineProjectedLane[];
}

type WindowState = TimelineWindow['state'];

const STATE_LABEL: Record<WindowState, string> = {
  past: '已重置',
  live: '进行中',
  upcoming: '待开始',
};

const STATE_ORDER: ReadonlyArray<WindowState> = ['past', 'live', 'upcoming'];

const MODE_TABS: ReadonlyArray<{ mode: 'weekly' | 'session'; label: string }> = [
  { mode: 'weekly', label: '周' },
  { mode: 'session', label: '会话' },
];

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  antigravity: 'Antigravity',
  codex: 'Codex',
  xai: 'xAI',
  kimi: 'Kimi',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function chevron(direction: 'left' | 'right'): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6');
  el.append(p);
  return el;
}

function remainingText(remaining: number | null): string | null {
  if (remaining === null || !Number.isFinite(remaining)) return null;
  return `${Math.round(remaining)}%`;
}

function windowDetail(label: string, window: TimelineWindow, nowMs: number): string {
  const stateWord = STATE_LABEL[window.state];
  const remaining = remainingText(window.remaining);
  const remainingClause = remaining ? ` · 剩余 ${remaining}` : '';
  return `${label} · ${stateWord}${remainingClause} · 重置 ${formatResetLabel(window.endMs, nowMs)}`;
}

function creditDetail(label: string, credit: TimelineCredit, nowMs: number): string {
  return `${label} · 额度重置券 · 过期 ${formatResetLabel(credit.expiresAtMs, nowMs)}`;
}

/** Show/hide a single shared tooltip from a focusable mark. Text is assigned via textContent. */
function wireTooltip(target: HTMLElement, tooltip: HTMLElement, detail: string, leftCss: string): void {
  const show = (): void => {
    tooltip.textContent = detail;
    tooltip.style.setProperty('left', leftCss);
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
  };
  const hide = (): void => {
    tooltip.hidden = true;
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.textContent = '';
  };
  target.addEventListener('focus', show);
  target.addEventListener('blur', hide);
  target.addEventListener('mouseenter', show);
  target.addEventListener('mouseleave', hide);
}

function buildHeader(model: TimelineModel, handlers: TimelineHandlers): HTMLElement {
  const header = h('div', { class: 'timelineHeader' });

  const tablist = h('div', {
    class: 'timelineModeTabs',
    attrs: { role: 'tablist' },
    aria: { label: '时间线模式' },
  });
  for (const { mode, label } of MODE_TABS) {
    const active = model.mode === mode;
    const tab = h('button', {
      class: `timelineModeTab${active ? ' is-active' : ''}`,
      attrs: { type: 'button', role: 'tab', 'data-mode': mode, 'aria-selected': active ? 'true' : 'false' },
      text: label,
    });
    tab.addEventListener('click', () => {
      if (!active) handlers.setMode(mode);
    });
    tablist.append(tab);
  }
  header.append(tablist);

  const controls = h('div', { class: 'timelineControls' });

  const prior = h('button', {
    class: 'timelineNav',
    attrs: { type: 'button', 'data-action': 'prior', 'aria-label': '上一周期' },
  });
  prior.append(chevron('left'));
  prior.addEventListener('click', () => handlers.shiftPeriod(-1));

  const today = h('button', {
    class: 'timelineToday',
    attrs: { type: 'button', 'data-action': 'today' },
    text: '今天',
  });
  today.disabled = model.span.isCurrentPeriod;
  today.addEventListener('click', () => handlers.goToday());

  const next = h('button', {
    class: 'timelineNav',
    attrs: { type: 'button', 'data-action': 'next', 'aria-label': '下一周期' },
  });
  next.append(chevron('right'));
  next.addEventListener('click', () => handlers.shiftPeriod(1));

  controls.append(prior, today, next);
  header.append(controls);
  return header;
}

function buildLabelColumn(lanes: ReadonlyArray<TimelineProjectedLane>): HTMLElement {
  const col = h('div', { class: 'timelineLabelColumn' });
  for (const pl of lanes) {
    const row = h('div', { class: 'timelineLaneLabel' });
    // Provider identity is NEVER carried by color alone (dataviz rule). The
    // colored dot is sub-3:1 for several light-theme slots, so the provider
    // name is also emitted as visually-hidden text — the relief channel for
    // screen-reader and CVD / low-contrast readers. It precedes the account
    // label in DOM so it reads "[provider] [account]".
    row.append(
      h('span', { class: 'timelineProviderDot', data: { provider: pl.lane.provider }, aria: { hidden: 'true' } }),
      h('span', { class: 'timelineProviderName timelineSrOnly', text: PROVIDER_LABEL[pl.lane.provider] }),
      h('span', { class: 'timelineLaneName', text: pl.label }),
    );
    col.append(row);
  }
  return col;
}

function buildLaneTrack(pl: TimelineProjectedLane, nowMs: number, tooltip: HTMLElement): HTMLElement {
  const track = h('div', { class: 'timelineLaneTrack' });

  for (const w of pl.windows) {
    const detail = windowDetail(pl.label, w, nowMs);
    const mark = h('button', {
      class: `timelineWindow is-${w.state}`,
      attrs: { type: 'button', tabindex: '0', 'data-state': w.state },
      style: { left: `${w.leftPercent}%`, width: `${w.widthPercent}%` },
      aria: { label: detail },
    });
    const remaining = remainingText(w.remaining);
    if (w.state === 'live' && remaining) {
      mark.append(h('span', { class: 'timelineWindowLabel', text: `剩余 ${remaining}` }));
    }
    wireTooltip(mark, tooltip, detail, `${w.leftPercent}%`);
    track.append(mark);
  }

  for (const c of pl.credits) {
    const detail = creditDetail(pl.label, c, nowMs);
    const tick = h('button', {
      class: 'timelineCredit',
      attrs: { type: 'button', tabindex: '0', 'data-id': c.id },
      style: { left: `${c.leftPercent}%` },
      aria: { label: detail },
      title: '额度重置券',
    });
    tick.append(h('span', { class: 'timelineCreditMark', aria: { hidden: 'true' } }));
    wireTooltip(tick, tooltip, detail, `${c.leftPercent}%`);
    track.append(tick);
  }

  return track;
}

function buildLegend(): HTMLElement {
  const legend = h('div', { class: 'timelineLegend', aria: { label: '窗口状态图例' } });
  for (const state of STATE_ORDER) {
    const item = h('div', { class: 'timelineLegendItem', attrs: { 'data-state': state } });
    item.append(
      h('span', { class: `timelineLegendSwatch is-${state}`, aria: { hidden: 'true' } }),
      h('span', { class: 'timelineLegendText', text: STATE_LABEL[state] }),
    );
    legend.append(item);
  }
  return legend;
}

function buildTable(lanes: ReadonlyArray<TimelineProjectedLane>, nowMs: number): HTMLElement {
  const table = h('table', { class: 'timelineTable timelineSrOnly' });
  const headRow = h('tr');
  for (const col of ['账号', '窗口', '状态', '剩余', '重置时间']) {
    headRow.append(h('th', { text: col }));
  }
  table.append(h('thead', { children: [headRow] }));

  const tbody = h('tbody');
  for (const pl of lanes) {
    const windowName = pl.lane.limits[0]?.label ?? PROVIDER_LABEL[pl.lane.provider];
    for (const w of pl.windows) {
      const remaining = remainingText(w.remaining);
      tbody.append(
        h('tr', {
          children: [
            h('td', { text: pl.label }),
            h('td', { text: windowName }),
            h('td', { text: STATE_LABEL[w.state] }),
            h('td', { text: remaining ?? '—' }),
            h('td', { text: formatResetLabel(w.endMs, nowMs) }),
          ],
        }),
      );
    }
  }
  table.append(tbody);
  return table;
}

/**
 * Render the timeline. Returns null when no lane projects any parseable window
 * or credit (the model carries pre-projected lanes; empty lanes are dropped).
 */
export function renderTimeline(model: TimelineModel, handlers: TimelineHandlers): HTMLElement | null {
  const lanes = model.lanes.filter((pl) => pl.windows.length > 0 || pl.credits.length > 0);
  if (lanes.length === 0) return null;

  const nowMs = model.nowMs;

  const root = h('section', {
    class: 'timeline',
    data: { mode: model.mode, state: 'ready' },
    aria: { label: '额度恢复时间线' },
  });

  root.append(buildHeader(model, handlers));

  const viewport = h('div', { class: 'timelineViewport' });
  viewport.append(buildLabelColumn(lanes));

  const trackScroll = h('div', { class: 'timelineTrackScroll' });
  const trackArea = h('div', { class: 'timelineTrackArea' });

  if (model.span.nowPositionPercent !== null && Number.isFinite(model.span.nowPositionPercent)) {
    trackArea.append(
      h('div', {
        class: 'timelineNow',
        aria: { hidden: 'true' },
        style: { left: `${model.span.nowPositionPercent}%` },
      }),
    );
  }

  const tooltip = h('div', { class: 'timelineTooltip', attrs: { role: 'tooltip' } });
  tooltip.hidden = true;
  tooltip.setAttribute('aria-hidden', 'true');

  for (const pl of lanes) {
    trackArea.append(buildLaneTrack(pl, nowMs, tooltip));
  }

  trackArea.append(tooltip);
  trackScroll.append(trackArea);
  viewport.append(trackScroll);
  root.append(viewport);

  root.append(buildLegend());
  root.append(buildTable(lanes, nowMs));

  return root;
}
