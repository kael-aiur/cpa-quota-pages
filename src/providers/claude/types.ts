import type { ProviderQuotaData } from '../types';
import type { JsonRecord } from '../../api/types';

export interface ClaudeExtraUsage extends JsonRecord {
  is_enabled?: boolean;
  monthly_limit?: number;
  used_credits?: number;
  utilization?: number | null;
}

export interface ClaudeQuotaData extends ProviderQuotaData {
  extraUsage: ClaudeExtraUsage | null;
  planType: string | null;
}
