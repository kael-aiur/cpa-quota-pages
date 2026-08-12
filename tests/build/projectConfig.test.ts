import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { resolveBuildTarget } from '../../vite.config';

const projectRoot = resolve(process.cwd());
const distDirectory = resolve(projectRoot, 'dist');
const outputNames = ['quota-admin.html', 'quota.html'];

function runCommand(command: string, ...args: string[]) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runNpm(...args: string[]) {
  return runCommand('npm', ...args);
}

function runBuild() {
  const result = runNpm('run', 'build');
  expect(result.status, result.stderr).toBe(0);
}

function distNames() {
  return readdirSync(distDirectory).sort();
}

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

  it('tracks exactly both outputs and preserves the sibling during each single build', () => {
    runBuild();
    expect(distNames()).toEqual(outputNames);
    expect(runNpm('run', 'build:user').status).toBe(0);
    expect(distNames()).toEqual(outputNames);
    expect(runNpm('run', 'build:admin').status).toBe(0);
    expect(distNames()).toEqual(outputNames);

    expect(runCommand('git', 'check-ignore', '--quiet', 'dist/quota.html').status).toBe(1);
    expect(runCommand('git', 'ls-files', '--error-unmatch', 'dist/quota.html').status).toBe(0);
    expect(runCommand('git', 'ls-files', '--error-unmatch', 'dist/quota-admin.html').status).toBe(0);
  }, 30_000);

  it('makes check:dist fail when a template changes', () => {
    const templatePath = resolve(projectRoot, 'templates/quota.html');
    const original = readFileSync(templatePath, 'utf8');
    try {
      writeFileSync(templatePath, `${original}\n<!-- contract mutation -->\n`);
      expect(runNpm('run', 'check:dist').status).not.toBe(0);
    } finally {
      writeFileSync(templatePath, original);
      runBuild();
    }
  }, 30_000);

  it('makes check:dist fail when a generated artifact changes', () => {
    runBuild();
    const artifactPath = resolve(distDirectory, 'quota.html');
    const original = readFileSync(artifactPath, 'utf8');
    try {
      writeFileSync(artifactPath, `${original}\n<!-- artifact mutation -->\n`);
      expect(runNpm('run', 'check:dist').status).not.toBe(0);
    } finally {
      writeFileSync(artifactPath, original);
      runBuild();
    }
  }, 30_000);
});
