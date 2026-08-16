/**
 * Same-origin route mocks for the browser suite.
 *
 * ONLY `/api/v1/*` (Sub2API identity) and `/cpa/*` (CPA management proxy)
 * are fulfilled here — those are the only paths the shipped artifacts are
 * allowed to call. Every other request is left untouched so the
 * network-security spec can observe and reject any attempt to reach an
 * external (provider) origin.
 *
 * The `/cpa/v0/management/api-call` mock is a tiny CPA wrapper emulation:
 * it inspects the JSON body, dispatches on the provider URL it carries, and
 * returns the `{status_code, header, body}` envelope the real proxy emits.
 */

import type { Page, Route } from '@playwright/test';
import {
  ADMIN_AUTH_RESPONSE,
  ANTIGRAVITY_SUMMARY,
  CANONICAL_ACCOUNTS,
  CLAUDE_PROFILE,
  CODEX_CONSUME_RESPONSE,
  CODEX_RESET_CREDITS,
  FIXED_NOW,
  claudeUsage,
  codexUsage,
  kimiUsage,
  type FixtureAccount,
  SUB2API_TOKEN,
  USER_AUTH_RESPONSE,
} from './fixtures';

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_CONSUME_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const ANTIGRAVITY_QUOTA_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';
const ANTIGRAVITY_CODE_ASSIST_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const XAI_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const XAI_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

export interface CapturedApiCall {
  authIndex: string;
  method: string;
  url: string;
  header: Record<string, string>;
  data?: string;
}

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
}

export interface RouteSession {
  /** Every `/cpa/v0/management/api-call` JSON body, in arrival order. */
  apiCalls: CapturedApiCall[];
  /** Every request the page issued (any method, any path). */
  requests: CapturedRequest[];
  /** Auth files served for `/cpa/v0/management/auth-files`. */
  accounts: FixtureAccount[];
  /** Toggle per-account provider failures: account name -> HTTP status. */
  failures: Map<string, number>;
  /** Toggle admin reset-credit consume failures. */
  consumeFailStatus: number | null;
  /** Allow-listed Sub2API bearer tokens; anything else → 401. */
  validTokens: Set<string>;
  /** When true, `/auth/me` reports a non-active user. */
  authInactive: boolean;
  /** When true, `/auth/me` answers as the admin user. */
  authAdmin: boolean;
  /**
   * Escape hatch for specs that need to intercept one specific api-call
   * (e.g. hold the consume POST open). When set, this handler receives the
   * route INSTEAD of the default api-call dispatch.
   */
  apiHandler?: (route: Route, capture: CapturedApiCall) => Promise<void>;
}

export interface RouteOptions {
  accounts?: FixtureAccount[];
  token?: string;
  authAdmin?: boolean;
  authInactive?: boolean;
}

export function createRouteSession(options: RouteOptions = {}): RouteSession {
  return {
    apiCalls: [],
    requests: [],
    accounts: options.accounts ?? [...CANONICAL_ACCOUNTS],
    failures: new Map(),
    consumeFailStatus: null,
    validTokens: new Set([options.token ?? SUB2API_TOKEN]),
    authInactive: options.authInactive ?? false,
    authAdmin: options.authAdmin ?? false,
  };
}

function claudeBodyFor(account: FixtureAccount): unknown {
  const resets = account.resets ?? {};
  return claudeUsage({ sessionMs: resets.sessionMs ?? 2 * 3600_000, weeklyMs: resets.weeklyMs ?? 4 * 24 * 3600_000 });
}

function codexBodyFor(account: FixtureAccount): unknown {
  const resets = account.resets ?? {};
  return codexUsage({ sessionMs: resets.sessionMs ?? 3 * 3600_000, weeklyMs: resets.weeklyMs ?? 5 * 24 * 3600_000 });
}

function kimiBodyFor(account: FixtureAccount): unknown {
  const resets = account.resets ?? {};
  return kimiUsage({ sessionMs: resets.sessionMs ?? 45 * 60_000, dailyMs: resets.dailyMs ?? resets.weeklyMs ?? 6 * 24 * 3600_000 });
}

/** xAI weekly billing summary; `weeklyMs` overrides the default reset offset. */
function xaiWeeklyFor(account: FixtureAccount | undefined): unknown {
  const weeklyMs = account?.resets?.weeklyMs ?? 4 * 24 * 3600_000;
  return {
    config: {
      currentPeriod: {
        type: 'weekly',
        start: new Date(FIXED_NOW.getTime() - 3 * 24 * 3600_000).toISOString(),
        end: new Date(FIXED_NOW.getTime() + weeklyMs).toISOString(),
      },
      creditUsagePercent: 25,
      productUsage: [{ product: 'Grok', usagePercent: 20 }],
    },
  };
}

/** Serve the provider payload for an api-call body; null = unmapped URL. */
function providerPayloadFor(capture: CapturedApiCall, session: RouteSession): { status: number; body: unknown } | null {
  const account = session.accounts.find((candidate) => String(candidate.authIndex) === capture.authIndex);

  switch (capture.url) {
    case CLAUDE_USAGE_URL:
      if (account && session.failures.has(account.name)) return { status: session.failures.get(account.name)!, body: { error: 'upstream failure' } };
      return { status: 200, body: account ? claudeBodyFor(account) : claudeBodyFor(CANONICAL_ACCOUNTS[0]) };
    case CLAUDE_PROFILE_URL:
      return { status: 200, body: CLAUDE_PROFILE };
    case CODEX_USAGE_URL:
      if (account && session.failures.has(account.name)) return { status: session.failures.get(account.name)!, body: { error: 'upstream failure' } };
      return { status: 200, body: account ? codexBodyFor(account) : codexUsage({ sessionMs: 3 * 3600_000, weeklyMs: 5 * 24 * 3600_000 }) };
    case CODEX_CREDITS_URL:
      return { status: 200, body: CODEX_RESET_CREDITS };
    case CODEX_CONSUME_URL:
      if (session.consumeFailStatus !== null) return { status: session.consumeFailStatus, body: { error: 'consume rejected' } };
      return { status: 200, body: CODEX_CONSUME_RESPONSE };
    case ANTIGRAVITY_QUOTA_URL:
      if (account && session.failures.has(account.name)) return { status: session.failures.get(account.name)!, body: { error: 'upstream failure' } };
      return { status: 200, body: ANTIGRAVITY_SUMMARY };
    case ANTIGRAVITY_CODE_ASSIST_URL:
      return { status: 200, body: { currentTier: 'tier_standard', tierId: 'tier_standard', cloudaicompanionProject: 'ag-project-77' } };
    case XAI_WEEKLY_URL:
      if (account && session.failures.has(account.name)) return { status: session.failures.get(account.name)!, body: { error: 'upstream failure' } };
      return { status: 200, body: xaiWeeklyFor(account) };
    case XAI_MONTHLY_URL:
      return { status: 200, body: { config: { currentPeriod: { type: 'monthly', start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' }, creditUsagePercent: 10 } } };
    case KIMI_USAGE_URL:
      if (account && session.failures.has(account.name)) return { status: session.failures.get(account.name)!, body: { error: 'upstream failure' } };
      return { status: 200, body: account ? kimiBodyFor(account) : kimiUsage({ sessionMs: 45 * 60_000, dailyMs: 6 * 24 * 3600_000 }) };
    default:
      return null;
  }
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });
}

/** Install every same-origin mock route on a page. */
export async function installRoutes(page: Page, session: RouteSession): Promise<void> {
  page.on('request', (request) => {
    session.requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
    });
  });

  // --- Sub2API identity (single dispatching handler) ------------------------
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/v1/auth/me') {
      await fulfillJson(route, 404, { error: `unexpected sub2api path: ${url.pathname}` });
      return;
    }
    const authorization = route.request().headers()['authorization'] ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!session.validTokens.has(token)) {
      await fulfillJson(route, 401, { code: 401, message: 'invalid token', data: null });
      return;
    }
    if (session.authInactive) {
      await fulfillJson(route, 200, { code: 0, message: 'ok', data: { id: 7, username: 'banned', status: 'banned' } });
      return;
    }
    await fulfillJson(route, 200, session.authAdmin ? ADMIN_AUTH_RESPONSE : USER_AUTH_RESPONSE);
  });

  // --- CPA management proxy (single dispatching handler) --------------------
  // One `**/cpa/**` handler dispatches internally: Playwright consults the
  // most recently registered handler first, so registering a catch-all AFTER
  // specific routes would shadow them.
  await page.route('**/cpa/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers()['authorization'] ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();

    if (url.pathname === '/cpa/v0/management/auth-files') {
      if (!session.validTokens.has(token)) {
        await fulfillJson(route, 401, { code: 401, message: 'unauthorized', data: null });
        return;
      }
      await fulfillJson(route, 200, {
        files: session.accounts.map((account) => ({
          name: account.name,
          provider: account.provider,
          auth_index: account.authIndex,
          disabled: false,
          ...(account.email !== undefined ? { email: account.email } : {}),
          ...(account.projectId !== undefined ? { project_id: account.projectId } : {}),
        })),
      });
      return;
    }

    if (url.pathname === '/cpa/v0/management/api-call') {
      const postData = request.postData() ?? '';
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(postData) as Record<string, unknown>;
      } catch {
        await fulfillJson(route, 400, { error: 'bad json' });
        return;
      }
      const capture: CapturedApiCall = {
        authIndex: String(parsed.authIndex ?? parsed.auth_index ?? ''),
        method: String(parsed.method ?? 'GET'),
        url: String(parsed.url ?? ''),
        header: (parsed.header ?? {}) as Record<string, string>,
        data: typeof parsed.data === 'string' ? parsed.data : parsed.data === undefined ? undefined : JSON.stringify(parsed.data),
      };
      session.apiCalls.push(capture);

      if (session.apiHandler) {
        await session.apiHandler(route, capture);
        return;
      }

      const served = providerPayloadFor(capture, session);
      if (!served) {
        await fulfillJson(route, 200, { status_code: 404, header: {}, body: 'no fixture for url' });
        return;
      }
      await fulfillJson(route, 200, { status_code: served.status, header: {}, body: served.body });
      return;
    }

    if (url.pathname.startsWith('/cpa/v0/management/auth-files/download')) {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '{}' });
      return;
    }

    await fulfillJson(route, 500, { error: `unexpected cpa path: ${url.pathname}` });
  });
}

/**
 * Navigate to a page with `?token=…&theme=…` and a frozen clock.
 *
 * The session argument is accepted (not read) so every spec reads uniformly:
 * `openPage(page, path, session, …)` right after `installRoutes(page, session)`.
 */
export async function openPage(
  page: Page,
  path: string,
  _session: RouteSession,
  options: { token?: string; theme?: 'light' | 'dark' } = {},
): Promise<void> {
  // `install` (unlike `pauseAt`) accepts a time in the past, so FIXED_NOW can
  // stay a fixed calendar instant regardless of when the suite runs.
  await page.clock.install({ time: FIXED_NOW });
  const params = new URLSearchParams();
  params.set('token', options.token ?? SUB2API_TOKEN);
  if (options.theme) params.set('theme', options.theme);
  await page.goto(`${path}?${params.toString()}`);
}

/** Wait until the app has finished bootstrapping and rendered cards. */
export async function waitForCards(page: Page, options: { timeout?: number } = {}): Promise<number> {
  await page.waitForSelector('.card', { timeout: options.timeout ?? 10_000 });
  return page.locator('.card').count();
}

/** Wait until the authenticated shell is visible. */
export async function waitForAuthenticated(page: Page, options: { timeout?: number } = {}): Promise<void> {
  await page.waitForSelector('.pageHeader', { timeout: options.timeout ?? 10_000 });
}
