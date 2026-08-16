# CPA Quota Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建两个可由 Nginx 从 GitHub 固定 tag 获取、供 Sub2API iframe 内嵌的自包含额度页面，完整支持五个 Provider、恢复时间线、普通用户视觉脱敏和管理员 Codex reset。

**Architecture:** 使用 Vanilla TypeScript、原生 DOM 与 `fetch`，以两个静态入口共享认证、CPA API、Provider adapter、状态和 UI 模块。Vite 分别构建 user/admin 单入口，`vite-plugin-singlefile` 内联全部资源，构建插件为最终脚本生成 CSP hash；普通页依赖图不得包含管理员写操作。

**Tech Stack:** Node.js、npm、TypeScript 6、Vite 8、`vite-plugin-singlefile`、Vitest、jsdom、Playwright、原生 CSS。

## Global Constraints

- 独立仓库路径固定为 `/Users/kael/workspace/github/kael-aiur/cpa-quota-pages`。
- 设计规格固定为 `docs/superpowers/specs/2026-08-12-cpa-quota-pages-design.md`。
- 最终产物固定为 `dist/quota.html` 与 `dist/quota-admin.html`。
- 不使用 React、React Router、Zustand、Axios、i18next、外部字体、CDN 或浏览器直连 Provider。
- 浏览器业务请求只允许同源 `/api/v1/` 和 `/cpa/`。
- Sub2API token 只保存在闭包内存中，读取后从 URL 移除，不写入 Cookie、DOM 或 Web Storage。
- 初次加载只获取认证文件，不自动查询额度。
- Provider 固定为 Claude、Antigravity、Codex、xAI、Kimi，默认顺序保持一致。
- Provider tab 和排序可写入 `sessionStorage`；token、quota、auth file 与 authIndex 不得写入。
- 每页固定 20 个账号；“查询全部”仅查询当前页。
- 普通页不得打包 Codex consume endpoint 或 `src/admin/` 模块。
- `dist/` 必须提交；CI 必须重建并检查工作树无差异。
- Nginx `/cpa/` 仅移除 `/cpa/` 前缀；浏览器已有 `/v0/management/`，不得重复添加。
- 构建信息中的 commit 表示“用于此次构建的源码 revision”，不是包含该产物的最终提交 SHA。
- 每个任务必须先写失败测试、确认失败、实现最小代码、确认通过，再提交。
- 所有提交消息结尾追加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## File Responsibility Map

### Project and build

- `package.json`：脚本、Node engine 与开发依赖。
- `package-lock.json`：锁定完整依赖树。
- `tsconfig.json`：严格 TypeScript 配置。
- `vite.config.ts`：按 mode 选择单 HTML 输入和固定输出名。
- `vitest.config.ts`：jsdom、setup 和测试匹配规则。
- `playwright.config.ts`：对 `dist` 产物运行 Chromium 集成测试。
- `build/buildInfo.ts`：读取 package version 与源码 revision。
- `build/cspHashPlugin.ts`：single-file 后生成 CSP hash并验证产物合同。
- `scripts/clean.mjs`：完整构建前只清理生成产物。
- `templates/quota.html`：普通页模板和 user 入口。
- `templates/quota-admin.html`：管理员模板和 admin 入口。

### Authentication and CPA API

- `src/auth/types.ts`：Sub2API 用户、session、authenticated fetch 类型。
- `src/auth/bootstrap.ts`：读取/清理 URL token、调用 `/auth/me`、建立内存 session。
- `src/auth/authenticatedFetch.ts`：同源与路径 allowlist、Bearer、超时和全局失效。
- `src/api/types.ts`：AuthFile、CPA api-call、CpaApi 类型。
- `src/api/errors.ts`：统一错误对象与消息提取。
- `src/api/apiCall.ts`：`POST /cpa/v0/management/api-call`。
- `src/api/authFiles.ts`：list、download、去重、合并与排序。

### Quota domain and providers

- `src/quota/types.ts`：标准化 Provider quota、四态、时间线类型。
- `src/quota/logic.ts`：Provider 归一化、过滤、分类、排序和分页。
- `src/quota/identity.ts`：稳定匿名标识与账号 view model。
- `src/quota/uiPreferences.ts`：只保存 provider/sortMode。
- `src/quota/resetSchedule.ts`：最早恢复与一小时强调。
- `src/quota/relativeTime.ts`：绝对/相对时间格式化。
- `src/quota/timelineModel.ts`：Weekly/Session 纯时间线模型。
- `src/quota/minuteClock.ts`：共享分钟时钟。
- `src/providers/types.ts`：adapter contract 与 query context。
- `src/providers/shared.ts`：Provider 共用字段、时间和 token 解析器。
- `src/providers/index.ts`：五个只读 adapter registry；不得导入 `src/admin/`。
- `src/providers/<provider>/adapter.ts`：构造 CPA api-call 并处理回退。
- `src/providers/<provider>/parser.ts`：纯响应解析与标准化。

### App and UI

- `src/app/types.ts`：应用 option/controller/capability 类型。
- `src/app/state.ts`：内存 store、generation 与 cache pruning。
- `src/app/lifecycle.ts`：AbortController、listener 与 destroy。
- `src/app/actions.ts`：单卡、batch、列表刷新和 reset 调度。
- `src/app/createQuotaApp.ts`：组合所有模块。
- `src/admin/codexReset.ts`：管理员唯一 consume 实现。
- `src/ui/dom.ts`：只用 `textContent`/`createTextNode` 的 DOM helpers。
- `src/ui/icons.ts`：内联 SVG。
- `src/ui/theme.ts`：URL theme 和系统主题。
- `src/ui/renderApp.ts`：认证态与主内容顶层渲染。
- `src/ui/renderHeader.ts`：统计和页头操作。
- `src/ui/renderTabs.ts`：tabs、排序和分页。
- `src/ui/renderCard.ts`：账号卡片四态与操作。
- `src/ui/renderProviderBody.ts`：Provider body dispatch。
- `src/ui/providerBodies/*.ts`：五类标准化数据的 DOM 展示。
- `src/ui/renderTimeline.ts`：时间线 DOM 与无障碍等价视图。
- `src/ui/confirmDialog.ts`：管理员确认对话框与焦点管理。
- `src/styles/*.css`：主题 token、布局、卡片和时间线。
- `src/entries/user.ts`：普通页入口，不导入 admin。
- `src/entries/admin.ts`：管理员入口，唯一导入 reset capability。

### Verification and deployment

- `tests/fixtures/`：脱敏的固定 CPA/Provider 响应。
- `tests/**/*.test.ts`：Vitest 单元和 DOM 测试。
- `tests/browser/**/*.spec.ts`：最终 HTML 浏览器测试。
- `tests/release/repositoryContract.test.ts`：CI、Nginx、README 和产物合同。
- `.github/workflows/ci.yml`：PR/main 全量验证。
- `nginx/example.conf`：GitHub HTML、token query 清理、auth_request 与 CPA 转发。
- `README.md`：开发、发布、Nginx、回滚及已接受风险。

---

### Task 1: Bootstrap the dual-entry project and test harness

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `templates/quota.html`
- Create: `templates/quota-admin.html`
- Create: `src/entries/user.ts`
- Create: `src/entries/admin.ts`
- Create: `scripts/clean.mjs`
- Test: `tests/build/projectConfig.test.ts`

**Interfaces:**
- Produces: `BuildMode = 'user' | 'admin'` and deterministic mode-to-template/output mapping.
- Produces: two minimal entry modules that only mount a temporary `<p>` into `#app`; real application wiring is introduced in Task 15.

- [ ] **Step 1: Initialize npm metadata and install the exact baseline toolchain**

Run:

```bash
cd /Users/kael/workspace/github/kael-aiur/cpa-quota-pages
npm init -y
npm install -D typescript@6.0.3 vite@8.1.4 vite-plugin-singlefile@2.3.3 vitest jsdom @playwright/test
```

Then set `package.json` to:

```json
{
  "name": "cpa-quota-pages",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.19.0" },
  "scripts": {
    "dev:user": "vite --mode user",
    "dev:admin": "vite --mode admin",
    "clean": "node scripts/clean.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "build:user": "vite build --mode user",
    "build:admin": "vite build --mode admin",
    "build": "npm run clean && npm run build:user && npm run build:admin",
    "check:dist": "npm run build && git diff --exit-code -- dist"
  }
}
```

- [ ] **Step 2: Write the failing project configuration test**

```ts
// tests/build/projectConfig.test.ts
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { resolveBuildTarget } from '../../vite.config';

describe('project contract', () => {
  it('maps each mode to one fixed self-contained output', () => {
    expect(resolveBuildTarget('user')).toEqual({
      input: 'templates/quota.html',
      fileName: 'quota.html',
    });
    expect(resolveBuildTarget('admin')).toEqual({
      input: 'templates/quota-admin.html',
      fileName: 'quota-admin.html',
    });
  });

  it('does not install forbidden UI/runtime dependencies', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ['react', 'react-router-dom', 'zustand', 'axios', 'i18next']) {
      expect(all).not.toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 3: Run the test and verify failure**

Run: `npm test -- tests/build/projectConfig.test.ts`  
Expected: FAIL because `vite.config.ts` and `resolveBuildTarget()` do not exist.

- [ ] **Step 4: Add strict TypeScript, two templates, clean script and minimal entries**

Implement:

```ts
// vite.config.ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export type BuildMode = 'user' | 'admin';

export function resolveBuildTarget(mode: string) {
  if (mode === 'user') return { input: 'templates/quota.html', fileName: 'quota.html' };
  if (mode === 'admin') return { input: 'templates/quota-admin.html', fileName: 'quota-admin.html' };
  throw new Error(`Unsupported build mode: ${mode}`);
}

export default defineConfig(({ mode }) => {
  const target = resolveBuildTarget(mode);
  const root = resolve(process.cwd(), 'templates');
  return {
    root,
    plugins: [viteSingleFile()],
    build: {
      outDir: resolve(process.cwd(), 'dist'),
      emptyOutDir: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(process.cwd(), target.input),
        output: { inlineDynamicImports: true },
      },
    },
  };
});
```

Use this strict compiler baseline:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  },
  "include": ["src", "build", "tests", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`templates/quota.html` loads `../src/entries/user.ts`; admin template loads `../src/entries/admin.ts`. Both include `<meta name="referrer" content="no-referrer">` and `<div id="app"></div>`. Each temporary entry obtains `#app`, throws if it is absent, creates one `<p>` with `textContent` set to its page mode, and appends it so the baseline build has executable content without introducing later application interfaces.

- [ ] **Step 5: Verify baseline**

Run:

```bash
npm test -- tests/build/projectConfig.test.ts
npm run typecheck
npm run build
```

Expected: tests PASS; typecheck PASS; `dist/` contains two HTML files.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts templates src/entries scripts tests/build/projectConfig.test.ts
git commit -m $'chore: bootstrap dual-entry quota pages\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 2: Implement in-memory Sub2API authentication

**Files:**
- Create: `src/auth/types.ts`
- Create: `src/auth/bootstrap.ts`
- Create: `src/auth/authenticatedFetch.ts`
- Create: `tests/auth/bootstrap.test.ts`
- Create: `tests/auth/authenticatedFetch.test.ts`
- Create: `tests/setup.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

```ts
export type AuthenticatedFetch = (
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

export interface AuthenticatedSession {
  user: Sub2ApiUser;
  request: AuthenticatedFetch;
  signal: AbortSignal;
  invalidate(reason: string): void;
  destroy(): void;
}

export function bootstrapSub2ApiAuth(options: {
  url: URL;
  history: History;
  fetchImpl?: typeof fetch;
  onInvalidated?: (reason: string) => void;
}): Promise<AuthenticatedSession>;
```

- [ ] **Step 1: Write failing bootstrap tests**

```ts
it('removes token before validating and preserves theme', async () => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async () => {
    calls.push(location.href);
    return new Response(JSON.stringify({ code: 0, data: { id: 7, status: 'active' } }));
  });
  history.replaceState(null, '', '/quota.html?token=secret&theme=dark');

  const session = await bootstrapSub2ApiAuth({ url: new URL(location.href), history, fetchImpl });

  expect(location.search).toBe('?theme=dark');
  expect(calls[0]).not.toContain('secret');
  expect(session.user.id).toBe(7);
  expect(fetchImpl).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({
    cache: 'no-store',
    credentials: 'same-origin',
    headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
  }));
});
```

Also add tests for missing token, 401, 403, non-zero business code, inactive user and no storage writes.

- [ ] **Step 2: Run bootstrap tests and verify failure**

Run: `npm test -- tests/auth/bootstrap.test.ts`  
Expected: FAIL because auth modules do not exist.

- [ ] **Step 3: Implement token cleanup and `/auth/me` validation**

Use a closure-scoped token. Call `history.replaceState()` before invoking `fetchImpl`. Accept only HTTP 2xx, business code `0`, non-null data and absent/active status.

- [ ] **Step 4: Write failing authenticated fetch tests**

```ts
it('rejects non-same-origin and non-allowed paths before fetch', async () => {
  const rawFetch = vi.fn();
  const request = createAuthenticatedFetch({
    origin: 'https://sub2api.example',
    token: () => 'secret',
    fetchImpl: rawFetch,
    rootSignal: new AbortController().signal,
    onInvalidated: vi.fn(),
  });

  await expect(request('https://evil.example/steal')).rejects.toThrow('非同源');
  await expect(request('/other/path')).rejects.toThrow('不允许的请求路径');
  expect(rawFetch).not.toHaveBeenCalled();
});
```

Add timeout, external abort, 401/403 invalidation, invalidated-session and header merge tests.

- [ ] **Step 5: Implement `createAuthenticatedFetch()` and verify**

The allowlist is exact prefix matching for `/api/v1/` and `/cpa/`. Compose root signal, caller signal and timeout controller; clear timeout in `finally`. On 401/403 call invalidation once and abort all in-flight requests.

Run:

```bash
npm test -- tests/auth/bootstrap.test.ts tests/auth/authenticatedFetch.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth tests/auth tests/setup.ts vitest.config.ts
git commit -m $'feat: add in-memory Sub2API authentication\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 3: Implement the CPA Management API client

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/errors.ts`
- Create: `src/api/apiCall.ts`
- Create: `src/api/authFiles.ts`
- Create: `tests/api/apiCall.test.ts`
- Create: `tests/api/authFiles.test.ts`
- Create: `tests/fixtures/auth-files/duplicates.json`

**Interfaces:**

```ts
export interface ApiCallRequest {
  authIndex: string;
  method: 'GET' | 'POST';
  url: string;
  header: Record<string, string>;
  data?: string;
}

export interface ApiCallResult<T = unknown> {
  statusCode: number;
  header: Record<string, string[]>;
  bodyText: string;
  body: T | string | null;
}

export interface CpaApi {
  listAuthFiles(signal?: AbortSignal): Promise<AuthFile[]>;
  downloadAuthFile(name: string, signal?: AbortSignal): Promise<string>;
  apiCall<T>(request: ApiCallRequest, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ApiCallResult<T>>;
}
```

- [ ] **Step 1: Write failing api-call tests**

```ts
it('posts the exact CPA wrapper request and parses a JSON-string body', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({
    status_code: 200,
    header: { date: ['Wed, 12 Aug 2026 12:00:00 GMT'] },
    body: '{"ok":true}',
  })));
  const api = createCpaApi(request);
  const result = await api.apiCall({
    authIndex: 'idx-1', method: 'GET', url: 'https://upstream.example/usage',
    header: { Authorization: 'Bearer $TOKEN$' },
  });

  expect(request).toHaveBeenCalledWith('/cpa/v0/management/api-call', expect.objectContaining({ method: 'POST' }));
  expect(result.body).toEqual({ ok: true });
  expect(result.statusCode).toBe(200);
});
```

Add object body, text body and error priority tests.

- [ ] **Step 2: Verify api-call tests fail**

Run: `npm test -- tests/api/apiCall.test.ts`  
Expected: FAIL because `createCpaApi()` does not exist.

- [ ] **Step 3: Implement wrapper parsing and error normalization**

Implement `extractApiError()` with this order: `error.message`, `error`, `message`, body text, `HTTP <status>`. Reject missing `status_code`; preserve response header and body text.

- [ ] **Step 4: Write failing auth-files normalization tests**

Use `duplicates.json` to assert same-name deduplication, priority selection, missing-field merge and stable filename sort. Include runtime-only and unavailable records and assert they remain.

- [ ] **Step 5: Implement list/download/normalization and verify**

`downloadAuthFile()` must call `/cpa/v0/management/auth-files/download?name=${encodeURIComponent(name)}`. Port the behavioral ordering from official `src/services/api/authFiles.ts:182-301`, without importing React code.

Run:

```bash
npm test -- tests/api/apiCall.test.ts tests/api/authFiles.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api tests/api tests/fixtures/auth-files
git commit -m $'feat: add CPA management API client\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 4: Implement quota account domain logic

**Files:**
- Create: `src/quota/types.ts`
- Create: `src/quota/logic.ts`
- Create: `src/quota/identity.ts`
- Create: `src/quota/uiPreferences.ts`
- Create: `src/providers/types.ts`
- Create: `src/providers/shared.ts`
- Create: `tests/quota/logic.test.ts`
- Create: `tests/quota/identity.test.ts`
- Create: `tests/quota/uiPreferences.test.ts`

**Interfaces:**

```ts
export type Provider = 'claude' | 'antigravity' | 'codex' | 'xai' | 'kimi';
export type ProviderSelection = Provider | 'all';
export type SortMode = 'default' | 'soonest';

export function resolveProvider(file: AuthFile): Provider | null;
export function classifyAccounts(files: AuthFile[]): AccountEntry[];
export function sortAccounts(entries: AccountEntry[], mode: SortMode, recovery: (entry: AccountEntry) => number | null): AccountEntry[];
export function paginate<T>(items: T[], requestedPage: number, pageSize?: number): Pagination<T>;
export function buildAnonymousAccountLabel(provider: Provider, stableIdentifier: string): Promise<string>;
```

- [ ] **Step 1: Write failing provider and pagination tests**

Assert `provider ?? type`, trim/lowercase, `_` to `-`, `x-ai/grok` aliases, disabled boolean/number/string, default Provider order, page size 20, pre-pagination soonest sort and stable bottom ordering.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/quota/logic.test.ts`  
Expected: FAIL because quota logic does not exist.

- [ ] **Step 3: Implement minimal classification/sort/pagination**

Use a fixed order map `{ claude: 0, antigravity: 1, codex: 2, xai: 3, kimi: 4 }`. `paginate()` clamps to `[1,totalPages]`, with `totalPages` at least `1`.

- [ ] **Step 4: Write failing identity and storage tests**

```ts
it('creates a stable six-character anonymous label', async () => {
  expect(await buildAnonymousAccountLabel('claude', 'private-file.json')).toMatch(/^Claude · [0-9A-F]{6}$/);
  expect(await buildAnonymousAccountLabel('claude', 'private-file.json'))
    .toBe(await buildAnonymousAccountLabel('claude', 'private-file.json'));
});
```

Assert storage only contains `provider` and `sortMode`; corrupt values fall back; merge-on-write preserves the other allowed field.

- [ ] **Step 5: Implement SHA-256 identity and preferences; verify**

Use `crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableIdentifier))`; never return the identifier. Use one key, `cpaQuota.uiState`, and serialize only the two allowed fields.

Run:

```bash
npm test -- tests/quota/logic.test.ts tests/quota/identity.test.ts tests/quota/uiPreferences.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/quota src/providers/types.ts src/providers/shared.ts tests/quota
git commit -m $'feat: add quota account domain logic\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 5: Implement the Claude provider

**Files:**
- Create: `src/providers/claude/adapter.ts`
- Create: `src/providers/claude/parser.ts`
- Create: `tests/providers/claude.test.ts`
- Create: `tests/fixtures/claude/usage-legacy.json`
- Create: `tests/fixtures/claude/usage-modern.json`
- Create: `tests/fixtures/claude/profile.json`

**Interfaces:**

```ts
export function parseClaudeQuota(usage: unknown, profile?: unknown): ClaudeQuotaData;
export function queryClaudeQuota(file: AuthFile, context: ProviderQueryContext): Promise<ClaudeQuotaData>;
```

- [ ] **Step 1: Write failing parser tests**

Cover five-hour, seven-day, OAuth Apps, Opus, Sonnet, Cowork, extra usage, plan max/pro/team/free, modern Fable/Fable 5 and legacy `iguana_necktie` fallback. Assert a valid modern Fable window suppresses the legacy duplicate.

- [ ] **Step 2: Verify parser tests fail**

Run: `npm test -- tests/providers/claude.test.ts`  
Expected: FAIL because Claude parser/adapter do not exist.

- [ ] **Step 3: Implement the pure parser**

Normalize each window into `{ id, label, usedPercent, remainingPercent, resetAtMs, periodHours }`. Keep `extra_usage` in the standardized result. Do not perform DOM rendering here.

- [ ] **Step 4: Add adapter request tests**

Assert parallel GET requests to:

```text
https://api.anthropic.com/api/oauth/usage
https://api.anthropic.com/api/oauth/profile
```

with `Authorization: Bearer $TOKEN$`, JSON content type and `anthropic-beta: oauth-2025-04-20`. Usage failure must reject; profile failure must still return quota.

- [ ] **Step 5: Implement adapter and verify**

Use `Promise.allSettled()` for usage/profile, require usage fulfilled and 2xx, treat profile as optional.

Run: `npm test -- tests/providers/claude.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude tests/providers/claude.test.ts tests/fixtures/claude
git commit -m $'feat: add Claude quota provider\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 6: Implement the Antigravity provider

**Files:**
- Create: `src/providers/antigravity/adapter.ts`
- Create: `src/providers/antigravity/parser.ts`
- Create: `tests/providers/antigravity.test.ts`
- Create: `tests/fixtures/antigravity/summary.json`
- Create: `tests/fixtures/antigravity/subscription.json`
- Create: `tests/fixtures/antigravity/downloaded-auth.json`

**Interfaces:**

```ts
export function resolveAntigravityProjectId(file: AuthFile, download: (name: string) => Promise<string>): Promise<string | null>;
export function parseAntigravityQuota(payload: unknown, headers: Record<string, string[]>, nowMs: number): AntigravityQuotaData;
export function queryAntigravityQuota(file: AuthFile, context: ProviderQueryContext): Promise<AntigravityQuotaData>;
```

- [ ] **Step 1: Write failing project-id and parser tests**

Assert precedence: top-level, metadata, attributes, `gemini_virtual_project`, downloaded top-level/installed/web. Assert snake/camel groups, invalid fraction filtering, 5h/weekly/name sorting and Date header offset.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/providers/antigravity.test.ts`  
Expected: FAIL because Antigravity modules do not exist.

- [ ] **Step 3: Implement project resolver and parser**

Use the official field search order. Parse JSON download text defensively; malformed download returns no project ID and produces a clear query error.

- [ ] **Step 4: Add adapter fallback tests**

Assert sequential quota endpoint order, POST body `{"project":"project-id"}`, exact User-Agent and optional concurrent `loadCodeAssist`. A 2xx response with no valid groups must continue fallback; subscription failure must not fail quota; preserve 403/404 as preferred final status.

- [ ] **Step 5: Implement adapter and verify**

Use three sequential quota attempts and one independent subscription promise. Return success with empty groups only when at least one 2xx was received and no endpoint produced valid groups.

Run: `npm test -- tests/providers/antigravity.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/antigravity tests/providers/antigravity.test.ts tests/fixtures/antigravity
git commit -m $'feat: add Antigravity quota provider\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 7: Implement read-only Codex quota and reset-credit details

**Files:**
- Create: `src/providers/codex/adapter.ts`
- Create: `src/providers/codex/parser.ts`
- Create: `tests/providers/codex.test.ts`
- Create: `tests/fixtures/codex/usage.json`
- Create: `tests/fixtures/codex/reset-credits.json`

**Interfaces:**

```ts
export function parseCodexQuota(usage: unknown, creditDetails: unknown, file: AuthFile, nowMs: number): CodexQuotaData;
export function queryCodexQuota(file: AuthFile, context: ProviderQueryContext): Promise<CodexQuotaData>;
```

- [ ] **Step 1: Write failing parser tests**

Cover `rate_limit`, `code_review_rate_limit`, `additional_rate_limits`, 5h/week/month by duration, legacy primary/secondary fallback only when duration is absent, reached-without-used as 100%, plan fallback, subscription renewal and available credits filtering.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/providers/codex.test.ts`  
Expected: FAIL because Codex modules do not exist.

- [ ] **Step 3: Implement the pure parser**

Normalize windows with stable IDs that include scope and period. Keep subscription renewal separate from quota reset instants. Filter credits to `reset_type=codex_rate_limits`, `status=available`, and valid future expiry.

- [ ] **Step 4: Add adapter request and isolation tests**

Assert usage GET, optional `Chatgpt-Account-Id`, Codex CLI User-Agent, 8-second credit details request and optional-error behavior. Add this source contract assertion:

```ts
expect(readFileSync('src/providers/codex/adapter.ts', 'utf8'))
  .not.toContain('/rate-limit-reset-credits/consume');
```

- [ ] **Step 5: Implement read-only adapter and verify**

The adapter may contain usage and credit-details URLs only. Credit-details failure becomes `creditDetailsError` on successful main data.

Run:

```bash
npm test -- tests/providers/codex.test.ts
npm run typecheck
! grep -R -F '/rate-limit-reset-credits/consume' src/providers
```

Expected: PASS and grep has no output.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex tests/providers/codex.test.ts tests/fixtures/codex
git commit -m $'feat: add read-only Codex quota provider\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 8: Implement the Kimi provider

**Files:**
- Create: `src/providers/kimi/adapter.ts`
- Create: `src/providers/kimi/parser.ts`
- Create: `tests/providers/kimi.test.ts`
- Create: `tests/fixtures/kimi/usages.json`

**Interfaces:**

```ts
export function parseKimiQuota(payload: unknown, nowMs: number): KimiQuotaData;
export function queryKimiQuota(file: AuthFile, context: ProviderQueryContext): Promise<KimiQuotaData>;
```

- [ ] **Step 1: Write failing Kimi tests**

Assert limits before summary, `limit - remaining` used inference, absolute reset priority, relative `reset_in/resetIn/ttl`, duration/timeUnit, `TIME_UNIT_MINUTE`, stable fallback labels and string/object bodies.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/providers/kimi.test.ts`  
Expected: FAIL because Kimi modules do not exist.

- [ ] **Step 3: Implement parser**

Normalize every row into `{ id, label, used, limit, remainingPercent, resetAtMs, periodHours }`. Append summary only after all limits.

- [ ] **Step 4: Add exact request test and implement adapter**

Assert GET `https://api.kimi.com/coding/v1/usages` with only the required `$TOKEN$` authorization header. Reject non-2xx through the common CPA error helper.

- [ ] **Step 5: Verify**

Run: `npm test -- tests/providers/kimi.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/kimi tests/providers/kimi.test.ts tests/fixtures/kimi
git commit -m $'feat: add Kimi quota provider\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 9: Implement the xAI provider

**Files:**
- Create: `src/providers/xai/adapter.ts`
- Create: `src/providers/xai/parser.ts`
- Create: `tests/providers/xai.test.ts`
- Create: `tests/fixtures/xai/weekly.json`
- Create: `tests/fixtures/xai/monthly.json`
- Create: `tests/fixtures/xai/paid-profile.json`

**Interfaces:**

```ts
export function isPaidXaiCredential(file: AuthFile): boolean;
export function parseXaiBilling(payload: unknown): XaiBillingSummary | null;
export function mergeXaiBilling(weekly: XaiBillingSummary | null, monthly: XaiBillingSummary | null): XaiBillingSummary | null;
export function queryXaiQuota(file: AuthFile, context: ProviderQueryContext): Promise<XaiQuotaData>;
```

- [ ] **Step 1: Write failing parser and paid-detection tests**

Assert atomic period selection, monthly monetary supplementation without borrowing reset/type, `using_api + paid prefix`, JWT tier detection and route-hint non-detection.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/providers/xai.test.ts`  
Expected: FAIL because xAI modules do not exist.

- [ ] **Step 3: Implement billing parser and paid detection**

Keep weekly quota reset distinct from monthly billing rollover. Store money in cents. Do not create a quota percentage for paid-health results.

- [ ] **Step 4: Add adapter behavior tests**

Assert weekly/monthly concurrent requests and exact Grok headers. Paid accounts must call `/v1/me` and `/v1/chat/completions` with the fixed ping body. Profile is optional; chat is required. Free billing with no useful data falls back to paid-health; if fallback fails, preserve the billing error.

- [ ] **Step 5: Implement adapter and verify**

Run: `npm test -- tests/providers/xai.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/xai tests/providers/xai.test.ts tests/fixtures/xai
git commit -m $'feat: add xAI quota provider\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 10: Implement reset schedule, relative time and timeline model

**Files:**
- Create: `src/quota/resetSchedule.ts`
- Create: `src/quota/relativeTime.ts`
- Create: `src/quota/timelineModel.ts`
- Create: `src/quota/minuteClock.ts`
- Create: `tests/quota/resetSchedule.test.ts`
- Create: `tests/quota/relativeTime.test.ts`
- Create: `tests/quota/timelineModel.test.ts`
- Create: `tests/quota/minuteClock.test.ts`

**Interfaces:**

```ts
export function nextRecoveryMs(provider: Provider, quota: QuotaData, nowMs: number): number | null;
export function urgentRecoveryId(provider: Provider, quota: QuotaData, nowMs: number): string | null;
export function formatResetLabel(resetAtMs: number, nowMs: number, locale?: string): string;
export function timelineSpan(mode: 'weekly' | 'session', offset: number, nowMs: number): TimelineSpan;
export function buildTimelineLane(input: TimelineLaneInput): TimelineLane;
export function createMinuteClock(options?: MinuteClockOptions): MinuteClock;
```

- [ ] **Step 1: Write failing recovery tests**

Assert valid future windows and available Codex credit, exclusion of xAI monthly rollover and Codex subscription renewal, past/invalid reset exclusion, stable earliest selection and strict `< 1 hour` urgency.

- [ ] **Step 2: Write failing timeline/time tests**

Assert Weekly 14 days, Session 3 days, true 5h filtering, DST-safe local boundaries, past/live/upcoming, Today, current-time position, credit expiry tick and empty behavior.

- [ ] **Step 3: Verify failure**

Run:

```bash
npm test -- tests/quota/resetSchedule.test.ts tests/quota/relativeTime.test.ts tests/quota/timelineModel.test.ts tests/quota/minuteClock.test.ts
```

Expected: FAIL because these modules do not exist.

- [ ] **Step 4: Implement pure schedule/time/model logic**

Use `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat`; never hand-build timezone offsets. Timeline positions are clamped percentages computed from `[span.startMs, span.endMs]`.

- [ ] **Step 5: Implement one shared minute-boundary clock and verify**

Schedule first tick at `60_000 - (Date.now() % 60_000)`, then continue minute intervals. Recalibrate on `visibilitychange`. Stop timers and listeners after the last subscriber or `destroy()`.

Run the four test files plus `npm run typecheck`; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/quota/resetSchedule.ts src/quota/relativeTime.ts src/quota/timelineModel.ts src/quota/minuteClock.ts tests/quota
git commit -m $'feat: add quota recovery timeline model\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 11: Implement state, cache generations and concurrent actions

**Files:**
- Create: `src/providers/index.ts`
- Create: `src/app/state.ts`
- Create: `src/app/lifecycle.ts`
- Create: `src/app/actions.ts`
- Create: `tests/app/state.test.ts`
- Create: `tests/app/actions.test.ts`

**Interfaces:**

```ts
export interface QuotaStore {
  getState(): Readonly<AppState>;
  subscribe(listener: (state: Readonly<AppState>) => void): () => void;
  beginAccountGeneration(): number;
  replaceAccounts(generation: number, accounts: AccountEntry[]): boolean;
  setQuota(accountId: string, generation: number, quota: QuotaLoadState): boolean;
  invalidateAuth(): void;
  destroy(): void;
}

export interface QuotaActions {
  reloadAccounts(): Promise<void>;
  queryOne(accountId: string): Promise<void>;
  queryCurrentPage(accountIds: string[]): Promise<void>;
  resetCodex?(accountId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing store tests**

Assert generation increment, stale result rejection, unchanged-account cache retention, removed-account pruning, auth invalidation and destroy.

- [ ] **Step 2: Verify store test failure**

Run: `npm test -- tests/app/state.test.ts`  
Expected: FAIL because state module does not exist.

- [ ] **Step 3: Implement immutable observable store**

Use private mutable state but return readonly snapshots. Every async write carries the generation captured when the request began.

- [ ] **Step 4: Write failing action/concurrency tests**

Assert same-card loading guard, batch loading guard, max 20 IDs, Provider grouping, group and account concurrency, `Promise.allSettled()` failure isolation, page abort, no generic retry and no quota persistence.

- [ ] **Step 5: Implement registry and actions; verify**

`src/providers/index.ts` exports all five read-only adapters only. `queryCurrentPage()` rejects more than 20 IDs as a programmer error and updates each Provider group when that group settles.

Run:

```bash
npm test -- tests/app/state.test.ts tests/app/actions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/index.ts src/app/state.ts src/app/lifecycle.ts src/app/actions.ts tests/app
git commit -m $'feat: add quota state and concurrency controls\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 12: Render accessible cards and Provider bodies

**Files:**
- Create: `src/ui/dom.ts`
- Create: `src/ui/icons.ts`
- Create: `src/ui/theme.ts`
- Create: `src/ui/renderHeader.ts`
- Create: `src/ui/renderTabs.ts`
- Create: `src/ui/renderCard.ts`
- Create: `src/ui/renderProviderBody.ts`
- Create: `src/ui/providerBodies/claude.ts`
- Create: `src/ui/providerBodies/antigravity.ts`
- Create: `src/ui/providerBodies/codex.ts`
- Create: `src/ui/providerBodies/kimi.ts`
- Create: `src/ui/providerBodies/xai.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/cards.css`
- Create: `tests/ui/renderCard.test.ts`
- Create: `tests/ui/renderProviderBody.test.ts`
- Create: `tests/ui/theme.test.ts`

**Interfaces:**

```ts
export interface RenderOptions {
  mode: 'user' | 'admin';
  revealAccountIdentity: boolean;
  canConsumeCodexReset: boolean;
}

export function renderQuotaCard(entry: AccountEntry, quota: QuotaLoadState, options: RenderOptions, handlers: CardHandlers): HTMLElement;
export function renderProviderBody(provider: Provider, data: QuotaData, nowMs: number): HTMLElement;
export function applyTheme(options: { requestedTheme: string | null; media: MediaQueryList }): () => void;
```

- [ ] **Step 1: Write failing DOM safety and card-state tests**

Assert idle/loading/success/error, `aria-busy`, progressbar semantics, 70/30 classes, text labels, and that dynamic upstream text appears as text rather than executable markup.

- [ ] **Step 2: Add ordinary/admin identity tests**

Use fixture secrets and assert user DOM, attributes, `title`, console calls and timeline display names do not contain filename/email/authIndex/account/project ID. Assert admin shows allowed metadata. Assert user has no reset button or reset event.

- [ ] **Step 3: Verify failure**

Run: `npm test -- tests/ui/renderCard.test.ts tests/ui/renderProviderBody.test.ts tests/ui/theme.test.ts`  
Expected: FAIL because UI modules do not exist.

- [ ] **Step 4: Implement DOM helpers, themes and shared card UI**

`src/ui/dom.ts` must expose safe helpers that set text through `textContent`; do not add a generic raw-HTML helper. Use CSS variables from the approved warm-gray/neutral/Indigo palette.

- [ ] **Step 5: Implement all five Provider bodies and verify**

Each body consumes only standardized data. It must not inspect raw CPA payloads. Theme priority is URL light/dark, then system; remove the media listener on cleanup.

Run the three test files and `npm run typecheck`; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui src/styles tests/ui
git commit -m $'feat: render accessible quota cards\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 13: Render the Weekly/Session timeline

**Files:**
- Create: `src/ui/renderTimeline.ts`
- Create: `src/styles/timeline.css`
- Create: `tests/ui/renderTimeline.test.ts`

**Interfaces:**

```ts
export interface TimelineHandlers {
  setMode(mode: 'weekly' | 'session'): void;
  shiftPeriod(delta: -1 | 1): void;
  goToday(): void;
}

export function renderTimeline(model: TimelineModel, handlers: TimelineHandlers): HTMLElement | null;
```

- [ ] **Step 1: Write failing timeline DOM tests**

Assert null for no valid data, Weekly/Session tabs, prior/next/Today controls, independently scrollable plot, provider labels, past/live/upcoming classes, credit tick, keyboard-focusable marks, `aria-label` details and hidden tabular equivalent.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/ui/renderTimeline.test.ts`  
Expected: FAIL because renderer does not exist.

- [ ] **Step 3: Implement timeline DOM without SVG text injection**

Use DOM elements and CSS positioning with numeric percentages. Tooltip content must be text nodes. Add a visually hidden table listing account, window, state, remaining and reset time.

- [ ] **Step 4: Implement responsive/reduced-motion CSS**

The page must not horizontally overflow at 420px; only the timeline viewport may scroll. Add `@media (prefers-reduced-motion: reduce)` to disable transition and shimmer motion.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/ui/renderTimeline.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/renderTimeline.ts src/styles/timeline.css tests/ui/renderTimeline.test.ts
git commit -m $'feat: render quota recovery timeline\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 14: Implement the admin-only Codex reset capability

**Files:**
- Create: `src/admin/codexReset.ts`
- Create: `src/ui/confirmDialog.ts`
- Create: `tests/admin/codexReset.test.ts`
- Create: `tests/ui/confirmDialog.test.ts`

**Interfaces:**

```ts
export type CodexResetCapability = (file: AuthFile, context: ProviderQueryContext) => Promise<CodexQuotaData>;
export const consumeCodexResetCredit: CodexResetCapability;

export function openConfirmDialog(options: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  trigger: HTMLElement;
  onConfirm: () => Promise<void>;
}): DialogController;
```

- [ ] **Step 1: Write failing reset request tests**

Assert POST `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume`, body `{"redeem_request_id":"<uuid>"}` with a different UUID per call, unified non-2xx errors, same-account lock, and full `queryCodexQuota()` after success.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/admin/codexReset.test.ts`  
Expected: FAIL because admin module does not exist.

- [ ] **Step 3: Implement reset capability**

Keep the consume URL constant in this file only. Use `crypto.randomUUID()`. Accept the shared query context and return refreshed Codex data after successful consume.

- [ ] **Step 4: Write failing dialog accessibility tests**

Assert default focus on cancel, Escape closes without action, irreversible warning, focus return, and button lock during `onConfirm()`.

- [ ] **Step 5: Implement dialog and verify**

Run:

```bash
npm test -- tests/admin/codexReset.test.ts tests/ui/confirmDialog.test.ts
npm run typecheck
! grep -R -F '/rate-limit-reset-credits/consume' src --exclude='codexReset.ts'
```

Expected: PASS; grep no output.

- [ ] **Step 6: Commit**

```bash
git add src/admin src/ui/confirmDialog.ts tests/admin tests/ui/confirmDialog.test.ts
git commit -m $'feat: add admin Codex reset flow\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 15: Wire the complete user and admin applications

**Files:**
- Create: `src/app/types.ts`
- Create: `src/app/createQuotaApp.ts`
- Create: `src/ui/renderApp.ts`
- Modify: `src/entries/user.ts`
- Modify: `src/entries/admin.ts`
- Modify: `templates/quota.html`
- Modify: `templates/quota-admin.html`
- Test: `tests/app/createQuotaApp.test.ts`
- Test: `tests/ui/renderApp.test.ts`

**Interfaces:**

```ts
export interface QuotaAppOptions {
  root: HTMLElement;
  mode: 'user' | 'admin';
  revealAccountIdentity: boolean;
  consumeCodexResetCredit?: CodexResetCapability;
}

export interface QuotaAppController {
  start(): Promise<void>;
  destroy(): void;
  getState(): Readonly<AppState>;
}

export function createQuotaApp(options: QuotaAppOptions): QuotaAppController;
```

- [ ] **Step 1: Write failing application orchestration tests**

Assert auth before auth-files, no initial api-call, tab counts and switching, page reset on tab/sort, pagination, list refresh without quota query, current-page batch max 20, isolated card failure, stats, auth invalidation and destroy cleanup.

- [ ] **Step 2: Write failing entry dependency tests**

Assert `user.ts` does not import `src/admin/`, does not pass reset capability and uses `revealAccountIdentity:false`. Assert `admin.ts` is the only entry importing `consumeCodexResetCredit`.

- [ ] **Step 3: Verify failure**

Run: `npm test -- tests/app/createQuotaApp.test.ts tests/ui/renderApp.test.ts`  
Expected: FAIL because application composition is incomplete.

- [ ] **Step 4: Implement `createQuotaApp()` and renderer event delegation**

The controller owns session, CpaApi, store, actions, clock, theme cleanup and DOM listeners. `destroy()` must be idempotent. Render auth loading/error before protected content.

- [ ] **Step 5: Wire entries and verify all unit tests**

`user.ts` imports no admin module. `admin.ts` imports reset capability and passes it explicitly.

Run:

```bash
npm test -- tests/app/createQuotaApp.test.ts tests/ui/renderApp.test.ts
npm run typecheck
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app src/ui/renderApp.ts src/entries templates tests/app tests/ui/renderApp.test.ts
git commit -m $'feat: wire complete quota page interactions\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 16: Produce secured self-contained HTML artifacts

**Files:**
- Create: `build/buildInfo.ts`
- Create: `build/cspHashPlugin.ts`
- Modify: `vite.config.ts`
- Modify: `templates/quota.html`
- Modify: `templates/quota-admin.html`
- Create: `tests/build/cspHashPlugin.test.ts`
- Generate: `dist/quota.html`
- Generate: `dist/quota-admin.html`

**Interfaces:**

```ts
export interface BuildInfo { version: string; commit: string }
export function readBuildInfo(environment?: NodeJS.ProcessEnv): BuildInfo;
export function finalizeQuotaHtml(options: { html: string; target: 'user' | 'admin'; buildInfo: BuildInfo }): string;
export function cspHashPlugin(options: { target: 'user' | 'admin'; buildInfo: BuildInfo }): Plugin;
```

- [ ] **Step 1: Write failing CSP/final artifact tests**

Assert final inline script SHA-256, hash-only `script-src`, fixed CSP directives, no script `unsafe-inline`, no external script/link/font/CDN/assets/source map, build version/revision, and hash failure after one-byte script mutation.

- [ ] **Step 2: Add user/admin bundle isolation tests**

Assert user HTML lacks `/rate-limit-reset-credits/consume`, admin module marker and irreversible dialog copy; admin HTML contains consume endpoint. Assert both have no CPA key or fixture secrets.

- [ ] **Step 3: Verify failure**

Run: `npm test -- tests/build/cspHashPlugin.test.ts`  
Expected: FAIL because build plugin does not exist.

- [ ] **Step 4: Implement build info and CSP plugin**

Run after `viteSingleFile()`. Extract the final inline script text, calculate `createHash('sha256').update(scriptText).digest('base64')`, inject the standard CSP source expression and then re-parse the output to verify the hash.

`readBuildInfo()` reads package version and uses `GITHUB_SHA` when present, otherwise `git rev-parse --short=12 HEAD`. `finalizeQuotaHtml()` injects `<meta name="cpa-quota-version" content="版本值">` and `<meta name="cpa-quota-source-revision" content="源码 revision">`; README documents the latter as source revision rather than final artifact commit.

- [ ] **Step 5: Build and run artifact checks**

Run:

```bash
npm test -- tests/build/cspHashPlugin.test.ts
npm run build
grep -F '/rate-limit-reset-credits/consume' dist/quota-admin.html
! grep -F '/rate-limit-reset-credits/consume' dist/quota.html
! grep -F '/assets/' dist/quota.html
! grep -F '/assets/' dist/quota-admin.html
npm run typecheck
```

Expected: all checks PASS; first grep finds admin endpoint; negative greps have no output.

- [ ] **Step 6: Commit**

```bash
git add build vite.config.ts templates tests/build/cspHashPlugin.test.ts dist
git commit -m $'build: emit secured single-file quota pages\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

### Task 17: Add browser tests, CI, Nginx and release documentation

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/browser/helpers/routes.ts`
- Create: `tests/browser/auth.spec.ts`
- Create: `tests/browser/quota-user.spec.ts`
- Create: `tests/browser/quota-admin.spec.ts`
- Create: `tests/browser/responsive-theme.spec.ts`
- Create: `tests/browser/network-security.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `nginx/example.conf`
- Create: `README.md`
- Create: `tests/release/repositoryContract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Playwright serves `dist/` locally and mocks only same-origin `/api/v1/` and `/cpa/`.
- Nginx exposes exact `/quota.html`, `/quota-admin.html`, and `/cpa/` routes.

- [ ] **Step 1: Write browser tests against final HTML**

Cover token removal/theme preservation, auth success/failure/inactive, no initial api-call, 21+ account pagination, current-page batch, user DOM secrecy, admin dialog/reset/requery, 420px layout, light/dark, timeline scroll and console errors.

In `network-security.spec.ts`, record every request and assert:

```ts
for (const request of requests) {
  expect(new URL(request.url()).origin).toBe(serverOrigin);
}
```

Provider URLs may appear only in the JSON body sent to `/cpa/v0/management/api-call`.

- [ ] **Step 2: Run browser tests and verify initial failures**

Run:

```bash
npm run build
npx playwright install chromium
npm run test:e2e
```

Expected: at least the yet-unimplemented deployment/network assertions fail before final configuration is added.

- [ ] **Step 3: Implement Playwright routing and finish browser behavior fixes**

Use deterministic fixtures and a fixed clock. Assert CSP actually permits app startup and that malformed hash prevents startup in a dedicated copied-page test.

- [ ] **Step 4: Write and implement repository contract tests**

The test must parse `.github/workflows/ci.yml`, `nginx/example.conf`, `README.md` and `package.json` and assert:

- CI runs install, typecheck, unit tests, build, Chromium install, e2e, user consume scan and `git diff --exit-code -- dist`.
- Raw GitHub URLs use `v1.0.0`, not `main`.
- Both HTML proxy locations discard client query strings with trailing `?`.
- `/quota.html` uses `auth_request /_sub2api_auth` and `/quota-admin.html` uses `auth_request /_sub2api_admin_auth`.
- `/_sub2api_admin_auth` is documented as a Sub2API deployment contract that returns 2xx only for administrators; the static HTML does not parse roles.
- GitHub upstream clears Authorization, Cookie and Referer and enables TLS SNI.
- `/cpa/` uses `auth_request`, secret include, and `proxy_pass http://cpa_backend/;`.
- Nginx does not duplicate `/v0/management/`.
- README includes all six accepted residual risks and does not claim server-side isolation.

- [ ] **Step 5: Add CI, Nginx example and README**

The Nginx example must use:

```nginx
location /cpa/ {
    auth_request /_sub2api_auth;
    include /etc/nginx/secrets/cpa-management-auth.conf;
    proxy_pass http://cpa_backend/;
}
```

HTML locations must use fixed tag raw URLs ending in `quota.html?` and `quota-admin.html?`, clear sensitive upstream headers, set SNI/Host, content type, no-referrer, no-store, nosniff and explicit `frame-ancestors`. The user location calls `auth_request /_sub2api_auth`; the admin location calls `auth_request /_sub2api_admin_auth`.

README must include setup, build, local preview, two URLs, release/tag update, rollback, source revision semantics, secret include and the accepted risks from specification §12.2. It must state that `/_sub2api_admin_auth` is supplied by the deployment and must return success only after server-side administrator validation; this protects the HTML entry but, under the accepted risk model, does not constrain arbitrary `/cpa/api-call` bodies.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
! grep -F '/rate-limit-reset-credits/consume' dist/quota.html
git diff --check
```

Then stage all intended source and `dist`, and run:

```bash
npm run check:dist
git status --short
```

Expected: all commands PASS; after staging regenerated `dist`, `check:dist` reports no diff. `git status --short` lists only the intended Task 17 files before commit.

- [ ] **Step 7: Commit**

```bash
git add .github nginx README.md package.json package-lock.json playwright.config.ts tests/browser tests/release dist
git commit -m $'ci: add deployment and release contracts\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
```

---

## Official Reference Map

Use the official project only as a behavior reference; do not copy its React/Zustand/i18next architecture.

- CPA wrapper protocol and errors: `../../Cli-Proxy-API-Management-Center/src/services/api/apiCall.ts`
- Auth-file normalization: `../../Cli-Proxy-API-Management-Center/src/services/api/authFiles.ts`
- Provider aliases/disabled: `../../Cli-Proxy-API-Management-Center/src/utils/quota/validators.ts`
- Classification/sort/pagination: `../../Cli-Proxy-API-Management-Center/src/features/quota/logic.ts`
- Batch/action guards: `../../Cli-Proxy-API-Management-Center/src/features/quota/hooks/useQuotaBatchLoader.ts`, `useQuotaActions.ts`
- Claude: `../../Cli-Proxy-API-Management-Center/src/features/quota/providers/claude/data.ts`
- Antigravity: `../../Cli-Proxy-API-Management-Center/src/features/quota/providers/antigravity/data.ts`
- Codex: `../../Cli-Proxy-API-Management-Center/src/features/quota/providers/codex/data.ts`
- Kimi: `../../Cli-Proxy-API-Management-Center/src/features/quota/providers/kimi/data.ts`
- xAI: `../../Cli-Proxy-API-Management-Center/src/features/quota/providers/xai/data.ts`
- Shared parsers/builders: `../../Cli-Proxy-API-Management-Center/src/utils/quota/parsers.ts`, `builders.ts`, `resolvers.ts`, `resetCredits.ts`, `xaiPaid.ts`
- Reset ordering: `../../Cli-Proxy-API-Management-Center/src/features/quota/resetSchedule.ts`
- Timeline: `../../Cli-Proxy-API-Management-Center/src/features/quota/quotaTimelineModel.ts`
- Relative time/clock: `../../Cli-Proxy-API-Management-Center/src/utils/quota/relativeTime.ts`, `src/utils/time/sharedClock.ts`
- Visual baseline and existing Sub2API token behavior: `/Users/kael/workspace/cpa_quota/index.html`

Reference tests to port as behavior fixtures:

- `../../Cli-Proxy-API-Management-Center/tests/authFilesResponseNormalization.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaPageLogic.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaUiState.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaSessionIsolation.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/claudeFableQuota.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/codexQuota.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/kimiQuotaOrder.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/xaiPaidQuotaFallback.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaResetSchedule.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaTimeline.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaTimelineRendering.test.ts`
- `../../Cli-Proxy-API-Management-Center/tests/quotaRelativeTime.test.ts`

## Final Verification Checklist

Before declaring implementation complete:

```bash
cd /Users/kael/workspace/github/kael-aiur/cpa-quota-pages
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
! grep -F '/rate-limit-reset-credits/consume' dist/quota.html
grep -F '/rate-limit-reset-credits/consume' dist/quota-admin.html
! grep -F '/assets/' dist/quota.html
! grep -F '/assets/' dist/quota-admin.html
git diff --check
npm run check:dist
git status --short
```

Expected:

- TypeScript、Vitest、构建和 Playwright 全部通过。
- 普通页不包含 consume endpoint；管理员页包含。
- 两个 HTML 无外部 assets。
- `check:dist` 无差异。
- 工作树只包含计划执行期间明确保留的变更；完成并提交全部任务后应为空。
