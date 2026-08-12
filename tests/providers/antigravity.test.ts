import { describe, expect, it, vi } from 'vitest';
import summary from '../fixtures/antigravity/summary.json';
import subscription from '../fixtures/antigravity/subscription.json';
import downloadedAuth from '../fixtures/antigravity/downloaded-auth.json';
import type { ApiCallResult, AuthFile } from '../../src/api/types';
import type { ProviderQueryContext } from '../../src/providers/types';
import {
  parseAntigravityQuota,
  parseAntigravitySubscription,
  resolveAntigravityProjectId,
} from '../../src/providers/antigravity/parser';
import {
  ANTIGRAVITY_CODE_ASSIST_URL,
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  queryAntigravityQuota,
} from '../../src/providers/antigravity/adapter';

const nowMs = Date.parse('2026-08-12T12:00:00.000Z');
const file: AuthFile = { name: 'antigravity.json', provider: 'antigravity', authIndex: 'idx-antigravity' };

function result(body: unknown, statusCode = 200, header: Record<string, string[]> = {}): ApiCallResult {
  return { statusCode, header, bodyText: typeof body === 'string' ? body : JSON.stringify(body), body };
}

function context(apiCall: ProviderQueryContext['apiCall'], downloadAuthFile?: ProviderQueryContext['downloadAuthFile']): ProviderQueryContext {
  return { apiCall, downloadAuthFile, timeoutMs: 1234 };
}

describe('Antigravity project resolver', () => {
  it('uses top-level, metadata, attributes, and gemini virtual project in precedence order', async () => {
    const download = vi.fn(async () => JSON.stringify(downloadedAuth));
    await expect(resolveAntigravityProjectId({ ...file, projectId: 'top', metadata: { project_id: 'metadata' }, attributes: { project_id: 'attributes', gemini_virtual_project: 'gemini' } }, download)).resolves.toBe('top');
    await expect(resolveAntigravityProjectId({ ...file, metadata: { projectId: 'metadata' }, attributes: { project_id: 'attributes', gemini_virtual_project: 'gemini' } }, download)).resolves.toBe('metadata');
    await expect(resolveAntigravityProjectId({ ...file, attributes: { project_id: 'attributes', gemini_virtual_project: 'gemini' } }, download)).resolves.toBe('attributes');
    await expect(resolveAntigravityProjectId({ ...file, attributes: { gemini_virtual_project: 'gemini' } }, download)).resolves.toBe('gemini');
    expect(download).toHaveBeenCalledTimes(0);
  });

  it('falls back through downloaded top-level, installed, then web project fields', async () => {
    const download = vi.fn(async () => JSON.stringify({ project_id: 'downloaded-top' }));
    await expect(resolveAntigravityProjectId(file, download)).resolves.toBe('downloaded-top');
    await expect(resolveAntigravityProjectId(file, vi.fn(async () => JSON.stringify(downloadedAuth)))).resolves.toBe('downloaded-installed-project');
    await expect(resolveAntigravityProjectId(file, vi.fn(async () => JSON.stringify({ web: { project_id: 'downloaded-web-project' } })))).resolves.toBe('downloaded-web-project');
  });

  it('returns null for malformed or empty downloaded auth', async () => {
    await expect(resolveAntigravityProjectId(file, vi.fn(async () => 'not json'))).resolves.toBeNull();
    await expect(resolveAntigravityProjectId(file, vi.fn(async () => ''))).resolves.toBeNull();
    await expect(resolveAntigravityProjectId(file, vi.fn(async () => { throw new Error('download failed'); }))).resolves.toBeNull();
  });
});

describe('Antigravity quota parser', () => {
  it('parses snake/camel buckets, filters invalid fractions, sorts groups and 5h before weekly', () => {
    const data = parseAntigravityQuota(summary, {}, nowMs);
    expect(data.groups.map((group) => group.label)).toEqual(['Alpha Models', 'Zeta Models']);
    expect(data.groups[0].buckets[0]).toMatchObject({
      id: 'gemini-weekly', label: 'Gemini', remainingFraction: 0.5, periodHours: 168,
    });
    expect(data.groups[1].buckets.map((bucket) => bucket.label)).toEqual(['Five Hour', 'Weekly']);
    expect(data.groups[1].buckets[0]).toMatchObject({ remainingFraction: 0.75, periodHours: 5, resetAtMs: Date.parse('2026-08-12T15:00:00.000Z') });
  });

  it('parses subscription tier and applies Date header server offset', () => {
    const data = parseAntigravityQuota({ ...summary, subscription }, { date: ['Wed, 12 Aug 2026 12:00:10 GMT'] }, nowMs);
    expect(data.subscription).toEqual({ plan: 'pro', tierId: 'g1-pro-tier', tierName: 'Pro' });
    expect(data.serverTimeOffsetMs).toBe(10_000);
  });

  it('accepts wrapped/string payloads and returns empty groups for invalid payloads', () => {
    expect(parseAntigravityQuota(JSON.stringify({ body: summary }), {}, nowMs).groups.length).toBe(2);
    expect(parseAntigravityQuota('not json', {}, nowMs).groups).toEqual([]);
  });
});

describe('Antigravity quota adapter', () => {
  it('queries quota endpoints sequentially and subscription concurrently with exact request shape', async () => {
    const calls: string[] = [];
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      calls.push(request.url);
      expect(request.authIndex).toBe('idx-antigravity');
      expect(request.method).toBe('POST');
      expect(request.header).toEqual(ANTIGRAVITY_REQUEST_HEADERS);
      expect(request.data).toBe(request.url === ANTIGRAVITY_CODE_ASSIST_URL
        ? JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } })
        : JSON.stringify({ project: 'project-id' }));
      if (request.url === ANTIGRAVITY_CODE_ASSIST_URL) return result(subscription);
      if (request.url === ANTIGRAVITY_QUOTA_URLS[0]) return result({ groups: [] });
      if (request.url === ANTIGRAVITY_QUOTA_URLS[1]) return result(summary, 200, { Date: ['Wed, 12 Aug 2026 12:00:10 GMT'] });
      throw new Error('unexpected endpoint');
    });

    expect(parseAntigravitySubscription(subscription)?.plan).toBe('pro');
    const data = await queryAntigravityQuota({ ...file, projectId: 'project-id' }, context(apiCall, async () => ''));
    expect(calls).toContain(ANTIGRAVITY_CODE_ASSIST_URL);
    expect(calls.indexOf(ANTIGRAVITY_QUOTA_URLS[0])).toBeLessThan(calls.indexOf(ANTIGRAVITY_QUOTA_URLS[1]));
    expect(data.groups).toHaveLength(2);
    expect(data.subscription?.plan).toBe('pro');
  });

  it('continues after a 2xx response with no valid groups and returns empty groups after any 2xx', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === ANTIGRAVITY_CODE_ASSIST_URL) throw new Error('optional subscription failed');
      return result({ groups: [] });
    });
    const data = await queryAntigravityQuota({ ...file, projectId: 'project-id' }, context(apiCall, async () => ''));
    const observed = apiCall.mock.calls.map(([request]) => request.url);
    expect(observed.filter((url) => url !== ANTIGRAVITY_CODE_ASSIST_URL)).toEqual([...ANTIGRAVITY_QUOTA_URLS]);
    expect(observed).toContain(ANTIGRAVITY_CODE_ASSIST_URL);
    expect(data).toEqual({ groups: [], subscription: null, serverTimeOffsetMs: null });
  });

  it('prefers the final 403/404 status over another endpoint failure', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async (request) => {
      if (request.url === ANTIGRAVITY_CODE_ASSIST_URL) throw new Error('optional');
      return request.url === ANTIGRAVITY_QUOTA_URLS[0]
        ? result({ message: 'forbidden' }, 403)
        : result({ message: 'server down' }, 500);
    });
    const error = await queryAntigravityQuota({ ...file, projectId: 'project-id' }, context(apiCall)).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ statusCode: 403, result: { body: { message: 'forbidden' } } });
  });

  it('reports a clear missing project error without quota calls', async () => {
    const apiCall = vi.fn<ProviderQueryContext['apiCall']>(async () => result(summary));
    await expect(queryAntigravityQuota(file, context(apiCall))).rejects.toThrow('Antigravity auth file is missing project ID');
    expect(apiCall).not.toHaveBeenCalled();
  });
});
