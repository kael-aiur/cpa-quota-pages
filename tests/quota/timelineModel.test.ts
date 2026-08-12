import { describe, expect, it } from 'vitest';
import { buildTimelineLane, projectLane, projectResetCredits, timelineSpan } from '../../src/quota/timelineModel';

const hour = 60 * 60 * 1000;
const now = new Date(2026, 6, 29, 12).getTime();

describe('timeline model', () => {
  it('creates a local weekly fortnight and session three-day span', () => {
    const weekly = timelineSpan('weekly', 0, now);
    const session = timelineSpan('session', 0, now);
    expect(weekly.days).toBe(14);
    expect(session.days).toBe(3);
    expect(new Date(weekly.startMs).getDay()).toBe(0);
    expect(new Date(weekly.startMs).getHours()).toBe(0);
    expect(new Date(weekly.endMs).getHours()).toBe(0);
  });

  it('projects past, live, and upcoming windows with clamped positions', () => {
    const span = timelineSpan('weekly', 0, now);
    const lane = buildTimelineLane({
      name: 'a', displayName: 'A', provider: 'claude',
      quota: { status: 'success', windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 40, resetAtMs: now + 2 * dayMs(), periodHours: 168 }] },
      maxPeriodHours: 14 * 24,
    });
    const windows = projectLane(lane, span.startMs, span.endMs, now + 3 * dayMs(), 'weekly');
    expect(windows.some((entry) => entry.state === 'past')).toBe(true);
    expect(windows.some((entry) => entry.state === 'live')).toBe(true);
    expect(windows.some((entry) => entry.state === 'upcoming')).toBe(true);
    expect(windows.every((entry) => entry.leftPercent >= 0 && entry.leftPercent + entry.widthPercent <= 100)).toBe(true);
  });

  it('filters session timelines to true five-hour windows', () => {
    const span = timelineSpan('session', 0, now);
    const weekly = buildTimelineLane({ name: 'w', displayName: 'W', provider: 'claude', quota: { status: 'success', windows: [{ id: 'weekly', resetAtMs: now + hour, periodHours: 168 }] } });
    expect(projectLane(weekly, span.startMs, span.endMs, now, 'session')).toEqual([]);
    const session = buildTimelineLane({ name: 's', displayName: 'S', provider: 'claude', quota: { status: 'success', windows: [{ id: 'session', resetAtMs: now + hour, periodHours: 5 }] } });
    expect(projectLane(session, span.startMs, span.endMs, now, 'session').length).toBeGreaterThan(0);
  });

  it('projects only live credit expiry ticks and supports empty lanes', () => {
    const span = timelineSpan('weekly', 0, now);
    const lane = buildTimelineLane({ name: 'c', displayName: 'C', provider: 'codex', quota: { status: 'success', windows: [{ id: 'weekly', resetAtMs: now + dayMs(), periodHours: 168 }], credits: [{ id: 'credit', status: 'available', grantedAtMs: now, expiresAtMs: now + 2 * dayMs() }, { id: 'past', status: 'available', expiresAtMs: now - hour }] } });
    expect(projectResetCredits(lane, span.startMs, span.endMs, now).map((credit) => credit.id)).toEqual(['credit']);
    expect(buildTimelineLane({ name: 'e', displayName: 'E', provider: 'xai', quota: { status: 'success', billing: { periodType: 'monthly', resetAtMs: now + dayMs() } } }).anchorMs).toBeNull();
  });
});

function dayMs(): number { return 24 * hour; }
