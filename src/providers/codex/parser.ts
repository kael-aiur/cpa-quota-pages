import type { AuthFile, JsonRecord } from '../../api/types';
import type { QuotaWindow, ProviderQuotaData } from '../types';

export interface CodexCredit extends JsonRecord {
  id: string;
  resetType: string;
  status: string;
  grantedAtMs: number | null;
  expiresAtMs: number;
}

export interface CodexQuotaData extends ProviderQuotaData {
  accountId: string | null;
  planType: string | null;
  subscriptionActiveUntil: number | null;
  credits: CodexCredit[];
  availableCreditCount: number;
  applicableAvailableCreditCount: number;
  creditDetailsError?: string;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateMs(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric !== null) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return milliseconds > 0 && Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'quota';
}

function periodHours(durationSeconds: unknown): number | null {
  const seconds = numberValue(durationSeconds);
  if (seconds === null || seconds <= 0) return null;
  return seconds / 3600;
}

function durationId(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours === 5) return '5h';
  if (hours === 168) return 'week';
  if (hours >= 672 && hours <= 744) return 'month';
  return `${String(hours).replace(/\.0$/, '')}h`;
}

function percent(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.min(100, Math.max(0, parsed));
}

function stableHash(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0').slice(0, 6)}${(second >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

function payload(value: unknown): RecordValue {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value)) ?? {};
    } catch {
      const segment = value.trim().split('.')[1];
      const decoded = segment ? decodeBase64Url(segment) : null;
      if (!decoded) return {};
      try {
        return record(JSON.parse(decoded)) ?? {};
      } catch {
        return {};
      }
    }
  }
  return record(value) ?? {};
}

function nestedRecords(file: AuthFile): RecordValue[] {
  const metadata = record(file.metadata);
  const attributes = record(file.attributes);
  return [
    file,
    metadata,
    attributes,
    record(file.id_token),
    metadata ? record(metadata.id_token) : null,
    attributes ? record(attributes.id_token) : null,
  ].filter((value): value is RecordValue => value !== null);
}

function authClaim(value: RecordValue): RecordValue | null {
  return record(value['https://api.openai.com/auth']);
}

function tokenRecords(file: AuthFile): RecordValue[] {
  return [file.id_token, record(file.metadata)?.id_token, record(file.attributes)?.id_token]
    .map(payload)
    .flatMap((token) => [token, authClaim(token)].filter((value): value is RecordValue => value !== null));
}

function accountId(file: AuthFile): string | null {
  for (const candidate of [...nestedRecords(file), ...tokenRecords(file)]) {
    const direct = text(candidate.chatgpt_account_id)
      ?? text(candidate.chatgptAccountId)
      ?? text(candidate.account_id)
      ?? text(candidate.accountId);
    if (direct) return direct;
  }
  return null;
}

function planType(usage: RecordValue, file: AuthFile): string | null {
  return text(usage.plan_type)
    ?? text(usage.planType)
    ?? [...nestedRecords(file), ...tokenRecords(file)]
      .map((candidate) => text(candidate.plan_type) ?? text(candidate.planType) ?? text(candidate.chatgpt_plan_type))
      .find((value) => value !== null)
    ?? null;
}

function renewal(usage: RecordValue, file: AuthFile): number | null {
  const usageCandidates = [
    usage.chatgpt_subscription_active_until,
    usage.subscription_active_until,
    usage.subscriptionActiveUntil,
    usage.subscription_renewal_at,
    usage.subscriptionRenewalAt,
    usage.subscription_renewal_date,
    usage.subscriptionRenewalDate,
    usage.renewal_at,
    usage.renewalAt,
    usage.renewal_date,
    usage.renewalDate,
  ];
  for (const candidate of usageCandidates) {
    const parsed = dateMs(candidate);
    if (parsed !== null) return parsed;
  }
  for (const entry of nestedRecords(file)) {
    for (const candidate of [
      entry.chatgpt_subscription_active_until,
      entry.subscription_active_until,
      entry.subscriptionActiveUntil,
      entry.subscription_renewal_at,
      entry.subscriptionRenewalAt,
      entry.subscription_renewal_date,
      entry.subscriptionRenewalDate,
    ]) {
      const parsed = dateMs(candidate);
      if (parsed !== null) return parsed;
    }
  }
  for (const token of tokenRecords(file)) {
    for (const value of [token.chatgpt_subscription_active_until, token.subscription_active_until, token.subscriptionActiveUntil]) {
      const parsed = dateMs(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function parseWindow(
  rawWindow: unknown,
  scope: string,
  discriminator: string,
  fallbackPeriod: string | null,
  reached: boolean,
  windowKind: 'primary' | 'secondary',
): QuotaWindow | null {
  const window = record(rawWindow);
  if (!window) return null;
  const explicitHours = periodHours(window.limit_window_seconds ?? window.limitWindowSeconds);
  const period = durationId(explicitHours) ?? fallbackPeriod;
  if (!period) return null;
  const used = reached || window.limit_reached === true || window.limitReached === true
    ? 100
    : percent(window.used_percent ?? window.usedPercent);
  const resetAtMs = dateMs(window.reset_at ?? window.resetAt);
  const id = `${slug(scope)}-${period}-${windowKind}-${discriminator}`;
  const label = scope === 'rate-limit'
    ? period === '5h' ? 'Five-hour' : period === 'week' ? 'Weekly' : period === 'month' ? 'Monthly' : period
    : `${scope} ${period}`;
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: used === null ? null : 100 - used,
    resetAtMs,
    periodHours: explicitHours ?? (period === '5h' ? 5 : period === 'week' ? 168 : period === 'month' ? 720 : null),
  };
}

function parseScope(value: unknown, scope: string, discriminator: string, windows: QuotaWindow[]): void {
  const entry = record(value);
  if (!entry) return;
  const nested = record(entry.rate_limit ?? entry.rateLimit) ?? entry;
  const reached = entry.limit_reached === true
    || entry.limitReached === true
    || nested.limit_reached === true
    || nested.limitReached === true
    || entry.allowed === false
    || nested.allowed === false;
  const primary = parseWindow(nested.primary_window ?? nested.primaryWindow, scope, discriminator, '5h', reached, 'primary');
  const secondary = parseWindow(nested.secondary_window ?? nested.secondaryWindow, scope, discriminator, 'week', reached, 'secondary');
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseCredits(value: unknown, nowMs: number, usage: RecordValue): {
  credits: CodexCredit[];
  availableCreditCount: number;
  applicableAvailableCreditCount: number;
} {
  const body = payload(value);
  const usageCredits = record(usage.rate_limit_reset_credits ?? usage.rateLimitResetCredits);
  const rawCredits = Array.isArray(body.credits) ? body.credits : [];
  const credits = rawCredits.map((raw): CodexCredit | null => {
    const credit = record(raw);
    if (!credit || text(credit.reset_type ?? credit.resetType) !== 'codex_rate_limits' || text(credit.status) !== 'available') return null;
    const expiresAtMs = dateMs(credit.expires_at ?? credit.expiresAt);
    const id = text(credit.id);
    if (!id || expiresAtMs === null || expiresAtMs <= nowMs) return null;
    return {
      ...credit,
      id,
      resetType: 'codex_rate_limits',
      status: 'available',
      grantedAtMs: dateMs(credit.granted_at ?? credit.grantedAt),
      expiresAtMs,
    };
  }).filter((credit): credit is CodexCredit => credit !== null);
  return {
    credits,
    availableCreditCount: nonNegativeInteger(
      body.available_count ?? body.availableCount ?? usageCredits?.available_count ?? usageCredits?.availableCount,
    ) ?? credits.length,
    applicableAvailableCreditCount: nonNegativeInteger(
      body.applicable_available_count
        ?? body.applicableAvailableCount
        ?? usageCredits?.applicable_available_count
        ?? usageCredits?.applicableAvailableCount,
    ) ?? credits.length,
  };
}

export function getCodexAccountId(file: AuthFile): string | null {
  return accountId(file);
}

export function parseCodexQuota(
  usage: unknown,
  creditDetails: unknown,
  file: AuthFile,
  nowMs: number,
): CodexQuotaData {
  const body = payload(usage);
  const windows: QuotaWindow[] = [];
  parseScope(body.rate_limit ?? body.rateLimit, 'rate-limit', 'standard', windows);
  parseScope(body.code_review_rate_limit ?? body.codeReviewRateLimit, 'code-review-rate-limit', 'standard', windows);
  const additionalValue = body.additional_rate_limits ?? body.additionalRateLimits;
  const additional = Array.isArray(additionalValue) ? additionalValue : [];
  for (const entry of additional) {
    const candidate = record(entry);
    if (!candidate) continue;
    const identity = text(candidate.limit_name ?? candidate.limitName ?? candidate.metered_feature ?? candidate.meteredFeature)
      ?? text(candidate.name)
      ?? 'additional-rate-limit';
    parseScope(candidate, identity, stableHash(identity), windows);
  }
  const occurrences = new Map<string, number>();
  const finalizedWindows = windows.map((window) => {
    const occurrence = occurrences.get(window.id) ?? 0;
    occurrences.set(window.id, occurrence + 1);
    return occurrence === 0 ? window : { ...window, id: `${window.id}-${occurrence + 1}` };
  });
  const parsedCredits = parseCredits(creditDetails, nowMs, body);
  return {
    windows: finalizedWindows,
    accountId: accountId(file),
    planType: planType(body, file),
    subscriptionActiveUntil: renewal(body, file),
    ...parsedCredits,
  };
}
