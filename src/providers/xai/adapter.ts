import type { ApiCallResult, AuthFile } from '../../api/types';
import { CpaApiError, extractApiError } from '../../api/errors';
import type { ProviderQueryContext } from '../types';
import { isPaidXaiCredential, mergeXaiBilling, parseXaiBilling } from './parser';
import type { XaiBillingSummary, XaiQuotaData } from './parser';

export const XAI_BILLING_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
export const XAI_API_ME_URL = 'https://api.x.ai/v1/me';
export const XAI_API_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
export const XAI_PAID_HEALTH_MODEL = 'grok-4.5';
export const XAI_GROK_CLIENT_VERSION = '0.2.91';
export const XAI_GROK_USER_AGENT = 'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)';
export const XAI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
  accept: '*/*',
  'user-agent': XAI_GROK_USER_AGENT,
};
export const XAI_API_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  accept: 'application/json',
};

function authIndex(file: AuthFile): string {
  const value = file.authIndex ?? file.auth_index;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('xAI auth file is missing auth index');
}

function success(statusCode: number): boolean { return statusCode >= 200 && statusCode < 300; }
function body(result: ApiCallResult): unknown { return result.body ?? result.bodyText; }
function statusError(result: ApiCallResult): CpaApiError {
  return new CpaApiError(extractApiError(result), { statusCode: result.statusCode, result });
}
function isAbortError(reason: unknown): boolean {
  if ((typeof reason !== 'object' && typeof reason !== 'function') || reason === null) return false;
  try { return (reason as { name?: unknown }).name === 'AbortError'; } catch { return false; }
}

function createAbortError(): Error {
  if (typeof globalThis.DOMException === 'function') return new globalThis.DOMException('The operation was aborted', 'AbortError');
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function abortReason(signal: AbortSignal | undefined, results: PromiseSettledResult<unknown>[] = []): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  const aborted = results.find((result) => result.status === 'rejected' && isAbortError(result.reason));
  if (aborted?.status === 'rejected') return aborted.reason;
  return createAbortError();
}

function emptyData(billing: XaiBillingSummary | null): XaiQuotaData {
  return { windows: [], billing };
}

async function paidHealth(file: AuthFile, context: ProviderQueryContext): Promise<XaiBillingSummary> {
  const index = authIndex(file);
  const requests = await Promise.allSettled([
    context.apiCall({ authIndex: index, method: 'GET', url: XAI_API_ME_URL, header: { ...XAI_API_REQUEST_HEADERS } }, { signal: context.signal, timeoutMs: context.timeoutMs }),
    context.apiCall({
      authIndex: index, method: 'POST', url: XAI_API_CHAT_URL,
      header: { ...XAI_API_REQUEST_HEADERS, 'Content-Type': 'application/json' },
      data: JSON.stringify({ model: XAI_PAID_HEALTH_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
    }, { signal: context.signal, timeoutMs: context.timeoutMs }),
  ]);
  const chat = requests[1];
  if (context.signal?.aborted) throw abortReason(context.signal, requests);
  if (requests.some((request) => request.status === 'rejected' && isAbortError(request.reason))) {
    throw abortReason(context.signal, requests);
  }
  if (chat.status === 'rejected') throw chat.reason;
  if (!success(chat.value.statusCode)) throw statusError(chat.value);
  const profile = requests[0].status === 'fulfilled' && success(requests[0].value.statusCode) ? body(requests[0].value) : null;
  const profileRow = typeof profile === 'object' && profile !== null && !Array.isArray(profile) ? profile as Record<string, unknown> : {};
  const userId = typeof profileRow.user_id === 'string' ? profileRow.user_id : typeof profileRow.userId === 'string' ? profileRow.userId : undefined;
  const teamId = typeof profileRow.team_id === 'string' ? profileRow.team_id : typeof profileRow.teamId === 'string' ? profileRow.teamId : undefined;
  return {
    mode: 'paid-health', source: 'api.x.ai-fallback', planType: 'paid', healthStatus: 'chat-ok', userId, teamId,
    periodType: 'unknown', usagePercent: null, productUsage: [], monthlyLimitCents: null, usedCents: null,
    includedUsedCents: null, onDemandCapCents: null, onDemandUsedCents: null, onDemandUsedPercent: null,
    usedPercent: null, resetAtMs: null, periodHours: null,
  };
}

export async function queryXaiQuota(file: AuthFile, context: ProviderQueryContext): Promise<XaiQuotaData> {
  if (context.signal?.aborted) throw abortReason(context.signal);
  if (isPaidXaiCredential(file)) return emptyData(await paidHealth(file, context));
  const index = authIndex(file);
  const request = (url: string) => context.apiCall({ authIndex: index, method: 'GET', url, header: { ...XAI_REQUEST_HEADERS } }, { signal: context.signal, timeoutMs: context.timeoutMs });
  const [weekly, monthly] = await Promise.allSettled([request(XAI_BILLING_WEEKLY_URL), request(XAI_BILLING_MONTHLY_URL)]);
  if (context.signal?.aborted) throw abortReason(context.signal, [weekly, monthly]);
  if ([weekly, monthly].some((requestResult) => requestResult.status === 'rejected' && isAbortError(requestResult.reason))) {
    throw abortReason(context.signal, [weekly, monthly]);
  }
  const weeklyData = weekly.status === 'fulfilled' && success(weekly.value.statusCode) ? parseXaiBilling(body(weekly.value)) : null;
  const monthlyData = monthly.status === 'fulfilled' && success(monthly.value.statusCode) ? parseXaiBilling(body(monthly.value)) : null;
  const merged = mergeXaiBilling(weeklyData, monthlyData);
  if (merged) return emptyData(merged);

  const originalError = weekly.status === 'rejected'
    ? weekly.reason
    : weekly.status === 'fulfilled' && !success(weekly.value.statusCode)
      ? statusError(weekly.value)
      : monthly.status === 'rejected'
        ? monthly.reason
        : monthly.status === 'fulfilled' && !success(monthly.value.statusCode)
          ? statusError(monthly.value)
          : new Error('xAI billing returned no useful data');
  if (context.signal?.aborted) throw abortReason(context.signal);
  try {
    return emptyData(await paidHealth(file, context));
  } catch (cause) {
    if (context.signal?.aborted) throw abortReason(context.signal);
    if (isAbortError(cause)) throw cause;
    throw originalError;
  }
}
