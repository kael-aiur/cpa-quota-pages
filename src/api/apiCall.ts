import type { AuthenticatedFetch } from '../auth/types';
import { CpaApiError, extractApiError } from './errors';
import { createAuthFileApi } from './authFiles';
import type { ApiCallRequest, ApiCallResult, CpaApi } from './types';

function normalizeBody(input: unknown): { bodyText: string; body: unknown | null } {
  if (input === undefined || input === null) return { bodyText: '', body: null };

  if (typeof input === 'string') {
    const bodyText = input;
    const trimmed = bodyText.trim();
    if (!trimmed) return { bodyText, body: null };
    try {
      return { bodyText, body: JSON.parse(trimmed) };
    } catch {
      return { bodyText, body: bodyText };
    }
  }

  try {
    return { bodyText: JSON.stringify(input), body: input };
  } catch {
    return { bodyText: String(input), body: input };
  }
}

function normalizeHeaders(input: unknown): Record<string, string[]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) result[key] = value.map((item) => String(item));
    else if (value !== undefined && value !== null) result[key] = [String(value)];
  }
  return result;
}

async function parseWrapperResponse(response: Response): Promise<ApiCallResult> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (cause) {
    throw new CpaApiError('CPA api-call 响应不是有效 JSON', { statusCode: response.status, cause });
  }

  if (!response.ok) {
    const result: ApiCallResult = {
      statusCode: response.status,
      header: {},
      bodyText: text,
      body: typeof payload === 'string' || (typeof payload === 'object' && payload !== null)
        ? payload
        : null,
    };
    throw new CpaApiError(extractApiError(result), { statusCode: response.status, result });
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new CpaApiError('CPA api-call 响应缺少 status_code', { statusCode: response.status });
  }

  const wrapper = payload as Record<string, unknown>;
  const rawStatus = wrapper.status_code;
  const statusCode = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
  if (rawStatus === undefined || rawStatus === null || !Number.isFinite(statusCode)) {
    throw new CpaApiError('CPA api-call 响应缺少 status_code', { statusCode: response.status });
  }

  const normalized = normalizeBody(wrapper.body);
  return {
    statusCode,
    header: normalizeHeaders(wrapper.header),
    bodyText: normalized.bodyText,
    body: normalized.body,
  };
}

export function createCpaApi(request: AuthenticatedFetch): CpaApi {
  const authFiles = createAuthFileApi(request);

  return {
    ...authFiles,
    async apiCall<T>(
      payload: ApiCallRequest,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<ApiCallResult<T>> {
      const response = await request('/cpa/v0/management/api-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      return await parseWrapperResponse(response) as ApiCallResult<T>;
    },
  };
}

export { extractApiError } from './errors';
