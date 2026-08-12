import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSub2ApiAuth } from '../../src/auth/bootstrap';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authUrl(query = 'token=secret&theme=dark', origin = location.origin) {
  history.replaceState(null, '', `/quota.html?${query}`);
  return new URL(`${origin}/quota.html?${query}`);
}

describe('bootstrapSub2ApiAuth', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/quota.html');
  });

  it('removes token before validating and preserves theme', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => {
      calls.push(location.href);
      return response({ code: 0, data: { id: 7, status: 'active' } });
    });
    const url = authUrl('token=secret&theme=dark', 'https://sub2api.example');

    const session = await bootstrapSub2ApiAuth({ url, history, fetchImpl });

    expect(location.search).toBe('?theme=dark');
    expect(calls[0]).not.toContain('secret');
    expect(session.user.id).toBe(7);
    expect(fetchImpl).toHaveBeenCalledWith('https://sub2api.example/api/v1/auth/me', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer secret',
        'Cache-Control': 'no-store',
      }),
    }));
    session.destroy();
    expect(session.signal.aborted).toBe(true);
  });

  it('rejects a URL without a token without making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(bootstrapSub2ApiAuth({
      url: authUrl('theme=dark'),
      history,
      fetchImpl,
    })).rejects.toThrow('token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])('rejects HTTP %s responses', async (status) => {
    const fetchImpl = vi.fn(async () => response({ code: 0, data: { id: 7 } }, status));

    await expect(bootstrapSub2ApiAuth({ url: authUrl(), history, fetchImpl }))
      .rejects.toThrow(String(status));
  });

  it('rejects a non-zero business code', async () => {
    const fetchImpl = vi.fn(async () => response({ code: 1001, message: 'unauthorized', data: null }));

    await expect(bootstrapSub2ApiAuth({ url: authUrl(), history, fetchImpl }))
      .rejects.toThrow('1001');
  });

  it('rejects a missing or inactive user', async () => {
    const missing = vi.fn(async () => response({ code: 0, data: null }));
    await expect(bootstrapSub2ApiAuth({ url: authUrl(), history, fetchImpl: missing }))
      .rejects.toThrow('用户');

    const inactive = vi.fn(async () => response({ code: 0, data: { id: 7, status: 'disabled' } }));
    await expect(bootstrapSub2ApiAuth({ url: authUrl(), history, fetchImpl: inactive }))
      .rejects.toThrow('active');
  });

  it('does not write the token to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fetchImpl = vi.fn(async () => response({ code: 0, data: { id: 7 } }));

    const session = await bootstrapSub2ApiAuth({ url: authUrl(), history, fetchImpl });

    expect(setItem).not.toHaveBeenCalled();
    session.destroy();
  });
});
