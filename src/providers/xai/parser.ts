import type { AuthFile, JsonRecord } from '../../api/types';
import type { ProviderQuotaData, QuotaWindow } from '../types';

export interface XaiBillingSummary {
  mode: 'billing' | 'paid-health';
  source?: 'cli-chat-proxy' | 'api.x.ai-fallback';
  planType?: 'paid';
  healthStatus?: 'chat-ok';
  userId?: string;
  teamId?: string;
  periodType: 'weekly' | 'monthly' | 'unknown';
  usagePercent: number | null;
  periodStart?: string;
  periodEnd?: string;
  productUsage: { product: string; usagePercent: number | null }[];
  monthlyLimitCents: number | null;
  usedCents: number | null;
  includedUsedCents: number | null;
  onDemandCapCents: number | null;
  onDemandUsedCents: number | null;
  onDemandUsedPercent: number | null;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  usedPercent: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface XaiQuotaData extends ProviderQuotaData {
  windows: QuotaWindow[];
  billing: XaiBillingSummary | null;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cents(value: unknown): number | null {
  const item = record(value);
  return number(item?.val ?? value);
}

function dateMs(value: unknown): number | null {
  const parsed = text(value);
  if (!parsed) return null;
  const ms = Date.parse(parsed);
  return Number.isFinite(ms) ? ms : null;
}

function periodType(value: unknown): XaiBillingSummary['periodType'] {
  const normalized = text(value)?.toLowerCase() ?? '';
  if (normalized.includes('weekly')) return 'weekly';
  if (normalized.includes('monthly')) return 'monthly';
  return 'unknown';
}

function productUsage(value: unknown): XaiBillingSummary['productUsage'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = record(item);
    if (!row) return [];
    return [{ product: text(row.product) ?? `Product ${index + 1}`, usagePercent: number(row.usagePercent ?? row.usage_percent) }];
  });
}

export function parseXaiBilling(payload: unknown): XaiBillingSummary | null {
  let parsed: unknown = payload;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  const root = record(parsed);
  const config = record(root?.config);
  if (!config) return null;

  const current = record(config.currentPeriod ?? config.current_period);
  const type = periodType(current?.type);
  const weeklyUsage = number(config.creditUsagePercent ?? config.credit_usage_percent);
  const monthlyLimit = cents(config.monthlyLimit ?? config.monthly_limit);
  const used = cents(config.used);
  const included = used === null ? null : monthlyLimit !== null && monthlyLimit > 0 ? Math.min(used, monthlyLimit) : used;
  const onDemandCap = cents(config.onDemandCap ?? config.on_demand_cap);
  const onDemandUsed = cents(config.onDemandUsed ?? config.on_demand_used) ?? (used !== null && monthlyLimit !== null ? Math.max(0, used - monthlyLimit) : null);
  const usedPercent = monthlyLimit !== null && monthlyLimit > 0 && included !== null ? included / monthlyLimit * 100 : null;
  const onDemandUsedPercent = onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null ? onDemandUsed / onDemandCap * 100 : null;
  const hasWeekly = weeklyUsage !== null || type === 'weekly' || productUsage(config.productUsage ?? config.product_usage).length > 0;
  const hasMonthly = monthlyLimit !== null || used !== null || onDemandCap !== null || text(config.billingPeriodEnd ?? config.billing_period_end) !== null;
  if (!hasWeekly && !hasMonthly) return null;

  const resolvedType = hasWeekly ? (type === 'unknown' ? 'weekly' : type) : 'monthly';
  const activeStart = hasWeekly ? text(current?.start) : undefined;
  const activeEnd = hasWeekly ? text(current?.end) : undefined;
  const activeStartMs = dateMs(activeStart);
  const activeEndMs = dateMs(activeEnd);
  return {
    mode: 'billing', source: 'cli-chat-proxy', periodType: resolvedType,
    usagePercent: hasWeekly ? weeklyUsage : usedPercent,
    periodStart: activeStart ?? undefined, periodEnd: activeEnd ?? undefined,
    productUsage: productUsage(config.productUsage ?? config.product_usage),
    monthlyLimitCents: monthlyLimit, usedCents: used, includedUsedCents: included,
    onDemandCapCents: onDemandCap, onDemandUsedCents: onDemandUsed, onDemandUsedPercent,
    billingPeriodStart: text(config.billingPeriodStart ?? config.billing_period_start) ?? undefined,
    billingPeriodEnd: text(config.billingPeriodEnd ?? config.billing_period_end) ?? undefined,
    usedPercent, resetAtMs: resolvedType === 'weekly' ? activeEndMs : null,
    periodHours: resolvedType === 'weekly' && activeStartMs !== null && activeEndMs !== null ? (activeEndMs - activeStartMs) / 3600000 : null,
  };
}

export function mergeXaiBilling(weekly: XaiBillingSummary | null, monthly: XaiBillingSummary | null): XaiBillingSummary | null {
  if (!weekly) return monthly;
  if (!monthly) return weekly;
  const active = weekly.periodType !== 'unknown' ? weekly : monthly;
  return {
    ...weekly,
    periodType: active.periodType,
    periodStart: active.periodStart,
    periodEnd: active.periodEnd,
    resetAtMs: active.periodType === 'weekly' ? active.resetAtMs : null,
    periodHours: active.periodType === 'weekly' ? active.periodHours : null,
    usagePercent: weekly.usagePercent ?? monthly.usagePercent,
    productUsage: weekly.productUsage.length ? weekly.productUsage : monthly.productUsage,
    monthlyLimitCents: weekly.monthlyLimitCents ?? monthly.monthlyLimitCents,
    usedCents: weekly.usedCents ?? monthly.usedCents,
    includedUsedCents: weekly.includedUsedCents ?? monthly.includedUsedCents,
    onDemandCapCents: weekly.onDemandCapCents ?? monthly.onDemandCapCents,
    onDemandUsedCents: weekly.onDemandUsedCents ?? monthly.onDemandUsedCents,
    onDemandUsedPercent: weekly.onDemandUsedPercent ?? monthly.onDemandUsedPercent,
    billingPeriodStart: weekly.billingPeriodStart ?? monthly.billingPeriodStart,
    billingPeriodEnd: weekly.billingPeriodEnd ?? monthly.billingPeriodEnd,
    usedPercent: weekly.usedPercent ?? monthly.usedPercent,
  };
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return typeof value === 'string' && ['true', '1', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function nestedRecords(value: unknown): JsonRecord[] {
  const output: JsonRecord[] = [];
  const visit = (candidate: unknown, depth: number) => {
    const row = record(candidate);
    if (!row || depth > 2 || output.includes(row)) return;
    output.push(row);
    for (const key of ['metadata', 'attributes', 'oauth', 'raw', 'credential', 'auth']) visit(row[key], depth + 1);
  };
  visit(value, 0);
  return output;
}

function jwtTier(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    const row = record(decoded);
    const entry = Object.entries(row ?? {}).find(([key]) => key.toLowerCase() === 'tier' || key.toLowerCase().endsWith('/tier') || key.toLowerCase().endsWith(':tier'));
    const value = number(entry?.[1]);
    return value;
  } catch { return null; }
}

export function isPaidXaiCredential(file: AuthFile): boolean {
  const records = nestedRecords(file);
  const usingApi = records.some((row) => truthy(row.using_api ?? row.usingApi));
  const paidPrefix = records.some((row) => text(row.prefix)?.toLowerCase() === 'paid');
  if (usingApi && paidPrefix) return true;
  return records.some((row) => ['access_token', 'accessToken', 'id_token', 'idToken', 'token'].some((key) => {
    const token = text(row[key]);
    return token !== null && (jwtTier(token) ?? 0) >= 1;
  }));
}
