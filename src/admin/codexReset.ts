/**
 * Admin-only Codex reset-credit consume capability.
 *
 * The consume endpoint string is deliberately confined to this module — the
 * read-only provider registry (`src/providers/**`) must never reference it, so
 * the admin write path cannot be reached through the user-facing query flow.
 */

import { CpaApiError, extractApiError } from '../api/errors';
import type { ApiCallResult, AuthFile } from '../api/types';
import type { ProviderQueryContext } from '../providers/types';
import { queryCodexQuota } from '../providers/codex/adapter';
import { getCodexAccountId } from '../providers/codex/parser';
import type { CodexQuotaData } from '../providers/codex/parser';

/**
 * The reset-credit consume endpoint. This constant is the single source of the
 * `/rate-limit-reset-credits/consume` path in the codebase; it intentionally
 * lives here rather than in the provider registry so the user-facing read path
 * cannot construct this URL.
 */
export const CODEX_RESET_CONSUME_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

export const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.1.0',
};

export type CodexResetCapability = (file: AuthFile, context: ProviderQueryContext) => Promise<CodexQuotaData>;

function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function authIndex(file: AuthFile): string {
  const value = file.authIndex ?? file.auth_index;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Codex auth file is missing auth index');
}

/**
 * Stable per-account lock key. Account id is preferred; the auth index (and
 * finally the file name) ensure every auth file maps to a deterministic key
 * even when the JWT/claim-derived account id is unavailable.
 */
function lockKey(file: AuthFile): string {
  const account = getCodexAccountId(file);
  if (account) return `acct:${account}`;
  return `idx:${authIndex(file)}:${file.name}`;
}

function statusError(result: ApiCallResult): CpaApiError {
  return new CpaApiError(extractApiError(result), {
    statusCode: result.statusCode,
    result,
  });
}

const activeResets = new Set<string>();

/**
 * Consume a Codex rate-limit reset credit for the given auth file, then perform
 * a full read-only `queryCodexQuota` re-query and return the refreshed data.
 *
 * Safety contracts:
 * - The consume POST body is `{"redeem_request_id":"<uuid>"}` with a freshly
 *   minted `crypto.randomUUID()` on every call.
 * - Any non-2xx consume response is unified into a `CpaApiError` and the
 *   re-query is skipped.
 * - A per-account lock prevents two concurrent resets for the same account;
 *   the second caller receives an `Error`. The lock is always released in the
 *   finally block, so failures leave the account available for retry.
 */
export const consumeCodexResetCredit: CodexResetCapability = async (file, context) => {
  const key = lockKey(file);
  if (activeResets.has(key)) {
    throw new Error('Codex 重置额度正在进行中，请稍后再试');
  }
  activeResets.add(key);
  try {
    const index = authIndex(file);
    const account = getCodexAccountId(file);
    const header = account
      ? { ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': account }
      : { ...CODEX_REQUEST_HEADERS };
    const body = JSON.stringify({ redeem_request_id: crypto.randomUUID() });
    const consume = await context.apiCall({
      authIndex: index,
      method: 'POST',
      url: CODEX_RESET_CONSUME_URL,
      header,
      data: body,
    }, { signal: context.signal, timeoutMs: context.timeoutMs });
    if (!isSuccess(consume.statusCode)) throw statusError(consume);

    // Hold the lock across the read-only re-query so the full reset operation
    // (consume + refresh) is atomic per account.
    return await queryCodexQuota(file, context);
  } finally {
    activeResets.delete(key);
  }
};
