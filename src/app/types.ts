/**
 * Application composition contracts shared by the orchestration root
 * (`createQuotaApp`) and the two entry points (`src/entries/*`).
 *
 * The reset capability is declared HERE — as a plain function type — rather
 * than imported from `src/admin/codexReset.ts`, so the user-facing entry can
 * depend on this module without ever pulling the admin write path (or the
 * consume endpoint string) into its dependency graph. Only the admin entry
 * imports the concrete `consumeCodexResetCredit` value.
 */

import type { AuthFile } from '../api/types';
import type { AuthenticatedSession } from '../auth/types';
import type { CpaApi } from '../api/types';
import type { ProviderQueryContext } from '../providers/types';
import type { Provider, ProviderQuery } from '../providers/types';
import type { CodexQuotaData } from '../providers/codex/parser';
import type { QuotaStore, AppState } from './state';
import type { AccountEntry } from '../quota/types';
import type { MinuteClock } from '../quota/minuteClock';

/** Admin-only Codex reset-credit consume capability (admin entry injects the concrete impl). */
export type CodexResetCapability = (file: AuthFile, context: ProviderQueryContext) => Promise<CodexQuotaData>;

/**
 * Everything the admin-only reset flow needs from a running app instance.
 * Built by the app root when a reset is requested and handed to the
 * admin-supplied `onResetRequest` handler, which owns the confirm dialog,
 * the consume call, and result publishing.
 */
export interface QuotaResetBridge {
  /** The account entry the reset applies to. */
  account: AccountEntry;
  /** Query context (api primitives + abort signal + timeout) for the consume call. */
  context: ProviderQueryContext;
  /** Publish the consume outcome onto the account's card. */
  publish(result: { status: 'success'; data: CodexQuotaData } | { status: 'error'; error: unknown }): void;
}

/**
 * Options for {@link createQuotaApp}. The first four fields are the public
 * contract; the remaining optional fields form the dependency-injection surface
 * used by tests and by non-browser host environments. The browser entries pass
 * only the public fields and let every injected dependency default to the real
 * browser primitive.
 */
export interface QuotaAppOptions {
  root: HTMLElement;
  mode: 'user' | 'admin';
  revealAccountIdentity: boolean;
  /**
   * Admin-only reset flow handler. When the reset button is clicked the app
   * root resolves a {@link QuotaResetBridge} and hands it to this handler,
   * which owns the confirm dialog and the consume call (closing over the
   * concrete `consumeCodexResetCredit` capability). Provided by the admin
   * entry (`src/admin/resetFlow`); its absence disables the reset UI. The
   * shared app root never touches the capability itself, so no admin
   * write-path symbol can reach the user-facing bundle.
   */
  onResetRequest?: (bridge: QuotaResetBridge) => void;
  /**
   * Reset button label, owned by the admin flow (see
   * {@link RESET_BUTTON_LABEL} in `src/admin/resetFlow`). Keeping the copy out
   * of the shared modules is what leaves zero reset-related strings in the
   * user bundle. Defaults to a neutral 重置 when only the handler is injected
   * (unit tests); the admin entry always passes the real label.
   */
  resetButtonLabel?: string;

  /** Override the page URL used for bootstrap (defaults to the current location). */
  url?: URL;
  /** Override the History used to strip the token (defaults to window.history). */
  history?: History;
  /** Override the Document used for theme + visibility (defaults to window.document). */
  document?: Document;
  /** Override the underlying network primitive observed by bootstrap + authenticated fetch. */
  fetchImpl?: typeof fetch;
  /** Override the theme media query (defaults to prefers-color-scheme). */
  media?: MediaQueryList;
  /** Override the clock used for relative-time refresh. */
  clock?: MinuteClock;
  /** Inject a pre-built session to skip bootstrap entirely (unit tests). */
  session?: AuthenticatedSession;
  /** Inject a pre-built CPA api to bypass `createCpaApi(session.request)` (unit tests). */
  api?: CpaApi;
  /** Inject a pre-built store (advanced; defaults to a fresh `createQuotaStore`). */
  store?: QuotaStore;
  /** Override the per-provider query registry (unit tests inject deterministic queries). */
  providerQueries?: Partial<Record<Provider, ProviderQuery>>;
  /** Page size for the account grid and the max batch size (default 20). */
  pageSize?: number;
  /** Per-request timeout forwarded to provider queries and the reset capability. */
  timeoutMs?: number;
  /** Header title override. */
  title?: string;
  /** Header description override. */
  description?: string;
}

export interface QuotaAppController {
  /** Bootstrap (unless a session was injected), validate auth, then load auth-files. Performs NO quota query. */
  start(): Promise<void>;
  /** Idempotent teardown: clock, in-flight work, listeners, theme, session and DOM. */
  destroy(): void;
  /** The latest store snapshot. */
  getState(): Readonly<AppState>;
}
