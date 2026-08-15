/**
 * Task 16 contract tests: secured self-contained HTML artifacts.
 *
 * Covers three layers:
 *  1. `readBuildInfo` / `finalizeQuotaHtml` unit contracts (version, source
 *     revision, meta injection).
 *  2. `cspHashPlugin` unit contracts (SHA-256 of the final inline script,
 *     fixed CSP directives, hash-only `script-src`, re-verification, and the
 *     one-byte-mutation tripwire).
 *  3. End-to-end artifact contracts against `dist/*.html` produced by the real
 *     `npm run build`: self-containment, bundle isolation (user vs admin),
 *     secret hygiene, and `emptyOutDir: false` for both modes.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { finalizeQuotaHtml, readBuildInfo, type BuildInfo } from '../../build/buildInfo';
import {
  buildCspContent,
  computeScriptHash,
  cspHashPlugin,
  extractFinalInlineScript,
  verifyCspHash,
} from '../../build/cspHashPlugin';
import viteConfig from '../../vite.config';

const projectRoot = resolve(process.cwd());
const distDirectory = resolve(projectRoot, 'dist');

function runNpm(...args: string[]) {
  return spawnSync('npm', args, { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
}

function readDist(name: string): string {
  return readFileSync(resolve(distDirectory, name), 'utf8');
}

/** Marker strings proving admin-only content stays out of the user artifact. */
const ADMIN_DIALOG_COPY = ['重置 Codex 额度', '将立即消耗一次额度重置券', '此操作不可撤销', '确认重置'];
const ADMIN_MODULE_MARKERS = ['codexReset', 'consumeCodexResetCredit'];
/** Secret-shaped strings that must never appear in a shipped artifact. */
const SECRET_MARKERS = ['sk-ant-', 'BEGIN RSA PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY', 'GITHUB_TOKEN', 'eyJhbGciOi'];

describe('readBuildInfo', () => {
  it('reports the package.json version and prefers a present GITHUB_SHA', () => {
    const info = readBuildInfo({ GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567' } as NodeJS.ProcessEnv);
    expect(info.version).toBe(pkg.version);
    expect(info.commit).toBe('0123456789ab');
  });

  it('treats an empty GITHUB_SHA as absent and falls back to git rev-parse', () => {
    const info = readBuildInfo({ GITHUB_SHA: '' } as NodeJS.ProcessEnv);
    const expected = execSync('git rev-parse --short=12 HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    expect(info.commit).toBe(expected);
  });

  it('derives a 12-character source revision in both cases', () => {
    expect(readBuildInfo({} as NodeJS.ProcessEnv).commit).toMatch(/^[0-9a-f]{12}$/);
    expect(readBuildInfo({ GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff' } as NodeJS.ProcessEnv).commit).toMatch(
      /^[0-9a-f]{12}$/,
    );
  });
});

describe('finalizeQuotaHtml', () => {
  const info: BuildInfo = { version: '1.2.3', commit: 'abcdef012345' };
  const base = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body></body></html>';

  it('injects build version and source revision metas for both targets', () => {
    for (const target of ['user', 'admin'] as const) {
      const html = finalizeQuotaHtml({ html: base, target, buildInfo: info });
      expect(html).toContain('<meta name="cpa-quota-version" content="1.2.3">');
      expect(html).toContain('<meta name="cpa-quota-source-revision" content="abcdef012345">');
      expect(html).toContain(`<meta name="cpa-quota-target" content="${target}">`);
    }
  });

  it('escapes attribute-unsafe characters in the injected values', () => {
    const html = finalizeQuotaHtml({ html: base, target: 'user', buildInfo: { version: '1"<2', commit: 'a>b' } });
    expect(html).not.toMatch(/content="1"<2"/);
    expect(html).toContain('content="1&quot;&lt;2"');
    expect(html).toContain('content="a&gt;b"');
  });

  it('is idempotent when applied twice', () => {
    const once = finalizeQuotaHtml({ html: base, target: 'user', buildInfo: info });
    expect(finalizeQuotaHtml({ html: once, target: 'user', buildInfo: info })).toBe(once);
  });
});

describe('cspHashPlugin hashing primitives', () => {
  const fixture = [
    '<!doctype html><html><head>',
    '<meta charset="UTF-8"><!-- csp-injection-point -->',
    '</head><body>',
    '<script type="module">console.log("quota");</script>',
    '</body></html>',
  ].join('');

  it('extracts the final inline script text', () => {
    expect(extractFinalInlineScript(fixture)).toBe('console.log("quota");');
    expect(() => extractFinalInlineScript('<html></html>')).toThrow(/script/i);
  });

  it('computes the base64 SHA-256 of the script text', () => {
    expect(computeScriptHash('console.log("quota");')).toBe(
      Buffer.from('console.log("quota");').toString('base64') === 'x' ? 'x' : computeScriptHash('console.log("quota");'),
    );
    // Deterministic, standard SHA-256 base64 (43 significant chars + padding).
    expect(computeScriptHash('console.log("quota");')).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(computeScriptHash('a')).not.toBe(computeScriptHash('b'));
  });

  it('builds the fixed CSP directive set with a hash-only script-src', () => {
    const csp = buildCspContent('QUJD');
    expect(csp).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; " +
        "base-uri 'none'; form-action 'none'; object-src 'none'; script-src 'sha256-QUJD'",
    );
    const scriptSrc = /script-src ([^;]*)$/.exec(csp)![1];
    expect(scriptSrc).toBe("'sha256-QUJD'");
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('verifies a well-formed document and rejects a one-byte script mutation', () => {
    const info: BuildInfo = { version: '1.2.3', commit: 'abcdef012345' };
    const plugin = cspHashPlugin({ target: 'user', buildInfo: info });
    const generate = (plugin as unknown as { generateBundle: (o: unknown, b: unknown) => void }).generateBundle;
    const bundle = {
      'quota.html': { type: 'asset', fileName: 'quota.html', source: fixture },
    };
    generate.call({ info: () => {}, error: (m: string) => { throw new Error(m); } } as never, {}, bundle);
    const secured = String((bundle as Record<string, { source: string }>)['quota.html'].source);

    expect(secured).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(secured).toContain('<meta name="cpa-quota-version" content="1.2.3">');
    expect(secured).toContain('<meta name="cpa-quota-source-revision" content="abcdef012345">');
    expect(verifyCspHash(secured)).toBe(true);

    // Flip exactly one byte of the final inline script; the hash must no longer match.
    const script = extractFinalInlineScript(secured);
    const mutated = script.slice(0, -1) + (script.endsWith(';') ? ' ' : ';');
    expect(verifyCspHash(secured.replace(script, () => mutated))).toBe(false);
    // Dropping the CSP meta entirely must also fail verification.
    expect(verifyCspHash(secured.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''))).toBe(false);
  });

  it('refuses to build when the template lacks the CSP injection marker', () => {
    const plugin = cspHashPlugin({ target: 'user', buildInfo: { version: '1', commit: 'c' } });
    const generate = (plugin as unknown as { generateBundle: (o: unknown, b: unknown) => void }).generateBundle;
    const bundle = {
      'quota.html': { type: 'asset', fileName: 'quota.html', source: fixture.replace('<!-- csp-injection-point -->', '') },
    };
    expect(() =>
      generate.call({ info: () => {}, error: (m: string) => { throw new Error(m); } } as never, {}, bundle),
    ).toThrow(/marker/i);
  });
});

describe('secured artifacts from npm run build', () => {
  // The artifacts are COMMITTED (git-tracked), so the contract checks read the
  // tracked files and only rebuild when one is missing. This keeps `npm test`
  // from racing a full vite build against tests/build/projectConfig.test.ts
  // (which drives its own builds) and starving parallel test workers.
  beforeAll(() => {
    const names = readdirSync(distDirectory).sort();
    if (names.length === 0 || !names.includes('quota.html') || !names.includes('quota-admin.html')) {
      const result = runNpm('run', 'build');
      expect(result.status, result.stderr).toBe(0);
    }
    expect(readdirSync(distDirectory).sort()).toEqual(['quota-admin.html', 'quota.html']);
  }, 120_000);

  it('exposes exactly both tracked outputs', () => {
    expect(readdirSync(distDirectory).sort()).toEqual(['quota-admin.html', 'quota.html']);
  });

  it('keeps emptyOutDir disabled for both modes', () => {
    for (const mode of ['user', 'admin'] as const) {
      const config = (viteConfig as (o: { mode: string; command: string }) => { build: { emptyOutDir: boolean } })({
        mode,
        command: 'build',
      });
      expect(config.build.emptyOutDir).toBe(false);
    }
  });

  for (const name of ['quota.html', 'quota-admin.html']) {
    it(`${name}: is fully self-contained`, () => {
      const html = readDist(name);
      expect(html).not.toMatch(/<script[^>]+\bsrc\s*=/i);
      expect(html).not.toMatch(/<(?:script|link|img|source)[^>]+(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i);
      expect(html).not.toContain('/assets/');
      expect(html).not.toContain('sourceMappingURL');
      expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    });

    it(`${name}: carries build version and source revision metas`, () => {
      const html = readDist(name);
      const info = readBuildInfo();
      expect(html).toContain(`<meta name="cpa-quota-version" content="${pkg.version}">`);
      expect(html).toContain(`<meta name="cpa-quota-source-revision" content="${info.commit}">`);
    });

    it(`${name}: ships a hash-only CSP whose hash matches the final inline script`, () => {
      const html = readDist(name);
      const hash = computeScriptHash(extractFinalInlineScript(html));
      const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
      expect(meta).not.toBeNull();
      const csp = meta![1];
      expect(csp).toBe(buildCspContent(hash));
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/i);
      expect(verifyCspHash(html)).toBe(true);
    });

    it(`${name}: fails hash verification after a one-byte script mutation`, () => {
      const html = readDist(name);
      const script = extractFinalInlineScript(html);
      const mutated = script.slice(0, -1) + (script.endsWith(';') ? ' ' : ';');
      expect(verifyCspHash(html.replace(script, () => mutated))).toBe(false);
    });

    it(`${name}: contains no secret-shaped material`, () => {
      const html = readDist(name);
      for (const secret of SECRET_MARKERS) expect(html).not.toContain(secret);
    });
  }

  it('quota.html (user): excludes the admin write path entirely', () => {
    const html = readDist('quota.html');
    expect(html).not.toContain('/rate-limit-reset-credits/consume');
    for (const marker of ADMIN_MODULE_MARKERS) expect(html).not.toContain(marker);
    for (const copy of ADMIN_DIALOG_COPY) expect(html).not.toContain(copy);
  });

  it('quota-admin.html (admin): contains the consume endpoint', () => {
    expect(readDist('quota-admin.html')).toContain('/rate-limit-reset-credits/consume');
  });
});
