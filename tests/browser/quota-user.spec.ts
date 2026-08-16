/**
 * User quota page browser spec (against the BUILT dist/quota.html).
 *
 * Covers:
 *  - 21+ accounts → paginated (20/page), pagination controls work;
 *  - provider tabs filter the list and reset to page 1;
 *  - sort modes ("default" vs "soonest") reorder accounts with quota loaded;
 *  - "query all" queries the CURRENT PAGE only (one ≤20 batch, never the
 *    whole list — specification §7.1);
 *  - a single failing card does not abort the rest of its batch;
 *  - DOM secrecy: fixture identity secrets never appear in the user DOM;
 *  - the user artifact carries no reset capability (no reset buttons);
 *  - zero console errors across the interactions.
 */

import { expect, test } from '@playwright/test';
import { CANONICAL_ACCOUNTS, FIXTURE_SECRETS, manyClaudeAccounts, type FixtureAccount } from './helpers/fixtures';
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

    // Specification §7.1: "查询全部额度" queries ONLY the current page (≤20
    // accounts) — one actions.queryCurrentPage batch, never the whole list.
    // The account set is 21 claude + 4 non-claude = 25 accounts over 2 pages,
    // and page 1 is the first 20 claude accounts, so the exact expected
    // traffic is 20 usage + 20 profile calls and NOTHING else.
    const claudeUsageCalls = session.apiCalls.filter((call) => call.url.endsWith('/api/oauth/usage'));
    expect(claudeUsageCalls).toHaveLength(20); // exactly page 1

    // Per-account claude traffic is exactly usage + profile.
    const claudeProfileCalls = session.apiCalls.filter((call) => call.url.endsWith('/api/oauth/profile'));
    expect(claudeProfileCalls).toHaveLength(20);

    // Page-1 accounts are claude only: no non-claude provider was touched.
    expect(session.apiCalls.filter((call) => call.url.includes('chatgpt.com/backend-api/wham/usage'))).toHaveLength(0);
    expect(session.apiCalls.filter((call) => call.url.includes('api.kimi.com'))).toHaveLength(0);
    expect(session.apiCalls.filter((call) => call.url.includes('grok.com/v1/billing?format=credits'))).toHaveLength(0);

    // The batch is exactly the first 20 claude accounts (authIndex 0-19).
    const usageIndexes = claudeUsageCalls.map((call) => Number(call.authIndex));
    expect(usageIndexes.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));

    // Let any stray second-batch regression surface before asserting totals.
    await page.waitForTimeout(500);
    expect(session.apiCalls.length).toBe(40);

    // Stats bar reports 20 successes of 25 accounts (page 1 only).
    await expect(page.locator('[data-role="stats"]')).toContainText('成功20');
    expect(errors).toEqual([]);
  });

  test('after paging, query-all re-targets the new current page', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const accounts = [...manyClaudeAccounts(21), ...CANONICAL_ACCOUNTS.filter((a) => a.provider !== 'claude')];
    const session = createRouteSession({ accounts });
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    // Page 2 = the last claude account + the four non-claude providers.
    await page.locator('[data-action="page-next"]').click();
    await page.locator('[data-action="query-all"]').click();

    await expect(page.locator('.card[data-state="success"]')).toHaveCount(5, { timeout: 20_000 });
    const claudeUsageCalls = session.apiCalls.filter((call) => call.url.endsWith('/api/oauth/usage'));
    expect(claudeUsageCalls).toHaveLength(1); // claude-bulk-20 only
    expect(Number(claudeUsageCalls[0].authIndex)).toBe(20);
    // Each non-claude provider on page 2 was queried exactly once.
    expect(session.apiCalls.filter((call) => call.url.includes('chatgpt.com/backend-api/wham/usage'))).toHaveLength(1);
    expect(session.apiCalls.filter((call) => call.url.includes('api.kimi.com'))).toHaveLength(1);
    expect(session.apiCalls.filter((call) => call.url.includes('grok.com/v1/billing?format=credits'))).toHaveLength(1);
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

test.describe('user page: soonest sort across providers', () => {
  test('soonest sort lifts an xAI weekly billing reset above claude windows (spec §9)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Claude recovers its session window at +2h; the xAI account's WEEKLY
    // BILLING period (not a windows[] entry — billing.resetAtMs) ends at +1h.
    // The canonical nextRecoveryMs must rank xAI first; the old ad-hoc
    // windows-only Math.min sank xAI entirely.
    const accounts: FixtureAccount[] = [
      { ...CANONICAL_ACCOUNTS[0], resets: { sessionMs: 2 * 3600_000, weeklyMs: 4 * 24 * 3600_000 } },
      { ...CANONICAL_ACCOUNTS[3], resets: { weeklyMs: 1 * 3600_000 } },
    ];
    const session = createRouteSession({ accounts });
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(2, { timeout: 20_000 });

    // Default order is canonical (claude first); soonest must flip to xAI.
    const defaultBadges = await page.locator('.card .typeBadge').allTextContents();
    expect(defaultBadges).toEqual(['Claude', 'xAI']);

    await page.locator('[data-sort="soonest"]').click();
    await expect(page.locator('.sortTab[data-sort="soonest"]')).toHaveAttribute('aria-pressed', 'true');
    const sortedBadges = await page.locator('.card .typeBadge').allTextContents();
    expect(sortedBadges).toEqual(['xAI', 'Claude']);
    expect(errors).toEqual([]);
  });

  test('badges the earliest sub-hour recovery with a text badge (spec §7.1)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Kimi's session window resets in 30 minutes (< 1h) — the earliest item on
    // the card must carry the urgent text badge + emphasis class.
    const accounts = [...CANONICAL_ACCOUNTS];
    const session = createRouteSession({ accounts });
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.card[data-state="success"]')).toHaveCount(CANONICAL_ACCOUNTS.length, { timeout: 20_000 });

    // Kimi card: one meter row, urgent.
    const kimiCard = page.locator('.card[data-provider="kimi"]');
    await expect(kimiCard.locator('.quotaRow.urgent')).toHaveCount(1);
    await expect(kimiCard.locator('.quotaRow.urgent .urgentBadge')).toHaveText('即将恢复');

    // Claude's earliest reset is 2h away — no urgent row on that card.
    const claudeCard = page.locator('.card[data-provider="claude"]');
    await expect(claudeCard.locator('.quotaRow.urgent')).toHaveCount(0);
    expect(errors).toEqual([]);
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
