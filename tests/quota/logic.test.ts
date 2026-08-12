import { describe, expect, it } from 'vitest';
import type { AuthFile } from '../../src/api/types';
import type { AccountEntry } from '../../src/quota/types';
import { classifyAccounts, paginate, resolveProvider, sortAccounts } from '../../src/quota/logic';

const file = (name: string, fields: Record<string, unknown> = {}): AuthFile => ({ name, ...fields });

const providers = (entries: AccountEntry[]) => entries.map((entry) => entry.provider);

describe('quota account logic', () => {
  it('normalizes provider from provider before type and supports aliases', () => {
    expect(resolveProvider(file('a', { provider: ' Claude ' }))).toBe('claude');
    expect(resolveProvider(file('b', { provider: 'x_ai' }))).toBe('xai');
    expect(resolveProvider(file('c', { provider: 'x-ai/grok' }))).toBe('xai');
    expect(resolveProvider(file('d', { provider: 'grok' }))).toBe('xai');
    expect(resolveProvider(file('e', { type: 'CODEX' }))).toBe('codex');
    expect(resolveProvider(file('f', { provider: 'unknown', type: 'claude' }))).toBeNull();
  });

  it('filters disabled files using boolean, numeric, and string values', () => {
    const entries = classifyAccounts([
      file('enabled-bool', { provider: 'claude', disabled: false }),
      file('disabled-bool', { provider: 'claude', disabled: true }),
      file('disabled-number', { provider: 'codex', disabled: 1 }),
      file('disabled-string', { provider: 'kimi', disabled: ' TRUE ' }),
      file('enabled-string', { provider: 'xai', disabled: 'false' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['enabled-bool', 'enabled-string']);
  });

  it('classifies accounts in the fixed default provider order while preserving group order', () => {
    const entries = classifyAccounts([
      file('kimi-1', { provider: 'kimi' }),
      file('claude-1', { provider: 'claude' }),
      file('claude-2', { provider: 'claude' }),
      file('xai-1', { provider: 'x-ai' }),
      file('codex-1', { provider: 'codex' }),
      file('antigravity-1', { provider: 'antigravity' }),
    ]);

    expect(providers(entries)).toEqual(['claude', 'claude', 'antigravity', 'codex', 'xai', 'kimi']);
    expect(entries.slice(0, 2).map((entry) => entry.id)).toEqual(['claude-1', 'claude-2']);
  });

  it('sorts soonest before pagination and keeps unavailable accounts stably at the bottom', () => {
    const entries = classifyAccounts([
      file('no-recovery-1', { provider: 'claude' }),
      file('late', { provider: 'claude' }),
      file('soon', { provider: 'codex' }),
      file('no-recovery-2', { provider: 'xai' }),
    ]);
    const recovery = (entry: AccountEntry): number | null => ({
      late: 300,
      soon: 100,
    }[entry.id] ?? null);

    const sorted = sortAccounts(entries, 'soonest', recovery);
    expect(sorted.map((entry) => entry.id)).toEqual(['soon', 'late', 'no-recovery-1', 'no-recovery-2']);

    const page = paginate(sorted, 2, 2);
    expect(page.items.map((entry) => entry.id)).toEqual(['no-recovery-1', 'no-recovery-2']);
    expect(page.totalPages).toBe(2);
  });

  it('uses twenty items by default and clamps requested pages', () => {
    const items = Array.from({ length: 41 }, (_, index) => index);
    expect(paginate(items, 0)).toMatchObject({ page: 1, pageSize: 20, totalItems: 41, totalPages: 3 });
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate([], 4)).toMatchObject({ page: 1, totalItems: 0, totalPages: 1, items: [] });
  });
});
