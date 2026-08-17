import type { JsonRecord } from '../../api/types';
import { extractRecentRequests } from '../shared';
import type { ProviderQuotaData, QuotaWindow } from '../types';

export interface KimiQuotaWindow extends QuotaWindow {
  used: number;
  limit: number;
}

export interface KimiQuotaData extends ProviderQuotaData {
  windows: KimiQuotaWindow[];
}

type RecordValue = JsonRecord;
type KimiTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week';

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.floor(parsed);
}

function firstValue<T>(values: unknown[], normalize: (value: unknown) => T | null): T | null {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function parsePayload(value: unknown): RecordValue | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return record(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return record(value);
}

function normalizeTimeUnit(value: unknown): KimiTimeUnit {
  const normalized = text(value)?.toUpperCase().replace(/^TIME_UNIT_/, '') ?? 'MINUTE';
  if (normalized === 'SECOND' || normalized === 'SECONDS') return 'second';
  if (normalized === 'HOUR' || normalized === 'HOURS') return 'hour';
  if (normalized === 'DAY' || normalized === 'DAYS') return 'day';
  if (normalized === 'WEEK' || normalized === 'WEEKS') return 'week';
  return 'minute';
}

function durationToken(duration: number, unit: KimiTimeUnit): string {
  if (unit === 'second') return `${duration}s`;
  if (unit === 'hour') return `${duration}h`;
  if (unit === 'day') return `${duration}d`;
  if (unit === 'week') return `${duration}w`;
  return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
}

function durationHours(duration: number, unit: KimiTimeUnit): number {
  if (unit === 'second') return duration / 3600;
  if (unit === 'hour') return duration;
  if (unit === 'day') return duration * 24;
  if (unit === 'week') return duration * 7 * 24;
  return duration / 60;
}

function periodFromLabel(label: string): number | null {
  const normalized = label.toLowerCase();
  if (normalized.includes('daily') || normalized.includes('day')) return 24;
  if (normalized.includes('weekly') || normalized.includes('week')) return 168;
  if (normalized.includes('monthly') || normalized.includes('month')) return 720;
  if (normalized.includes('5h') || normalized.includes('hour')) return 5;
  return null;
}

function parseDate(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric !== null && numeric > 0) return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const valueText = text(value);
  if (!valueText) return null;
  const parsed = Date.parse(valueText.replace(/(\.\d{6})\d+/, '$1'));
  return Number.isFinite(parsed) ? parsed : null;
}

function resetAt(detail: RecordValue, item: RecordValue, nowMs: number): number | null {
  for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
    const absolute = firstValue([detail[key], item[key]], parseDate);
    if (absolute !== null) return absolute;
  }
  for (const key of ['reset_in', 'resetIn', 'ttl']) {
    const relative = firstValue([detail[key], item[key]], (value) => {
      const parsed = numberValue(value);
      return parsed !== null && parsed > 0 ? parsed : null;
    });
    if (relative !== null) return nowMs + relative * 1000;
  }
  return null;
}

function labelFor(
  item: RecordValue,
  detail: RecordValue,
  duration: number | null,
  unit: KimiTimeUnit,
  index: number,
): string {
  const label = firstValue(
    [detail.name, detail.title, detail.scope, item.name, item.title, item.scope],
    text,
  );
  if (label) return label;
  if (duration !== null && duration > 0) return `${durationToken(duration, unit)} limit`;
  return `Limit ${index + 1}`;
}

function parseWindow(
  detail: RecordValue,
  item: RecordValue,
  window: RecordValue,
  index: number,
  nowMs: number,
  fallbackLabel?: string,
): KimiQuotaWindow | null {
  const limit = firstValue([detail.limit, item.limit], integerValue);
  let used = firstValue([detail.used, item.used], integerValue);
  const remaining = firstValue([detail.remaining, item.remaining], integerValue);
  if (used === null && remaining !== null && limit !== null) used = limit - remaining;
  if (used === null && limit === null) return null;

  const duration = firstValue([window.duration, detail.duration, item.duration], integerValue);
  const rawTimeUnit = firstValue([window.timeUnit, detail.timeUnit, item.timeUnit], text);
  const unit = normalizeTimeUnit(rawTimeUnit);
  const label = fallbackLabel ?? labelFor(item, detail, duration, unit, index);
  const resolvedLimit = limit ?? 0;
  const resolvedUsed = used ?? 0;
  const usedPercent = resolvedLimit > 0
    ? Math.min(100, Math.max(0, (resolvedUsed / resolvedLimit) * 100))
    : null;
  const remainingPercent = remaining !== null && resolvedLimit > 0
    ? Math.min(100, Math.max(0, (remaining / resolvedLimit) * 100))
    : usedPercent === null ? null : 100 - usedPercent;
  const periodHours = duration !== null && duration > 0
    ? durationHours(duration, unit)
    : periodFromLabel(label);

  return {
    id: `limit-${index}`,
    label,
    used: resolvedUsed,
    limit: resolvedLimit,
    usedPercent,
    remainingPercent,
    resetAtMs: resetAt(detail, item, nowMs),
    periodHours,
  };
}

export function parseKimiQuota(payload: unknown, nowMs: number): KimiQuotaData {
  const parsed = parsePayload(payload);
  if (!parsed) return { windows: [] };

  const windows: KimiQuotaWindow[] = [];
  const limits = Array.isArray(parsed.limits) ? parsed.limits : [];
  limits.forEach((rawItem, index) => {
    const item = record(rawItem);
    if (!item) return;
    const detail = record(item.detail) ?? item;
    const window = record(item.window) ?? {};
    const parsedWindow = parseWindow(detail, item, window, index, nowMs);
    if (parsedWindow) windows.push(parsedWindow);
  });

  const usage = record(parsed.usage);
  if (usage) {
    const summary = parseWindow(usage, {}, {}, windows.length, nowMs, 'Weekly');
    if (summary) windows.push({ ...summary, id: 'summary' });
  }

  const recentRequests = extractRecentRequests(parsed);
  return { windows, ...(recentRequests !== undefined ? { recentRequests } : {}) };
}
