import { queryAntigravityQuota } from './antigravity/adapter';
import { queryClaudeQuota } from './claude/adapter';
import { queryCodexQuota } from './codex/adapter';
import { queryKimiQuota } from './kimi/adapter';
import { queryXaiQuota } from './xai/adapter';
import type { Provider, ProviderQuery } from './types';

export const providerQueries: Readonly<Record<Provider, ProviderQuery>> = Object.freeze({
  claude: queryClaudeQuota,
  antigravity: queryAntigravityQuota,
  codex: queryCodexQuota,
  xai: queryXaiQuota,
  kimi: queryKimiQuota,
});

export { queryAntigravityQuota, queryClaudeQuota, queryCodexQuota, queryKimiQuota, queryXaiQuota };
export type { Provider, ProviderQuery, ProviderQueryContext, ProviderQuotaData, QuotaWindow } from './types';
