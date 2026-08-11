# CPA Quota Pages 设计规格

**日期：** 2026-08-12  
**状态：** 已批准  
**目标仓库：** `kael-aiur/cpa-quota-pages`  
**参考实现：**

- `/Users/kael/workspace/github/Cli-Proxy-API-Management-Center` 的 `#/quota`
- `/Users/kael/workspace/cpa_quota/index.html` 的视觉与 Sub2API token 传递方式

## 1. 目标

建立一个与 `cpa-plugin-key-bind` 解耦的静态页面仓库，提供两个可被 Sub2API iframe 内嵌的额度页面：

- `quota.html`：普通用户只读页面；
- `quota-admin.html`：管理员页面，额外支持 Codex reset-credit consume。

两个页面应做到：

1. 支持 Claude、Antigravity、Codex、xAI 和 Kimi 五类 Provider；
2. 功能与官方管理中心 `#/quota` 对齐，包括 Provider 分类、分页、排序、单卡查询、当前页批量查询、额度解析和恢复时间线；
3. 视觉风格与现有 `cpa_quota/index.html` 一致；
4. 最终产物均为 CSS、JavaScript、SVG 全部内联的自包含 HTML；
5. 由 Nginx 从 GitHub 固定 tag 获取，无需单独部署静态文件目录；
6. 浏览器不知道 CPA management key，所有 CPA 请求使用 `/cpa/` 相对路径；
7. Sub2API token 只保存在页面内存中，不写入 Web Storage 或 Cookie。

## 2. 非目标

本项目不负责：

- 修改或发布 `cpa-plugin-key-bind`；
- 注册 CPA 插件 resource route；
- 将页面嵌入 CPA 插件二进制；
- 在浏览器中直接请求 Provider 上游 API；
- 管理 CPA management key；
- 为所有普通用户建立严格的服务端最小权限网关；
- 实现官方管理中心的完整导航、路由、国际化和动画系统。

## 3. 已确认的设计决策

### 3.1 仓库边界

使用独立仓库：

```text
kael-aiur/cpa-quota-pages
```

该仓库与 `cpa-plugin-key-bind` 不存在构建或运行时依赖。额度页面可以独立发布、升级和回滚。

### 3.2 页面入口

构建产物固定为：

```text
dist/quota.html
dist/quota-admin.html
```

两个页面是独立 HTML，不通过 `?mode=admin` 在运行时切换能力。页面能力由两个静态入口的依赖图确定：

```ts
// user.ts 不导入任何管理员写操作模块。
createQuotaApp({
  mode: 'user',
  revealAccountIdentity: false,
});
```

```ts
// admin.ts 是唯一允许导入 admin/codexReset.ts 的入口。
import { consumeCodexResetCredit } from '../admin/codexReset';

createQuotaApp({
  mode: 'admin',
  revealAccountIdentity: true,
  consumeCodexResetCredit,
});
```

`dist/quota.html` 中不得出现 Codex consume endpoint 字符串或管理员写操作实现；CI 必须扫描并验证这一点。

### 3.3 技术栈

使用：

- Vanilla TypeScript；
- 原生 DOM；
- 原生 `fetch`；
- CSS variables；
- Vite；
- `vite-plugin-singlefile`；
- Vitest，用于纯逻辑和 DOM 单元测试；
- Playwright，用于两个构建产物的浏览器集成测试。

不使用：

- React；
- React Router；
- Zustand；
- Axios；
- i18next；
- 外部字体或 CDN 资源。

### 3.4 认证参数传递

Sub2API 使用 URL 查询参数传递 token：

```text
/quota.html?token=<Sub2API-token>&theme=dark
/quota-admin.html?token=<Sub2API-token>&theme=dark
```

页面读取 token 后：

1. 仅保存于 JavaScript 内存；
2. 使用 `history.replaceState()` 从当前 URL 移除 token；
3. 保留非敏感的 `theme` 参数；
4. 调用 `/api/v1/auth/me` 验证身份；
5. 验证成功后才加载账号列表。

页面刷新后不从存储恢复 token，需要 Sub2API 重新设置 iframe URL。

### 3.5 Nginx 双重认证头

浏览器对业务 API 始终发送：

```http
Authorization: Bearer <Sub2API-token>
```

Nginx 对 `/cpa/` 请求：

1. 先验证 Sub2API token；
2. 验证通过后移除 `/cpa` 前缀；
3. 将发往 CPA 的 `Authorization` 替换成 CPA management key；
4. 不把 CPA management key 返回给浏览器。

### 3.6 管理员判定

管理员 HTML 自身不解析 `/auth/me` 的角色字段。管理员入口由 Sub2API 菜单和 Nginx 路由控制。

这只是入口控制，不是 `/api-call` 的服务端最小权限控制。相关残余风险见第 12 节。

## 4. 建议目录结构

```text
cpa-quota-pages/
├── src/
│   ├── entries/
│   │   ├── user.ts
│   │   └── admin.ts
│   ├── app/
│   │   ├── createQuotaApp.ts
│   │   ├── state.ts
│   │   └── lifecycle.ts
│   ├── auth/
│   │   ├── bootstrap.ts
│   │   └── authenticatedFetch.ts
│   ├── admin/
│   │   └── codexReset.ts
│   ├── api/
│   │   ├── authFiles.ts
│   │   ├── apiCall.ts
│   │   └── errors.ts
│   ├── providers/
│   │   ├── index.ts
│   │   ├── antigravity/
│   │   ├── claude/
│   │   ├── codex/
│   │   ├── kimi/
│   │   └── xai/
│   ├── quota/
│   │   ├── logic.ts
│   │   ├── resetSchedule.ts
│   │   ├── relativeTime.ts
│   │   ├── timelineModel.ts
│   │   └── types.ts
│   ├── ui/
│   │   ├── renderApp.ts
│   │   ├── renderCard.ts
│   │   ├── renderProviderBody.ts
│   │   ├── renderTimeline.ts
│   │   └── confirmDialog.ts
│   └── styles/
│       ├── tokens.css
│       ├── layout.css
│       ├── cards.css
│       └── timeline.css
├── templates/
│   ├── quota.html
│   └── quota-admin.html
├── tests/
│   ├── fixtures/
│   ├── providers/
│   ├── quota/
│   └── browser/
├── build/
│   └── cspHashPlugin.ts
├── nginx/
│   └── example.conf
├── scripts/
│   └── clean.mjs
├── dist/
│   ├── quota.html
│   └── quota-admin.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

模块边界要求：

- `auth/` 只负责 Sub2API 身份建立和统一请求头；
- `admin/` 只包含管理员写操作，并且只能被 `entries/admin.ts` 导入；
- `api/` 只负责 CPA Management API 协议；
- `providers/` 负责 Provider 请求、解析和标准化；
- `quota/` 只处理与 DOM 无关的排序、分页、恢复时间和时间线模型；
- `ui/` 只消费标准化状态并渲染；
- `entries/` 只配置 user/admin 能力差异；
- `build/cspHashPlugin.ts` 在 single-file 内联完成后计算脚本 hash、写入 CSP meta，并对最终 HTML 做产物约束检查。

## 5. API 边界

### 5.1 Sub2API 身份验证

```http
GET /api/v1/auth/me
Authorization: Bearer <Sub2API-token>
Accept: application/json
Cache-Control: no-store
```

成功条件：

- HTTP 2xx；
- 返回业务 `code` 为 `0`；
- 存在 `data`；
- 用户状态不存在，或等于 `active`。

`401`、`403` 或业务身份失败时，不渲染额度内容。

### 5.2 CPA 认证文件

```http
GET /cpa/v0/management/auth-files
Authorization: Bearer <Sub2API-token>
```

响应按官方管理中心规则进行：

- 同名去重；
- 优先磁盘文件、带 path、非 runtime-only、未停用、更新时间较新和字段较丰富的记录；
- 从低优先级重复项补齐缺失字段；
- 最终按文件名稳定排序。

### 5.3 Antigravity 原始认证文件

必要时调用：

```http
GET /cpa/v0/management/auth-files/download?name=<encoded-name>
```

仅用于补找 Antigravity project id。

### 5.4 CPA 上游代理

```http
POST /cpa/v0/management/api-call
Authorization: Bearer <Sub2API-token>
Content-Type: application/json
```

请求体：

```json
{
  "authIndex": "credential-index",
  "method": "GET",
  "url": "https://provider.example/path",
  "header": {
    "Authorization": "Bearer $TOKEN$"
  }
}
```

CPA 包装响应：

```json
{
  "status_code": 200,
  "header": {},
  "body": "{}"
}
```

解析规则：

- `body` 兼容字符串和对象；
- 保留 `status_code` 与响应 header；
- 错误消息优先级为 `body.error.message`、`body.error`、`body.message`、body 文本、`HTTP <status>`。

### 5.5 请求约束

`authenticatedFetch()` 必须：

- 拒绝非同源 URL；
- 只允许 `/api/v1/` 和 `/cpa/`；
- 设置 `Authorization`；
- 设置 `cache: no-store`；
- 设置 `credentials: same-origin`；
- 支持超时和 `AbortSignal`；
- 遇到身份失效时清空内存 token 并终止在途请求。

浏览器不得直接向 Provider 域名发请求。

## 6. Provider 功能

### 6.1 Provider 归一化

支持：

```text
antigravity | claude | codex | kimi | xai
```

规则：

- 读取 `file.provider ?? file.type`；
- trim；
- 小写；
- `_` 转 `-`；
- `x-ai` 和 `grok` 归一为 `xai`；
- 排除 disabled；
- 与官方页面保持一致，不额外排除 runtime-only 或 unavailable。

默认分组顺序：

1. Claude
2. Antigravity
3. Codex
4. xAI
5. Kimi

### 6.2 Claude

调用：

```text
GET https://api.anthropic.com/api/oauth/usage
GET https://api.anthropic.com/api/oauth/profile
```

请求头：

```http
Authorization: Bearer $TOKEN$
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
```

要求：

- usage 是强依赖；
- profile 是可选增强；
- 支持 five-hour、seven-day、OAuth Apps、Opus、Sonnet、Cowork 等窗口；
- 支持现代 `limits[]` 中 Fable/Fable 5，并避免与 legacy `iguana_necktie` 重复；
- 展示 plan 与 extra usage。

### 6.3 Antigravity

project id 搜索顺序：

1. 顶层；
2. metadata；
3. attributes；
4. `gemini_virtual_project`；
5. 下载认证文件后检查顶层、installed、web。

依次尝试三个 quota endpoint：

```text
https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary
https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary
https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary
```

并行尝试可选订阅信息：

```text
https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
```

要求：

- 支持 groups 和 bucket snake/camel 字段；
- 只保留有效 remaining fraction；
- 按 5 小时、周、名称排序；
- 使用响应 Date header 修正服务端时钟；
- subscription 失败不影响主 quota；
- 三个 quota URL 按官方语义回退。

### 6.4 Codex

调用：

```text
GET  https://chatgpt.com/backend-api/wham/usage
GET  https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume
```

要求：

- 支持 `rate_limit`、`code_review_rate_limit` 和 `additional_rate_limits`；
- 支持 5 小时、周和月窗口；
- plan 优先读取 usage，再回退认证文件；
- 解析 subscription renewal；
- reset-credit details 失败不影响主 quota；
- 普通页只读显示 reset credits；
- 管理员页可消费 reset credit；
- 管理员操作生成新的 `redeem_request_id`；
- 成功后完整重查该账号；
- 同账号 reset 请求防重复。

### 6.5 Kimi

调用：

```text
GET https://api.kimi.com/coding/v1/usages
```

要求：

- 先展示 `limits[]`，再展示 usage summary；
- used 缺失时由 limit 和 remaining 推导；
- 支持 absolute reset、relative reset、ttl；
- 支持 duration、timeUnit 和 `TIME_UNIT_MINUTE`；
- label 缺失时生成稳定回退名称。

### 6.6 xAI

免费/Grok CLI 调用：

```text
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
GET https://cli-chat-proxy.grok.com/v1/billing
```

付费健康检查：

```text
GET  https://api.x.ai/v1/me
POST https://api.x.ai/v1/chat/completions
```

要求：

- weekly 与 monthly 并行；
- 周额度和月度 billing 周期必须原子合并；
- monthly billing rollover 不参与“最快恢复”；
- 付费账号仅展示健康状态，不伪造 quota total；
- free billing 无有效数据时按官方行为回退 paid-health。

## 7. 页面功能

### 7.1 共同功能

两个页面均包含：

- 总账号数、已加载数、错误数；
- 全部及五个 Provider tabs；
- 每个 tab 的账号数量；
- 默认排序；
- 最快恢复排序；
- 每页 20 个认证账号；
- 页码切换和越界收敛；
- 重新加载账号列表；
- 查询当前页全部额度；
- 单卡查询与刷新；
- idle、loading、success、error 四态；
- Provider 专属 quota body；
- 绝对和相对 reset 时间；
- 一小时内最早恢复项强调；
- Weekly/Session 恢复时间线。

首次进入仅加载认证文件，不自动查询所有 quota。

“查询全部额度”只查询当前页，最多 20 个认证账号。

### 7.2 排序与 UI 状态

`sessionStorage` 只保存：

```json
{
  "provider": "codex",
  "sortMode": "soonest"
}
```

不保存：

- token；
- quota；
- 原始认证文件；
- authIndex。

### 7.3 普通用户页

普通页视觉上不显示：

- 完整认证文件名；
- 邮箱；
- authIndex；
- account；
- project id；
- 原始认证字段。

显示稳定匿名标识：

```text
Claude · 7A3F21
Codex · B918D4
```

匿名标识由稳定认证文件标识计算摘要并截取，不把原始值写入可见 DOM、title、data 属性或日志。

普通页不包含 Codex consume 的 UI 入口，也不把 `admin/codexReset.ts` 打包进 `dist/quota.html`。构建测试必须确认普通页产物中不存在 `/rate-limit-reset-credits/consume`。

### 7.4 管理员页

管理员页显示：

- 完整认证文件名；
- 可安全展示的邮箱；
- plan 和状态；
- authIndex 等必要调试信息；
- Codex reset-credit 明细；
- Codex consume 操作。

管理员 reset 使用页面内确认对话框：

- 默认焦点为取消；
- Escape 关闭；
- 明确提示操作不可撤销；
- 请求期间锁定操作；
- 完成后焦点返回原按钮。

## 8. 状态、缓存和并发

共享状态：

```ts
interface AppState {
  auth: AuthState;
  accounts: AuthFile[];
  selectedProvider: Provider | 'all';
  sortMode: 'default' | 'soonest';
  currentPage: number;
  quotaCache: Map<string, QuotaState>;
  generation: number;
  batchLoading: boolean;
}
```

规则：

- quota 只保存在内存；
- 无 TTL；
- 账号列表刷新后保留仍存在账号的缓存；
- 删除已不存在账号的缓存；
- 身份失效时全部清空；
- 每次身份或账号列表代际变化时递增 generation；
- 异步结果写入前检查 generation；
- 页面级 AbortController 终止失效请求；
- 每卡防止重复 loading；
- 每个 Codex 账号防止重复 reset；
- batch 使用请求 ID 和 loading guard；
- batch 按 Provider 分组；
- Provider 组之间并行；
- 组内账号并行；
- 使用 `Promise.allSettled()`；
- 一个账号失败不终止整批。

不实现通用自动 retry、指数退避或 429 自动重试。只保留 Provider 语义回退。

## 9. 时间与时间线

页面使用单一共享分钟时钟：

- 在分钟边界更新；
- 页面重新可见时立即校准；
- 页面卸载时清理；
- 不为每行创建独立定时器。

时间线：

- Weekly：14 天；
- Session：3 天；
- Session 只显示真实 5 小时窗口；
- 支持前后周期；
- 支持 Today 和当前时间；
- 支持 past、live、upcoming；
- 支持 Codex reset-credit expiry tick；
- 只比较当前页账号；
- 没有可解析窗口时不显示。

最快恢复排序：

- 从有效 quota window 和 Codex 可用 reset credit 中提取最早未来时间；
- xAI monthly billing rollover 不参与；
- Codex subscription renewal 不参与；
- 未加载、失败或无 reset 的账号沉底；
- 沉底项保持默认稳定顺序。

## 10. 视觉与可访问性

视觉沿用现有 `cpa_quota/index.html`：

- 暖灰浅色主题；
- neutral 深色主题；
- Indigo 主色；
- 圆角卡片和胶囊按钮；
- Codex 淡紫渐变；
- Pro 金色徽章；
- 三档额度水位；
- 系统字体；
- 内联 SVG。

主题优先级：

1. `theme=light|dark`；
2. 系统 `prefers-color-scheme`；
3. 无显式 theme 时监听系统变化。

响应式要求：

- 最大宽度约 1280px；
- 桌面卡片最小宽度 360–380px；
- 窄 iframe 单列；
- Provider tabs 可横向滚动；
- 页头操作可换行；
- 时间线可横向滚动；
- 不设置固定 iframe 高度。

可访问性要求：

- Tabs 使用 tablist 语义；
- loading 使用 `aria-busy`；
- 状态通知使用有限的 `aria-live`；
- meter 使用 progressbar 语义；
- 状态不只依赖颜色；
- 支持 `prefers-reduced-motion`；
- 动态文本默认通过 `textContent` 渲染；
- 所有操作可使用键盘；
- 管理员对话框正确管理焦点。

## 11. 构建、测试和发布

### 11.1 构建命令

```json
{
  "scripts": {
    "dev:user": "vite --mode user",
    "dev:admin": "vite --mode admin",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "clean": "node scripts/clean.mjs",
    "build:user": "vite build --mode user",
    "build:admin": "vite build --mode admin",
    "build": "npm run clean && npm run build:user && npm run build:admin",
    "check:dist": "npm run build && git diff --exit-code -- dist"
  }
}
```

两个入口分别构建，避免 single-file 插件和多入口 chunk 冲突。`npm run build` 先由 `scripts/clean.mjs` 清空 `dist`；两个 Vite mode 均配置 `emptyOutDir: false`，分别只写入自己的固定文件名，避免第二次构建删除第一次产物。单独执行 `build:user` 或 `build:admin` 只更新对应文件，不代表完整发布构建。

构建产物必须：

- CSS、JS、SVG 全部内联；
- 无 `/assets/`；
- 无外部字体、CDN 和脚本；
- 无 source map；
- 无 CPA management key；
- 无测试认证数据；
- 包含可识别的页面版本和 commit 信息；
- CSP script hash 与最终内联脚本内容一致；
- 普通页不包含 Codex consume endpoint 或管理员写操作模块。

### 11.2 测试范围

Provider fixture 测试覆盖：

- URL、method、headers 和 `/api-call` body；
- 字符串/对象 body；
- snake/camel 字段；
- 缺失字段；
- 非 2xx；
- Provider 回退；
- reset 时间单位；
- Claude Fable；
- Antigravity project id、回退和时钟；
- Codex 所有窗口和 credits；
- Kimi 周期推导；
- xAI billing 合并与 paid fallback。

页面逻辑测试覆盖：

- Provider 归一化；
- disabled 过滤；
- auth-files 去重；
- tabs、排序、分页；
- sessionStorage；
- generation 隔离；
- 单卡和 batch 防重复；
- 身份失效清理；
- user/admin 能力差异；
- reset 交互。

时间线测试覆盖：

- Weekly 和 Session；
- DST 和时区；
- past/live/upcoming；
- Today；
- credit expiry；
- xAI monthly 排除规则；
- 空数据隐藏。

浏览器测试覆盖：

- URL token 读取和移除；
- `/auth/me` 成功、失败、过期；
- light/dark；
- 窄 iframe；
- tabs、分页、排序；
- 单卡和 batch；
- 管理员对话框；
- 无控制台错误；
- 无浏览器直连 Provider 请求。

### 11.3 CI

Pull Request 和 `main` push 执行：

```text
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
! grep -F '/rate-limit-reset-credits/consume' dist/quota.html
git diff --exit-code -- dist
```

源码变化但 `dist` 未同步提交时，CI 必须失败。

### 11.4 发布

发布步骤：

1. 更新页面版本；
2. 构建两个 HTML；
3. 提交源码与 dist；
4. CI 通过；
5. 创建 `vX.Y.Z` tag；
6. Nginx 切换到新 tag；
7. 执行验收；
8. 保留旧 tag 以便回滚。

## 12. 安全模型与已接受风险

### 12.1 保证项

本项目保证：

- CPA management key 不进入 HTML；
- CPA management key 不返回浏览器；
- Provider access token 不返回浏览器；
- Provider 请求继续通过 CPA `$TOKEN$` 注入；
- Sub2API token 不写入 Web Storage 或 Cookie；
- token 从当前 URL 中移除；
- HTML 页面请求的查询参数不转发给 GitHub；
- 浏览器不直接访问 Provider 域名；
- 普通页不在可见 DOM 中渲染完整账号身份；
- 动态文本不以未转义 HTML 注入。

### 12.2 已接受的残余风险

用户明确选择不增加 Sub2API quota gateway，也不使用 Nginx Lua/njs 做服务端 body 级限制。因此接受：

1. `/auth-files` 原始响应对能够打开普通页并调用 `/cpa/` 的用户可见；
2. 普通页视觉脱敏不构成数据保密边界；
3. `/v0/management/api-call` 是通用代理，用户可绕过页面 UI 自行构造请求；
4. 隐藏 Codex consume 按钮不构成管理员授权边界；
5. 只要普通用户能够调用同一 `/cpa/v0/management/api-call`，其理论上可以手工构造 consume 请求；
6. Nginx 注入 CPA key 防止 key 字符串泄漏，但不能限制该 key 的全部代理能力。

README 和 Nginx 示例必须显著注明这些风险，不得把普通页描述为服务端强隔离页面。

未来如需建立真正权限边界，应新增 Sub2API quota gateway：

- 服务端保存 authIndex 映射；
- 普通用户只获得匿名账号 ID；
- Provider URL/method/header 使用白名单；
- Codex consume 必须校验管理员角色；
- 不向普通用户返回原始 auth-files。

## 13. Nginx 约束

### 13.1 GitHub HTML 获取

Nginx 从固定 tag 获取：

```text
https://raw.githubusercontent.com/kael-aiur/cpa-quota-pages/v1.0.0/dist/quota.html
https://raw.githubusercontent.com/kael-aiur/cpa-quota-pages/v1.0.0/dist/quota-admin.html
```

客户端入口带 token，但 token 不得转发给 GitHub。`proxy_pass` 必须丢弃客户端查询参数：

```nginx
location = /quota.html {
    proxy_pass https://raw.githubusercontent.com/kael-aiur/cpa-quota-pages/v1.0.0/dist/quota.html?;

    proxy_ssl_server_name on;
    proxy_set_header Host raw.githubusercontent.com;
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_set_header Referer "";

    proxy_hide_header Content-Type;
    add_header Content-Type "text/html; charset=utf-8" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Cache-Control "private, no-store" always;
}
```

管理员入口使用相同的 GitHub 请求清理规则，并额外应用管理员入口控制。

### 13.2 CPA 转发

```nginx
location /cpa/ {
    # 先验证浏览器发送的 Sub2API Bearer token。
    auth_request /_sub2api_auth;

    # 该服务器本地文件只包含 proxy_set_header Authorization，且不进入 Git 仓库。
    include /etc/nginx/secrets/cpa-management-auth.conf;

    # 浏览器路径已包含 /v0/management/；这里只移除 location 匹配的 /cpa/。
    proxy_pass http://cpa_backend/;
}
```

`/etc/nginx/secrets/cpa-management-auth.conf` 的权限仅允许 Nginx 运行用户和管理员读取，内容形如 `proxy_set_header Authorization "Bearer 实际密钥";`。仓库中的示例配置只引用该文件，不保存实际密钥。

### 13.3 响应头

Nginx 必须设置：

- `Referrer-Policy: no-referrer`；
- `Cache-Control: private, no-store`；
- `X-Content-Type-Options: nosniff`；
- `Content-Security-Policy: frame-ancestors 'self'`，如 iframe 父页面不是同源，则改为明确列出的 Sub2API origin。

每个构建产物在 `<head>` 中内置构建时生成的 CSP meta。固定指令为 `default-src 'none'`、`style-src 'unsafe-inline'`、`img-src data:`、`connect-src 'self'`、`base-uri 'none'`、`form-action 'none'` 和 `object-src 'none'`；`script-src` 由构建脚本对最终内联脚本内容计算 base64 SHA-256 后生成标准 CSP hash source expression。

`script-src` 不使用 `unsafe-inline`；构建脚本必须在所有 JavaScript 内联完成后计算 hash，并在写入 CSP 后验证浏览器能够执行该脚本。`style-src 'unsafe-inline'` 仅用于内联样式表、额度宽度和时间线定位。`frame-ancestors` 不能由 meta CSP 生效，因此必须由 Nginx HTTP 响应头提供。

## 14. 发布验收标准

每个 release tag 必须满足：

1. `npm run typecheck` 通过；
2. `npm test` 通过；
3. `npm run build` 通过；
4. `git diff --exit-code -- dist` 通过；
5. 两个 HTML 均无外部 asset URL；
6. 两个 HTML 均不包含 CPA key；
7. Nginx 不把 token 查询参数发送到 GitHub；
8. `/auth/me` 验证成功和失败路径正确；
9. `/cpa/` 发往 CPA 的是 management key，而非 Sub2API token；
10. 五个 Provider fixture 均通过；
11. 普通页视觉脱敏正确；
12. 管理员 Codex reset 正常；
13. Weekly/Session 时间线正常；
14. 页面在窄 iframe、浅色和深色主题下可用；
15. 浏览器无非同源 Provider 请求；
16. 普通页产物不包含 Codex consume endpoint；
17. 两个页面的 CSP script hash 与最终内联脚本一致；
18. README 明确列出第 12.2 节的已接受风险。
