import type { AuthFile } from '../../api/types';
import { extractApiError } from '../../api/errors';
import type { ProviderQueryContext } from '../types';
import { parseClaudeQuota } from './parser';
import type { ClaudeQuotaData } from './types';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
export const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};

function responseBody(result: { body: unknown; bodyText: string }): unknown {
  return result.body ?? result.bodyText;
}

function errorForResult(result: { statusCode: number; body: unknown; bodyText: string }): Error {
  return new Error(extractApiError({
    statusCode: result.statusCode,
    header: {},
    bodyText: result.bodyText,
    body: result.body,
  }));
}

function authIndex(file: AuthFile): string {
  const value = file.authIndex ?? file.auth_index;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Claude auth file is missing authIndex');
}

export async function queryClaudeQuota(
  file: AuthFile,
  context: ProviderQueryContext,
): Promise<ClaudeQuotaData> {
  const index = authIndex(file);
  const request = (url: string) => context.apiCall({
    authIndex: index,
    method: 'GET',
    url,
    header: { ...CLAUDE_REQUEST_HEADERS },
  }, { signal: context.signal, timeoutMs: context.timeoutMs });

  const [usageResult, profileResult] = await Promise.allSettled([
    request(CLAUDE_USAGE_URL),
    request(CLAUDE_PROFILE_URL),
  ]);

  if (usageResult.status === 'rejected') throw usageResult.reason;
  if (usageResult.value.statusCode < 200 || usageResult.value.statusCode >= 300) {
    throw errorForResult(usageResult.value);
  }

  const profilePayload = profileResult.status === 'fulfilled'
    && profileResult.value.statusCode >= 200
    && profileResult.value.statusCode < 300
    ? responseBody(profileResult.value)
    : undefined;

  return parseClaudeQuota(responseBody(usageResult.value), profilePayload);
}
