/**
 * Repository release contracts (Task 17).
 *
 * These tests pin the DEPLOYMENT and RELEASE surface of the repository:
 * `.github/workflows/ci.yml`, `nginx/example.conf`, `README.md` and
 * `package.json`. They fail whenever a deployment-relevant regression slips
 * in — e.g. a raw GitHub URL drifting from the fixed release tag to `main`,
 * an HTML proxy location that forwards the client query string (and therefore
 * the Sub2API token) upstream, a dropped `auth_request`, a `/cpa/` rewrite
 * that duplicates `/v0/management/`, or README copy that overstates the
 * security model beyond the accepted residual risks of specification §12.2.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

const projectRoot = resolve(process.cwd());

function readRepositoryFile(relativePath: string): string {
  const absolute = resolve(projectRoot, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`Missing required repository file: ${relativePath}`);
  }
  return readFileSync(absolute, 'utf8');
}

const ciYaml = readRepositoryFile('.github/workflows/ci.yml');
const nginxConf = readRepositoryFile('nginx/example.conf');
const readme = readRepositoryFile('README.md');
const releaseTag = 'v1.0.0';

/** Strip nginx `#` comments and blank lines so assertions see only directives. */
function nginxDirectives(conf: string): string[] {
  return conf
    .split('\n')
    .map((line) => {
      const withoutComment = line.replace(/#.*$/, '');
      return withoutComment.trim();
    })
    .filter((line) => line.length > 0);
}

/**
 * Flatten nginx comments into prose: strip `#` prefixes, collapse the runs of
 * spaces the comment indentation used, and re-join so a sentence wrapped over
 * several comment lines matches as one contiguous string.
 */
function nginxConfShadow(conf: string): string {
  return conf
    .split('\n')
    .map((line) => {
      const comment = /^(\s*#\s?)/.exec(line);
      return comment ? line.slice(comment[0].length) : '';
    })
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** The body of `location <pattern> { … }` including its braces. */
function nginxLocationBody(conf: string, locationPattern: string): string {
  const directives = nginxDirectives(conf).join('\n');
  const opener = new RegExp(`location\\s+${escapeRegExp(locationPattern)}\\s*\\{`);
  const opening = opener.exec(directives);
  if (!opening) {
    throw new Error(`nginx example has no location ${locationPattern}`);
  }
  let depth = 0;
  let index = opening.index + opening[0].length;
  for (; index < directives.length; index += 1) {
    const char = directives[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return directives.slice(opening.index + opening[0].length, index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('repository contract: CI workflow', () => {
  it('runs the full release pipeline on pull requests and main pushes', () => {
    expect(ciYaml).toContain('on:');
    expect(ciYaml).toMatch(/pull_request/);
    expect(ciYaml).toMatch(/push:\s*\n?\s*branches:\s*\n?\s*-\s*main/);
  });

  it('checks out the repository and installs dependencies with npm ci', () => {
    expect(ciYaml).toMatch(/- uses:\s*actions\/checkout/);
    expect(ciYaml).toMatch(/npm ci/);
  });

  it('runs typecheck, unit tests and the production build before e2e', () => {
    expect(ciYaml).toMatch(/npm run typecheck/);
    expect(ciYaml).toMatch(/npm test\b/);
    expect(ciYaml).toMatch(/npm run build\b/);
  });

  it('installs Chromium and runs the Playwright e2e suite', () => {
    expect(ciYaml).toMatch(/npx playwright install(?!-with-deps)\s+--with-deps\s+chromium|npx playwright install\s+chromium/);
    expect(ciYaml).toMatch(/npm run test:e2e/);
  });

  it('asserts the user artifact cannot consume reset credits', () => {
    // Every gate must be a `if grep -qF …; then exit 1; fi` block. A bare
    // multi-line `! grep` list is a dead gate under `bash -e`: `!` pipelines
    // are exempt from errexit and the step status is the LAST line's, so any
    // violation above the final line passes silently.
    expect(ciYaml).toMatch(/if grep -qF '\/rate-limit-reset-credits\/consume' dist\/quota\.html; then/);
    expect(ciYaml).toMatch(/exit 1/);
    expect(ciYaml).not.toMatch(/^\s*!\s*grep/m);
    // All four gates survive in the workflow (user+admin consume, user+admin assets).
    expect(ciYaml.match(/if (! )?grep -qF/g) ?? []).toHaveLength(4);
    expect(ciYaml).toMatch(/if ! grep -qF '\/rate-limit-reset-credits\/consume' dist\/quota-admin\.html; then/);
    expect(ciYaml).toMatch(/if grep -qF '\/assets\/' dist\/quota\.html; then/);
    expect(ciYaml).toMatch(/if grep -qF '\/assets\/' dist\/quota-admin\.html; then/);
  });

  it('fails when the committed dist is not a rebuild of the current sources', () => {
    expect(ciYaml).toMatch(/npm run check:dist/);
    // The workflow must restore the committed dist (NOT `git add -A dist`)
    // before check:dist: the earlier Build step re-stamps dist with
    // GITHUB_SHA, and staging that would poison the index so check:dist's
    // worktree-vs-index diff is a guaranteed mismatch.
    expect(ciYaml).toMatch(/git checkout -- dist\s*\n\s*npm run check:dist/);
    expect(ciYaml).not.toMatch(/git add -A dist/);
  });
});

describe('repository contract: nginx example', () => {
  it('fetches both HTML artifacts from the fixed release tag, never main', () => {
    expect(nginxConf).toContain(`https://raw.githubusercontent.com/kael-aiur/cpa-quota-pages/${releaseTag}/dist/quota.html`);
    expect(nginxConf).toContain(`https://raw.githubusercontent.com/kael-aiur/cpa-quota-pages/${releaseTag}/dist/quota-admin.html`);
    expect(nginxConf).not.toContain('/main/dist/');
    expect(nginxConf).not.toContain('/HEAD/dist/');
  });

  it('discards client query strings before any upstream hop on both HTML entries', () => {
    // raw.githubusercontent.com answers 404 for an unvalidated ?token=… query
    // parameter (it is GitHub's own raw-access-token parameter; observed live:
    // ?token=231 -> 404 while ?TOKEN=231 / ?user_id=1 -> 200). A trailing "?"
    // on proxy_pass only cleans the URL nginx itself builds — an outer
    // gateway can re-append the original query. The contract is therefore a
    // rewrite-phase strip to an `internal` location whose proxy_pass is a
    // fixed query-free URL.
    for (const [entry, internal] of [
      ['= /quota.html', '= /_quota_html'],
      ['= /quota-admin.html', '= /_quota_admin_html'],
    ] as const) {
      const entryBody = nginxLocationBody(nginxConf, entry);
      expect(entryBody).toMatch(new RegExp(`rewrite\\s+\\^\\s+${escapeRegExp(internal.slice(2))}\\?\\s+break;`));
      const upstreamBody = nginxLocationBody(nginxConf, internal);
      expect(upstreamBody).toContain('internal;');
      const proxyPass = nginxDirectives(upstreamBody).find((line) => /^proxy_pass\b/.test(line));
      expect(proxyPass).toBeDefined();
      expect(proxyPass).not.toContain('?');
    }
  });

  it('protects the user entry with the Sub2API user auth_request', () => {
    const body = nginxLocationBody(nginxConf, '= /quota.html');
    expect(body).toContain('auth_request /_sub2api_auth;');
    expect(body).not.toContain('auth_request /_sub2api_admin_auth;');
  });

  it('protects the admin entry with the dedicated admin auth_request', () => {
    const body = nginxLocationBody(nginxConf, '= /quota-admin.html');
    expect(body).toContain('auth_request /_sub2api_admin_auth;');
  });

  it('clears Authorization, Cookie and Referer towards the GitHub upstream', () => {
    for (const location of ['= /_quota_html', '= /_quota_admin_html']) {
      const body = nginxLocationBody(nginxConf, location);
      expect(body).toContain('proxy_set_header Authorization "";');
      expect(body).toContain('proxy_set_header Cookie "";');
      expect(body).toContain('proxy_set_header Referer "";');
    }
  });

  it('enables TLS SNI and pins the upstream Host for raw.githubusercontent.com', () => {
    for (const location of ['= /_quota_html', '= /_quota_admin_html']) {
      const body = nginxLocationBody(nginxConf, location);
      expect(body).toContain('proxy_ssl_server_name on;');
      expect(body).toContain('proxy_set_header Host raw.githubusercontent.com;');
    }
  });

  it('serves the HTML with the hardened response headers', () => {
    for (const location of ['= /_quota_html', '= /_quota_admin_html']) {
      const body = nginxLocationBody(nginxConf, location);
      expect(body).toContain('proxy_hide_header Content-Type;');
      expect(body).toMatch(/add_header Content-Type "text\/html; charset=utf-8" always;/);
      expect(body).toContain('add_header Referrer-Policy "no-referrer" always;');
      expect(body).toContain('add_header Cache-Control "private, no-store" always;');
      expect(body).toContain('add_header X-Content-Type-Options "nosniff" always;');
      expect(body).toMatch(/add_header Content-Security-Policy "frame-ancestors 'self'"/);
    }
  });

  it('strips GitHub raw security headers that would sandbox the document', () => {
    // raw.githubusercontent.com serves every file with
    //   Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
    //   X-Frame-Options: deny
    // The sandbox directive (without allow-scripts) disables all script execution,
    // and X-Frame-Options: deny blocks iframe embedding outright. Proxied as an HTML
    // document these break the page completely, so every GitHub-injected security
    // header must be hidden before our own add_header set applies. This exact
    // failure was observed live at https://llm.kael.site:8444/cpa/quota.html:
    // "Blocked script execution ... because the document's frame is sandboxed and
    // the 'allow-scripts' permission is not set".
    for (const location of ['= /_quota_html', '= /_quota_admin_html']) {
      const body = nginxLocationBody(nginxConf, location);
      for (const header of [
        'proxy_hide_header Content-Security-Policy;',
        'proxy_hide_header X-Frame-Options;',
        'proxy_hide_header X-Content-Type-Options;',
        'proxy_hide_header Strict-Transport-Security;',
        'proxy_hide_header Cross-Origin-Resource-Policy;',
        'proxy_hide_header Access-Control-Allow-Origin;',
      ]) {
        expect(body).toContain(header);
      }
    }
  });

  it('routes /cpa/ through auth_request, the secret include and a stripping proxy_pass', () => {
    const body = nginxLocationBody(nginxConf, '/cpa/');
    expect(body).toContain('auth_request /_sub2api_auth;');
    expect(body).toContain('include /etc/nginx/secrets/cpa-management-auth.conf;');
    expect(body).toContain('proxy_pass http://cpa_backend/;');
  });

  it('never duplicates /v0/management/ in the /cpa/ proxy path', () => {
    const body = nginxLocationBody(nginxConf, '/cpa/');
    // The proxy_pass directive itself must be exactly the backend root + the
    // location-stripping trailing slash; adding /v0/management/ would yield
    // /v0/management/v0/management/api-call upstream.
    const proxyPassLines = nginxDirectives(nginxConf).filter((line) => /^proxy_pass\b/.test(line));
    expect(proxyPassLines.length).toBeGreaterThan(0);
    for (const line of proxyPassLines) {
      expect(line).not.toMatch(/v0\/management/);
    }
    const bodyProxyPass = nginxDirectives(body).filter((line) => /^proxy_pass\b/.test(line));
    expect(bodyProxyPass).toEqual(['proxy_pass http://cpa_backend/;']);
  });

  it('documents that the admin auth endpoint is a deployment-supplied administrator check', () => {
    // Anchored to the actual scope-comment sentence (not merely "the file
    // mentions admin"): /_sub2api_admin_auth must be a deployment-supplied
    // auth_request that returns 2xx only after server-side validation that
    // the caller is an administrator, and the HTML itself parses no roles.
    // Comment line prefixes (`#   * `, `#     `) are stripped first so the
    // assertions see the prose, not the comment syntax.
    const prose = nginxConfShadow(nginxConf);
    expect(prose).toContain(
      '`/_sub2api_admin_auth` must be an auth_request endpoint provided by your Sub2API deployment that returns 2xx ONLY after server-side validation that the caller is an ADMINISTRATOR.',
    );
    expect(prose).toContain('the admin gate is exactly this endpoint');
    expect(prose).toContain('2xx only when server-side role validation proves the caller is an administrator');
    expect(prose).toContain('the entire admin authorization decision for this entry');
  });

  it('documents the secret include file so the key never enters the repository', () => {
    expect(nginxConf).toContain('/etc/nginx/secrets/cpa-management-auth.conf');
    expect(nginxConf).not.toMatch(/Bearer [A-Za-z0-9._~+/=-]{8,}/);
  });
});

describe('repository contract: README', () => {
  it('documents setup, build and the local preview commands', () => {
    for (const command of ['npm ci', 'npm run build', 'npm run typecheck', 'npm test', 'npm run test:e2e']) {
      expect(readme).toContain(command);
    }
    expect(readme).toMatch(/npm run dev:user|vite --mode user/);
  });

  it('documents the two deployed URLs and their auth_request boundaries', () => {
    expect(readme).toContain('/quota.html');
    expect(readme).toContain('/quota-admin.html');
    expect(readme).toContain('/_sub2api_auth');
    expect(readme).toContain('/_sub2api_admin_auth');
  });

  it('documents the release/tag update and rollback flow', () => {
    expect(readme).toContain(releaseTag);
    expect(readme).toMatch(/rollback|回滚/i);
    expect(readme).toMatch(/tag/i);
  });

  it('documents the source-revision meta semantics', () => {
    expect(readme).toContain('cpa-quota-source-revision');
  });

  it('documents the CPA management key secret include', () => {
    expect(readme).toContain('/etc/nginx/secrets/cpa-management-auth.conf');
  });

  it('states that /_sub2api_admin_auth is a deployment contract returning success only for administrators', () => {
    expect(readme).toMatch(/_sub2api_admin_auth[^]*administrator|_sub2api_admin_auth[^]*管理员/s);
    expect(readme).toMatch(/2xx|成功|success/i);
  });

  it('lists all six accepted residual risks from specification §12.2', () => {
    expect(readme).toMatch(/12\.2|已接受(的)?(残余)?风险|accepted (residual )?risks/i);
    const riskMarkers = readme.match(/残余风险|residual risk/gi);
    expect(riskMarkers === null ? 0 : riskMarkers.length).toBeGreaterThanOrEqual(1);

    const numberedRiskList = /^[-*\s]*\d+\.\s+.*(?:auth-files|脱敏|api-call|consume|管理密钥|key|代理|绕过|保密|授权|构造)/gim;
    const matches = readme.match(numberedRiskList) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it('covers the concrete substance of each accepted risk', () => {
    // 1. Raw /auth-files response remains visible to users who can open the page.
    expect(readme).toMatch(/auth-files[^]*可见|auth-files[^]*visible|原始响应/is);
    // 2. User-page visual redaction is not a confidentiality boundary.
    expect(readme).toMatch(/脱敏[^]*保密|脱敏[^]*边界|redaction[^]*boundar|visual redaction/is);
    // 3. /v0/management/api-call is a general proxy users can call directly.
    expect(readme).toMatch(/api-call[^]*通用|api-call[^]*general|api-call[^]*代理|api-call[^]*proxy/is);
    // 4/5. Hiding the consume control is not an authorization boundary and can
    //      be hand-crafted by a regular user.
    expect(readme).toMatch(/consume|重置券|手工构造/is);
    // 6. The injected CPA key prevents string leakage but not full proxy capability.
    expect(readme).toMatch(/key[^]*代理|key[^]*proxy|密钥[^]*能力|capability/is);
  });

  it('never claims server-side isolation for the user page', () => {
    // Every mention of isolation (Chinese or English) must be a DISCLAIMER —
    // the line carrying it has to contain a negation/prohibition marker, so
    // the README can warn against the mischaracterization but never assert it.
    const negationMarkers = /不是|不得|不要|不构成|不具备|无法|从未|never|not\b|only entry|no\b/i;
    const isolationMention = /隔离|isolation|isolated/i;
    const offending: string[] = [];
    for (const line of readme.split('\n')) {
      if (isolationMention.test(line) && !negationMarkers.test(line)) {
        offending.push(line.trim());
      }
    }
    expect(offending, 'README lines mentioning isolation without a negation').toEqual([]);

    // And the affirmative-claim phrasings are banned outright.
    for (const pattern of [/具备服务端隔离/, /实现服务端隔离/, /提供服务端隔离/, /强隔离/, /server[- ]side isolation is (provided|enforced)/i]) {
      expect(readme, `README must not match ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('repository contract: package.json', () => {
  it('exposes the release verification scripts used by CI and the README', () => {
    const scripts = pkg.scripts as Record<string, string>;
    for (const name of ['typecheck', 'test', 'test:e2e', 'build', 'check:dist']) {
      expect(scripts, `package.json is missing the ${name} script`).toHaveProperty(name);
    }
    expect(scripts['test:e2e']).toBe('playwright test');
  });
});
