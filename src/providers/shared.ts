import type { AuthFile } from '../api/types';
import type { Provider, RecentRequest } from './types';

export function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  }
  return false;
}

export function isDisabled(file: AuthFile): boolean {
  return readBoolean(file.disabled);
}

function recentCount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeRecentRequests(value: unknown): RecentRequest[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): RecentRequest[] => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const time = typeof row.time === 'string' ? row.time.trim() : '';
    if (!time) return [];
    return [{ time, success: recentCount(row.success), failed: recentCount(row.failed) }];
  });
}

export function extractRecentRequests(value: unknown, depth = 0): RecentRequest[] | undefined {
  if (depth > 4 || typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = extractRecentRequests(child, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const row = value as Record<string, unknown>;
  for (const key of ['recent_requests', 'recentRequests']) {
    if (key in row) return normalizeRecentRequests(row[key]);
  }
  for (const child of Object.values(row)) {
    const found = extractRecentRequests(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function normalizeProvider(value: unknown): Provider | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'x-ai' || normalized === 'grok' || normalized === 'x-ai/grok' || normalized === 'xai') {
    return 'xai';
  }
  if (normalized === 'claude' || normalized === 'antigravity' || normalized === 'codex' || normalized === 'kimi') {
    return normalized;
  }
  return null;
}
