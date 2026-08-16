/**
 * Network security browser spec (against the BUILT dist/ artifacts).
 *
 * The core invariant: EVERY request the page issues is same-origin. Provider
 * URLs (anthropic.com, chatgpt.com, googleapis.com, grok.com, api.kimi.com)
 * may exist ONLY inside the JSON body POSTed to /cpa/v0/management/api-call —
 * the browser itself must never open a connection to a provider.
 *
 * Also covers: zero console errors across a full interaction sweep, and the
 * artifact's CSP actually enforces connect-src 'self'.
 */

import { expect, test } from '@playwright/test';
import { createRouteSession, installRoutes, openPage } from './helpers/routes';

const PAGE_PATHS = ['/quota.html', '/quota-admin.html'] as const;

/** Provider hosts that must never appear as a request destination. */
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'chatgpt.com',
  'daily-cloudcode-pa.googleapis.com',
  'cloudcode-pa.googleapis.com',
  'cli-chat-proxy.grok.com',
  'api.x.ai',
  'api.kimi.com',
];

test.describe('network security', () => {
  for (const path of PAGE_PATHS) {
    test(`${path}: every request stays same-origin`, async ({ page }) => {
      const session = createRouteSession({ authAdmin: path.includes('admin') });
      await installRoutes(page, session);
      await openPage(page, path, session);

      // Full interaction sweep: load, query everything, open the dialog on
      // the admin page, sort, filter, page around, switch timeline modes.
      await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-action="query-all"]').click();
      await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 25_000 });
      await page.locator('[data-sort="soonest"]').click();
      await page.locator('.tab[data-provider="claude"]').click();
      await page.locator('.tab[data-provider="all"]').click();
      if (await page.locator('[data-action="page-next"]').isEnabled()) {
        await page.locator('[data-action="page-next"]').click();
      }
      await page.locator('.timelineModeTab[data-mode="session"]').click().catch(() => undefined);
      await page.locator('[data-action="toggle-theme"]').click();
      await page.waitForTimeout(800);

      expect(session.requests.length).toBeGreaterThan(0);
      const serverOrigin = new URL(page.url()).origin;
      for (const request of session.requests) {
        expect(new URL(request.url).origin).toBe(serverOrigin);
      }

      // No request URL anywhere contains a provider host.
      for (const request of session.requests) {
        for (const host of PROVIDER_HOSTS) {
          expect(request.url, `request to ${request.url} leaked provider host`).not.toContain(host);
        }
      }
    });

    test(`${path}: provider URLs appear only inside /api-call JSON bodies`, async ({ page }) => {
      const session = createRouteSession({ authAdmin: path.includes('admin') });
      await installRoutes(page, session);
      await openPage(page, path, session);

      await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-action="query-all"]').click();
      await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 25_000 });

      expect(session.apiCalls.length).toBeGreaterThan(0);

      // Every api-call went to the same-origin proxy path.
      const apiCallRequests = session.requests.filter((request) => request.url.includes('/cpa/v0/management/api-call'));
      expect(apiCallRequests.length).toBe(session.apiCalls.length);

      // Provider hosts appear ONLY as the `url` field inside those bodies.
      for (const request of session.requests) {
        if (request.url.includes('/cpa/v0/management/api-call')) continue;
        expect(request.url).not.toMatch(new RegExp(PROVIDER_HOSTS.join('|'), 'i'));
      }

      // And the bodies themselves carry the provider URLs (positive control:
      // the proxy pattern is actually in use).
      const providerUrlsInBodies = session.apiCalls.filter((call) =>
        PROVIDER_HOSTS.some((host) => call.url.includes(host)),
      );
      expect(providerUrlsInBodies.length).toBeGreaterThan(0);
    });

    test(`${path}: zero console errors across the interaction sweep`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

      const session = createRouteSession({ authAdmin: path.includes('admin') });
      await installRoutes(page, session);
      await openPage(page, path, session);

      await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-action="query-all"]').click();
      await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 25_000 });
      await page.locator('[data-action="refresh-accounts"]').click();
      await page.waitForTimeout(500);

      expect(errors).toEqual([]);
    });
  }

  test('a cross-origin fetch is refused by the shipped CSP', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    // connect-src 'self' must make an external fetch throw.
    const result = await page.evaluate(async () => {
      try {
        await fetch('https://api.anthropic.com/api/oauth/usage');
        return 'succeeded';
      } catch (error) {
        return `blocked: ${(error as Error).name}`;
      }
    });
    expect(result).toContain('blocked');
    expect(result).not.toContain('succeeded');
  });

  test('no external asset, font or script reference exists in the artifacts', async ({ request }) => {
    for (const path of PAGE_PATHS) {
      const response = await request.get(`http://127.0.0.1:4173${path}`);
      const html = await response.text();

      expect(html).not.toMatch(/<script[^>]+src=/i);
      expect(html).not.toMatch(/<link[^>]+href=/i);
      expect(html).not.toMatch(/url\(https?:/i);
      expect(html).not.toMatch(/https?:\/\/[^"'\s)]+\.(woff2?|ttf|otf)/i);
      expect(html).not.toContain('/assets/');
    }
  });
});
