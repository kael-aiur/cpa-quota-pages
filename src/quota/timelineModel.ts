import type { Provider } from '../providers/types';

const HOUR_MS = 60 * 60 * 1000;
type TimelineMode = 'weekly' | 'session';
export interface TimelineSpan { startMs: number; endMs: number; days: number }
export interface TimelineLimit { label: string; remaining: number }
export interface TimelineCredit { id: string; grantedAtMs: number | null; expiresAtMs: number }
export interface TimelineLane { name: string; displayName: string; provider: Provider; anchorMs: number | null; periodHours: number | null; remaining: number | null; limits: TimelineLimit[]; resetCredits: TimelineCredit[] }
export interface TimelineWindow { startMs: number; endMs: number; leftPercent: number; widthPercent: number; state: 'past' | 'live' | 'upcoming'; remaining: number | null }
export interface TimelineLaneInput { name: string; displayName: string; provider: Provider; quota: unknown; maxPeriodHours?: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const startDay = (ms: number): number => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };
const startWeek = (ms: number): number => { const date = new Date(startDay(ms)); date.setDate(date.getDate() - date.getDay()); return date.getTime(); };

export function timelineSpan(mode: TimelineMode, offset: number, nowMs: number): TimelineSpan {
  const days = mode === 'weekly' ? 14 : 3;
  const date = new Date(mode === 'weekly' ? startWeek(nowMs) : startDay(nowMs));
  date.setDate(date.getDate() + offset * (mode === 'weekly' ? 7 : 1));
  const end = new Date(date);
  end.setDate(end.getDate() + days);
  return { startMs: date.getTime(), endMs: end.getTime(), days };
}

function empty(input: TimelineLaneInput): TimelineLane { return { name: input.name, displayName: input.displayName, provider: input.provider, anchorMs: null, periodHours: null, remaining: null, limits: [], resetCredits: [] }; }
function pick(windows: Array<Record<string, unknown>>, maxPeriodHours?: number): Record<string, unknown> | null {
  const usable = windows.filter((window) => finite(window.resetAtMs));
  const fitting = maxPeriodHours === undefined ? usable : usable.filter((window) => finite(window.periodHours) && (window.periodHours as number) <= maxPeriodHours);
  const pool = fitting.length ? fitting : usable;
  return pool.sort((a, b) => (finite(b.periodHours) ? b.periodHours : 0) - (finite(a.periodHours) ? a.periodHours : 0) || (a.resetAtMs as number) - (b.resetAtMs as number))[0] ?? null;
}

export function buildTimelineLane(input: TimelineLaneInput): TimelineLane {
  const lane = empty(input);
  if (!input.quota || typeof input.quota !== 'object') return lane;
  const quota = input.quota as Record<string, unknown>;
  let windows: Array<Record<string, unknown>> = [];
  let chosen: Record<string, unknown> | null = null;
  let remainingOf: (window: Record<string, unknown>) => number | null = () => null;
  if (input.provider === 'claude' || input.provider === 'codex') {
    windows = Array.isArray(quota.windows) ? quota.windows.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object') : [];
    if (input.provider === 'codex') {
      const preferred = input.maxPeriodHours !== undefined && input.maxPeriodHours <= 5 ? 'five-hour' : 'weekly';
      chosen = windows.find((w) => w.id === preferred && finite(w.resetAtMs) && (input.maxPeriodHours === undefined || (finite(w.periodHours) && (w.periodHours as number) <= input.maxPeriodHours))) ?? null;
    }
    chosen ??= pick(windows, input.maxPeriodHours);
    remainingOf = (w) => finite(w.usedPercent) ? clamp(100 - (w.usedPercent as number)) : null;
  } else if (input.provider === 'antigravity') {
    const groups = Array.isArray(quota.groups) ? quota.groups : [];
    windows = groups.flatMap((g) => g && typeof g === 'object' && Array.isArray((g as Record<string, unknown>).buckets) ? ((g as Record<string, unknown>).buckets as unknown[]).filter((w): w is Record<string, unknown> => !!w && typeof w === 'object') : []);
    chosen = pick(windows, input.maxPeriodHours);
    remainingOf = (w) => finite(w.remainingFraction) ? clamp(Math.round((w.remainingFraction as number) * 100)) : null;
  } else if (input.provider === 'kimi') {
    windows = Array.isArray(quota.windows) ? quota.windows.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object') : [];
    chosen = pick(windows, input.maxPeriodHours);
    remainingOf = (w) => finite(w.limit) && (w.limit as number) > 0 && finite(w.used) ? clamp(Math.round((((w.limit as number) - (w.used as number)) / (w.limit as number)) * 100)) : null;
  } else if (input.provider === 'xai') {
    const billing = quota.billing;
    if (billing && typeof billing === 'object' && (billing as Record<string, unknown>).periodType === 'weekly') {
      const b = billing as Record<string, unknown>;
      windows = [{ ...b, periodHours: finite(b.periodHours) ? b.periodHours : 168, label: 'Weekly' }];
      chosen = pick(windows, input.maxPeriodHours);
      remainingOf = (w) => finite(w.usagePercent) ? clamp(100 - (w.usagePercent as number)) : null;
    }
  }
  if (!chosen) return lane;
  const limits = windows.map((w) => ({ label: typeof w.label === 'string' ? w.label : '', remaining: remainingOf(w) })).filter((limit): limit is TimelineLimit => limit.remaining !== null);
  const credits = input.provider === 'codex' && Array.isArray(quota.credits) ? quota.credits.flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const credit = c as Record<string, unknown>;
    return credit.status === 'available' && finite(credit.expiresAtMs) ? [{ id: typeof credit.id === 'string' ? credit.id : '', grantedAtMs: finite(credit.grantedAtMs) ? credit.grantedAtMs : null, expiresAtMs: credit.expiresAtMs as number }] : [];
  }) : [];
  return { ...lane, anchorMs: chosen.resetAtMs as number, periodHours: finite(chosen.periodHours) ? chosen.periodHours as number : null, remaining: remainingOf(chosen), limits, resetCredits: credits };
}

export function projectLane(lane: TimelineLane, spanStartMs: number, spanEndMs: number, nowMs: number, mode: TimelineMode): TimelineWindow[] {
  if (!finite(lane.anchorMs) || !finite(lane.periodHours) || lane.periodHours <= 0 || (mode === 'session' && lane.periodHours !== 5) || spanEndMs <= spanStartMs) return [];
  const period = lane.periodHours * HOUR_MS;
  const windows: TimelineWindow[] = [];
  let end = lane.anchorMs + Math.ceil((spanStartMs - lane.anchorMs) / period) * period;
  while (end - period < spanEndMs && windows.length < 1000) {
    const start = end - period;
    const left = Math.max(0, ((start - spanStartMs) / (spanEndMs - spanStartMs)) * 100);
    const right = Math.min(100, ((end - spanStartMs) / (spanEndMs - spanStartMs)) * 100);
    if (right > 0 && left < 100 && right > left) {
      const state = end <= nowMs ? 'past' : start <= nowMs ? 'live' : 'upcoming';
      windows.push({ startMs: start, endMs: end, leftPercent: left, widthPercent: right - left, state, remaining: state === 'live' && end === lane.anchorMs ? lane.remaining : null });
    }
    end += period;
  }
  return windows;
}

export function projectResetCredits(lane: TimelineLane, spanStartMs: number, spanEndMs: number, nowMs: number): Array<TimelineCredit & { leftPercent: number }> {
  if (spanEndMs <= spanStartMs) return [];
  return lane.resetCredits.filter((credit) => credit.expiresAtMs > nowMs && credit.expiresAtMs >= spanStartMs && credit.expiresAtMs < spanEndMs).map((credit) => ({ ...credit, leftPercent: ((credit.expiresAtMs - spanStartMs) / (spanEndMs - spanStartMs)) * 100 }));
}
