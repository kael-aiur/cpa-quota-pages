import type { ApiCallResult, AuthFile } from '../../api/types';
import { CpaApiError, extractApiError } from '../../api/errors';
import type { ProviderQueryContext } from '../types';
import { parseKimiQuota } from './parser';
import type { KimiQuotaData } from './parser';

export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
export const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};

function authIndex(file: AuthFile): string {
  for (const value of [file.authIndex, file.auth_index]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  }
  throw new Error('Kimi auth file is missing auth index');
}

function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function bodyOf(result: ApiCallResult): unknown {
  return result.body ?? result.bodyText;
}

function statusError(result: ApiCallResult): CpaApiError {
  return new CpaApiError(extractApiError(result), {
    statusCode: result.statusCode,
    result,
  });
}

export async function queryKimiQuota(
  file: AuthFile,
  context: ProviderQueryContext,
): Promise<KimiQuotaData> {
  const result = await context.apiCall({
    authIndex: authIndex(file),
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  }, { signal: context.signal, timeoutMs: context.timeoutMs });

  if (!isSuccess(result.statusCode)) throw statusError(result);
  return parseKimiQuota(bodyOf(result), Date.now());
}
