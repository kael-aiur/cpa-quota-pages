# Task 16 Report: Secured Self-Contained HTML Artifacts

## Status

COMPLETE. Commit: see git log (`build: emit secured single-file quota pages`).

## What Was Built

### New modules

- **`build/buildInfo.ts`**
  - `readBuildInfo(environment?)` → `{ version, commit }`. Version comes from
    `package.json`. `commit` is the 12-char SOURCE REVISION: `GITHUB_SHA` when
    present (validated as hex, truncated/normalized to 12), otherwise
    `git rev-parse --short=12 HEAD`. Documented in-module as source revision,
    not the final artifact commit (dist is committed alongside sources, so the
    two can differ).
  - `finalizeQuotaHtml()` injects `cpa-quota-version`, `cpa-quota-source-revision`
    and `cpa-quota-target` metas at the `<!-- csp-injection-point -->` marker,
    with HTML-attribute escaping and idempotent re-runs.

- **`build/cspHashPlugin.ts`**
  - `cspHashPlugin({ target, buildInfo })` — a Vite plugin listed AFTER
    `viteSingleFile()` (post-plugin array order = generateBundle order), so it
    operates on the fully inlined document.
  - Pipeline: finalize metas → extract the FINAL inline `<script>` text →
    `createHash('sha256').update(text).digest('base64')` → inject the CSP meta
    at the marker → re-parse the finished HTML and re-verify the hash matches
    (`verifyCspHash`), failing the build on mismatch or on a missing marker.
  - Fixed directives: `default-src 'none'; style-src 'unsafe-inline'; img-src
    data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src
    'none'; script-src 'sha256-<hash>'`. `script-src` is hash-only — NO
    `'unsafe-inline'` for scripts. Exported helpers: `extractFinalInlineScript`,
    `computeScriptHash`, `buildCspContent`, `verifyCspHash`.

- **`src/admin/resetFlow.ts`** (necessary source refactor, see below)

### Modified

- **`vite.config.ts`** — wires `cspHashPlugin` after `viteSingleFile()` for both
  modes; `emptyOutDir: false` unchanged.
- **`templates/quota.html` / `templates/quota-admin.html`** — added the
  `<!-- csp-injection-point -->` marker in `<head>`.
- **`dist/quota.html` / `dist/quota-admin.html`** — regenerated secured
  artifacts (committed with the sources).

## Key Finding: Admin Write Path Leaked into the User Bundle

The artifact-isolation test caught a real defect: `dist/quota.html` contained
the strings `consumeCodexResetCredit`, the reset dialog copy (`重置 Codex 额度`,
`确认重置`, …) even though `/rate-limit-reset-credits/consume` itself was
correctly absent. Root cause: `createQuotaApp` accepted a
`consumeCodexResetCredit` option and embedded the whole confirm-dialog flow,
so the shared (user) bundle compiled in the property names and dialog strings.

**Fix**: moved the confirm dialog + consume call into a new admin-only module
`src/admin/resetFlow.ts` (`createResetRequestHandler`). The app root now
exposes only an `onResetRequest?: (bridge: QuotaResetBridge) => void` option;
when the reset button is clicked it builds a `QuotaResetBridge` (account,
provider query context, store-publish callback) and hands it to the admin
handler, which closes over the concrete capability. The admin entry wires
this; the user entry passes nothing. The dialog message was also upgraded to
explicit irreversible copy (`此操作不可撤销…`). After the refactor the user
artifact contains zero admin markers (capability name, module name, dialog
copy, endpoint) while `dist/quota-admin.html` contains the consume endpoint.

## Verification

- TDD: `tests/build/cspHashPlugin.test.ts` (25 tests) written first; confirmed
  red (module-not-found) before implementation, green after.
- Targeted: `npm test -- tests/build/cspHashPlugin.test.ts` → 25/25 pass.
- Full suite: `npm test` → **289/289 pass** (264 prior + 25 new), three
  consecutive clean runs.
- `npm run typecheck` → clean.
- `npm run build` → both artifacts secured; single-mode `build:user` /
  `build:admin` each preserve the sibling (`dist` contains exactly the two
  tracked outputs).
- Brief greps: `/rate-limit-reset-credits/consume` FOUND in
  `dist/quota-admin.html`; ABSENT from `dist/quota.html`; `/assets/` ABSENT
  from both; no `sourceMappingURL`; no script `src=`; no external link/font/CDN.
- Artifact mutation tripwire: flipping one byte of the final inline script
  makes `verifyCspHash` fail (both in unit tests and against the real dist
  files).
- Secret hygiene: neither artifact contains `sk-ant-`, private-key PEM
  markers, `GITHUB_TOKEN`, or JWT-shaped strings.

## Notes / Concerns

1. **Pre-existing flaky test (not introduced here)**:
   `tests/app/createQuotaApp.test.ts > "queries every visible account in
   batches of at most the page size (max 20)"` times out at 20s intermittently
   under parallel-worker CPU starvation — it reproduced on the pristine
   baseline (git stash) as well. Mitigation applied in this task: the new
   artifact tests no longer run `npm run build` inside the suite when the
   tracked dist files exist (they read the committed artifacts, rebuilding
   only if missing), which removes the heaviest concurrent load. The flake is
   still latent on loaded machines; recommend raising its timeout or
   increasing `testTimeout` in a follow-up.
2. The brief mentions "README documents the latter as source revision" — no
   README.md exists in the repo yet (the spec's structure includes one; it
   belongs to the release task 17). The source-revision semantics are
   documented in `build/buildInfo.ts` instead; flag for Task 17 to carry into
   the README.
3. The Vite module-preload shim survives in the single-file bundle (it is part
   of the inlined module script, hashed by CSP like the rest). It issues no
   network requests on a fully-inlined page.

## Fix Round 1 (2026-08-15)

### I-1: `check:dist` could never pass after a commit (self-referential revision meta)

The committed dist embeds the source revision of the PREVIOUS commit — the
revision is stamped from HEAD at build time, while dist is committed in the
same commit it was built from, so a clean rebuild always stamped the new HEAD
and `git diff --exit-code -- dist` always reported a difference (red evidence
captured: exit 1 with only the two `cpa-quota-source-revision` lines differing).

**Fix**: `check:dist` now runs `scripts/check-dist.mjs`, which
1. requires a clean `dist` tree (`git diff --exit-code -- dist`),
2. captures the committed `cpa-quota-source-revision` value from each tracked
   artifact via `git show HEAD:dist/<name>` (fails loudly when the meta is
   missing or empty),
3. rebuilds (`npm run build`),
4. fails loudly unless dist contains exactly `quota.html` + `quota-admin.html`,
5. rewrites the freshly stamped revision meta in the rebuilt files to the
   captured committed value — normalizing ONLY this build-time self-reference;
   every other byte must still match,
6. re-runs `git diff --exit-code -- dist`.

Verified green: `npm run check:dist` exits 0 on the post-fix HEAD (the two
pre-existing projectConfig tests that drive `check:dist` under mutation still
fail it as required — they passed in the full suite).

### M-2: tautological `computeScriptHash` assertion

`tests/build/cspHashPlugin.test.ts:109-111` compared the function against a
conditional containing itself. Replaced with a known vector:
`computeScriptHash('console.log("cpa-quota");') === 'BmzNxl6Z287dJZ8rgof1LPFbC/RGO6Nn9FRttfeRWcE='`
(precomputed independently with node crypto).

### M-4: dead reset button label in user dist

`dist/quota.html` contained a dead `重置额度` string — the reset button label
lived in shared `renderCard` but the button never renders in user mode.

**Fix**: `RenderOptions.canConsumeCodexReset` (renderCard/renderApp) became
`resetAction: { label: string } | null` — the label is injected by the admin
flow. `createQuotaApp` gains `resetButtonLabel?`; the admin entry passes
`RESET_BUTTON_LABEL` (new export from `src/admin/resetFlow.ts`, admin-only
module), so the string only enters the admin bundle.

Reviewer premise partially corrected: the two `重置券` occurrences in user dist
are NOT dead — timeline credit marks render live in user mode from read-only
Codex credit data (asserted by `tests/ui/renderTimeline.test.ts`). Likewise
`可用重置额度` is the read-only Codex quota meta label (Task 7 contract). The
artifact test therefore asserts `重置额度` appears ONLY as part of the allowed
`可用重置额度` occurrences, and that the admin dist still carries the button
label constant.

### Verification

- Red: new user-dist reset-copy test failed on pre-fix dist; old `check:dist`
  exited 1 on HEAD.
- Targeted: cspHashPlugin + renderCard + renderApp + createQuotaApp → 74/74.
- Full suite: 289/290 — the sole failure is the documented pre-existing flaky
  test (`queries every visible account in batches of at most the page size`),
  which passes in isolation and reproduced on the pristine baseline before
  this round.
- `npm run typecheck` clean; `npm run build` clean; `npm run check:dist`
  exits 0; `git diff --check` clean.
- Sources + tests + dist committed together.

## Fix round 1: eliminate the flaky full-suite failure (Task 16 follow-up)

Baseline at HEAD feedf67 (investigation BEFORE fixing, no blind timeout bumps):

1. Single test `queries every visible account in batches of at most the page
   size` run 5x in isolation: 5/5 green.
2. Full suite runs: run 1 → 2 failed (both cspHashPlugin revision-meta), run 2
   → 3 failed (the target app test + the same 2 build tests). The target
   failure mode is `Error: Test timed out in 20000ms` at
   tests/app/createQuotaApp.test.ts:259 — a wall-clock timeout, not an
   assertion mismatch or unhandled rejection.
3. Code reading:
   - `src/app/createQuotaApp.ts` `handleQueryAll` loops page-sized chunks
     sequentially; every `store.setQuota*` publish synchronously re-renders the
     ENTIRE page (`store.subscribe(() => render())` → `renderApp` rebuilds
     stats + all cards + pagination + timeline via DOM `h()` calls). With 25
     accounts that is 25 rendered cards × ~40+ publishes of full-DOM rebuild
     per query-all, while sibling vitest workers run REAL `npm run build`
     (vite) from tests/build/projectConfig.test.ts on an 8-core machine —
     classic event-loop starvation, so `vi.waitFor`'s 50ms-interval polls and
     the awaited microtask chains get starved past the 20s test cap.
   - No shared mutable state, sessionStorage, or missing-await race found: the
     store coalesces re-entrant publishes (MAX_PUBLISH_PASSES + microtask
     deferral), the test's afterEach clears sessionStorage/roots, and the mock
     `apiCall` resolves immediately.

Root cause (app test): load-bound wall-clock blowup — 25 accounts × full-page
DOM rebuild per store publish under 4-6 parallel jsdom workers also driving
real vite builds.

Fix (app test): reduced work + explicit generous timeout (Task 9 precedent of
30_000ms). Fixture 25 → 12 accounts with `pageSize: 5` — still THREE serialized
batches (>2, the minimum that proves chunking), while the rendered page drops
from 25 cards to 5 (~5x cheaper per publish). Timeout 20s → 30s. The hard >20
RangeError cap stays covered by tests/app/actions.test.ts (rejects /20/).

Second, deterministic failure found and fixed during verification (a clean
checkout could never go green without it): `tests/build/cspHashPlugin.test.ts`
"carries build version and source revision metas" asserted the COMMITTED
dist's `cpa-quota-source-revision` equals `readBuildInfo().commit` (current
HEAD). But the revision is stamped from HEAD at build time and dist is
committed in the same commit it was built from, so the committed artifact
always carries the PARENT commit's sha — the exact build-time self-reference
that scripts/check-dist.mjs documents and normalizes. The test only passed in
the Task 16 session because the working-tree dist happened to be dirty
(rebuilt with HEAD's stamp); it failed 3/3 on a clean tree (red evidence:
expected content="feedf674d9bb", received content="b2f46696d0d9"). Rewritten
to assert presence + `^[0-9a-f]{12}$` format of the meta in both artifacts;
byte-exact rebuild equivalence remains enforced by `npm run check:dist`, which
exits 0 on this tree.

Verification (all AFTER both fixes):
- Modified single test in isolation: 5/5 green.
- Full suite (`npx vitest run`): 3/3 consecutive full-suite runs green —
  30/30 files, 290/290 tests each run.
- `npm run typecheck` clean; `npm run check:dist` exits 0 ("committed dist
  matches a clean rebuild of the current sources"). Sources unchanged, so no
  dist rebuild/commit was needed (the only dist bytes a rebuild touches are
  the self-referential revision stamp, restored to committed state).

### Fix round 1 verification audit (independent re-run, 2026-08-15)

The fix commit (81f0466) was re-verified from scratch rather than trusted;
code and wiring were re-read and every verification claim re-run.

Re-investigation findings (all confirmed against HEAD):
- `src/app/createQuotaApp.ts` `handleQueryAll` loops page-sized chunks
  sequentially; every store publish synchronously re-renders via
  `store.subscribe(() => render())`. `src/ui/renderApp.ts` `derivePage` →
  `paginate` renders ONLY the current page slice, so `pageSize: 5` really does
  cut per-publish DOM work ~5x versus 25 cards.
- The >20 hard cap is independently asserted in `tests/app/actions.test.ts:77`
  (`rejects.toThrow(/20/)`), so shrinking this fixture loses no coverage.
- No functional race exists: the store coalesces re-entrant publishes
  (`MAX_PUBLISH_PASSES` + microtask deferral in `src/app/state.ts`), the
  mock `apiCall` resolves immediately, afterEach clears sessionStorage/roots,
  and `tests/setup.ts` restores URL and real timers per test.
- The sibling-worker load source is real: `tests/build/projectConfig.test.ts`
  spawns actual `npm run build` / `build:user` / `build:admin` (vite) runs —
  several full builds in parallel workers while the app test churns full-DOM
  rebuilds.

Comparative reproduction under deliberate starvation (8 `yes` CPU burners,
load average 35):
- PRE-fix test (temporarily restored from feedf67): full suite →
  `FAIL tests/app/createQuotaApp.test.ts > queries every visible account in
  batches of at most the page size (max 20)` — `Error: Test timed out in
  20000ms` at tests/app/createQuotaApp.test.ts:259. Failure mode confirmed:
  wall-clock timeout, NOT an assertion mismatch or unhandled rejection.
- Fixed test (HEAD, same 8 burners, same command): 30/30 files, 290/290 tests
  green.
- Both trees also ran 3x full suites without burners: pre-fix happened to stay
  green (machine idle — the flake is load-dependent, which is why it was
  intermittent), fixed green 3/3.

Note: the same `projectConfig`/`cspHashPlugin` build-running tests re-stamp
dist's `cpa-quota-source-revision` from HEAD during suite runs, so `dist`
shows a 2-line (stamp-only) diff after any full suite. Verified the delta is
exactly the 4 self-referential revision-stamp lines and nothing else; restored
via `git checkout -- dist`. `npm run check:dist` exits 0 ("committed dist
matches a clean rebuild of the current sources"), so committed dist is correct
and needs no rebuild/commit.

Final verification on the clean tree (commit 81f0466, no code changes needed
this session — the committed fix is correct):
- Single test in isolation: 5/5 green.
- Full suite (`npx vitest run`): 3/3 consecutive runs green — 30/30 files,
  290/290 tests each.
- `npm run typecheck` clean; `npm run check:dist` exit 0; working tree clean.

Root cause (confirmed): load-bound wall-clock blowup — 25 accounts × full-page
DOM rebuild on every store publish under parallel jsdom workers that are
simultaneously running real vite builds, starving the event loop past the 20s
test timeout. Fix: reduced fixture (12 accounts, `pageSize: 5` — still three
serialized batches, >2, proving chunking) + explicit 30s timeout (Task 9
precedent).
