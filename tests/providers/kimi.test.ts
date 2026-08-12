import { describe, expect, it, vi } from 'vitest';
import usage from '../fixtures/kimi/usages.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import type { ProviderQueryContext } from '../../src/providers/types';
import { parseKimiQuota } from '../../src/providers/kimi/parser';
import { KIMI_REQUEST_HEADERS, KIMI_USAGE_URL, queryKimiQuota } from '../../src/providers/kimi/adapter';

const nowMs = Date.parse('2026-08-12T12:00:00.000Z');
const file: AuthFile = { name: 'kimi.json', provider: 'kimi', authIndex: 'idx-kimi' };

function result(body: unknown, statusCode = 200): ApiCallResult {
  return {
    statusCode,
    header: {},
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
    body,
  };
}

describe('Kimi quota parser', () => {
  it('puts limits before summary and normalizes usage, reset, and periods', () => {
    const data = parseKimiQuota(usage, nowMs);

    expect(data.windows.map(({ id }) => id)).toEqual(['limit-0', 'limit-1', 'summary']);
    expect(data.windows[0]).toMatchObject({
      id: 'limit-0',
      used: 2,
      limit: 100,
      usedPercent: 2,
      remainingPercent: 98,
      resetAtMs: Date.parse('2026-08-12T17:00:00.123Z'),
      periodHours: 5,
    });
    expect(data.windows[1]).toMatchObject({
      label: 'Daily Coding',
      used: 25,
      limit: 100,
      remainingPercent: 75,
      resetAtMs: nowMs + 86400 * 1000,
      periodHours: 24,
    });
    expect(data.windows[2]).toMatchObject({
      id: 'summary',
      label: 'Weekly',
      used: 100,
      limit: 1000,
      usedPercent: 10,
      remainingPercent: 90,
      resetAtMs: Date.parse('2026-08-19T12:00:00Z'),
      periodHours: 168,
    });
  });

  it('uses absolute reset before relative aliases and supports camel-case strings', () => {
    const data = parseKimiQuota({
      limits: [
        { detail: { limit: '10', remaining: '5', reset_at: '2026-08-13T00:00:00Z', resetIn: '5' } },
        { detail: { used: '1', limit: '10', resetIn: '60' } },
        { detail: { used: '1', limit: '10', ttl: 120 } },
      ],
    }, nowMs);

    expect(data.windows.map((window) => window.resetAtMs)).toEqual([
      Date.parse('2026-08-13T00:00:00Z'),
      nowMs + 60_000,
      nowMs + 120_000,
    ]);
  });

  it('supports duration time units and stable fallback labels and IDs', () => {
    const payload = {
      limits: [
        { detail: { used: 1, limit: 10 }, window: { duration: 30, timeUnit: 'TIME_UNIT_MINUTE' } },
        { detail: { used: 2, limit: 10 }, window: { duration: 2, timeUnit: 'hour' } },
        { detail: { used: 3, limit: 10 }, window: { duration: 1, timeUnit: 'TIME_UNIT_WEEK' } },
      ],
    };
    const first = parseKimiQuota(payload, nowMs);
    const second = parseKimiQuota(payload, nowMs);

    expect(first.windows.map(({ id, label, periodHours }) => ({ id, label, periodHours }))).toEqual([
      { id: 'limit-0', label: '30m limit', periodHours: 0.5 },
      { id: 'limit-1', label: '2h limit', periodHours: 2 },
      { id: 'limit-2', label: '1w limit', periodHours: 168 },
    ]);
    expect(second.windows.map(({ id, label }) => ({ id, label }))).toEqual(
      first.windows.map(({ id, label }) => ({ id, label })),
    );
  });

  it('accepts a JSON string body and ignores malformed rows', () => {
    const data = parseKimiQuota(JSON.stringify({ limits: [{ detail: { limit: 10, remaining: 7 } }, null, 42] }), nowMs);
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0]).toMatchObject({ used: 3, limit: 10, remainingPercent: 70 });
  });
});

describe('Kimi quota adapter', () => {
  it('sends one exact GET request with only the CPA token authorization header', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (_request, options) => {
      expect(options).toEqual({ signal: undefined, timeoutMs: 1234 });
      return result(usage);
    });

    const data = await queryKimiQuota(file, { apiCall, timeoutMs: 1234 });

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith({
      authIndex: 'idx-kimi',
      method: 'GET',
      url: KIMI_USAGE_URL,
      header: KIMI_REQUEST_HEADERS,
    }, { signal: undefined, timeoutMs: 1234 });
    expect(data.windows).toHaveLength(3);
  });

  it('rejects non-2xx responses as structured CPA errors', async () => {
    const error = await queryKimiQuota(file, {
      apiCall: vi.fn(async () => result({ error: { message: 'rate limited' } }, 429)),
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: 'CpaApiError',
      statusCode: 429,
      result: { body: { error: { message: 'rate limited' } } },
    });
    expect(error).toHaveProperty('message', 'rate limited');
  });
});
