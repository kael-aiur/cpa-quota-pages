# Task 7 report — Codex read-only quota provider

状态：已完成；接管了前一 agent 的中断工作。HEAD 起点为 `2abefeb`，接管时已有未提交的 `src/providers/codex/`、`tests/fixtures/codex/` 与 `tests/providers/codex.test.ts`；未盲目重写，先检查并在原有基础上补齐实现与回归测试。

## 变更

- 新增 `/Users/kael/workspace/github/kael-aiur/cpa-quota-pages/.worktrees/quota-pages-implementation/src/providers/codex/parser.ts`
  - 解析 `rate_limit`、`code_review_rate_limit`、`additional_rate_limits`，支持 snake/camel aliases 与嵌套 rate-limit payload。
  - 按 `limit_window_seconds` 识别 5 小时、周、月（672–744 小时月长），仅在 duration 缺失时使用 primary/secondary 的 5h/week legacy fallback。
  - 稳定窗口 ID 包含 scope 与 period；`allowed=false` / `limit_reached=true` 且 used 缺失时推导 100%。
  - usage plan 优先，认证文件与 nested/JWT（包括 canonical `https://api.openai.com/auth` claims）作为 fallback。
  - 订阅 renewal 独立于 quota reset，解析 usage/auth file/JWT 的 renewal 字段。
  - reset credits 仅保留 `reset_type=codex_rate_limits`、`status=available` 且 expiry 为未来的条目；保留 usage payload 的 available/applicable counts。
- 新增 `/Users/kael/workspace/github/kael-aiur/cpa-quota-pages/.worktrees/quota-pages-implementation/src/providers/codex/adapter.ts`
  - 只发 usage 与 reset-credit details 的 GET 请求。
  - 支持可选 `Chatgpt-Account-Id`，使用 Codex CLI User-Agent。
  - details 使用 8 秒 timeout；details 非 2xx/普通错误/超时记录 `creditDetailsError`，主 usage 成功仍返回；调用方 signal 已 abort 时传播取消。
  - 主 usage 非 2xx 统一抛出 `CpaApiError`。
  - `src/providers` 中严格不包含 `/rate-limit-reset-credits/consume`。
- 保留并扩展接管时已有 Codex fixtures 与测试，新增 month duration、`allowed=false`、nested/JWT canonical claims、usage credit counts、optional timeout/cancellation 与无 account header 回归覆盖。

## TDD / 红绿证据

- 接管后首次运行 `npm test -- tests/providers/codex.test.ts` 为红：Vitest 无法解析 `../../src/providers/codex/parser`，因为 Codex production modules 尚不存在。
- 补充 cancellation、canonical JWT、month/allowed 与 usage count 回归测试后，先分别观察到对应生产行为失败，再实现修复。
- 定向测试最终绿：`11 tests passed`。

## 最终验证

- `npm test`：11 test files / 87 tests passed。
- `npm test -- tests/providers/codex.test.ts`：11 tests passed。
- `npm run typecheck`：passed。
- `git diff --check`：passed。
- negative grep：`src/providers` 无 `/rate-limit-reset-credits/consume` 输出。

## 修复轮次 1

- 修复窗口 ID：加入稳定的响应来源 discriminator（scope/index + primary/secondary），保留 slug scope 与 period；重复 Spark、slug collision、同周期窗口现在 ID 唯一且同 payload 重复解析稳定。
- 支持 `limitReached` camel alias，补充 literal URL、details URL、User-Agent、`Chatgpt-Account-Id` header 断言，避免测试仅自引用导出常量。
- 保留 canonical nested JWT、caller abort、usage reset-credit count fallback 与 consume endpoint isolation 行为。

## 修复轮次 1 验证

- 红：新增 ID/camel alias/literal contract 测试后，定向测试先失败；窗口仍为旧 ID，camel `limitReached` 未推导 100%，且测试暴露常量自引用问题。
- 绿：`npm test -- tests/providers/codex.test.ts`：13 tests passed。
- `npm test`：11 files / 89 tests passed。
- `npm run typecheck`：passed。
- `git diff --check`：passed。
- negative grep：`src/providers` 无 `/rate-limit-reset-credits/consume` 输出。

## 修复轮次 2

- 将 additional 窗口 discriminator 从数组 index 改为内容身份驱动：稳定字段优先使用 `limit_name`/`limitName`/`metered_feature`/`meteredFeature`/`name`，以确定性短 hash 处理 slug collision；完全相同身份使用 occurrence 后缀。
- 标准 `rate_limit` 与 `code_review_rate_limit` 使用固定 `standard` discriminator，窗口 ID 保留 scope、period 与 window kind。
- 补充 `entry.limitReached` 与 `nested.limitReached` 的 scope-level reached 推导。
- 新增 additional 重排/前插身份稳定性、slug collision、完全重复项稳定唯一，以及 `rate_limit.limitReached=true` + used 20 推导 100% 测试。

## 修复轮次 2 验证

- 红：新增回归测试先失败：旧数组 index 出现在 ID 中，standard ID 不符合固定 discriminator，scope-level camel `limitReached` 未推导 100%。
- 绿：`npm test -- tests/providers/codex.test.ts`：13 tests passed。
- `npm test`：最终运行结果见下方；typecheck、diff-check、negative grep 均已重新执行并通过。

## 修复轮次 3

- 将 additional occurrence 分配下沉到最终窗口 semantic base ID：base 由 scope、period、window kind 与内容身份 hash 构成；只有完全相同 semantic base 的窗口才追加 occurrence。
- 同一 identity 的 primary/secondary、不同 duration，以及响应重排/前插不再互相改变 ID；完全相同语义重复项仍唯一且解析稳定。
- 稳定身份 hash 从 6 hex 延长为 12 hex（48-bit 目标长度）。
- 新增同名 primary-only/secondary-only 与同名不同 period 重排测试，并更新 hash 长度断言。

## 修复轮次 3 验证

- 红：新增语义重排与 hash 长度测试先失败；entry-level occurrence 导致 primary/secondary 或不同 period 重排时 occurrence 发生漂移，且旧 hash 只有 6 hex。
- 绿：`npm test -- tests/providers/codex.test.ts`：14 tests passed。
- `npm test`、`npm run typecheck`、`git diff --check` 与 negative consume grep：最终提交前重新运行并记录实际结果。

## Concerns

- 订阅 renewal 与 reset-credit 详情依赖后端/认证 payload 的字段存在；未知字段不会阻塞主 quota。
- 这是只读 provider；consume endpoint 有意留给后续管理员 Task 14，不在本任务源码中出现。
