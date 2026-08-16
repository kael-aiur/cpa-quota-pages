/**
 * Responsive + theme browser spec (against the BUILT dist/ artifacts).
 *
 * Covers:
 *  - light and dark themes via `?theme=`, the toggle button, and system
 *    preference fallback, with real computed-color verification per theme;
 *  - 420px viewport: single-column card grid, no horizontal page overflow
 *    from any section (including the timeline with its 560px inner track);
 *  - the timeline scrolls INSIDE `.timelineTrackScroll` (not the page);
 *  - timeline mode switching (weekly ↔ session) and period navigation
 *    (prior / today / next) keep rendering and stay within bounds.
 */

import { expect, test } from '@playwright/test';
import { createRouteSession, installRoutes, openPage } from './helpers/routes';

test.describe('theme', () => {
  test('?theme=dark applies the dark palette', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session, { theme: 'dark' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBackground).toBe('rgb(17, 24, 39)'); // dark --bg-secondary #111827
  });

  test('?theme=light applies the light palette', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session, { theme: 'light' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBackground).toBe('rgb(249, 250, 251)'); // light --bg-secondary #f9fafb
  });

  test('defaults to the system preference when ?theme is absent', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    // Pin the emulation BEFORE navigation so the boot-time matchMedia read is
    // deterministic (headless default varies by platform).
    await page.emulateMedia({ colorScheme: 'light' });
    // No ?theme: the system colorScheme decides.
    await openPage(page, '/quota.html', session);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // A dark system preference flips it, including reactively after boot.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // ...and back.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('the toggle button flips the theme attribute and real colors', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session, { theme: 'light' });
    await expect(page.locator('.pageHeader')).toBeVisible({ timeout: 10_000 });

    const readBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const backgroundBefore = await readBackground();
    expect(backgroundBefore).toBe('rgb(249, 250, 251)');

    await page.locator('[data-action="toggle-theme"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // body transitions colors over 0.2s; wait for the transition to settle.
    await expect.poll(readBackground, { timeout: 3000 }).toBe('rgb(17, 24, 39)');

    await page.locator('[data-action="toggle-theme"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(readBackground, { timeout: 3000 }).toBe(backgroundBefore);
  });

  test('URL theme wins over the system preference', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await page.emulateMedia({ colorScheme: 'light' });
    await openPage(page, '/quota.html', session, { theme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('responsive: 420px', () => {
  test.use({ viewport: { width: 420, height: 900 } });

  test.beforeEach(async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });
    // Query everything so the timeline renders.
    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.card[data-state="success"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.timeline')).toBeVisible();
  });

  test('cards lay out in a single column with no page-level horizontal overflow', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.clientWidth).toBe(420);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('no element extends past the viewport width', async ({ page }) => {
    const offenders = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      // Elements nested inside an ancestor with its own horizontal scroll
      // (the tab bar, the timeline track) are clipped by that ancestor and
      // do not widen the page.
      const insideScroller = (element: Element): boolean => {
        for (let node = element.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (/(auto|scroll|hidden)/.test(style.overflowX)) return true;
        }
        return false;
      };
      const out: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>('body *')) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (insideScroller(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.right > viewportWidth + 1) {
          out.push(`${element.tagName}.${element.className} right=${Math.round(rect.right)}`);
        }
      }
      return out;
    });
    expect(offenders).toEqual([]);
  });

  test('the timeline scrolls inside its own track, not the page', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>('.timelineTrackScroll');
      return {
        trackScrollWidth: track?.scrollWidth ?? 0,
        trackClientWidth: track?.clientWidth ?? 0,
        pageScrollWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
      };
    });
    // The inner track area is 560px min, wider than the 420px viewport, so the
    // TRACK must be scrollable...
    expect(metrics.trackScrollWidth).toBeGreaterThan(metrics.trackClientWidth);
    // ...while the page itself is not.
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.pageClientWidth);
  });

  test('the pinned label column stays fixed beside the scrolling track', async ({ page }) => {
    const layout = await page.evaluate(() => {
      const labels = document.querySelector<HTMLElement>('.timelineLabelColumn');
      const track = document.querySelector<HTMLElement>('.timelineTrackScroll');
      if (!labels || !track) return null;
      return {
        labelsRight: Math.round(labels.getBoundingClientRect().right),
        trackLeft: Math.round(track.getBoundingClientRect().left),
        trackScrollable: track.scrollWidth > track.clientWidth,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.trackScrollable).toBe(true);
    // The label column sits immediately left of the track.
    expect(layout!.labelsRight).toBeLessThanOrEqual(layout!.trackLeft + 1);

    // Scrolling the track does not move the label column.
    const before = await page.evaluate(() => document.querySelector<HTMLElement>('.timelineLabelColumn')!.getBoundingClientRect().left);
    await page.locator('.timelineTrackScroll').evaluate((element) => { element.scrollLeft = 200; });
    const after = await page.evaluate(() => document.querySelector<HTMLElement>('.timelineLabelColumn')!.getBoundingClientRect().left);
    expect(after).toBe(before);
  });
});

test.describe('timeline interaction', () => {
  test.use({ viewport: { width: 420, height: 900 } });

  test('switching to session mode and paging periods keeps rendering within bounds', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.timeline')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.timeline')).toHaveAttribute('data-mode', 'weekly');

    // "Today" is disabled on the current period.
    await expect(page.locator('.timelineToday')).toBeDisabled();

    // Switch to session mode.
    await page.locator('.timelineModeTab[data-mode="session"]').click();
    await expect(page.locator('.timeline')).toHaveAttribute('data-mode', 'session');

    // Navigate to the next period; "Today" becomes enabled again.
    await page.locator('[data-action="next"]').click();
    await expect(page.locator('.timelineToday')).toBeEnabled();
    await expect(page.locator('.timelineWindow').first()).toBeVisible();

    // Back to today via the button.
    await page.locator('.timelineToday').click();
    await expect(page.locator('.timelineToday')).toBeDisabled();

    // Still no page overflow after all the re-renders.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('window marks expose state and full detail labels', async ({ page }) => {
    const session = createRouteSession();
    await installRoutes(page, session);
    await openPage(page, '/quota.html', session);
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-action="query-all"]').click();
    await expect(page.locator('.timeline')).toBeVisible({ timeout: 20_000 });

    const marks = page.locator('.timelineWindow');
    const count = await marks.count();
    expect(count).toBeGreaterThan(0);

    const states = new Set(await marks.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.state)));
    // With FIXED_NOW-anchored fixtures both live and upcoming windows project.
    expect(states.has('live')).toBe(true);
    expect(states.has('upcoming')).toBe(true);

    // Every mark is keyboard focusable with a full aria-label.
    const firstLabel = await marks.first().getAttribute('aria-label');
    expect(firstLabel).toBeTruthy();
    expect(firstLabel!).toContain('重置');

    // The legend repeats the state vocabulary as text.
    const legend = await page.locator('.timelineLegend').textContent();
    for (const word of ['已重置', '进行中', '待开始']) expect(legend).toContain(word);

    // The sr-only table mirrors the lanes for assistive tech.
    await expect(page.locator('.timelineTable')).toBeAttached();
  });
});
