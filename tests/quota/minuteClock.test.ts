import { describe, expect, it } from 'vitest';
import { createMinuteClock } from '../../src/quota/minuteClock';

describe('minute clock', () => {
  it('shares one timer, starts at the next real minute boundary, and destroys cleanly', () => {
    let now = 12_345;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const clear = new Set<unknown>();
    const clock = createMinuteClock({ now: () => now, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: (id) => clear.add(id) });
    let calls = 0;
    const offA = clock.subscribe(() => { calls += 1; });
    const offB = clock.subscribe(() => { calls += 1; });
    expect(timers[0].ms).toBe(60_000 - (now % 60_000));
    expect(timers).toHaveLength(1);
    now += timers[0].ms;
    timers[0].fn();
    expect(calls).toBe(2);
    offA(); offB();
    expect(clear.size).toBe(1);
    clock.destroy();
  });

  it('recalibrates on visibilitychange', () => {
    let now = 10;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const clock = createMinuteClock({ now: () => now, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => undefined });
    clock.subscribe(() => undefined);
    now = 30_000;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(timers.length).toBe(2);
    expect(timers[1].ms).toBe(30_000);
    clock.destroy();
  });
});
