import type { AuthenticatedFetch } from './types';

export interface AuthenticatedFetchOptions {
  origin: string;
  token: () => string | null | undefined;
  fetchImpl?: typeof fetch;
  rootSignal: AbortSignal;
  onInvalidated?: (reason: string) => void;
}

export type AuthenticatedFetchHandle = AuthenticatedFetch & {
  invalidate(reason: string): void;
  destroy(): void;
};

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function wireAbort(source: AbortSignal, target: AbortController): () => void {
  const abort = () => target.abort(source.reason ?? abortError('请求已取消'));
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

export function createAuthenticatedFetch(options: AuthenticatedFetchOptions): AuthenticatedFetchHandle {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowedOrigin = new URL(options.origin).origin;
  const invalidationController = new AbortController();
  let invalidated = false;
  let invalidationReason = '';

  const invalidate = (reason: string) => {
    if (invalidated) return;
    invalidated = true;
    invalidationReason = reason;
    invalidationController.abort(abortError(reason));
    options.onInvalidated?.(reason);
  };

  const destroy = () => {
    if (invalidated) return;
    invalidated = true;
    invalidationReason = '会话已销毁';
    invalidationController.abort(abortError(invalidationReason));
  };

  const request: AuthenticatedFetchHandle = async (input, init = {}) => {
    if (invalidated) {
      throw new Error(`会话已失效: ${invalidationReason}`);
    }

    const token = options.token();
    if (!token) {
      throw new Error('缺少认证 token');
    }

    const target = new URL(input.toString(), options.origin);
    if (target.origin !== allowedOrigin) {
      throw new Error('非同源请求被拒绝');
    }
    if (!target.pathname.startsWith('/api/v1/') && !target.pathname.startsWith('/cpa/')) {
      throw new Error('不允许的请求路径');
    }

    const { timeoutMs, signal: callerSignal, ...requestInit } = init;
    const headers = new Headers(requestInit.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    headers.set('Cache-Control', 'no-store');

    const requestController = new AbortController();
    const removeRootAbort = wireAbort(options.rootSignal, requestController);
    const removeInvalidationAbort = wireAbort(invalidationController.signal, requestController);
    const removeCallerAbort = callerSignal ? wireAbort(callerSignal, requestController) : () => undefined;
    const timeoutController = new AbortController();
    const removeTimeoutAbort = wireAbort(timeoutController.signal, requestController);
    const timeout = timeoutMs === undefined ? undefined : setTimeout(
      () => timeoutController.abort(abortError('请求超时')),
      Math.max(0, timeoutMs),
    );

    try {
      if (requestController.signal.aborted) {
        throw requestController.signal.reason ?? abortError('请求已取消');
      }
      const response = await fetchImpl(input, {
        ...requestInit,
        headers,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: requestController.signal,
      });
      if (response.status === 401 || response.status === 403) {
        invalidate(`身份认证失败 (${response.status})`);
        throw new Error(`身份认证失败 (${response.status})`);
      }
      return response;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      removeRootAbort();
      removeInvalidationAbort();
      removeCallerAbort();
      removeTimeoutAbort();
    }
  };

  request.invalidate = invalidate;
  request.destroy = destroy;
  return request;
}
