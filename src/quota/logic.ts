import type { AuthFile } from '../api/types';
import { isDisabled, normalizeProvider } from '../providers/shared';
import type { Provider } from '../providers/types';
import type { AccountEntry, Pagination, SortMode } from './types';

const DEFAULT_PAGE_SIZE = 20;

const PROVIDER_ORDER: Record<Provider, number> = {
  claude: 0,
  antigravity: 1,
  codex: 2,
  xai: 3,
  kimi: 4,
};

export function resolveProvider(file: AuthFile): Provider | null {
  return normalizeProvider(file.provider ?? file.type);
}

export function classifyAccounts(files: AuthFile[]): AccountEntry[] {
  return files
    .filter((file) => !isDisabled(file))
    .map((file) => {
      const provider = resolveProvider(file);
      return provider ? { id: file.name, provider, file } : null;
    })
    .filter((entry): entry is AccountEntry => entry !== null)
    .sort((left, right) => PROVIDER_ORDER[left.provider] - PROVIDER_ORDER[right.provider]);
}

export function sortAccounts(
  entries: AccountEntry[],
  mode: SortMode,
  recovery: (entry: AccountEntry) => number | null,
): AccountEntry[] {
  if (mode === 'default') return [...entries];

  return entries
    .map((entry, index) => ({ entry, index, recoveryAt: recovery(entry) }))
    .sort((left, right) => {
      const leftHasRecovery = left.recoveryAt !== null;
      const rightHasRecovery = right.recoveryAt !== null;
      if (leftHasRecovery !== rightHasRecovery) return leftHasRecovery ? -1 : 1;
      if (left.recoveryAt !== null && right.recoveryAt !== null && left.recoveryAt !== right.recoveryAt) {
        return left.recoveryAt - right.recoveryAt;
      }
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function paginate<T>(items: T[], requestedPage: number, pageSize = DEFAULT_PAGE_SIZE): Pagination<T> {
  const flooredPageSize = Math.floor(pageSize);
  const normalizedPageSize = Number.isFinite(flooredPageSize) && flooredPageSize >= 1
    ? flooredPageSize
    : DEFAULT_PAGE_SIZE;
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * normalizedPageSize;

  return {
    items: items.slice(start, start + normalizedPageSize),
    page,
    pageSize: normalizedPageSize,
    totalItems,
    totalPages,
  };
}
