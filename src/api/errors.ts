import type { ApiCallResult, JsonRecord } from './types';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

export function extractApiError(result: ApiCallResult): string {
  const body = result.body;
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error)) {
      const message = usableText(error.message);
      if (message) return message;
    }
    const errorText = usableText(error);
    if (errorText) return errorText;

    const message = usableText(body.message);
    if (message) return message;
  }

  const bodyValue = usableText(body);
  if (bodyValue) return bodyValue;

  const bodyText = usableText(result.bodyText);
  if (bodyText) return bodyText;
  return `HTTP ${result.statusCode}`;
}

export class CpaApiError extends Error {
  readonly statusCode: number | undefined;
  readonly result: ApiCallResult | undefined;

  constructor(message: string, options: { statusCode?: number; result?: ApiCallResult; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CpaApiError';
    this.statusCode = options.statusCode;
    this.result = options.result;
  }
}
