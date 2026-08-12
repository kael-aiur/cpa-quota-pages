import type { AuthenticatedFetch } from '../auth/types';
import type { ApiCallResult, AuthFile, CpaApi } from '../api/types';
import type { AntigravityQuotaData } from './antigravity/parser';
import type { ClaudeQuotaData } from './claude/types';
import type { CodexQuotaData } from './codex/parser';
import type { KimiQuotaData } from './kimi/parser';
import type { XaiQuotaData } from './xai/parser';

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

export type ProviderQuotaResult = ClaudeQuotaData | AntigravityQuotaData | CodexQuotaData | KimiQuotaData | XaiQuotaData;

export type ProviderQuery<T extends ProviderQuotaResult = ProviderQuotaResult> = (
  file: AuthFile,
  context: ProviderQueryContext,
) => Promise<T>;

export type ProviderApiResult<T = unknown> = ApiCallResult<T>;

export type { AuthenticatedFetch };
