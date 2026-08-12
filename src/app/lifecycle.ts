export interface PageLifecycle {
  signal: AbortSignal;
  abort(reason?: unknown): void;
  destroy(): void;
}

export function createPageLifecycle(parentSignal?: AbortSignal): PageLifecycle {
  const controller = new AbortController();
  let destroyed = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
      if (!controller.signal.aborted) controller.abort(new Error('页面已销毁'));
    },
  };
}
