import type { Provider } from '../providers/types';
import type { SortMode } from './types';

export interface UiPreferences {
  provider?: Provider;
  sortMode?: SortMode;
}

const STORAGE_KEY = 'cpaQuota.uiState';
const PROVIDERS = new Set<Provider>(['claude', 'antigravity', 'codex', 'xai', 'kimi']);
const SORT_MODES = new Set<SortMode>(['default', 'soonest']);

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function readUiPreferences(): UiPreferences {
  const target = storage();
  if (!target) return {};

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.provider === 'string' && PROVIDERS.has(record.provider as Provider)
        ? { provider: record.provider as Provider }
        : {}),
      ...(typeof record.sortMode === 'string' && SORT_MODES.has(record.sortMode as SortMode)
        ? { sortMode: record.sortMode as SortMode }
        : {}),
    };
  } catch {
    return {};
  }
}

function write(next: UiPreferences): void {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable or quota-limited; preferences are optional.
  }
}

export function writeProviderPreference(provider: Provider): void {
  write({ ...readUiPreferences(), provider });
}

export function writeSortModePreference(sortMode: SortMode): void {
  write({ ...readUiPreferences(), sortMode });
}
