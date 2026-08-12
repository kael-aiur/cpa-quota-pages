import { describe, expect, it, vi } from 'vitest';
import legacyUsage from '../fixtures/claude/usage-legacy.json';
import modernUsage from '../fixtures/claude/usage-modern.json';
import profile from '../fixtures/claude/profile.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import type { ProviderQueryContext } from '../../src/providers/types';
import { parseClaudeQuota } from '../../src/providers/claude/parser';
import { queryClaudeQuota } from '../../src/providers/claude/adapter';

const file: AuthFile = { name: 'claude.json', provider: 'claude', authIndex: 'idx-claude' };

function context(apiCall: ProviderQueryContext['apiCall']): ProviderQueryContext {
  return { apiCall };
}

function result(body: unknown, statusCode = 200): ApiCallResult {
  return { statusCode, header: {}, bodyText: JSON.stringify(body), body };
}

describe('Claude quota parser', () => {
  it('normalizes legacy windows, plan, and extra usage', () => {
    const data = parseClaudeQuota(legacyUsage, {
      account: { has_claude_max: false, has_claude_pro: false },
      organization: { organization_type: 'claude_team', subscription_status: 'active' },
    });

    expect(data.planType).toBe('plan_team');
    expect(data.extraUsage).toEqual(legacyUsage.extra_usage);
    expect(data.windows.map(({ id, label, usedPercent, remainingPercent, periodHours }) => ({
      id, label, usedPercent, remainingPercent, periodHours,
    }))).toEqual([
      { id: 'five-hour', label: 'Five-hour', usedPercent: 25, remainingPercent: 75, periodHours: 5 },
      { id: 'seven-day', label: 'Seven-day', usedPercent: 40, remainingPercent: 60, periodHours: 168 },
      { id: 'seven-day-oauth-apps', label: 'OAuth Apps', usedPercent: 10, remainingPercent: 90, periodHours: 168 },
      { id: 'seven-day-opus', label: 'Opus', usedPercent: 55, remainingPercent: 45, periodHours: 168 },
      { id: 'seven-day-sonnet', label: 'Sonnet', usedPercent: 35, remainingPercent: 65, periodHours: 168 },
      { id: 'seven-day-cowork', label: 'Cowork', usedPercent: 20, remainingPercent: 80, periodHours: 168 },
      { id: 'seven-day-fable', label: 'Fable', usedPercent: 41, remainingPercent: 59, periodHours: 168 },
    ]);
    expect(data.windows[0].resetAtMs).toBe(Date.parse('2026-08-12T15:00:00.000Z'));
  });

  it('normalizes modern Fable 5 and suppresses the duplicate legacy Fable window', () => {
    const data = parseClaudeQuota(modernUsage, profile);
    const fableWindows = data.windows.filter((window) => window.id === 'seven-day-fable');

    expect(fableWindows).toHaveLength(1);
    expect(fableWindows[0]).toMatchObject({
      label: 'Fable',
      usedPercent: 64,
      remainingPercent: 36,
      resetAtMs: Date.parse('2026-08-17T12:00:00.000Z'),
      periodHours: 168,
    });
    expect(data.planType).toBe('plan_pro');
  });

  it.each([
    [{ account: { has_claude_max: true } }, 'plan_max'],
    [{ account: { has_claude_pro: true } }, 'plan_pro'],
    [{ account: { has_claude_max: false, has_claude_pro: false } }, 'plan_free'],
    [{ organization: { organization_type: 'claude_team', subscription_status: 'active' } }, 'plan_team'],
  ])('resolves %s as %s', (input, expected) => {
    expect(parseClaudeQuota({}, input).planType).toBe(expected);
  });

  it('parses a usage JSON string as an object payload', () => {
    expect(parseClaudeQuota(JSON.stringify(legacyUsage)).windows).toHaveLength(7);
  });

  it.each(['not json', '', '   ', null, 42, true, []])(
    'rejects a non-object usage payload: %s',
    (payload) => {
      expect(() => parseClaudeQuota(payload)).toThrow('Claude usage response must be a JSON object');
    },
  );
});

describe('Claude quota adapter', () => {
  it('sends parallel usage and profile requests with exact URLs and headers', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      expect(request.authIndex).toBe('idx-claude');
      expect(request.method).toBe('GET');
      expect(request.header).toEqual({
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      });
      return request.url.endsWith('/usage') ? result(modernUsage) : result(profile);
    });

    const data = await queryClaudeQuota(file, context(apiCall));

    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(apiCall.mock.calls.map(([request]) => request.url).sort()).toEqual([
      'https://api.anthropic.com/api/oauth/profile',
      'https://api.anthropic.com/api/oauth/usage',
    ]);
    expect(data.planType).toBe('plan_pro');
  });

  it('rejects when the required usage request fails', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url.endsWith('/usage')) return result({ error: 'usage failed' }, 503);
      return result(profile);
    });

    await expect(queryClaudeQuota(file, context(apiCall))).rejects.toThrow('usage failed');
  });

  it('returns quota when optional profile request fails', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url.endsWith('/usage')) return result(legacyUsage);
      throw new Error('profile unavailable');
    });

    const data = await queryClaudeQuota(file, context(apiCall));
    expect(data.windows).toHaveLength(7);
    expect(data.planType).toBeNull();
  });

  it('ignores a malformed optional profile response', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url.endsWith('/usage')) return result(JSON.stringify(legacyUsage));
      return result('not json');
    });

    const data = await queryClaudeQuota(file, context(apiCall));
    expect(data.windows).toHaveLength(7);
    expect(data.planType).toBeNull();
  });

  it('rejects a non-2xx usage response even when apiCall resolves', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url.endsWith('/usage')) return result({ message: 'rate limited' }, 429);
      return result(profile);
    });

    const error = await queryClaudeQuota(file, context(apiCall)).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ statusCode: 429 });
    expect(error).toHaveProperty('result.body.message', 'rate limited');
  });

  it.each([
    ['not json', 'malformed JSON'],
    ['', 'empty'],
    [null, 'null'],
    [42, 'primitive'],
  ])('rejects a 2xx %s usage response', async (body, kind) => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url.endsWith('/usage')) return result(body);
      return result(profile);
    });

    await expect(queryClaudeQuota(file, context(apiCall))).rejects.toThrow(
      `Claude usage response must be a JSON object (${kind})`,
    );
  });
});
