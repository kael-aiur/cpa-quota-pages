import type { JsonRecord, QuotaWindow } from '../types';
import type { ClaudeExtraUsage, ClaudeQuotaData } from './types';

export type { ClaudeQuotaData } from './types';

interface UsageWindow {
  utilization?: unknown;
  resets_at?: unknown;
}

interface UsageLimit {
  kind?: unknown;
  percent?: unknown;
  resets_at?: unknown;
  is_active?: unknown;
  scope?: { model?: { display_name?: unknown } | null } | null;
}

interface ClaudeUsagePayload extends JsonRecord {
  limits?: unknown;
  extra_usage?: unknown;
}

const NAMED_WINDOWS = [
  ['five_hour', 'five-hour', 'Five-hour', 5],
  ['seven_day', 'seven-day', 'Seven-day', 168],
  ['seven_day_oauth_apps', 'seven-day-oauth-apps', 'OAuth Apps', 168],
  ['seven_day_opus', 'seven-day-opus', 'Opus', 168],
  ['seven_day_sonnet', 'seven-day-sonnet', 'Sonnet', 168],
  ['seven_day_cowork', 'seven-day-cowork', 'Cowork', 168],
  ['iguana_necktie', 'seven-day-fable', 'Fable', 168],
] as const;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parsePayload(value: unknown): ClaudeUsagePayload {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return record(parsed) as ClaudeUsagePayload ?? {};
    } catch {
      return {};
    }
  }
  return record(value) as ClaudeUsagePayload ?? {};
}

function parseProfile(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return record(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function resetAt(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function usedPercent(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.min(100, Math.max(0, parsed));
}

function buildWindow(id: string, label: string, used: number | null, reset: number | null, periodHours: number): QuotaWindow {
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: used === null ? null : 100 - used,
    resetAtMs: reset,
    periodHours,
  };
}

function findModernFable(payload: ClaudeUsagePayload): UsageLimit | null {
  if (!Array.isArray(payload.limits)) return null;
  const candidates = payload.limits
    .map((value) => record(value) as UsageLimit | null)
    .filter((limit): limit is UsageLimit => {
      if (!limit) return false;
      const kind = typeof limit.kind === 'string' ? limit.kind.trim().toLowerCase() : '';
      const displayName = typeof limit.scope?.model?.display_name === 'string'
        ? limit.scope.model.display_name.trim().toLowerCase()
        : '';
      return kind === 'weekly_scoped'
        && (displayName === 'fable' || displayName === 'fable 5')
        && usedPercent(limit.percent) !== null;
    });
  return candidates.find((limit) => limit.is_active === true) ?? candidates[0] ?? null;
}

function planType(profile: unknown): string | null {
  const parsed = parseProfile(profile);
  if (!parsed) return null;
  const account = record(parsed.account);
  const organization = record(parsed.organization);
  const hasMax = booleanValue(account?.has_claude_max);
  const hasPro = booleanValue(account?.has_claude_pro);
  if (hasMax === true) return 'plan_max';
  if (hasPro === true) return 'plan_pro';
  if (organization?.organization_type === 'claude_team' && organization.subscription_status === 'active') {
    return 'plan_team';
  }
  if (hasMax === false && hasPro === false) return 'plan_free';
  return null;
}

export function parseClaudeQuota(usage: unknown, profile?: unknown): ClaudeQuotaData {
  const payload = parsePayload(usage);
  const modernFable = findModernFable(payload);
  const windows: QuotaWindow[] = [];

  for (const [key, id, label, periodHours] of NAMED_WINDOWS) {
    if (key === 'iguana_necktie' && modernFable) continue;
    const window = record(payload[key]);
    if (!window || !('utilization' in window)) continue;
    const typed = window as UsageWindow;
    windows.push(buildWindow(id, label, usedPercent(typed.utilization), resetAt(typed.resets_at), periodHours));
  }

  if (modernFable) {
    const used = usedPercent(modernFable.percent);
    windows.push(buildWindow(
      'seven-day-fable',
      'Fable',
      used,
      resetAt(modernFable.resets_at),
      168,
    ));
  }

  return {
    windows,
    extraUsage: (record(payload.extra_usage) as ClaudeExtraUsage | null) ?? null,
    planType: planType(profile),
  };
}
