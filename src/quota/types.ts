import type { AuthFile } from '../api/types';
import type { Provider } from '../providers/types';

export type { Provider } from '../providers/types';
export type ProviderSelection = Provider | 'all';
export type SortMode = 'default' | 'soonest';

export interface AccountEntry {
  id: string;
  provider: Provider;
  file: AuthFile;
}

export interface Pagination<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
