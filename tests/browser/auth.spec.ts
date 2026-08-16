/**
 * Auth bootstrap browser spec (against the BUILT dist/ artifacts).
 *
 * Covers the Sub2API entry contract:
 *  - `?token=…` is read and immediately removed from the address bar;
 *  - an unrelated `?theme=dark` parameter SURVIVES the token removal;
 *  - `/api/v1/auth/me` success → the authenticated shell renders;
 *  - HTTP 401, business-code failure and non-active user → auth-error gate,
 *    no cards, no `/cpa/` call;
 *  - the app issues no `/cpa/` api-call during load (quota is user-initiated);
 *  - the token never lands in Web Storage or cookies;
 *  - the shipped CSP hash actually permits startup (a mutated copy blocks it).
 */

import { expect, test } from '@playwright/test';
import { FIXED_NOW, SUB2API_TOKEN } from './helpers/fixtures';
import { createRouteSession, installRoutes, openPage } from './helpers/routes';

test.describe('auth: token handling', () => {
  test('removes ?token from the URL while preserving other query parameters', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session, { theme: 'dark' });

    await page.waitForSelector('.pageHeader', { timeout: 10_000 });

    await expect.poll(() => page.evaluate(() => window.location.search)).toBe('?theme=dark');
    await expect.poll(() => page.evaluate(() => window.location.href)).not.toContain('token=');
    expect(page.url()).not.toContain(SUB2API_TOKEN);
    // Theme was preserved and actually applied.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('does not persist the token in Web Storage or cookies', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await page.waitForSelector('.pageHeader', { timeout: 10_000 });
    await page.waitForTimeout(300);

    const leakage = await page.evaluate((token) => {
      const haystacks = [
        window.localStorage.toString(),
        window.sessionStorage.toString(),
        document.cookie,
      ];
      return haystacks.some((value) => value.includes(token));
    }, SUB2API_TOKEN);
    expect(leakage).toBe(false);
  });

  test('issues no /cpa/ api-call during load', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await page.waitForSelector('.card', { timeout: 10_000 });
    await page.waitForTimeout(500);

    expect(session.apiCalls).toHaveLength(0);
    expect(session.requests.some((request) => request.url.includes('/api-call'))).toBe(false);
  });
});

test.describe('auth: /auth/me outcomes', () => {
  test('renders the shell on success', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.pageHeader')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.card').first()).toBeVisible();
    await expect(page.locator('.authGate')).toHaveCount(0);
  });

  test('renders the auth-error gate on HTTP 401', async ({ page }) => {
    const session = createRouteSession();
    session.validTokens.clear(); // any token now fails
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session, { token: 'wrong-token' });

    await expect(page.locator('.authGate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.authGate')).toContainText('身份验证失败');
    await expect(page.locator('.card')).toHaveCount(0);
    await expect(page.locator('.pageHeader')).toHaveCount(0);
    expect(session.requests.filter((request) => request.url.includes('/cpa/'))).toHaveLength(0);
  });

  test('renders the auth-error gate on business-code failure', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 403, message: 'forbidden', data: null }) });
    });
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.authGate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.authGate')).toContainText('身份验证失败');
    await expect(page.locator('.card')).toHaveCount(0);
    expect(session.requests.filter((request) => request.url.includes('/cpa/'))).toHaveLength(0);
  });

  test('rejects a non-active user (inactive account)', async ({ page }) => {
    const session = createRouteSession();
    session.authInactive = true;
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.authGate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.authGate')).toContainText('身份验证失败');
    await expect(page.locator('.card')).toHaveCount(0);
    expect(session.requests.filter((request) => request.url.includes('/cpa/'))).toHaveLength(0);
  });
});

test.describe('auth: CSP boot integrity', () => {
  test('the shipped CSP hash permits the inline script to run', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    // If the hash were wrong the app would never bootstrap past the static
    // placeholder text.
    await expect(page.locator('.pageHeader')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#app')).not.toContainText('正在加载…');
  });

  test('a tampered (malformed) CSP hash blocks startup', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);

    // Serve a byte-identical copy of the shipped artifact with one corrupted
    // character inside the CSP script hash. The browser must refuse to run
    // the inline script, leaving the static placeholder in place.
    await page.route('**/tampered-quota.html', async (route) => {
      const response = await page.request.get('http://127.0.0.1:4173/quota.html');
      const html = (await response.text())
        .replace(/script-src 'sha256-([A-Za-z0-9+/=]{10})/, 'script-src \'sha256-AAAAAAAAAA$1');
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });

    const fixedNow = new Date(FIXED_NOW);
    await page.clock.install({ time: fixedNow });
    const baseline = session.requests.length;
    await page.goto(`http://127.0.0.1:4173/tampered-quota.html?token=${SUB2API_TOKEN}`);

    // Startup must NOT have happened: no shell, no cards, no API traffic
    // (the only new request may be the document itself, which never boots).
    await page.waitForTimeout(1500);
    await expect(page.locator('.pageHeader')).toHaveCount(0);
    await expect(page.locator('.card')).toHaveCount(0);
    const documentRequests = session.requests.slice(baseline).filter((request) => request.url.includes('/api/') || request.url.includes('/cpa/'));
    expect(documentRequests).toEqual([]);
  });
});
