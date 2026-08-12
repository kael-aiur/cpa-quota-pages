import { describe, expect, it } from 'vitest';
import { buildTimelineLane, timelineSpan } from '../../src/quota/timelineModel';
import type { AntigravityQuotaData } from '../../src/providers/antigravity/parser';
import type { ClaudeQuotaData } from '../../src/providers/claude/types';
import type { CodexQuotaData } from '../../src/providers/codex/parser';
import type { KimiQuotaData } from '../../src/providers/kimi/parser';
import type { XaiQuotaData } from '../../src/providers/xai/parser';

const now = Date.UTC(2026, 7, 5, 12);
const base = { name: 'account', displayName: 'Account' };

describe('timeline contract', () => {
  it('exposes Today/current period and current-time position', () => {
    const today = timelineSpan('weekly', 0, now);
    const previous = timelineSpan('weekly', -1, now);
    const next = timelineSpan('weekly', 1, now);
    expect(today.isCurrentPeriod).toBe(true);
    expect(previous.isCurrentPeriod).toBe(false);
    expect(next.isCurrentPeriod).toBe(false);
    expect(today.nowPositionPercent).toBeGreaterThanOrEqual(0);
    expect(today.nowPositionPercent).toBeLessThanOrEqual(100);
    expect(timelineSpan('weekly', 0, now, today.startMs - 1).nowPositionPercent).toBeNull();
    expect(timelineSpan('weekly', 0, now, today.endMs).nowPositionPercent).toBeNull();
  });

  it('builds lanes from standard typed quota data for all five providers', () => {
    const claude: ClaudeQuotaData = { windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 20, remainingPercent: 80, resetAtMs: now + 2 * 86400000, periodHours: 168 }], extraUsage: null, planType: null };
    const antigravity: AntigravityQuotaData = { groups: [{ id: 'group', label: 'Group', buckets: [{ id: 'bucket', label: '5h', window: '5h', remainingFraction: 0.5, resetTime: null, resetAtMs: now + 3600000, periodHours: 5 }] }], subscription: null, serverTimeOffsetMs: null };
    const codex: CodexQuotaData = { windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 30, remainingPercent: 70, resetAtMs: now + 3 * 86400000, periodHours: 168 }], accountId: null, planType: null, subscriptionActiveUntil: null, credits: [{ id: 'credit', resetType: 'codex_rate_limits', status: 'available', grantedAtMs: null, expiresAtMs: now + 86400000 }], availableCreditCount: 1, applicableAvailableCreditCount: 1 };
    const kimi: KimiQuotaData = { windows: [{ id: 'limit-0', label: '5h', used: 2, limit: 10, usedPercent: 20, remainingPercent: 80, resetAtMs: now + 5 * 3600000, periodHours: 5 }] };
    const xai: XaiQuotaData = { windows: [], billing: { mode: 'billing', periodType: 'weekly', usagePercent: 10, resetAtMs: now + 6 * 3600000, periodHours: 168, productUsage: [], monthlyLimitCents: null, usedCents: null, includedUsedCents: null, onDemandCapCents: null, onDemandUsedCents: null, onDemandUsedPercent: null, usedPercent: 10 } };
    expect(buildTimelineLane({ ...base, provider: 'claude', quota: claude }).anchorMs).not.toBeNull();
    expect(buildTimelineLane({ ...base, provider: 'antigravity', quota: antigravity }).anchorMs).not.toBeNull();
    expect(buildTimelineLane({ ...base, provider: 'codex', quota: codex }).resetCredits).toHaveLength(1);
    expect(buildTimelineLane({ ...base, provider: 'kimi', quota: kimi }).anchorMs).not.toBeNull();
    expect(buildTimelineLane({ ...base, provider: 'xai', quota: xai }).anchorMs).not.toBeNull();
    const monthly: XaiQuotaData = { windows: [], billing: { ...xai.billing!, periodType: 'monthly', resetAtMs: null, periodHours: null } };
    expect(buildTimelineLane({ ...base, provider: 'xai', quota: monthly }).anchorMs).toBeNull();
  });
});
