export interface MinuteClockOptions {
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  document?: Document;
}

export interface MinuteClock {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  destroy(): void;
}

export function createMinuteClock(options: MinuteClockOptions = {}): MinuteClock {
  const now = options.now ?? Date.now;
  const setTimeoutFn = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const setIntervalFn = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => {
    clearTimeout(id as ReturnType<typeof setTimeout>);
    clearInterval(id as ReturnType<typeof setInterval>);
  });
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const listeners = new Set<() => void>();
  let snapshot = now();
  let timer: unknown = null;
  let generation = 0;
  let destroyed = false;
  let visibility: (() => void) | null = null;

  const notify = () => {
    snapshot = now();
    listeners.forEach((listener) => listener());
  };
  const schedule = () => {
    generation += 1;
    const scheduledGeneration = generation;
    if (timer !== null) clearTimer(timer);
    const delay = 60_000 - (now() % 60_000);
    timer = setTimeoutFn(() => {
      if (destroyed || generation !== scheduledGeneration) return;
      timer = null;
      notify();
      if (destroyed || listeners.size === 0 || generation !== scheduledGeneration || timer !== null) return;
      timer = setIntervalFn(notify, 60_000);
    }, delay);
  };
  const recalibrate = () => {
    if (listeners.size > 0 && !destroyed) {
      snapshot = now();
      schedule();
    }
  };
  const start = () => {
    snapshot = now();
    schedule();
    if (doc && visibility === null) {
      visibility = recalibrate;
      doc.addEventListener('visibilitychange', visibility);
    }
  };
  const stop = () => {
    generation += 1;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (doc && visibility !== null) {
      doc.removeEventListener('visibilitychange', visibility);
      visibility = null;
    }
  };

  return {
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      if (listeners.size === 1) start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      stop();
    },
  };
}
