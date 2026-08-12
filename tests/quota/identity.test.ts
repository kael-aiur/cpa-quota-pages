import { describe, expect, it } from 'vitest';
import { buildAnonymousAccountLabel } from '../../src/quota/identity';

describe('anonymous account identity', () => {
  it('creates a stable six-character anonymous label without returning the identifier', async () => {
    const label = await buildAnonymousAccountLabel('claude', 'private-file.json');

    expect(label).toBe('Claude · 11A0C5');
    expect(label).not.toContain('private-file.json');
    expect(label).toBe(await buildAnonymousAccountLabel('claude', 'private-file.json'));
    expect(await buildAnonymousAccountLabel('codex', 'private-file.json')).toMatch(/^Codex · [0-9A-F]{6}$/);
  });
});
