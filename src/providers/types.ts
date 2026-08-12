import type { AuthenticatedFetch } from '../auth/types';
import type { ApiCallResult, AuthFile, CpaApi } from '../api/types';

export type Provider = 'claude' | 'antigravity' | 'codex' | 'xai' | 'kimi';

export type ProviderSelection = Provider | 'all';

export type JsonRecord = Record<string, unknown>;

export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface ProviderQueryContext {
  apiCall: (
    request: Parameters<CpaApi['apiCall']>[0],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<ApiCallResult>;
  downloadAuthFile?: CpaApi['downloadAuthFile'];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ProviderQuotaData = {
  windows: QuotaWindow[];
  [key: string]: unknown;
};

export type ProviderQuery<T extends ProviderQuotaData = ProviderQuotaData> = (
  file: AuthFile,
  context: ProviderQueryContext,
) => Promise<T>;

export type ProviderApiResult<T = unknown> = ApiCallResult<T>;

export type { AuthenticatedFetch };
