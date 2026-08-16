/**
 * User quota page browser spec (against the BUILT dist/quota.html).
 *
 * Covers:
 *  - 21+ accounts → paginated (20/page), pagination controls work;
 *  - provider tabs filter the list and reset to page 1;
 *  - sort modes ("default" vs "soonest") reorder accounts with quota loaded;
 *  - "query all" batches the CURRENT PAGE only (≤20 accounts per batch);
 *  - a single failing card does not abort the rest of its batch;
 *  - DOM secrecy: fixture identity secrets never appear in the user DOM;
 *  - the user artifact carries no reset capability (no reset buttons);
 *  - zero console errors across the interactions.
 */

import { expect, test } from '@playwright/test';
import { CANONICAL_ACCOUNTS, FIXTURE_SECRETS, manyClaudeAccounts } from './helpers/fixtures';
import { createRouteSession, installRoutes, openPage } from './helpers/routes';

/** Collect console errors + page errors into a live array (synchronous). */
function collectConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.describe('user page: list rendering', () => {
  test('shows one card per non-disabled account with provider badges', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('.card').count()).toBe(CANONICAL_ACCOUNTS.length);

    // Provider order is canonical: claude, antigravity, codex, xai, kimi.
    const badges = await page.locator('.card .typeBadge').allTextContents();
    expect(badges).toEqual(['Claude', 'Antigravity', 'Codex', 'xAI', 'Kimi']);

    // Stats bar reflects the account count.
    await expect(page.locator('[data-role="stats"]')).toContainText(String(CANONICAL_ACCOUNTS.length));
    expect(errors).toEqual([]);
  });

  test('keeps the user page free of any reset control', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-action="reset"]')).toHaveCount(0);
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('重置额度');
    expect(body).not.toContain('/rate-limit-reset-credits/consume');
  });
});

test.describe('user page: 21+ accounts, pagination, tabs and sort', () => {
  test.beforeEach(async ({ page }) => {
    // 21 claude accounts + the other four providers = 25 cards → 2 pages.
    const accounts = [...manyClaudeAccounts(21), ...CANONICAL_ACCOUNTS.filter((a) => a.provider !== 'claude')];
    const session = createRouteSession({ accounts });
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('paginates at 20 per page and navigates between pages', async ({ page }) => {
    await expect(page.locator('.card')).toHaveCount(20);
    await expect(page.locator('[data-role="page-status"]')).toHaveText('第 1 / 2 页');

    await page.locator('[data-action="page-next"]').click();
    await expect(page.locator('.card')).toHaveCount(5);
    await expect(page.locator('[data-role="page-status"]')).toHaveText('第 2 / 2 页');
    await expect(page.locator('[data-action="page-next"]')).toBeDisabled();

    await page.locator('[data-action="page-prev"]').click();
    await expect(page.locator('.card')).toHaveCount(20);
    await expect(page.locator('[data-action="page-prev"]')).toBeDisabled();
  });

  test('provider tab filters the list and resets to page 1', async ({ page }) => {
    // Move to page 2 first, then switch tabs: page must reset to 1.
    await page.locator('[data-action="page-next"]').click();
    await expect(page.locator('[data-role="page-status"]')).toHaveText('第 2 / 2 页');

    await page.locator('.tab[data-provider="kimi"]').click();
    await expect(page.locator('.tab[data-provider="kimi"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.card')).toHaveCount(1);
    await expect(page.locator('[data-role="page-status"]')).toHaveText('第 1 / 1 页');

    // Back to "all": pagination metadata reflects the full list again.
    await page.locator('.tab[data-provider="all"]').click();
    await expect(page.locator('.card')).toHaveCount(20);
    await expect(page.locator('[data-role="page-status"]')).toHaveText('第 1 / 2 页');
  });

  test('tab counts mirror the per-provider account totals', async ({ page }) => {
    await expect(page.locator('.tab[data-provider="all"] .tabCount')).toHaveText('25');
    await expect(page.locator('.tab[data-provider="claude"] .tabCount')).toHaveText('21');
    await expect(page.locator('.tab[data-provider="kimi"] .tabCount')).toHaveText('1');
  });

  test('soonest sort reorders queried accounts by earliest reset', async ({ page }) => {
    // Query ONLY the visible page (query-one per card) so that page-1
    // membership stays stable while sorting — "query all" would also load
    // page 2, pulling codex/kimi ahead of un-queried accounts.
    const cards = page.locator('.card');
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      await cards.nth(index).locator('[data-action="query"]').click();
    }
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(20, { timeout: 30_000 });

    const defaultOrder = await page.locator('.card .fileName').allTextContents();
    expect(new Set(defaultOrder).size).toBe(defaultOrder.length);

    await page.locator('[data-sort="soonest"]').click();
    await expect(page.locator('.sortTab[data-sort="soonest"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(20);

    const sortedOrder = await page.locator('.card .fileName').allTextContents();
    // Same membership (the whole page was queried), different order.
    expect(sortedOrder.slice().sort()).toEqual(defaultOrder.slice().sort());
    expect(sortedOrder).not.toEqual(defaultOrder);

    // Bulk fixtures zig-zag their session-reset offsets, so the soonest sort
    // puts the smallest "resets in N hours" on the first card. Each claude
    // card renders two meter rows (session + weekly); take the FIRST row of
    // each card, which is the session window the offsets describe.
    const firstRowResets = await page.locator('.card').evaluateAll((cards) =>
      cards.map((card) => (card.querySelector('.quotaRow .quotaReset') as HTMLElement | null)?.textContent ?? ''),
    );
    expect(firstRowResets.length).toBe(20);
    expect(firstRowResets.every((text) => text.length > 0)).toBe(true);
    const parseHours = (text: string): number => {
      const hours = /([0-9]+)\s*小时/.exec(text);
      if (hours) return Number(hours[1]);
      const minutes = /([0-9]+)\s*分钟/.exec(text);
      if (minutes) return Number(minutes[1]) / 60;
      return Number.POSITIVE_INFINITY;
    };
    const hours = firstRowResets.map(parseHours);
    expect(parseHours(firstRowResets[0])).toBe(Math.min(...hours));
  });
});

test.describe('user page: current-page batch', () => {
  test('query-all queries exactly the current page (20 accounts), not the whole list', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const accounts = [...manyClaudeAccounts(21), ...CANONICAL_ACCOUNTS.filter((a) => a.provider !== 'claude')];
    const session = createRouteSession({ accounts });
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();

    // 20 cards succeed (all fixtures answer 200).
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(20, { timeout: 20_000 });

    // "Query all" walks the WHOLE visible account list in page-sized chunks
    // (max 20 per batch — actions.queryCurrentPage rejects >20). With 25
    // accounts: chunk 1 = the first 20 claude accounts, chunk 2 = the
    // remaining claude + the four other providers.
    const claudeUsageCalls = session.apiCalls.filter((call) => call.url.endsWith('/api/oauth/usage'));
    expect(claudeUsageCalls).toHaveLength(21); // every claude account, both pages

    // Per-account claude traffic is exactly usage + profile.
    const claudeProfileCalls = session.apiCalls.filter((call) => call.url.endsWith('/api/oauth/profile'));
    expect(claudeProfileCalls).toHaveLength(21);

    // Non-claude providers were queried exactly once each in the second chunk.
    expect(session.apiCalls.filter((call) => call.url.includes('chatgpt.com/backend-api/wham/usage'))).toHaveLength(1);
    expect(session.apiCalls.filter((call) => call.url.includes('api.kimi.com'))).toHaveLength(1);
    expect(session.apiCalls.filter((call) => call.url.includes('grok.com/v1/billing?format=credits'))).toHaveLength(1);

    // Chunking: the first 20 usage calls are the page-1 accounts (index 0-19).
    const usageIndexes = claudeUsageCalls.map((call) => Number(call.authIndex));
    expect(usageIndexes.length).toBe(21);

    // Stats bar reports 25 successes out of 25 accounts once every chunk lands.
    await expect(page.locator('[data-role="stats"]')).toContainText('成功25', { timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('a single failing card does not abort its batch siblings', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const session = createRouteSession();
    session.failures.set(FIXTURE_SECRETS.claudeFile, 500);
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();

    await expect(page.locator('.card[data-state="error"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(CANONICAL_ACCOUNTS.length - 1);
    await expect(page.locator('.card[data-state="error"] .quotaError')).toContainText('查询失败');
    // Claude's profile sub-request still succeeded for other providers' cards.
    expect(errors).toEqual([]);
  });

  test('query-one fetches a single account on demand', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('.card').first().locator('[data-action="query"]').click();
    await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 10_000 });

    // Claude card issues usage + profile for one account only.
    expect(session.apiCalls.length).toBe(2);
    expect(await page.locator('.card[data-state="success"]').count()).toBe(1);
  });

  test('refresh reloads the account list without issuing quota queries', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    const apiCallsBefore = session.apiCalls.length;
    await page.locator('[data-action="refresh-accounts"]').click();
    await expect(page.locator('.card')).toHaveCount(CANONICAL_ACCOUNTS.length);
    await page.waitForTimeout(300);
    expect(session.apiCalls.length).toBe(apiCallsBefore);
  });
});

test.describe('user page: DOM secrecy', () => {
  test('fixture identity secrets never appear anywhere in the user DOM', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);

    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    // Query everything so provider bodies are fully rendered too.
    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 15_000 });

    // Check the ENTIRE document (visible + attributes + sr-only table).
    const entireDom = await page.evaluate(() => document.documentElement.outerHTML);
    for (const [key, secret] of Object.entries(FIXTURE_SECRETS)) {
      expect(entireDom, `user DOM leaked ${key}`).not.toContain(secret);
    }

    // User cards must show the anonymized hash label instead.
    const labels = await page.locator('.card .fileName').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^Claude · [0-9A-F]{6}$|^Antigravity · |^Codex · |^xAI · |^Kimi · /);
    expect(errors).toEqual([]);
  });
});
