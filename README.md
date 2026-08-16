# cpa-quota-pages

两个自包含（single-file）的额度查询页面，部署在 Sub2API 前端 Nginx 上：

- `dist/quota.html` — 普通用户额度页（视觉脱敏、无重置能力）
- `dist/quota-admin.html` — 管理员额度页（可见账号身份、可执行 Codex 额度重置）

每个产物是一个不引用任何外部 asset 的 HTML 文件；浏览器只与部署域同源的
`/api/v1/*`（Sub2API 身份）和 `/cpa/*`（CPA management 代理）通信，从不直连任何
Provider 域名。页面内置构建期生成的 CSP（`script-src` 为最终内联脚本的 SHA-256
hash，不含 `unsafe-inline`）。

> **安全模型定位（务必先读）**：本项目提供的是 **入口门禁 + 密钥注入 + UI 脱敏**，
> 不是数据保密边界。普通页在已接受的残余风险模型下运行（见下文
> 「已接受的残余风险」，规格 §12.2）。在描述或评估 `/quota.html` 时，永远不要使用
> “服务端隔离”这类表述 —— 它不是，详见下文。

---

## 目录

1. [本地开发](#本地开发)
2. [构建与产物](#构建与产物)
3. [本地预览](#本地预览)
4. [部署：两个 URL](#部署两个-url)
5. [Nginx 与密钥注入](#nginx-与密钥注入)
6. [管理员授权契约](#管理员授权契约)
7. [发布与 tag 更新流程](#发布与-tag-更新流程)
8. [回滚](#回滚)
9. [源码版本（source revision）语义](#源码版本source-revision语义)
10. [已接受的残余风险（规格 §12.2）](#已接受的残余风险规格-122)
11. [未来建立真正权限边界的方向](#未来建立真正权限边界的方向)

---

## 本地开发

要求 Node.js ≥ 20.19（CI 使用 `.nvmrc` 固定的版本）。

```bash
npm ci            # 安装依赖（锁定版本）
npm run dev:user  # 用户页开发服务器（vite --mode user）
npm run dev:admin # 管理员页开发服务器（vite --mode admin）
```

常用校验：

```bash
npm run typecheck   # TypeScript 严格检查
npm test            # Vitest 单元/契约测试（含发布契约测试）
npm run build       # 构建两个单文件产物到 dist/
npm run test:e2e    # Playwright 浏览器测试（针对已构建的 dist/）
npm run check:dist  # 校验已提交的 dist 与当前源码干净重建一致
```

完整验收（与 CI 一致）：

```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
! grep -F '/rate-limit-reset-credits/consume' dist/quota.html
grep -F '/rate-limit-reset-credits/consume' dist/quota-admin.html
! grep -F '/assets/' dist/quota.html
! grep -F '/assets/' dist/quota-admin.html
git diff --check
npm run check:dist
git diff --exit-code -- dist
```

## 构建与产物

```bash
npm run build        # = clean + build:user + build:admin
```

产物要求（`npm run check:dist` 与单元测试共同守护）：

- `dist/` 只包含 `quota.html` 和 `quota-admin.html`；
- 无 `/assets/` 引用、无外部字体/CDN/脚本、无 source map；
- 不含 CPA management key、不含测试认证数据；
- `<head>` 内置 `cpa-quota-version` / `cpa-quota-source-revision` /
  `cpa-quota-target` 三个 meta；
- CSP `script-src` hash 与最终内联脚本逐字节一致（构建后自校验，不一致直接构建失败）；
- **普通页不含 Codex consume 端点**（`/rate-limit-reset-credits/consume` 只出现在管理员页）。

## 本地预览

浏览器测试用 Playwright `webServer` 起 `vite preview` 服务 `dist/`。手动预览：

```bash
npm run build
npx vite preview --mode user   # http://127.0.0.1:4173/quota.html
```

注意：本地预览没有 Sub2API `/api/v1/auth/me` 与 `/cpa/` 后端，页面会停在
「身份验证失败」门禁。要看到完整 UI，用 `npm run test:e2e`（同源 mock 路由），
或在本地起一个把 `/api/v1/`、`/cpa/` 反代到真实服务的 Nginx。

## 部署：两个 URL

| URL | 入口门禁（auth_request） | 页面能力 |
| --- | --- | --- |
| `/quota.html` | `/_sub2api_auth` | 只读额度查询；账号身份以匿名哈希展示 |
| `/quota-admin.html` | `/_sub2api_admin_auth` | 完整账号身份 + Codex 额度重置 |

两个 location 都以固定 tag 从 GitHub raw 拉取，并以 `proxy_pass …?;` 结尾
**丢弃客户端查询字符串**，因此入口 URL 携带的 `?token=…`（Sub2API token）不会被
转发给 GitHub。页面在启动时读取并立即从地址栏移除该 token，且从不写入
Web Storage 或 Cookie。

## Nginx 与密钥注入

完整示例见 [`nginx/example.conf`](nginx/example.conf)。要点：

- `location = /quota.html` / `location = /quota-admin.html`：固定 tag raw URL
  （`…/v1.0.0/dist/quota.html?;`），`proxy_ssl_server_name on` +
  `Host raw.githubusercontent.com`（SNI/Host 正确），清空
  `Authorization` / `Cookie` / `Referer`，`Content-Type` 显式设为
  `text/html; charset=utf-8`，并输出 `Referrer-Policy: no-referrer`、
  `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` 和
  `Content-Security-Policy: frame-ancestors 'self'`（frame-ancestors 无法由
  meta CSP 生效，必须由 HTTP 头提供；若父 iframe 非同源，改为明确列出的
  Sub2API origin）。
- **必须 `proxy_hide_header` GitHub raw 注入的安全头**（`Content-Security-Policy`、
  `X-Frame-Options`、`X-Content-Type-Options`、`Strict-Transport-Security`、
  `Cross-Origin-Resource-Policy`、`Access-Control-Allow-Origin`）：GitHub raw
  对所有响应强制下发 `CSP: …; sandbox`（无 `allow-scripts`）和
  `X-Frame-Options: deny`，直接代理成 HTML 文档会**禁止全部脚本执行**且
  **无法 iframe 嵌入**——页面永远停在静态回退文案。不隐藏这些头，页面必坏。
- `location /cpa/`：先 `auth_request /_sub2api_auth`，再
  `include /etc/nginx/secrets/cpa-management-auth.conf;` 注入 CPA management
  key，最后 `proxy_pass http://cpa_backend/;`。浏览器路径已含
  `/v0/management/`，这里的尾部斜杠**只**剥掉被匹配的 `/cpa/` 前缀：
  `/cpa/v0/management/api-call → http://cpa_backend/v0/management/api-call`。
  不要在 proxy_pass 里再写 `/v0/management/`，否则路径会重复。

`/etc/nginx/secrets/cpa-management-auth.conf` 是服务器本地文件，**不进入本仓库**，
内容只有一行：

```nginx
proxy_set_header Authorization "Bearer <CPA_MANAGEMENT_KEY>";
```

权限收紧到仅 Nginx 运行用户与管理员可读（如 `chmod 640 root:nginx`）。它保证
CPA management key 字符串不进入 HTML、不返回浏览器，浏览器发出的 `/cpa/` 请求
上游侧携带的是 management key 而非 Sub2API token。

## 管理员授权契约

`/_sub2api_admin_auth` 是 **Sub2API 部署方提供** 的 `auth_request` 内部端点，必须在
**服务端完成管理员角色校验后仅对管理员返回 2xx**（成功）。静态 HTML 不解析角色：
`/quota-admin.html` 的管理员判定就是、也仅仅是这一个端点的返回值。

这个门禁保护的是 **HTML 入口**。在已接受的残余风险模型下，它**不**约束任意
`/cpa/v0/management/api-call` 请求体 —— 普通用户能调用同一个 `/cpa/` 代理（见
风险 3/5）。

## 发布与 tag 更新流程

1. 更新 `package.json` 的 `version`；
2. `npm run build`（两个 HTML 会盖上新版本号与源码 revision meta）；
3. 连同源码一起提交 `dist/`；
4. CI 全绿（typecheck / 单测 / 构建 / Playwright / dist 一致性）；
5. 创建并推送 `vX.Y.Z` tag（例如 `git tag v1.0.1 && git push origin v1.0.1`）；
6. 把 `nginx/example.conf` 中两处 raw URL 的 tag 从 `v1.0.0` 改为新 tag，同步更新
   实际部署配置并 `nginx -s reload`；
7. 执行验收（两个 URL 各自打开、管理员重置、普通页脱敏、控制台无错误）；
8. **保留旧 tag** 以便回滚。

raw URL 的 tag 一旦写错成 `main`，部署会变成不可追踪的漂移源，因此发布契约测试
（`tests/release/repositoryContract.test.ts`）强制 raw URL 使用固定 tag。

## 回滚

- **页面回滚**：把 `nginx/example.conf`（和实际部署配置）里的 tag 从 `v1.0.1` 改回
  `v1.0.0`，`nginx -s reload`。旧 tag 的产物仍在 GitHub raw 上，无需重新构建。
- **本仓库回滚**：`git revert` 或检出旧 tag 重建。`cpa-quota-source-revision` meta
  会告诉你在浏览器里实际跑的是哪个源码版本（见下节）。

## 源码版本（source revision）语义

两个 HTML 的 `<head>` 内置三个 meta：

- `cpa-quota-version` — `package.json` 的版本号；
- `cpa-quota-source-revision` — **构建该产物时所依据的源码 commit**（12 位短 SHA；
  CI 下取 `GITHUB_SHA`，本地取当时的 `git HEAD`）；
- `cpa-quota-target` — `user` 或 `admin`，标明这是哪个 bundle。

注意：`cpa-quota-source-revision` 是**源码 revision**，不等于最终落盘这些产物的
commit —— 因为 `dist/` 是与源码在同一个 commit 里一起提交的，产物必然构建于该
commit 之前，两者可以合法地不同。`npm run check:dist` 重建时会对这个自引用 meta
做归一化，除此之外逐字节比对。

## 已接受的残余风险（规格 §12.2）

用户明确选择**不**增加 Sub2API quota gateway，也**不**使用 Nginx Lua/njs 做服务端
body 级限制。因此以下六条是**已接受的残余风险**，不是待修复缺陷：

1. `/auth-files` 的**原始响应对能打开普通页并调用 `/cpa/` 的用户可见** —— Nginx 只
   验证 Sub2API token，不过滤响应体，账号身份等字段随原始响应返回浏览器。
2. **普通页的视觉脱敏不构成数据保密边界** —— 匿名哈希只是 UI 呈现层；持有 token 的
   用户可以通过 `/cpa/v0/management/auth-files` 直接读取原始数据。
3. **`/v0/management/api-call` 是通用代理，用户可绕过页面 UI 自行构造请求** ——
   任何能通过 `/_sub2api_auth` 的用户都能对该端点 POST 任意
   `authIndex`/`url`/`method`/`header`/`data` 组合。
4. **隐藏 Codex consume 按钮不构成管理员授权边界** —— 按钮只是不渲染在用户 bundle
   里（用户产物连端点字符串都不含），但端点本身没有服务端角色校验。
5. **只要普通用户能调用同一 `/cpa/v0/management/api-call`，理论上就可以手工构造
   consume 请求** —— 与第 4 条同源：消耗 reset-credit 的写操作缺乏服务端管理员
   校验。
6. **Nginx 注入 CPA key 防止 key 字符串泄漏，但不能限制该 key 的全部代理能力** ——
   密钥不进浏览器，但持有 Sub2API token 的用户实际上可以借道 `/cpa/` 使用该密钥
   的全部 management 代理能力。

因此：**普通页没有服务端隔离能力，不得如此宣传**。本项目的保证项（management
key 不进 HTML/不返回浏览器、Provider token 不返回浏览器、token 从 URL 移除、
查询串不转发 GitHub、浏览器不直连 Provider、动态文本不未转义注入）全部是上述
接受模型之内的保证。

## 未来建立真正权限边界的方向

如需消除上述风险，需新增 **Sub2API quota gateway**（不是本项目的部署配置能实现的）：

- 服务端保存 authIndex ↔ 匿名账号 ID 映射，普通用户只获得匿名 ID；
- Provider URL / method / header 使用服务端白名单；
- Codex consume 强制服务端管理员角色校验；
- 不向普通用户返回原始 `/auth-files`。

---

## 测试地图

| 位置 | 内容 |
| --- | --- |
| `tests/unit…`（各目录） | Provider 解析、逻辑、UI、状态并发、时间模型等 |
| `tests/browser/*.spec.ts` | Playwright 针对已构建 `dist/` 的浏览器测试 |
| `tests/release/repositoryContract.test.ts` | CI / Nginx / README 发布契约 |
| `build/cspHashPlugin.ts` + `tests/build` | CSP hash 注入与自校验 |
| `scripts/check-dist.mjs` | dist 与源码干净重建一致性 |
