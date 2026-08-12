import { describe, expect, it } from 'vitest';
import { nextRecoveryMs, urgentRecoveryId } from '../../src/quota/resetSchedule';

const now = Date.UTC(2026, 7, 2, 12);
const hour = 60 * 60 * 1000;
const day = 24 * hour;

const success = (extra: Record<string, unknown> = {}) => ({ status: 'success', ...extra });

describe('reset schedule', () => {
  it('selects the earliest future recovery from windows and available Codex credit', () => {
    const quota = success({
      windows: [
        { id: 'weekly', resetAtMs: now + 4 * day },
        { id: 'session', resetAtMs: now + 3 * hour },
      ],
      credits: [
        { id: 'credit', status: 'available', expiresAtMs: now + 2 * hour },
      ],
    });
    expect(nextRecoveryMs('codex', quota, now)).toBe(now + 2 * hour);
  });

  it('ignores xAI monthly rollover and Codex subscription renewal', () => {
    expect(nextRecoveryMs('xai', success({ billing: { periodType: 'monthly', resetAtMs: now + hour } }), now)).toBeNull();
    expect(nextRecoveryMs('codex', success({ windows: [], subscriptionActiveUntil: now + hour, credits: [] }), now)).toBeNull();
  });

  it('ignores past, invalid, unavailable, and non-finite instants', () => {
    const quota = success({
      windows: [
        { id: 'past', resetAtMs: now - hour },
        { id: 'invalid', resetAtMs: Number.NaN },
        { id: 'future', resetAtMs: now + day },
      ],
      credits: [
        { id: 'used', status: 'consumed', expiresAtMs: now + hour },
        { id: 'bad', status: 'available', expiresAtMs: Number.POSITIVE_INFINITY },
      ],
    });
    expect(nextRecoveryMs('codex', quota, now)).toBe(now + day);
  });

  it('returns null for unavailable quota and preserves deterministic earliest selection', () => {
    expect(nextRecoveryMs('claude', undefined, now)).toBeNull();
    expect(nextRecoveryMs('claude', success({ windows: [{ id: 'a', resetAtMs: now + hour }, { id: 'b', resetAtMs: now + hour }] }), now)).toBe(now + hour);
  });

  it('marks only a recovery strictly less than one hour away as urgent', () => {
    expect(urgentRecoveryId('claude', success({ windows: [{ id: 'one', resetAtMs: now + hour }] }), now)).toBeNull();
    expect(urgentRecoveryId('claude', success({ windows: [{ id: 'soon', resetAtMs: now + 59 * 60 * 1000 }, { id: 'sooner', resetAtMs: now + 10 * 60 * 1000 }] }), now)).toBe('sooner');
  });
});
