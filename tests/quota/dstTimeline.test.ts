import { describe, expect, it } from 'vitest';
import { timelineSpan } from '../../src/quota/timelineModel';

describe('timeline DST calendar boundaries', () => {
  it('keeps spring-forward session boundaries at local midnight over 71 elapsed hours', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const now = new Date('2026-03-07T12:00:00-05:00').getTime();
      const span = timelineSpan('session', 0, now);
      expect(span.endMs - span.startMs).toBe(71 * 60 * 60 * 1000);
      expect(new Date(span.startMs).toString()).toContain('00:00:00');
      expect(new Date(span.endMs).toString()).toContain('00:00:00');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('keeps fall-back session boundaries at local midnight over 73 elapsed hours', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const now = new Date('2026-10-31T12:00:00-04:00').getTime();
      const span = timelineSpan('session', 0, now);
      expect(span.endMs - span.startMs).toBe(73 * 60 * 60 * 1000);
      expect(new Date(span.startMs).toString()).toContain('00:00:00');
      expect(new Date(span.endMs).toString()).toContain('00:00:00');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('keeps weekly span at fourteen local calendar days across spring-forward', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const now = new Date('2026-03-07T12:00:00-05:00').getTime();
      const span = timelineSpan('weekly', 0, now);
      expect(new Date(span.endMs).getDate()).toBe(15);
      expect(span.days).toBe(14);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
