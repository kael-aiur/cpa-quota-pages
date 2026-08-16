import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedFetch } from '../../src/auth/authenticatedFetch';

function requestFor(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createAuthenticatedFetch>[0]> = {}) {
  return createAuthenticatedFetch({
    origin: 'https://sub2api.example',
    token: () => 'secret',
    fetchImpl,
    rootSignal: new AbortController().signal,
    onInvalidated: vi.fn(),
    ...overrides,
  });
}

describe('createAuthenticatedFetch', () => {
  it('rejects non-same-origin and non-allowed paths before fetch', async () => {
    const rawFetch = vi.fn();
    const request = requestFor(rawFetch);

    await expect(request('https://evil.example/steal')).rejects.toThrow('非同源');
    await expect(request('/other/path')).rejects.toThrow('不允许的请求路径');
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it('uses the validated origin when fetching a relative request', async () => {
    const rawFetch = vi.fn(async () => new Response('ok'));
    const request = requestFor(rawFetch);

    await request('/api/v1/data');

    const [input, init] = rawFetch.mock.calls[0] as unknown as [string | URL, RequestInit];
    expect(String(input)).toBe('https://sub2api.example/api/v1/data');
    expect(String(input)).not.toContain(location.origin);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('allows only the exact API and CPA path prefixes', async () => {
    const rawFetch = vi.fn(async () => new Response('ok'));
    const request = requestFor(rawFetch);

    await request('/api/v1/auth/me');
    await request('/cpa/v0/management/auth-files');
    await expect(request('/api/v1')).rejects.toThrow('不允许的请求路径');
    await expect(request('/cpa')).rejects.toThrow('不允许的请求路径');
    await expect(request('/api/v10/not-allowed')).rejects.toThrow('不允许的请求路径');
    expect(rawFetch).toHaveBeenCalledTimes(2);
  });

  it('merges headers while enforcing authentication and same-origin defaults', async () => {
    const rawFetch = vi.fn(async () => new Response('ok'));
    const request = requestFor(rawFetch);

    await request('/api/v1/data', {
      method: 'POST',
      headers: { 'X-Request-ID': 'request-1', Authorization: 'Bearer caller' },
      credentials: 'omit',
      cache: 'reload',
    });

    const [, init] = rawFetch.mock.calls[0] as unknown as [string | URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
    expect(headers.get('X-Request-ID')).toBe('request-1');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('POST');
  });

  it('aborts a request when its timeout expires', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const rawFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')));
      });
    });
    const request = requestFor(rawFetch);
    const pending = request('/api/v1/data', { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it('propagates an external abort signal', async () => {
    let signal: AbortSignal | undefined;
    const rawFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      });
    });
    const external = new AbortController();
    const request = requestFor(rawFetch);
    const pending = request('/api/v1/data', { signal: external.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    external.abort();
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it('invalidates once on 401 and aborts other in-flight requests', async () => {
    const root = new AbortController();
    const onInvalidated = vi.fn();
    const rawFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/unauthorized')) {
        return Promise.resolve(new Response('unauthorized', { status: 401 }));
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('invalidated', 'AbortError')));
      });
    });
    const request = requestFor(rawFetch, { rootSignal: root.signal, onInvalidated });
    const pending = request('/api/v1/pending');
    const pendingAssertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const failed = request('/api/v1/unauthorized');

    await expect(failed).rejects.toThrow('401');
    expect(onInvalidated).toHaveBeenCalledTimes(1);
    expect(onInvalidated).toHaveBeenCalledWith(expect.stringContaining('401'));
    await pendingAssertion;
  });

  it('rejects new requests after invalidation and clears the token', async () => {
    const onInvalidated = vi.fn();
    let currentToken: string | null = 'secret';
    const rawFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const request = requestFor(rawFetch, {
      token: () => currentToken,
      onInvalidated: (reason) => {
        currentToken = null;
        onInvalidated(reason);
      },
    });

    await expect(request('/api/v1/data')).rejects.toThrow('403');
    await expect(request('/api/v1/data')).rejects.toThrow('失效');
    expect(currentToken).toBeNull();
    expect(onInvalidated).toHaveBeenCalledTimes(1);
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when the root session is already aborted', async () => {
    const root = new AbortController();
    root.abort();
    const rawFetch = vi.fn();
    const request = requestFor(rawFetch, { rootSignal: root.signal });

    await expect(request('/api/v1/data')).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawFetch).not.toHaveBeenCalled();
  });
});
