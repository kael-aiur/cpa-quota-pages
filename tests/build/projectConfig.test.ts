import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { resolveBuildTarget } from '../../vite.config';

describe('project contract', () => {
  it('maps each mode to one fixed self-contained output', () => {
    expect(resolveBuildTarget('user')).toEqual({
      input: 'templates/quota.html',
      fileName: 'quota.html',
    });
    expect(resolveBuildTarget('admin')).toEqual({
      input: 'templates/quota-admin.html',
      fileName: 'quota-admin.html',
    });
  });

  it('does not install forbidden UI/runtime dependencies', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ['react', 'react-router-dom', 'zustand', 'axios', 'i18next']) {
      expect(all).not.toHaveProperty(name);
    }
  });
});
