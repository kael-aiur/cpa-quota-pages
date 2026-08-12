import { describe, expect, it } from 'vitest';
import { nextRecoveryMs, urgentRecoveryId } from '../../src/quota/resetSchedule';
import type { AntigravityQuotaData } from '../../src/providers/antigravity/parser';
import type { ClaudeQuotaData } from '../../src/providers/claude/types';
import type { CodexQuotaData } from '../../src/providers/codex/parser';
import type { KimiQuotaData } from '../../src/providers/kimi/parser';
import type { XaiQuotaData } from '../../src/providers/xai/parser';

const now = Date.UTC(2026, 7, 2, 12);
const hour = 60 * 60 * 1000;
const day = 24 * hour;

describe('reset schedule', () => {
  it('selects earliest recovery from a normalized Codex quota and available credit', () => {
    const quota: CodexQuotaData = {
      windows: [
        { id: 'weekly', label: 'Weekly', usedPercent: 10, remainingPercent: 90, resetAtMs: now + 4 * day, periodHours: 168 },
        { id: 'session', label: 'Session', usedPercent: 10, remainingPercent: 90, resetAtMs: now + 3 * hour, periodHours: 5 },
      ],
      credits: [{ id: 'credit', resetType: 'codex_rate_limits', status: 'available', grantedAtMs: null, expiresAtMs: now + 2 * hour }],
      subscriptionActiveUntil: null,
      accountId: null,
      planType: null,
      availableCreditCount: 1,
      applicableAvailableCreditCount: 1,
    };
    expect(nextRecoveryMs('codex', quota, now)).toBe(now + 2 * hour);
  });

  it('extracts normalized Claude, Antigravity, Kimi, and xAI weekly recoveries', () => {
    const claude: ClaudeQuotaData = { windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 10, remainingPercent: 90, resetAtMs: now + day, periodHours: 168 }], extraUsage: null, planType: null };
    const antigravity: AntigravityQuotaData = { groups: [{ id: 'g', label: 'Group', buckets: [{ id: 'b', label: 'Bucket', window: '5h', remainingFraction: 0.5, resetTime: null, resetAtMs: now + hour, periodHours: 5 }] }], subscription: null, serverTimeOffsetMs: null };
    const kimi: KimiQuotaData = { windows: [{ id: 'limit-0', label: '5h', used: 1, limit: 10, usedPercent: 10, remainingPercent: 90, resetAtMs: now + 2 * hour, periodHours: 5 }] };
    const xai: XaiQuotaData = { windows: [], billing: { mode: 'billing', periodType: 'weekly', usagePercent: 10, resetAtMs: now + 3 * hour, periodHours: 168, productUsage: [], monthlyLimitCents: null, usedCents: null, includedUsedCents: null, onDemandCapCents: null, onDemandUsedCents: null, onDemandUsedPercent: null, usedPercent: 10 } };
    expect(nextRecoveryMs('claude', claude, now)).toBe(now + day);
    expect(nextRecoveryMs('antigravity', antigravity, now)).toBe(now + hour);
    expect(nextRecoveryMs('kimi', kimi, now)).toBe(now + 2 * hour);
    expect(nextRecoveryMs('xai', xai, now)).toBe(now + 3 * hour);
  });

  it('ignores xAI monthly rollover and Codex subscription renewal', () => {
    expect(nextRecoveryMs('xai', { billing: { periodType: 'monthly', resetAtMs: now + hour } }, now)).toBeNull();
    expect(nextRecoveryMs('codex', { windows: [], credits: [], subscriptionActiveUntil: now + hour }, now)).toBeNull();
  });

  it('ignores past, invalid, unavailable, and non-finite instants', () => {
    const quota = {
      windows: [{ id: 'past', resetAtMs: now - hour }, { id: 'invalid', resetAtMs: Number.NaN }, { id: 'future', resetAtMs: now + day }],
      credits: [{ id: 'used', status: 'consumed', expiresAtMs: now + hour }, { id: 'bad', status: 'available', expiresAtMs: Number.POSITIVE_INFINITY }],
    };
    expect(nextRecoveryMs('codex', quota, now)).toBe(now + day);
  });

  it('returns null for null or invalid quota and preserves earliest selection', () => {
    expect(nextRecoveryMs('claude', null, now)).toBeNull();
    expect(nextRecoveryMs('claude', { windows: [{ id: 'a', resetAtMs: now + hour }, { id: 'b', resetAtMs: now + hour }] }, now)).toBe(now + hour);
  });

  it('marks only a recovery strictly less than one hour away as urgent', () => {
    expect(urgentRecoveryId('claude', { windows: [{ id: 'one', resetAtMs: now + hour }] }, now)).toBeNull();
    expect(urgentRecoveryId('claude', { windows: [{ id: 'soon', resetAtMs: now + 59 * 60 * 1000 }, { id: 'sooner', resetAtMs: now + 10 * 60 * 1000 }] }, now)).toBe('sooner');
  });
});
