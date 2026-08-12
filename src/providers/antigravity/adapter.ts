import type { AuthFile, ApiCallResult } from '../../api/types';
import { CpaApiError, extractApiError } from '../../api/errors';
import type { ProviderQueryContext } from '../types';
import {
  parseAntigravityQuota,
  parseAntigravitySubscription,
  resolveAntigravityProjectId,
} from './parser';
import type { AntigravityQuotaData } from './parser';

export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
] as const;

export const ANTIGRAVITY_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const ANTIGRAVITY_USER_AGENT = 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)';

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
};

function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function statusError(result: ApiCallResult): CpaApiError {
  return new CpaApiError(extractApiError(result), {
    statusCode: result.statusCode,
    result,
  });
}

function bodyOf(result: ApiCallResult): unknown {
  return result.body ?? result.bodyText;
}

function authIndex(file: AuthFile): string {
  const value = file.authIndex ?? file.auth_index;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Antigravity auth file is missing auth index');
}

export async function queryAntigravityQuota(
  file: AuthFile,
  context: ProviderQueryContext,
): Promise<AntigravityQuotaData> {
  const index = authIndex(file);
  const projectId = await resolveAntigravityProjectId(
    file,
    context.downloadAuthFile ?? (async () => ''),
  );
  if (!projectId) throw new Error('Antigravity auth file is missing project ID');

  const request = (url: string) => context.apiCall({
    authIndex: index,
    method: 'POST',
    url,
    header: { ...ANTIGRAVITY_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId }),
  }, { signal: context.signal, timeoutMs: context.timeoutMs });

  const subscriptionPromise = Promise.resolve().then(async () => {
    const result = await context.apiCall({
      authIndex: index,
      method: 'POST',
      url: ANTIGRAVITY_CODE_ASSIST_URL,
      header: { ...ANTIGRAVITY_REQUEST_HEADERS },
      data: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    }, { signal: context.signal, timeoutMs: context.timeoutMs });
    return isSuccess(result.statusCode) ? parseAntigravitySubscription(bodyOf(result)) : null;
  }).catch(() => null);

  let hadSuccess = false;
  let preferred: ApiCallResult | null = null;
  let lastFailure: ApiCallResult | null = null;
  let lastCause: unknown = null;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await request(url);
      if (!isSuccess(result.statusCode)) {
        lastFailure = result;
        if ((result.statusCode === 403 || result.statusCode === 404) && !preferred) preferred = result;
        continue;
      }
      hadSuccess = true;
      const parsed = parseAntigravityQuota(bodyOf(result), result.header, Date.now());
      if (parsed.groups.length > 0) {
        return { ...parsed, subscription: await subscriptionPromise };
      }
      lastCause = new Error('Antigravity quota response contained no valid groups');
    } catch (cause) {
      lastCause = cause;
      if (cause instanceof CpaApiError) {
        if ((cause.statusCode === 403 || cause.statusCode === 404) && !preferred) preferred = cause.result ?? null;
      }
    }
  }

  if (hadSuccess) {
    return { groups: [], subscription: await subscriptionPromise, serverTimeOffsetMs: null };
  }

  if (preferred) throw statusError(preferred);
  if (lastFailure) throw statusError(lastFailure);
  if (lastCause instanceof Error) throw lastCause;
  throw new Error('Antigravity quota request failed');
}
