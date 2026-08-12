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
  const clearTimer = options.clearTimer ?? ((id) => { clearTimeout(id as ReturnType<typeof setTimeout>); clearInterval(id as ReturnType<typeof setInterval>); });
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const listeners = new Set<() => void>();
  let snapshot = now();
  let timer: unknown = null;
  let destroyed = false;
  let visibility: (() => void) | null = null;

  const notify = () => { snapshot = now(); listeners.forEach((listener) => listener()); };
  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    const delay = 60_000 - (now() % 60_000);
    timer = setTimeoutFn(() => { notify(); timer = setIntervalFn(notify, 60_000); }, delay);
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
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (doc && visibility !== null) {
      doc.removeEventListener('visibilitychange', visibility);
      visibility = null;
    }
  };
  const recalibrate = () => { if (listeners.size > 0 && !destroyed) start(); };

  return {
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      if (listeners.size === 1) start();
      let active = true;
      return () => { if (!active) return; active = false; listeners.delete(listener); if (listeners.size === 0) stop(); };
    },
    getSnapshot: () => snapshot,
    destroy() { if (destroyed) return; destroyed = true; listeners.clear(); stop(); if (doc && visibility) doc.removeEventListener('visibilitychange', visibility); visibility = null; },
  };
}
