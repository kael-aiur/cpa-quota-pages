import type { ApiCallResult, AuthFile } from '../../api/types';
import { CpaApiError, extractApiError } from '../../api/errors';
import type { ProviderQueryContext } from '../types';
import { getCodexAccountId, parseCodexQuota } from './parser';
import type { CodexQuotaData } from './parser';

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_CREDIT_DETAILS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
export const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.1.0',
};

function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function authIndex(file: AuthFile): string {
  const value = file.authIndex ?? file.auth_index;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Codex auth file is missing auth index');
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function queryCodexQuota(
  file: AuthFile,
  context: ProviderQueryContext,
): Promise<CodexQuotaData> {
  const index = authIndex(file);
  const account = getCodexAccountId(file);
  const header = account
    ? { ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': account }
    : { ...CODEX_REQUEST_HEADERS };
  const request = (url: string, timeoutMs = context.timeoutMs) => context.apiCall({
    authIndex: index,
    method: 'GET',
    url,
    header,
  }, { signal: context.signal, timeoutMs });

  const usageResult = await request(CODEX_USAGE_URL);
  if (!isSuccess(usageResult.statusCode)) throw statusError(usageResult);

  let creditDetails: unknown = null;
  let creditDetailsError: string | undefined;
  try {
    const result = await request(CODEX_CREDIT_DETAILS_URL, 8000);
    if (isSuccess(result.statusCode)) {
      creditDetails = bodyOf(result);
    } else {
      creditDetailsError = extractApiError(result);
    }
  } catch (cause) {
    if (context.signal?.aborted) throw cause;
    creditDetailsError = errorMessage(cause);
  }

  const data = parseCodexQuota(bodyOf(usageResult), creditDetails, file, Date.now());
  return creditDetailsError ? { ...data, creditDetailsError } : data;
}
