import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import usage from '../fixtures/codex/usage.json';
import creditDetails from '../fixtures/codex/reset-credits.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import type { ProviderQueryContext } from '../../src/providers/types';
import { parseCodexQuota } from '../../src/providers/codex/parser';
import { queryCodexQuota } from '../../src/providers/codex/adapter';

const nowMs = Date.parse('2026-08-12T12:00:00Z');
const file: AuthFile = {
  name: 'codex.json', provider: 'codex', authIndex: 'idx-codex',
  id_token: { chatgpt_account_id: 'acct-123' }, plan_type: 'team',
  subscription_active_until: '2026-08-20T00:00:00Z',
};
const result = (body: unknown, statusCode = 200): ApiCallResult => ({
  statusCode, header: {}, bodyText: typeof body === 'string' ? body : JSON.stringify(body), body,
});

describe('Codex parser', () => {
  it('normalizes scope windows, duration periods, reached inference, plan fallback, renewal, and credits', () => {
    const data = parseCodexQuota(usage, creditDetails, file, nowMs);
    expect(data.planType).toBe('pro');
    expect(data.subscriptionActiveUntil).toBe(Date.parse('2026-08-20T00:00:00Z'));
    expect(data.accountId).toBe('acct-123');
    expect(data.windows[0]?.id).toBe('rate-limit-5h-primary-standard');
    expect(data.windows[1]?.id).toBe('rate-limit-week-secondary-standard');
    expect(data.windows[2]?.id).toBe('code-review-rate-limit-month-primary-standard');
    expect(data.windows[3]?.id).toMatch(/^spark-5h-primary-[0-9a-f]{12}$/);
    expect(data.windows[0]?.usedPercent).toBe(100);
    expect(data.windows[2]?.periodHours).toBe(720);
    expect(data.credits.map((credit) => credit.id)).toEqual(['valid-1', 'valid-2']);
    expect(data.availableCreditCount).toBe(3);
    expect(data.applicableAvailableCreditCount).toBe(2);
  });

  it('uses primary and secondary as legacy five-hour and week only without durations', () => {
    const data = parseCodexQuota({ rate_limit: {
      primary_window: { used_percent: 10, reset_at: '2026-08-13T00:00:00Z' },
      secondary_window: { used_percent: 20, reset_at: '2026-08-19T00:00:00Z' },
    } }, null, { name: 'x', authIndex: 'i', plan_type: 'plus' }, nowMs);
    expect(data.windows.map((window) => window.id)).toEqual(['rate-limit-5h-primary-standard', 'rate-limit-week-secondary-standard']);
    expect(data.planType).toBe('plus');
  });

  it('recognizes month-length durations and allowed false as reached', () => {
    const data = parseCodexQuota({ rate_limit: {
      allowed: false,
      primary_window: { limit_window_seconds: 744 * 3600, reset_at: '2026-09-12T00:00:00Z' },
    } }, null, { name: 'x', authIndex: 'i' }, nowMs);
    expect(data.windows[0]).toMatchObject({ id: 'rate-limit-month-primary-standard', usedPercent: 100 });
    expect(data.windows[0]?.periodHours).toBe(744);
  });

  it('treats camel limitReached as reached', () => {
    const data = parseCodexQuota({ rate_limit: {
      limitReached: true,
      primary_window: { limit_window_seconds: 18000, used_percent: 20 },
    } }, null, { name: 'x', authIndex: 'i' }, nowMs);
    expect(data.windows[0]?.usedPercent).toBe(100);
  });

  it('keeps duplicate and slug-colliding additional windows uniquely stable', () => {
    const usageWithDuplicates = {
      additional_rate_limits: [
        { limit_name: 'Spark', rate_limit: { primary_window: { limit_window_seconds: 18000 } } },
        { limit_name: 'Spark', rate_limit: { primary_window: { limit_window_seconds: 18000 } } },
        { limit_name: 'Spark!', rate_limit: { primary_window: { limit_window_seconds: 18000 } } },
      ],
    };
    const first = parseCodexQuota(usageWithDuplicates, null, { name: 'x', authIndex: 'i' }, nowMs).windows.map((window) => window.id);
    const second = parseCodexQuota(usageWithDuplicates, null, { name: 'x', authIndex: 'i' }, nowMs).windows.map((window) => window.id);
    expect(first[0]).toMatch(/^spark-5h-primary-[0-9a-f]{12}$/);
    expect(first[1]).toMatch(/^spark-5h-primary-[0-9a-f]{12}-2$/);
    expect(first[2]).toMatch(/^spark-5h-primary-[0-9a-f]{12}$/);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);

    const reordered = {
      additional_rate_limits: [usageWithDuplicates.additional_rate_limits[2], usageWithDuplicates.additional_rate_limits[0]],
    };
    const reorderedIds = parseCodexQuota(reordered, null, { name: 'x', authIndex: 'i' }, nowMs).windows.map((window) => window.id);
    expect(reorderedIds).toEqual([first[2], first[0]]);
  });

  it('keeps same-identity windows stable when kind or period entries reorder', () => {
    const entries = [
      { limit_name: 'Shared', rate_limit: { primary_window: { limit_window_seconds: 18000 } } },
      { limit_name: 'Shared', rate_limit: { secondary_window: { limit_window_seconds: 604800 } } },
      { limit_name: 'Shared', rate_limit: { primary_window: { limit_window_seconds: 604800 } } },
    ];
    const original = parseCodexQuota({ additional_rate_limits: entries }, null, { name: 'x', authIndex: 'i' }, nowMs).windows;
    const reordered = parseCodexQuota({ additional_rate_limits: [entries[2], entries[0], entries[1]] }, null, { name: 'x', authIndex: 'i' }, nowMs).windows;
    const idsBySemantic = (windows: typeof original) => new Map(
      windows.map((window) => [`${window.periodHours}-${window.id.includes('-secondary-') ? 'secondary' : 'primary'}`, window.id]),
    );
    expect(idsBySemantic(reordered)).toEqual(idsBySemantic(original));
  });

  it('keeps usage reset-credit counts when detail lookup fails', () => {
    const data = parseCodexQuota({ rate_limit_reset_credits: { available_count: 4, applicable_available_count: 3 } }, null, { name: 'x', authIndex: 'i' }, nowMs);
    expect(data.availableCreditCount).toBe(4);
    expect(data.applicableAvailableCreditCount).toBe(3);
  });

  it('extracts account and renewal claims from nested JWT auth data without using file id', () => {
    const jwt = `header.${Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-jwt', chatgpt_subscription_active_until: '2026-08-22T00:00:00Z' })).toString('base64url')}.signature`;
    const data = parseCodexQuota({}, null, {
      name: 'x', authIndex: 'i', id: 'credential-id', metadata: { id_token: jwt },
    }, nowMs);
    expect(data.accountId).toBe('acct-jwt');
    expect(data.subscriptionActiveUntil).toBe(Date.parse('2026-08-22T00:00:00Z'));
  });

  it('extracts canonical OpenAI auth claims from a JWT', () => {
    const jwt = `header.${Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-canonical',
        chatgpt_plan_type: 'team',
        chatgpt_subscription_active_until: '2026-08-23T00:00:00Z',
      },
    })).toString('base64url')}.signature`;
    const data = parseCodexQuota({}, null, { name: 'x', authIndex: 'i', id_token: jwt }, nowMs);
    expect(data.accountId).toBe('acct-canonical');
    expect(data.planType).toBe('team');
    expect(data.subscriptionActiveUntil).toBe(Date.parse('2026-08-23T00:00:00Z'));
  });
});

describe('Codex adapter', () => {
  it('uses read-only GET requests, account header, CLI user agent, and optional credit errors', async () => {
    const calls: Array<{ url: string; options?: { timeoutMs?: number }; request: Parameters<ProviderQueryContext['apiCall']>[0] }> = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request, options) => {
      calls.push({ url: request.url, options, request });
      if (request.url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits') throw new Error('credits unavailable');
      return result(usage);
    });
    const data = await queryCodexQuota(file, { apiCall, timeoutMs: 999 });
    expect(calls.map((call) => call.url)).toEqual([
      'https://chatgpt.com/backend-api/wham/usage',
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
    ]);
    expect(calls[0]?.request).toMatchObject({
      method: 'GET',
      authIndex: 'idx-codex',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'User-Agent': 'codex_cli_rs/0.1.0',
        'Chatgpt-Account-Id': 'acct-123',
      },
    });
    expect(calls[1]?.request).toMatchObject({
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'User-Agent': 'codex_cli_rs/0.1.0',
        'Chatgpt-Account-Id': 'acct-123',
      },
    });
    expect(calls[1]?.options).toEqual({ signal: undefined, timeoutMs: 8000 });
    expect(data.creditDetailsError).toBe('credits unavailable');
    expect(readFileSync('src/providers/codex/adapter.ts', 'utf8')).not.toContain('/rate-limit-reset-credits/consume');
  });

  it('omits the account header when the auth file has no account id', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => result(
      request.url === 'https://chatgpt.com/backend-api/wham/usage' ? usage : creditDetails,
    ));
    await queryCodexQuota({ name: 'x', authIndex: 'i' }, { apiCall });
    expect(apiCall.mock.calls[0]?.[0].header).toEqual({
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': 'codex_cli_rs/0.1.0',
    });
  });

  it('propagates caller cancellation from optional credit details', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const controller = new AbortController();
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits') throw abortError;
      controller.abort();
      return result(usage);
    });
    await expect(queryCodexQuota(file, { apiCall, signal: controller.signal })).rejects.toBe(abortError);
  });

  it('keeps usage data when credit details time out', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits') throw new DOMException('timed out', 'AbortError');
      return result(usage);
    });
    await expect(queryCodexQuota(file, { apiCall })).resolves.toMatchObject({
      planType: 'pro',
      creditDetailsError: 'AbortError: timed out',
    });
  });

  it('turns main non-2xx into CpaApiError', async () => {
    await expect(queryCodexQuota(file, { apiCall: vi.fn(async () => result({ message: 'forbidden' }, 403)) }))
      .rejects.toMatchObject({ name: 'CpaApiError', statusCode: 403 });
  });
});
