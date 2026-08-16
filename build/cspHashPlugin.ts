/**
 * CSP hash plugin for the single-file quota artifacts.
 *
 * Runs AFTER `viteSingleFile()` so the bundle it inspects is already fully
 * inlined. Pipeline per output document:
 *
 *  1. `finalizeQuotaHtml` injects the build version / source-revision metas at
 *     the `<!-- csp-injection-point -->` marker (required).
 *  2. Extract the FINAL inline `<script>` text — the one and only script that
 *     survives single-file inlining.
 *  3. Hash it with SHA-256 (base64 digest) and inject the CSP meta with a
 *     fixed directive set. `script-src` carries ONLY `'sha256-<hash>'` —
 *     never `'unsafe-inline'`.
 *  4. Re-parse the finished document and re-verify that the emitted hash
 *     still matches the final inline script byte-for-byte; a mismatch fails
 *     the build instead of shipping an unenforceable/blocked page.
 */

import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { finalizeQuotaHtml, type BuildInfo } from './buildInfo';

export const CSP_INJECTION_MARKER = '<!-- csp-injection-point -->';

/** Fixed non-script CSP directives (script-src is appended with the hash). */
const FIXED_CSP_DIRECTIVES =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; object-src 'none'";

/** Matches a non-external script element and captures its body text. */
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Extract the text content of the last inline (non-src) script in the document. */
export function extractFinalInlineScript(html: string): string {
  INLINE_SCRIPT.lastIndex = 0;
  let last: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = INLINE_SCRIPT.exec(html)) !== null) {
    if (!/\bsrc\s*=/i.test(match[1])) last = match[2];
  }
  if (last === undefined) throw new Error('cspHashPlugin: document contains no inline script to hash');
  return last;
}

/** SHA-256 of the script text, base64-encoded — the CSP hash-source value. */
export function computeScriptHash(scriptText: string): string {
  return createHash('sha256').update(scriptText).digest('base64');
}

/** The full CSP policy for a given base64 hash. `script-src` is hash-only. */
export function buildCspContent(hash: string): string {
  return `${FIXED_CSP_DIRECTIVES}; script-src 'sha256-${hash}'`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Re-parse a finished document and confirm the emitted CSP meta's
 * `script-src 'sha256-…'` still matches the SHA-256 of the final inline
 * script. Returns false when the meta is missing, malformed, or stale.
 */
export function verifyCspHash(html: string): boolean {
  // Delimiter-aware: the policy itself contains single quotes ('none', 'self'),
  // so the value capture must exclude only the delimiter it opened with.
  const meta = /<meta\s+http-equiv=("([^"]*)"|'([^']*)')\s+content=("([^"]*)"|'([^']*)')\s*\/?>/i.exec(html);
  if (!meta || meta[1].replace(/["']/g, '').toLowerCase() !== 'content-security-policy') return false;
  const policy = meta[4] ?? meta[6];
  if (policy === undefined) return false;
  const hashSource = /script-src\s+'sha256-([^']+)'/.exec(policy);
  if (!hashSource) return false;
  return computeScriptHash(extractFinalInlineScript(html)) === hashSource[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Vite plugin that hardens a single-file quota artifact.
 *
 * Must be ordered after `viteSingleFile()` in `plugins` (it is a plain plugin
 * with only `generateBundle`, so it runs after singlefile's `enforce: 'post'`
 * `generateBundle` only if listed later — vite.config.ts guarantees this).
 */
export function cspHashPlugin(options: { target: 'user' | 'admin'; buildInfo: BuildInfo }): Plugin {
  const { target, buildInfo } = options;
  return {
    name: 'cpa-quota-csp-hash',
    enforce: 'post',
    generateBundle(_outputOptions, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset' || !fileName.endsWith('.html')) continue;
        const source = typeof chunk.source === 'string' ? chunk.source : Buffer.from(chunk.source).toString('utf8');

        if (!source.includes(CSP_INJECTION_MARKER)) {
          this.error(`cspHashPlugin: ${fileName} is missing the ${CSP_INJECTION_MARKER} injection marker`);
        }

        // 1. Build-identity metas (before hashing — the metas live in <head>,
        //    outside the script, so they cannot perturb the hash anyway).
        let html = finalizeQuotaHtml({ html: source, target, buildInfo });

        // 2-3. Hash the final inline script and inject the CSP meta.
        const scriptText = extractFinalInlineScript(html);
        const hash = computeScriptHash(scriptText);
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(buildCspContent(hash))}">`;
        html = html.replace(CSP_INJECTION_MARKER, cspMeta);

        // 4. Re-verify against the finished bytes; refuse to ship on mismatch.
        if (!verifyCspHash(html)) {
          this.error(`cspHashPlugin: post-injection CSP hash verification failed for ${fileName}`);
        }
        // Guard against a marker reappearing (e.g. injected twice) — the marker
        // must be fully consumed exactly once.
        if (new RegExp(escapeRegExp(CSP_INJECTION_MARKER)).test(html)) {
          this.error(`cspHashPlugin: ${fileName} still contains an unconsumed injection marker`);
        }

        chunk.source = html;
        this.info(`cspHashPlugin: secured ${fileName} (script sha256-${hash})`);
      }
    },
  };
}
