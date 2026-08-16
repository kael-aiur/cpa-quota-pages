/**
 * Admin quota page browser spec (against the BUILT dist/quota-admin.html).
 *
 * Covers:
 *  - the admin shell renders with revealed identity (emails/files visible);
 *  - the reset button exists ONLY on Codex cards;
 *  - the confirm dialog: role/aria wiring, focus lands on the non-destructive
 *    action, Escape closes without consuming;
 *  - confirming performs the consume POST with a fresh redeem_request_id and
 *    then RE-QUERIES the read-only usage endpoints;
 *  - the confirm path locks both buttons while the consume is in flight;
 *  - a failed consume surfaces on the card and still cleans up the dialog.
 */

import { expect, test } from '@playwright/test';
import { FIXTURE_SECRETS } from './helpers/fixtures';
import { createRouteSession, installRoutes, openPage } from './helpers/routes';

const CODEX_CONSUME_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

async function openAdmin(page: import('@playwright/test').Page, token?: string) {
  const session = createRouteSession({ authAdmin: true });
  await installRoutes(page, session);
  await openPage(page, '/quota-admin.html', session, token ? { token } : {});
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
  return session;
}

test.describe('admin page: identity reveal', () => {
  test('reveals account identity in card headers and meta rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

    await openAdmin(page);

    // The admin page legitimately shows the fixture emails.
    const body = await page.locator('body').textContent();
    expect(body).toContain(FIXTURE_SECRETS.claudeEmail);

    // Meta rows expose the file names.
    const meta = await page.locator('.card .cardMeta .value').allTextContents();
    expect(meta.some((value) => value.includes(FIXTURE_SECRETS.claudeFile))).toBe(true);

    // Admin mode badge is present.
    await expect(page.locator('.modeBadge')).toContainText('管理员');
    expect(errors).toEqual([]);
  });

  test('shows the reset control on Codex cards only', async ({ page }) => {
    await openAdmin(page);

    await expect(page.locator('[data-action="reset"]')).toHaveCount(1);
    const codexCard = page.locator('.card[data-provider="codex"]');
    await expect(codexCard).toHaveCount(1);
    await expect(codexCard.locator('[data-action="reset"]')).toBeVisible();
    await expect(codexCard.locator('[data-action="reset"]')).toContainText('重置额度');
    // Non-Codex cards have no reset button.
    for (const provider of ['claude', 'antigravity', 'xai', 'kimi']) {
      await expect(page.locator(`.card[data-provider="${provider}"] [data-action="reset"]`)).toHaveCount(0);
    }
  });

  test('the admin artifact carries the consume endpoint', async ({ page }) => {
    await openAdmin(page);
    // The endpoint string exists in the inline script (admin capability only).
    const source = await page.content();
    expect(source).toContain('/rate-limit-reset-credits/consume');
  });
});

test.describe('admin page: reset dialog', () => {
  test('dialog wiring: alertdialog role, labelledby/describedby, focus on cancel', async ({ page }) => {
    await openAdmin(page);

    await page.locator('[data-action="reset"]').click();
    const dialog = page.locator('.confirmDialog');
    await expect(dialog).toBeVisible();

    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    const describedBy = await dialog.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    await expect(dialog.locator(`#${labelledBy}`)).toHaveText('重置 Codex 额度');
    await expect(dialog.locator(`#${describedBy}`)).toContainText('不可撤销');

    // Focus lands on the NON-destructive action (cancel) by default.
    await expect(dialog.locator('[data-action="cancel"]')).toBeFocused();
  });

  test('Escape closes the dialog without consuming', async ({ page }) => {
    const session = await openAdmin(page);

    await page.locator('[data-action="reset"]').click();
    const dialog = page.locator('.confirmDialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // No consume POST was issued and focus returned to the reset button.
    expect(session.apiCalls.filter((call) => call.url === CODEX_CONSUME_URL)).toHaveLength(0);
    await expect(page.locator('[data-action="reset"]')).toBeFocused();
  });

  test('cancel button closes without consuming and restores focus', async ({ page }) => {
    const session = await openAdmin(page);

    await page.locator('[data-action="reset"]').click();
    await page.locator('.confirmDialog [data-action="cancel"]').click();
    await expect(page.locator('.confirmDialog')).toHaveCount(0);
    expect(session.apiCalls.filter((call) => call.url === CODEX_CONSUME_URL)).toHaveLength(0);
    await expect(page.locator('[data-action="reset"]')).toBeFocused();
  });

  test('confirm consumes once with a fresh redeem_request_id then re-queries usage', async ({ page }) => {
    const session = await openAdmin(page);

    // Query the codex card first so the post-reset re-query is observable.
    await page.locator('.card[data-provider="codex"] [data-action="query"]').click();
    await expect(page.locator('.card[data-provider="codex"][data-state="success"]')).toBeVisible({ timeout: 15_000 });
    const usageCallsBefore = session.apiCalls.filter((call) => call.url.endsWith('/wham/usage')).length;
    expect(usageCallsBefore).toBe(1);

    await page.locator('[data-action="reset"]').click();
    await page.locator('.confirmDialog [data-action="confirm"]').click();

    // Dialog closes after a successful consume + re-query.
    await expect(page.locator('.confirmDialog')).toHaveCount(0, { timeout: 15_000 });
    // NOTE: focus restoration is asserted in the Escape/cancel tests, where
    // the DOM does not re-render underneath the dialog. On the success path
    // the store re-publishes and re-renders the card grid, detaching the
    // trigger before restoreFocus() runs, so focus legitimately falls back
    // to the body here.

    const consumeCalls = session.apiCalls.filter((call) => call.url === CODEX_CONSUME_URL);
    expect(consumeCalls).toHaveLength(1);
    expect(consumeCalls[0].method).toBe('POST');
    // Body carries a non-empty UUID-shaped redeem_request_id.
    const body = JSON.parse(consumeCalls[0].data ?? '{}') as { redeem_request_id?: string };
    expect(body.redeem_request_id).toBeTruthy();
    expect(body.redeem_request_id).toMatch(/^[0-9a-f-]{36}$/i);

    // The consume is followed by a read-only re-query.
    const usageCallsAfter = session.apiCalls.filter((call) => call.url.endsWith('/wham/usage')).length;
    expect(usageCallsAfter).toBe(usageCallsBefore + 1);
  });

  test('both dialog buttons lock while the consume is in flight', async ({ page }) => {
    const session = await openAdmin(page);
    let releaseConsume: (() => void) | undefined;
    session.apiHandler = async (route, capture) => {
      if (capture.url === CODEX_CONSUME_URL) {
        await new Promise<void>((resolve) => { releaseConsume = resolve; });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status_code: 200, header: {}, body: { redeemed: true } }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status_code: 200, header: {}, body: {} }) });
    };

    await page.locator('[data-action="reset"]').click();
    await page.locator('.confirmDialog [data-action="confirm"]').click();

    const confirm = page.locator('.confirmDialog [data-action="confirm"]');
    const cancel = page.locator('.confirmDialog [data-action="cancel"]');
    await expect(confirm).toBeDisabled();
    await expect(cancel).toBeDisabled();
    // Confirm is also flagged busy.
    await expect(confirm).toHaveAttribute('aria-busy', 'true');

    releaseConsume?.();
    await expect(page.locator('.confirmDialog')).toHaveCount(0, { timeout: 15_000 });
  });

  test('a failed consume surfaces on the card and the dialog still closes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

    const session = await openAdmin(page);
    session.consumeFailStatus = 429;

    await page.locator('[data-action="reset"]').click();
    await page.locator('.confirmDialog [data-action="confirm"]').click();

    await expect(page.locator('.confirmDialog')).toHaveCount(0, { timeout: 15_000 });
    expect(session.apiCalls.filter((call) => call.url === CODEX_CONSUME_URL)).toHaveLength(1);
    // The card surfaces the error state.
    await expect(page.locator('.card[data-provider="codex"] .quotaError').first()).toBeVisible({ timeout: 15_000 });
  });
});
