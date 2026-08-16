import { describe, expect, it } from 'vitest';
import { formatResetLabel } from '../../src/quota/relativeTime';

const now = Date.UTC(2026, 7, 2, 12);
const day = 24 * 60 * 60 * 1000;

describe('reset labels', () => {
  it('includes an Intl absolute date and localized relative time', () => {
    const label = formatResetLabel(now + 2 * day, now, 'en-US');
    expect(label).toContain('08/04/2026');
    expect(label).toContain('in 2 days');
  });

  it('uses relative past wording and does not hand-build date offsets', () => {
    const label = formatResetLabel(now - day, now, 'en');
    expect(label).toContain('ago');
    expect(label).toContain('08/01/2026');
  });

  it('falls back for invalid locale and invalid dates', () => {
    expect(formatResetLabel(now + day, now, 'not-a-locale!!')).toBeTruthy();
    expect(formatResetLabel(Number.NaN, now, 'en')).toBe('-');
  });
});
