# Task 6 report — Antigravity provider

状态：已完成，修复轮次 1 已追加。

## 变更

- 新增 `/Users/kael/workspace/github/kael-aiur/cpa-quota-pages/.worktrees/quota-pages-implementation/src/providers/antigravity/parser.ts`
  - project id precedence：top-level → metadata → attributes.project_id/projectId → attributes.gemini_virtual_project → downloaded top-level → installed → web。
  - malformed/empty/download failure returns `null`。
  - 支持 snake/camel quota fields、百分比/小数 fraction、非法 fraction 过滤、group 名称排序、5h 在 weekly 前、reset time 与 Date header offset。
  - 解析可选 subscription tier。
- 新增 `/Users/kael/workspace/github/kael-aiur/cpa-quota-pages/.worktrees/quota-pages-implementation/src/providers/antigravity/adapter.ts`
  - 三个 quota endpoint 顺序回退。
  - quota POST body 为 `{"project":"project-id"}`，subscription `loadCodeAssist` 独立并行、失败不影响 quota。
  - 2xx 但无有效 groups 时继续回退；至少一个 2xx 且最终无 groups 时返回空成功。
  - 403/404 作为最终错误优先状态。
  - 使用固定官方 User-Agent。
- 扩展 `ProviderQueryContext` 的可选 `downloadAuthFile`，供 project id 下载回退使用。
- 新增 Antigravity fixtures 与测试。

## 验证

- `npm test`：10 files / 74 tests passed。
- `npm run typecheck`：passed。
- `git diff --check`：passed。

## 修复轮次 1

- 新增 `firstAlias`/`firstText` helper：每个 snake/camel alias 独立归一化，空值或无效值不会遮蔽后续有效 alias。
- 修复 top-level、metadata、attributes、downloaded top-level/installed/web project 字段，以及 group label、bucket fraction/id/label/reset time 选择。
- 新增空 snake + 有效 camel 的 top/nested/downloaded/quota bucket 回归测试。

## 验证（修复轮次 1）

- `npm test -- tests/providers/antigravity.test.ts`：12 tests passed。
- `npm test`：10 files / 76 tests passed。
- `npm run typecheck`：passed。
- `git diff --check`：passed。

## Concerns

- `downloadAuthFile` 是 ProviderQueryContext 的可选扩展；没有该回调时，仅能使用 auth file 中已有的 project id。
- subscription payload 作为独立请求解析，quota summary 自身携带的 subscription 仅作为纯 parser 的支持路径。
