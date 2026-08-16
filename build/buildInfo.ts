/**
 * Build metadata for the single-file quota artifacts.
 *
 * `readBuildInfo()` resolves, in order:
 *  - `version`: the `version` field of `package.json` (single source of truth).
 *  - `commit`: the 12-character SOURCE REVISION the artifacts were built from —
 *    `GITHUB_SHA` when present (CI builds a specific commit and may not have a
 *    full git checkout), otherwise `git rev-parse --short=12 HEAD`.
 *
 * NOTE: `commit` is documented (README) as the source revision, NOT the commit
 * that ultimately lands the generated artifacts — those can differ because the
 * dist output is committed alongside the sources.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BuildInfo {
  version: string;
  commit: string;
}

const SHORT_SHA_LENGTH = 12;

function shortSha(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[0-9a-f]{40}$/i.test(trimmed) || /^[0-9a-f]{12,}$/i.test(trimmed)
    ? trimmed.slice(0, SHORT_SHA_LENGTH).toLowerCase()
    : undefined;
}

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function readBuildInfo(environment: NodeJS.ProcessEnv = process.env): BuildInfo {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const version = String(JSON.parse(readFileSync(packageJsonPath, 'utf8')).version);
  const fromEnv = shortSha(environment.GITHUB_SHA ?? '');
  const commit = fromEnv ?? execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', cwd: process.cwd() }).trim();
  return { version, commit };
}

/**
 * Inject the build-identity metas into a (near-)final HTML document:
 *  - `cpa-quota-version` — package version,
 *  - `cpa-quota-source-revision` — source revision (see {@link readBuildInfo}),
 *  - `cpa-quota-target` — which bundle (`user` / `admin`) this artifact is.
 *
 * Idempotent: a re-run over already-injected HTML is a byte-for-byte no-op.
 */
export function finalizeQuotaHtml(options: { html: string; target: 'user' | 'admin'; buildInfo: BuildInfo }): string {
  const { html, target, buildInfo } = options;
  const metas = [
    `<meta name="cpa-quota-version" content="${escapeHtmlAttribute(buildInfo.version)}">`,
    `<meta name="cpa-quota-source-revision" content="${escapeHtmlAttribute(buildInfo.commit)}">`,
    `<meta name="cpa-quota-target" content="${target}">`,
  ];
  const injection = `<!-- cpa-build-info -->\n    ${metas.join('\n    ')}`;

  const existing = /<!-- cpa-build-info -->[\s\S]*?<!-- \/cpa-build-info -->/.exec(html);
  if (existing) return html.slice(0, existing.index) + injection + '\n  <!-- /cpa-build-info -->' + html.slice(existing.index + existing[0].length);

  const marker = /<!--\s*csp-injection-point\s*-->/.exec(html);
  if (marker) {
    return html.slice(0, marker.index) + `${injection}\n  <!-- /cpa-build-info -->\n  ${marker[0]}` + html.slice(marker.index + marker[0].length);
  }
  const head = /<\/head>/i.exec(html);
  if (!head) throw new Error('finalizeQuotaHtml: no <!-- csp-injection-point --> marker and no </head> to fall back to');
  return html.slice(0, head.index) + `${injection}\n  <!-- /cpa-build-info -->\n  ` + html.slice(head.index);
}
