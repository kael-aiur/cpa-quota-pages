import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import usage from '../fixtures/codex/usage.json';
import creditDetails from '../fixtures/codex/reset-credits.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import { CpaApiError } from '../../src/api/errors';
import type { ProviderQueryContext } from '../../src/providers/types';
import { consumeCodexResetCredit } from '../../src/admin/codexReset';

const CONSUME_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const DETAILS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const file: AuthFile = {
  name: 'codex.json',
  provider: 'codex',
  authIndex: 'idx-codex',
  id_token: { chatgpt_account_id: 'acct-123' },
  plan_type: 'team',
  subscription_active_until: '2026-08-20T00:00:00Z',
};

function result(body: unknown, statusCode = 200): ApiCallResult {
  return {
    statusCode,
    header: {},
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
    body,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function consumeRequestData(request: { data?: string }): { redeem_request_id?: unknown } {
  if (!request.data) return {};
  try {
    return JSON.parse(request.data) as { redeem_request_id?: unknown };
  } catch {
    return {};
  }
}

describe('consumeCodexResetCredit', () => {
  it('POSTs the consume endpoint with a fresh redeem_request_id UUID per call', async () => {
    const calls: Array<{ method: string; url: string; data?: string; header: Record<string, string> }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push({ method: request.method, url: request.url, data: request.data, header: request.header });
      if (request.method === 'POST' && request.url === CONSUME_URL) return result({});
      if (request.url === DETAILS_URL) return result(creditDetails);
      return result(usage);
    });

    const first = await consumeCodexResetCredit(file, { apiCall, timeoutMs: 999 });
    const second = await consumeCodexResetCredit(file, { apiCall, timeoutMs: 999 });

    const consumeCalls = calls.filter((call) => call.url === CONSUME_URL);
    expect(consumeCalls.length).toBe(2);
    for (const call of consumeCalls) {
      expect(call.method).toBe('POST');
      expect(call.header['Chatgpt-Account-Id']).toBe('acct-123');
      const body = consumeRequestData(call);
      expect(body.redeem_request_id).toMatch(UUID_RE);
    }
    const firstId = consumeRequestData(consumeCalls[0]!).redeem_request_id;
    const secondId = consumeRequestData(consumeCalls[1]!).redeem_request_id;
    expect(firstId).not.toBe(secondId);
    // The full request body must be exactly the redeem_request_id envelope.
    expect(consumeCalls[0]!.data).toBe(JSON.stringify({ redeem_request_id: firstId }));

    // Re-query must run after each successful consume.
    const usageCalls = calls.filter((call) => call.url === USAGE_URL);
    expect(usageCalls.length).toBe(2);
    expect(first.planType).toBe('pro');
    expect(second.planType).toBe('pro');
  });

  it('turns a non-2xx consume response into a CpaApiError and skips the re-query', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push({ method: request.method, url: request.url });
      if (request.method === 'POST' && request.url === CONSUME_URL) {
        return result({ error: { message: 'no credits available' } }, 409);
      }
      return result(usage);
    });

    await expect(consumeCodexResetCredit(file, { apiCall })).rejects.toMatchObject({
      name: 'CpaApiError',
      statusCode: 409,
      message: 'no credits available',
    });
    expect(CpaApiError).toBeDefined();
    // No re-query should fire when the consume itself failed.
    expect(calls.filter((call) => call.url === USAGE_URL)).toHaveLength(0);
  });

  it('re-queries via queryCodexQuota after success and returns refreshed CodexQuotaData', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push({ method: request.method, url: request.url });
      if (request.method === 'POST' && request.url === CONSUME_URL) return result({ granted: true });
      if (request.url === DETAILS_URL) return result(creditDetails);
      return result(usage);
    });

    const data = await consumeCodexResetCredit(file, { apiCall, timeoutMs: 500 });

    expect(calls.map((call) => call.url)).toEqual([CONSUME_URL, USAGE_URL, DETAILS_URL]);
    // The returned object is a freshly parsed CodexQuotaData from the re-query,
    // not the consume response: it carries the usage-derived plan/account and a
    // credits array drawn from the details fixture.
    expect(data.planType).toBe('pro');
    expect(data.accountId).toBe('acct-123');
    expect(Array.isArray(data.credits)).toBe(true);
    expect(data.availableCreditCount).toBe(3);
    for (const credit of data.credits) {
      expect(credit.resetType).toBe('codex_rate_limits');
      expect(credit.status).toBe('available');
      expect(credit.expiresAtMs).toBeGreaterThan(Date.now());
    }
  });

  it('rejects a concurrent reset for the same account and releases the lock afterward', async () => {
    const consumeGate = deferred<ApiCallResult>();
    const calls: Array<{ method: string; url: string }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push({ method: request.method, url: request.url });
      if (request.method === 'POST' && request.url === CONSUME_URL) return consumeGate.promise;
      if (request.url === DETAILS_URL) return result(creditDetails);
      return result(usage);
    });

    const first = consumeCodexResetCredit(file, { apiCall });
    // Let the first call enter the POST and acquire the lock.
    await vi.waitFor(() => expect(apiCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', url: CONSUME_URL }),
      expect.anything(),
    ));

    await expect(consumeCodexResetCredit(file, { apiCall })).rejects.toThrow(/进行中|already|in progress/i);

    // No second consume POST should have fired while the lock is held.
    expect(calls.filter((call) => call.url === CONSUME_URL)).toHaveLength(1);

    consumeGate.resolve(result({ granted: true }));
    await expect(first).resolves.toMatchObject({ planType: 'pro' });

    // After release, a fresh reset is allowed again.
    const second = await consumeCodexResetCredit(file, { apiCall });
    expect(second.planType).toBe('pro');
    expect(calls.filter((call) => call.url === CONSUME_URL)).toHaveLength(2);
  });

  it('releases the same-account lock when the consume rejects so a later retry can proceed', async () => {
    let attempt = 0;
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.method === 'POST' && request.url === CONSUME_URL) {
        attempt += 1;
        if (attempt === 1) return result({ error: 'temporary' }, 500);
        return result({ granted: true });
      }
      if (request.url === DETAILS_URL) return result(creditDetails);
      return result(usage);
    });

    await expect(consumeCodexResetCredit(file, { apiCall })).rejects.toMatchObject({ name: 'CpaApiError', statusCode: 500 });
    // Lock must be free now so the retry is not rejected as concurrent.
    const data = await consumeCodexResetCredit(file, { apiCall });
    expect(data.planType).toBe('pro');
  });

  it('holds the lock across the read-only re-query, then releases it', async () => {
    const usageGate = deferred<ApiCallResult>();
    const calls: Array<{ method: string; url: string }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push({ method: request.method, url: request.url });
      if (request.method === 'POST' && request.url === CONSUME_URL) return result({ granted: true });
      if (request.url === USAGE_URL) return usageGate.promise;
      if (request.url === DETAILS_URL) return result(creditDetails);
      return result(usage);
    });

    const first = consumeCodexResetCredit(file, { apiCall });
    // Wait until the first call has consumed and entered the re-query's usage GET.
    await vi.waitFor(() => expect(calls.some((call) => call.url === USAGE_URL)).toBe(true));

    // While the re-query is still in flight, the same account is still locked.
    await expect(consumeCodexResetCredit(file, { apiCall })).rejects.toThrow(/进行中|already|in progress/i);
    expect(calls.filter((call) => call.url === CONSUME_URL)).toHaveLength(1);

    usageGate.resolve(result(usage));
    await expect(first).resolves.toMatchObject({ planType: 'pro' });

    // Once the full operation completes the lock is freed and a new reset is allowed.
    const second = await consumeCodexResetCredit(file, { apiCall });
    expect(second.planType).toBe('pro');
    expect(calls.filter((call) => call.url === CONSUME_URL)).toHaveLength(2);
  });

  it('keeps the consume endpoint string out of the read-only provider registry and adapters', () => {
    const sources = [
      readFileSync('src/providers/index.ts', 'utf8'),
      readFileSync('src/providers/codex/adapter.ts', 'utf8'),
      readFileSync('src/providers/codex/parser.ts', 'utf8'),
    ];
    for (const source of sources) {
      expect(source).not.toContain('/rate-limit-reset-credits/consume');
    }
  });

  it('keeps the consume endpoint string confined to the admin module', () => {
    const source = readFileSync('src/admin/codexReset.ts', 'utf8');
    expect(source).toContain('/rate-limit-reset-credits/consume');
  });
});
