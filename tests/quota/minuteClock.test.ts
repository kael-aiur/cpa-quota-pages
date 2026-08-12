import { describe, expect, it } from 'vitest';
import { createMinuteClock } from '../../src/quota/minuteClock';

type Timer = { kind: 'timeout' | 'interval'; fn: () => void; ms: number; id: number };
function fakeTimers() {
  const timers: Timer[] = [];
  const cleared: number[] = [];
  let nextId = 1;
  return {
    timers,
    cleared,
    setTimeout: (fn: () => void, ms: number) => { const timer = { kind: 'timeout' as const, fn, ms, id: nextId++ }; timers.push(timer); return timer.id; },
    setInterval: (fn: () => void, ms: number) => { const timer = { kind: 'interval' as const, fn, ms, id: nextId++ }; timers.push(timer); return timer.id; },
    clearTimer: (id: unknown) => { cleared.push(id as number); },
  };
}

describe('minute clock', () => {
  it('shares one timer, starts at the next real minute boundary, and destroys cleanly', () => {
    let now = 12_345;
    const fake = fakeTimers();
    const clock = createMinuteClock({ now: () => now, ...fake });
    let calls = 0;
    const offA = clock.subscribe(() => { calls += 1; });
    const offB = clock.subscribe(() => { calls += 1; });
    expect(fake.timers[0].ms).toBe(60_000 - (now % 60_000));
    expect(fake.timers).toHaveLength(1);
    now += fake.timers[0].ms;
    fake.timers[0].fn();
    expect(calls).toBe(2);
    expect(fake.timers.filter((timer) => timer.kind === 'interval')).toHaveLength(1);
    offA(); offB();
    expect(fake.cleared).toHaveLength(1);
    clock.destroy();
  });

  it('does not leave an interval when the timeout listener unsubscribes', () => {
    const fake = fakeTimers();
    const clock = createMinuteClock({ now: () => 10, ...fake });
    const off = clock.subscribe(() => off());
    fake.timers[0].fn();
    expect(fake.timers.filter((timer) => timer.kind === 'interval')).toHaveLength(0);
  });

  it('does not leave an interval when the timeout listener destroys the clock', () => {
    const fake = fakeTimers();
    const clock = createMinuteClock({ now: () => 10, ...fake });
    clock.subscribe(() => clock.destroy());
    fake.timers[0].fn();
    expect(fake.timers.filter((timer) => timer.kind === 'interval')).toHaveLength(0);
  });

  it('recalibrates from visibilitychange without creating a stale interval', () => {
    let now = 10;
    const fake = fakeTimers();
    const clock = createMinuteClock({ now: () => now, ...fake });
    clock.subscribe(() => undefined);
    now = 30_000;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.timers[1].ms).toBe(30_000);
    expect(fake.timers.filter((timer) => timer.kind === 'interval')).toHaveLength(0);
    clock.destroy();
  });
});
