import type { AuthFile } from '../api/types';
import type { Provider } from './types';

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
