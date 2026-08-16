# Final-review fix wave — recovery seam (spec §9 + §7.1)

Base: `d5546ff`. Whole-branch review found ONE root cause with several symptoms.

## Root cause

Task 10's canonical recovery module `src/quota/resetSchedule.ts`
(`nextRecoveryMs` + `urgentRecoveryId`, implementing spec §9 extraction rules)
was dead code. `src/ui/renderApp.ts` carried a divergent ad-hoc `recoveryAt()`
that only read `data.windows[].resetAtMs` and took `Math.min` of whatever it
found, with no `now` filter.

Symptoms:

1. **Antigravity always sank** — quota lives in `groups[].buckets[]`, no
   top-level `windows`, so the ad-hoc reader saw `[]` → `null`.
2. **xAI always sank** — `windows: []`, recovery lives in
   `billing.resetAtMs` (weekly only) → `null`.
3. **Codex available reset credits not counted** — spec §9 requires "从有效
   quota window 和 Codex 可用 reset credit 中提取最早未来时间".
4. **Past reset times could win** — `Math.min` ignored `now`.
5. **§7.1 "一小时内最早恢复项强调" was entirely unimplemented.**

## What changed

- `src/ui/renderApp.ts`
  - Deleted the ad-hoc `recoveryAt()`. The replacement delegates to
    `nextRecoveryMs(entry.provider, quota.data, nowMs)` from
    `src/quota/resetSchedule.ts` (canonical module untouched).
  - `derivePage` gained a `nowMs` parameter; `renderApp` passes
    `options.now()` so recovery keys share the view's snapshot (and tick with
    the clock). Unloaded/failed/window-less accounts still produce `null` and
    sink below loaded ones, keeping their stable default order
    (`sortAccounts` unchanged).
  - `render` now computes, per visible card, `urgentRecoveryId(provider,
    quota.data, nowMs)` into `urgentWindowIds: Map<accountId, windowId>` and
    forwards it through `RenderOptions`.
- `src/ui/renderCard.ts` — `RenderOptions.urgentWindowIds?: ReadonlyMap`;
  `renderQuotaRegion` forwards the per-card id into `renderProviderBody`.
- `src/ui/renderProviderBody.ts` — `renderProviderBody(provider, data, nowMs,
  urgentWindowId?)`; `renderMeter(input, nowMs, urgent?)` adds:
  - `.quotaRow.urgent` class,
  - a TEXT badge `<span class="urgentBadge">即将恢复</span>`,
  - `aria-valuetext` gains "，即将恢复" and the row carries
    `aria-label="即将恢复"`.
  Text badge is the primary channel; class/color only reinforce it — urgency
  is never color-alone (dataviz status rule).
- `src/ui/providerBodies/{claude,antigravity,codex,kimi,xai}.ts` — thread
  `urgentWindowId` and mark the matching meter row (window `id ===
  urgentWindowId`). Applied at window-row level per §7.1 ("一小时内最早恢复项
  强调" — the earliest recovering ITEM).
- `src/styles/cards.css` — `.quotaRow.urgent .quotaModel` and `.urgentBadge`
  use the existing badge tokens (`--badge-bg/-text/-border`), which are
  hand-stepped for both light and dark themes; no status colors on text.
- `src/app/createQuotaApp.ts` — `handleQueryAll` passes `clock.getSnapshot()`
  to the new `derivePage` signature (same page membership the view renders).
- `tests/browser/helpers/fixtures.ts` + `routes.ts` — `FixtureAccount.resets`
  fields are all optional; the xAI weekly billing fixture is now built per
  account (`xaiWeeklyFor`) honoring `resets.weeklyMs`, so a spec can position
  an xAI weekly reset relative to other providers.

## Red/green evidence (TDD, red first)

`tests/ui/renderApp.test.ts` — 8 new tests, written and run BEFORE the fix:

RED (6 of 8 failing against the ad-hoc implementation):

```
 ❯ tests/ui/renderApp.test.ts (20 tests | 6 failed)
     × sorts an Antigravity bucket recovery before unloaded accounts
     × sorts xAI weekly billing recovery from windows:[] billing data
     × counts a Codex available reset credit as the soonest recovery
     × never lets a past reset time win the soonest slot
     × badges the earliest window recovering in under one hour with text + class
     × badges only the earliest urgent window, not every window under one hour
```

(The 2 non-failing ones — exactly-1h and past-recovery badge absence — are
boundary guards that must stay green.)

GREEN after the fix:

```
 ❯ tests/ui/renderApp.test.ts (20 tests | 20 passed)
```

Sort coverage details:

- Antigravity: `[u1, u2, ag]` (ag last by default) → `[ag, u1, u2]`.
- xAI: `windows: []` + weekly `billing.resetAtMs` → sorts above unloaded.
- Codex: windows at +5h vs claude at +2h, credit at +30m → codex first.
- Past: `ag` has only a past bucket reset (+(-1h)); `x` has +3h → `[x, ag]`
  (ad-hoc Math.min would have put `ag` first).

Urgency coverage: 30m → badge + `.urgent` + `即将恢复`; exactly 1h → no badge;
past → no badge; two sub-hour windows → only the earliest is badged.

## E2E coverage (tests/browser/quota-user.spec.ts)

New describe "user page: soonest sort across providers" (2 tests):

1. **soonest sort lifts an xAI weekly billing reset above claude windows
   (spec §9)** — claude session +2h vs xAI weekly billing +1h
   (`windows: []`, recovery only in `billing.resetAtMs`). Default order
   `[Claude, xAI]` flips to `[xAI, Claude]` in soonest mode. The old code
   returned `null` for xAI and could never lift it.
2. **badges the earliest sub-hour recovery with a text badge (spec §7.1)** —
   kimi session +30m gets exactly one `.quotaRow.urgent` with
   `.urgentBadge` text `即将恢复`; claude (+2h) gets none.

## Verification results

| Check | Result |
| --- | --- |
| `npm test` (unit, 31 files) | **326 passed** (318 before + 8 new) |
| `npm run test:e2e` (browser) | **51 passed** (49 before + 2 new) |
| `npm run typecheck` | clean, exit 0 |
| `npm run build` | both artifacts rebuilt |
| `npm run check:dist` | exit 0 (committed dist == clean rebuild) |
| `git diff --check` | clean (no whitespace errors) |

Bundle sanity: `dist/quota.html` contains the canonical logic markers
(`xai:weekly`, `即将恢复`), confirming `resetSchedule.ts` is now live in the
shipped artifact rather than dead code.
