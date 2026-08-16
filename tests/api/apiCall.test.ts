import { describe, expect, it, vi } from 'vitest';
import { createCpaApi } from '../../src/api/apiCall';
import { extractApiError } from '../../src/api/errors';
import type { AuthenticatedFetch } from '../../src/auth/types';

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('CPA api-call boundary', () => {
  it('posts the exact CPA wrapper request and parses a JSON-string body', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => response({
      status_code: 200,
      header: { date: ['Wed, 12 Aug 2026 12:00:00 GMT'] },
      body: '{"ok":true}',
    }));
    const api = createCpaApi(request);

    const result = await api.apiCall({
      authIndex: 'idx-1',
      method: 'GET',
      url: 'https://upstream.example/usage',
      header: { Authorization: 'Bearer $TOKEN$' },
    });

    expect(request).toHaveBeenCalledWith('/cpa/v0/management/api-call', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        authIndex: 'idx-1',
        method: 'GET',
        url: 'https://upstream.example/usage',
        header: { Authorization: 'Bearer $TOKEN$' },
      }),
    }));
    expect(result.body).toEqual({ ok: true });
    expect(result.bodyText).toBe('{"ok":true}');
    expect(result.statusCode).toBe(200);
    expect(result.header).toEqual({ date: ['Wed, 12 Aug 2026 12:00:00 GMT'] });
  });

  it('preserves an object body and serializes its body text', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => response({
      status_code: 201,
      header: {},
      body: { created: true },
    }));
    const api = createCpaApi(request);

    const result = await api.apiCall({
      authIndex: 'idx-1',
      method: 'POST',
      url: 'https://upstream.example/resource',
      header: {},
      data: '{"name":"demo"}',
    });

    expect(result.body).toEqual({ created: true });
    expect(result.bodyText).toBe('{"created":true}');
  });

  it('keeps a non-JSON body as text', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => response({
      status_code: 502,
      header: {},
      body: 'upstream unavailable',
    }));
    const api = createCpaApi(request);

    const result = await api.apiCall({
      authIndex: 'idx-1',
      method: 'GET',
      url: 'https://upstream.example/resource',
      header: {},
    });

    expect(result.body).toBe('upstream unavailable');
    expect(result.bodyText).toBe('upstream unavailable');
    expect(result.statusCode).toBe(502);
  });

  it('rejects a wrapper response without status_code', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => response({ body: '{}' }));
    const api = createCpaApi(request);

    await expect(api.apiCall({
      authIndex: 'idx-1',
      method: 'GET',
      url: 'https://upstream.example/resource',
      header: {},
    })).rejects.toThrow('status_code');
  });

  it('extracts errors in the documented priority order', () => {
    expect(extractApiError({
      statusCode: 400,
      header: {},
      bodyText: 'raw',
      body: { error: { message: 'nested' }, message: 'outer' },
    })).toBe('nested');
    expect(extractApiError({
      statusCode: 400,
      header: {},
      bodyText: 'raw',
      body: { error: 'error text', message: 'outer' },
    })).toBe('error text');
    expect(extractApiError({
      statusCode: 400,
      header: {},
      bodyText: 'raw',
      body: { message: 'outer' },
    })).toBe('outer');
    expect(extractApiError({
      statusCode: 400,
      header: {},
      bodyText: '',
      body: 'plain body',
    })).toBe('plain body');
    expect(extractApiError({
      statusCode: 400,
      header: {},
      bodyText: 'raw',
      body: null,
    })).toBe('raw');
    expect(extractApiError({
      statusCode: 429,
      header: {},
      bodyText: '',
      body: null,
    })).toBe('HTTP 429');
  });
});
