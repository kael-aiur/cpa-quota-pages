import { describe, expect, it, vi } from 'vitest';
import type { CpaApi } from '../../src/api/types';
import { createQuotaActions } from '../../src/app/actions';
import { createQuotaStore } from '../../src/app/state';
import type { AccountEntry } from '../../src/quota/types';
import type { ProviderQuery } from '../../src/providers/types';

const account = (id: string, provider: AccountEntry['provider']): AccountEntry => ({ id, provider, file: { name: id, provider } });
const result = (id: string, calls: string[], delay = 0): ProviderQuery => async (_file, context) => {
  calls.push(`start:${id}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(context.signal?.reason); }, { once: true });
  });
  calls.push(`end:${id}`);
  return { windows: [{ id, label: id, usedPercent: 1, remainingPercent: 99, resetAtMs: null, periodHours: null }] };
};

function api(files: AccountEntry[], _calls: string[]): CpaApi {
  return {
    listAuthFiles: vi.fn(async () => files.map(({ file }) => file)),
    downloadAuthFile: vi.fn(async () => ''),
    apiCall: vi.fn(),
  };
}

describe('quota actions', () => {
  it('loads one card once and ignores a duplicate while loading', async () => {
    const calls: string[] = [];
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const actions = createQuotaActions({ api: api([a], calls), store, providerQueries: { claude: result('a', calls, 10) } });
    const first = actions.queryOne('a');
    await expect(actions.queryOne('a')).resolves.toBeUndefined();
    await first;
    expect(calls.filter((value) => value === 'start:a')).toHaveLength(1);
  });

  it('runs a page in Provider groups and isolates account failures', async () => {
    const calls: string[] = [];
    const store = createQuotaStore();
    const accounts = [account('c1', 'claude'), account('c2', 'claude'), account('k1', 'kimi')];
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const queries: Record<string, ProviderQuery> = {
      claude: async (file) => {
        calls.push(`start:${file.name}`);
        if (file.name === 'c2') throw new Error('bad');
        return { windows: [] };
      },
      kimi: result('k1', calls),
    };
    const actions = createQuotaActions({ api: api(accounts, calls), store, providerQueries: queries });
    await actions.queryCurrentPage(['c1', 'c2', 'k1']);
    expect(store.getState().quotaCache.get('c1')?.status).toBe('success');
    expect(store.getState().quotaCache.get('c2')?.status).toBe('error');
    expect(store.getState().quotaCache.get('k1')?.status).toBe('success');
    expect(calls).toContain('start:k1');
  });

  it('rejects batches larger than twenty and passes the caller abort signal', async () => {
    const store = createQuotaStore();
    const accounts = Array.from({ length: 21 }, (_, index) => account(`a${index}`, 'claude'));
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, accounts);
    const controller = new AbortController();
    const query = vi.fn(async (_file, context) => {
      expect(context.signal).toBe(controller.signal);
      return { windows: [] };
    });
    const actions = createQuotaActions({ api: api(accounts, []), store, signal: controller.signal, providerQueries: { claude: query } });
    await expect(actions.queryCurrentPage(accounts.slice(0, 20).map(({ id }) => id))).resolves.toBeUndefined();
    await expect(actions.queryCurrentPage(['a0'])).resolves.toBeUndefined();
    await expect(actions.queryCurrentPage(accounts.map(({ id }) => id))).rejects.toThrow(/20/);
  });

  it('does not retry a failed provider query or persist quota outside the store', async () => {
    const store = createQuotaStore();
    const a = account('a', 'claude');
    const generation = store.beginAccountGeneration();
    store.replaceAccounts(generation, [a]);
    const query = vi.fn(async () => { throw new Error('failed'); });
    const actions = createQuotaActions({ api: api([a], []), store, providerQueries: { claude: query } });
    await actions.queryOne('a');
    expect(query).toHaveBeenCalledTimes(1);
    expect(store.getState().quotaCache.get('a')?.status).toBe('error');
  });
});
