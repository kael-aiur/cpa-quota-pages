/**
 * Deterministic browser fixtures.
 *
 * Everything the mocked CPA/Sub2API backend returns is derived from this
 * module so the browser tests are reproducible:
 *
 *  - `FIXED_NOW` is the wall-clock instant every assertion is anchored to
 *    (relative reset labels, timeline spans and "session" windows are all
 *    derived from it). Tests freeze the page clock via `page.clock` and
 *    recompute fixture timestamps relative to FIXED_NOW so the data always
 *    projects live/past/upcoming windows regardless of the real run date.
 *  - Account identities are intentionally recognizable secrets (`SECRET_*`)
 *    so the DOM-secrecy spec can assert the user page never leaks them.
 */

/** The frozen "now" every fixture is anchored to. */
export const FIXED_NOW = new Date('2026-08-13T09:30:00Z');

export const SUB2API_TOKEN = 'sub2api-token-e2e-7f3d';

/** Deterministic account identity values that must NEVER reach the user DOM. */
export const FIXTURE_SECRETS = {
  claudeEmail: 'claude-owner@secret-example.test',
  claudeFile: 'claude-main.secret.json',
  codexFile: 'codex-team.secret.json',
  codexEmail: 'codex-team@secret-example.test',
} as const;

export const USER_AUTH_RESPONSE = {
  code: 0,
  message: 'ok',
  data: { id: 42, username: 'e2e-user', status: 'active' },
};

export const ADMIN_AUTH_RESPONSE = {
  code: 0,
  message: 'ok',
  data: { id: 1, username: 'e2e-admin', status: 'active', role: 'admin' },
};

export const INACTIVE_AUTH_RESPONSE = {
  code: 0,
  message: 'ok',
  data: { id: 7, username: 'banned-user', status: 'banned' },
};

function isoFromNow(deltaMs: number): string {
  return new Date(FIXED_NOW.getTime() + deltaMs).toISOString();
}

/** A Claude usage payload whose windows reset at deterministic offsets. */
export function claudeUsage(resetOffsets: { sessionMs: number; weeklyMs: number }) {
  return {
    five_hour: { utilization: 25, resets_at: isoFromNow(resetOffsets.sessionMs) },
    seven_day: { utilization: 40, resets_at: isoFromNow(resetOffsets.weeklyMs) },
  };
}

export const CLAUDE_PROFILE = {
  account: { has_claude_max: false, has_claude_pro: true },
  organization: { organization_type: 'claude_team', subscription_status: 'active' },
};

/** A Codex usage payload (pro plan, session + weekly windows). */
export function codexUsage(resetOffsets: { sessionMs: number; weeklyMs: number }) {
  return {
    plan_type: 'pro',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: isoFromNow(resetOffsets.sessionMs) },
      secondary_window: { used_percent: 55, limit_window_seconds: 604800, reset_at: isoFromNow(resetOffsets.weeklyMs) },
    },
    code_review_rate_limit: {
      allowed: true,
      primary_window: { used_percent: 10, limit_window_seconds: 2592000, reset_at: isoFromNow(30 * 24 * 3600_000) },
    },
  };
}

export const CODEX_RESET_CREDITS = {
  available_count: 2,
  applicable_available_count: 2,
  credits: [
    { id: 'credit-live-1', reset_type: 'codex_rate_limits', status: 'available', granted_at: isoFromNow(-24 * 3600_000), expires_at: isoFromNow(36 * 3600_000) },
  ],
};

export const CODEX_CONSUME_RESPONSE = {
  redeemed: true,
  credit_id: 'credit-live-1',
  redeem_request_id: 'deterministic-redeem-id',
};

/** Antigravity quota summary with a live weekly bucket. */
export const ANTIGRAVITY_SUMMARY = {
  groups: [
    {
      displayName: 'Agent Models',
      buckets: [
        { displayName: 'Weekly', window: 'weekly', remaining_fraction: 0.62, reset_time: isoFromNow(4 * 24 * 3600_000) },
        { displayName: 'Five Hour', window: '5h', remainingFraction: 0.9, resetTime: isoFromNow(2 * 3600_000) },
      ],
    },
  ],
};

/** xAI credits-format billing summary (weekly period). */
export const XAI_WEEKLY_BILLING = {
  config: {
    currentPeriod: { type: 'weekly', start: isoFromNow(-3 * 24 * 3600_000), end: isoFromNow(4 * 24 * 3600_000) },
    creditUsagePercent: 25,
    productUsage: [{ product: 'Grok', usagePercent: 20 }],
  },
};

/** Kimi usages payload (session + daily windows). */
export function kimiUsage(resetOffsets: { sessionMs: number; dailyMs: number }) {
  return {
    limits: [
      {
        detail: { limit: '100', remaining: '98', resetTime: isoFromNow(resetOffsets.sessionMs) },
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      },
      {
        name: 'Daily Coding',
        detail: { used: 25, limit: 100, reset_in: 86400 },
        window: { duration: '1', timeUnit: 'TIME_UNIT_DAY' },
      },
    ],
    usage: { used: 100, limit: 1000, resetTime: isoFromNow(resetOffsets.dailyMs) },
  };
}

export interface FixtureAccount {
  name: string;
  provider: string;
  authIndex: number;
  email?: string;
  projectId?: string;
  /** Deterministic reset offsets, only used by the per-URL mock builder. */
  resets?: { sessionMs?: number; weeklyMs?: number; dailyMs?: number };
}

/** The canonical small account set (one per provider, secrets included). */
export const CANONICAL_ACCOUNTS: FixtureAccount[] = [
  { name: FIXTURE_SECRETS.claudeFile, provider: 'claude', authIndex: 0, email: FIXTURE_SECRETS.claudeEmail, resets: { sessionMs: 2 * 3600_000, weeklyMs: 4 * 24 * 3600_000 } },
  { name: 'antigravity-main.json', provider: 'antigravity', authIndex: 1, projectId: 'ag-project-77' },
  { name: FIXTURE_SECRETS.codexFile, provider: 'codex', authIndex: 2, email: FIXTURE_SECRETS.codexEmail, resets: { sessionMs: 3 * 3600_000, weeklyMs: 5 * 24 * 3600_000 } },
  { name: 'xai-weekly.json', provider: 'x-ai', authIndex: 3 },
  { name: 'kimi-pro.json', provider: 'kimi', authIndex: 4, resets: { sessionMs: 45 * 60_000, dailyMs: 6 * 24 * 3600_000 } },
];

/** A disabled account that must never appear as a card. */
export const DISABLED_ACCOUNT: FixtureAccount = { name: 'disabled-account.json', provider: 'claude', authIndex: 99 };

/**
 * Build an auth-files list with N claude accounts (deterministic names), used
 * for the pagination/tabs/sort specs (21+ accounts → 2+ pages).
 *
 * Session-reset offsets deliberately do NOT follow name order (they zig-zag),
 * so "soonest" sorting is observable: alphabetical order and reset order are
 * different permutations of the same accounts.
 */
export function manyClaudeAccounts(count: number): FixtureAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `claude-bulk-${String(index).padStart(2, '0')}.json`,
    provider: 'claude',
    authIndex: index,
    email: `bulk${index}@secret-example.test`,
    resets: {
      // Zig-zag: even indices reset late, odd indices early.
      sessionMs: index % 2 === 0 ? (count - index) * 3600_000 : (index + 1) * 3600_000,
      weeklyMs: (index + 1) * 24 * 3600_000,
    },
  }));
}

export function authFilesPayload(accounts: FixtureAccount[], extras: FixtureAccount[] = []) {
  return {
    files: [...accounts, ...extras]
      .filter((account) => account !== DISABLED_ACCOUNT)
      .map((account) => ({
        name: account.name,
        provider: account.provider,
        auth_index: account.authIndex,
        disabled: account === DISABLED_ACCOUNT,
        ...(account.email !== undefined ? { email: account.email } : {}),
        ...(account.projectId !== undefined ? { project_id: account.projectId } : {}),
        updated_at: isoFromNow(-3600_000),
      })),
  };
}

export function disabledAuthFilesPayload(): { files: unknown[] } {
  return { files: [{ name: DISABLED_ACCOUNT.name, provider: DISABLED_ACCOUNT.provider, auth_index: DISABLED_ACCOUNT.authIndex, disabled: true }] };
}
