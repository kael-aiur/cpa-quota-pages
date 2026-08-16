import type { Provider } from '../providers/types';

export interface RecoveryInstant { id: string; atMs: number; kind: 'window' | 'credit' }

const HOUR_MS = 60 * 60 * 1000;
const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const recordOf = (quota: unknown): Record<string, unknown> | null =>
  quota && typeof quota === 'object' ? quota as Record<string, unknown> : null;
const rows = (value: unknown, prefix: string): RecoveryInstant[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const atMs = record.resetAtMs;
    return usable(atMs) ? [{ id: typeof record.id === 'string' && record.id ? record.id : `${prefix}-${index}`, atMs, kind: 'window' as const }] : [];
  });
};

export function collectRecoveryInstants(provider: Provider, quota: unknown): RecoveryInstant[] {
  const record = recordOf(quota);
  if (!record) return [];
  if (provider === 'claude') return rows(record.windows, 'window');
  if (provider === 'antigravity') {
    const groups = Array.isArray(record.groups) ? record.groups : [];
    return groups.flatMap((group) => group && typeof group === 'object' ? rows((group as Record<string, unknown>).buckets, 'bucket') : []);
  }
  if (provider === 'kimi') return rows(record.windows, 'window');
  if (provider === 'xai') {
    const billing = record.billing;
    if (!billing || typeof billing !== 'object' || (billing as Record<string, unknown>).periodType !== 'weekly') return [];
    const atMs = (billing as Record<string, unknown>).resetAtMs;
    return usable(atMs) ? [{ id: 'xai:weekly', atMs, kind: 'window' }] : [];
  }
  if (provider === 'codex') {
    const windows = rows(record.windows, 'window');
    const credits = Array.isArray(record.credits) ? record.credits.flatMap((credit, index) => {
      if (!credit || typeof credit !== 'object') return [];
      const item = credit as Record<string, unknown>;
      const atMs = item.expiresAtMs;
      if (item.status !== 'available' || !usable(atMs)) return [];
      return [{ id: typeof item.id === 'string' && item.id ? item.id : `credit-${index}`, atMs, kind: 'credit' as const }];
    }) : [];
    return [...windows, ...credits];
  }
  return [];
}

export function nextRecoveryMs(provider: Provider, quota: unknown, nowMs: number): number | null {
  return collectRecoveryInstants(provider, quota)
    .filter((instant) => instant.atMs > nowMs)
    .reduce<number | null>((best, instant) => best === null || instant.atMs < best ? instant.atMs : best, null);
}

export function urgentRecoveryId(provider: Provider, quota: unknown, nowMs: number): string | null {
  const candidates = collectRecoveryInstants(provider, quota).filter((instant) => instant.atMs > nowMs && instant.atMs - nowMs < HOUR_MS);
  const best = candidates.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))[0];
  return best?.id ?? null;
}
