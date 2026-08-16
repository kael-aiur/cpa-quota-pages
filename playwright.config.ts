import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against the BUILT single-file artifacts in `dist/`
 * (never the dev server): the whole point is to exercise the bytes that
 * actually ship, including the build-generated CSP script hash.
 *
 * `vite preview` serves the directory; every same-origin `/api/v1/*` and
 * `/cpa/*` route is fulfilled by Playwright route mocks in
 * `tests/browser/helpers/routes.ts`. No request ever leaves the origin.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npx vite preview --mode user --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/quota.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  outputDir: 'test-results',
});
