import { describe, expect, it, vi } from 'vitest';
import weekly from '../fixtures/xai/weekly.json';
import monthly from '../fixtures/xai/monthly.json';
import paidProfile from '../fixtures/xai/paid-profile.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import type { ProviderQueryContext } from '../../src/providers/types';
import {
  isPaidXaiCredential,
  mergeXaiBilling,
  parseXaiBilling,
} from '../../src/providers/xai/parser';
import {
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_API_REQUEST_HEADERS,
  XAI_REQUEST_HEADERS,
  queryXaiQuota,
} from '../../src/providers/xai/adapter';

const file: AuthFile = { name: 'xai.json', provider: 'xai', authIndex: 'idx-xai' };

function result(body: unknown, statusCode = 200): ApiCallResult {
  return { statusCode, header: {}, bodyText: typeof body === 'string' ? body : JSON.stringify(body), body };
}

function encodeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('xAI billing parser', () => {
  it('parses weekly usage and keeps its active quota reset', () => {
    const data = parseXaiBilling(weekly);
    expect(data).toMatchObject({
      periodType: 'weekly',
      usagePercent: 25,
      periodStart: '2026-08-10T00:00:00Z',
      periodEnd: '2026-08-17T00:00:00Z',
      resetAtMs: Date.parse('2026-08-17T00:00:00Z'),
      periodHours: 168,
    });
    expect(data?.productUsage).toEqual([{ product: 'Grok', usagePercent: 20 }]);
  });

  it('supplements weekly billing with monthly money without borrowing monthly rollover', () => {
    const merged = mergeXaiBilling(parseXaiBilling(weekly), parseXaiBilling(monthly));
    expect(merged).toMatchObject({
      periodType: 'weekly',
      usagePercent: 25,
      resetAtMs: Date.parse('2026-08-17T00:00:00Z'),
      periodHours: 168,
      monthlyLimitCents: 10000,
      usedCents: 2500,
      includedUsedCents: 2500,
      onDemandCapCents: 5000,
      billingPeriodStart: '2026-08-01T00:00:00Z',
      billingPeriodEnd: '2026-09-01T00:00:00Z',
    });
    expect(merged?.periodStart).toBe('2026-08-10T00:00:00Z');
    expect(merged?.periodEnd).toBe('2026-08-17T00:00:00Z');
  });

  it('does not expose a monthly rollover as a quota reset', () => {
    const data = parseXaiBilling(monthly);
    expect(data).toMatchObject({ periodType: 'monthly', resetAtMs: null, periodHours: null });
  });

  it('recognizes using_api plus paid prefix, JWT tier, and not route hints', () => {
    expect(isPaidXaiCredential({ name: 'paid.json', using_api: true, prefix: 'PAID' })).toBe(true);
    expect(isPaidXaiCredential({ name: 'tier.json', metadata: { access_token: encodeJwt({ tier: 1 }) } })).toBe(true);
    expect(isPaidXaiCredential({ name: 'api-only.json', using_api: true })).toBe(false);
    expect(isPaidXaiCredential({ name: 'prefix-only.json', prefix: 'paid' })).toBe(false);
    expect(isPaidXaiCredential({ name: 'route.json', route: 'paid' })).toBe(false);
  });
});

describe('xAI quota adapter', () => {
  it('queries weekly and monthly billing concurrently with exact Grok headers', async () => {
    const requests: string[] = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      requests.push(request.url);
      expect(request).toMatchObject({
        authIndex: 'idx-xai', method: 'GET', header: XAI_REQUEST_HEADERS,
      });
      return result(request.url === XAI_BILLING_WEEKLY_URL ? weekly : monthly);
    });

    const data = await queryXaiQuota(file, { apiCall, timeoutMs: 4321 });
    expect(requests.sort()).toEqual([XAI_BILLING_MONTHLY_URL, XAI_BILLING_WEEKLY_URL].sort());
    expect(apiCall.mock.calls.every(([, options]) => options?.timeoutMs === 4321)).toBe(true);
    expect(data.billing).toMatchObject({ periodType: 'weekly', monthlyLimitCents: 10000 });
  });

  it('uses paid health with optional profile and required fixed ping chat', async () => {
    const paidFile = { ...file, using_api: true, prefix: 'paid' };
    const requests: string[] = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      requests.push(request.url);
      if (request.url === XAI_API_ME_URL) {
        expect(request).toMatchObject({ method: 'GET', header: XAI_API_REQUEST_HEADERS });
        return result(paidProfile);
      }
      expect(request).toMatchObject({
        method: 'POST', header: { ...XAI_API_REQUEST_HEADERS, 'Content-Type': 'application/json' },
        data: JSON.stringify({ model: 'grok-4.5', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      });
      return result({ choices: [] });
    });

    const data = await queryXaiQuota(paidFile, { apiCall });
    expect(requests).toEqual([XAI_API_ME_URL, XAI_API_CHAT_URL]);
    expect(data.billing).toMatchObject({ mode: 'paid-health', planType: 'paid', healthStatus: 'chat-ok', userId: 'user-1', teamId: 'team-1' });
    expect(data.windows).toEqual([]);
  });

  it('continues when optional paid profile fails', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === XAI_API_ME_URL) throw new Error('profile unavailable');
      return result({ choices: [] });
    });
    await expect(queryXaiQuota({ ...file, using_api: true, prefix: 'paid' }, { apiCall })).resolves.toMatchObject({ billing: { mode: 'paid-health' } });
  });

  it('falls back to paid health for free billing with no useful data and preserves billing errors if fallback fails', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === XAI_BILLING_WEEKLY_URL || request.url === XAI_BILLING_MONTHLY_URL) return result({}, 403);
      return result({ error: 'invalid token' }, 401);
    });
    const error = await queryXaiQuota(file, { apiCall }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: 'CpaApiError', statusCode: 403 });
  });

  it('does not swallow caller aborts', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async () => { throw abortError; });
    await expect(queryXaiQuota(file, { apiCall })).rejects.toBe(abortError);
  });
});
