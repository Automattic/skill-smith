# Code Plan: Reconcile the skip-misconfigured-agents branch with current `trunk`

## Overview

This is a **reconciliation, not a feature build**. The `skip-misconfigured-agents` branch (PR #45) is 89 commits behind `trunk` and reports `CONFLICTING`; merging current `trunk` into it conflicts in exactly 19 files. The feature (skip statically misconfigured agents across every phase of a run) already shipped across the prior `base`, `review-1`, and `review-2` runs, and is pinned by nine existing test files plus the testing-project config smoke check. The plan performs a single `trunk`→branch merge commit, resolves all 19 conflicts so **both** sides survive (`trunk`'s Biome 2.5.0 "WordPress" reformat + nested-scenario-folders + subscription-auth docs **and** the branch's skip feature), installs dependencies so the Biome 2.5.0 binary lands, re-runs the formatter, and proves the result green against the full local guardrail set. The order is strict and dependency-linked: **merge → resolve the four hard files → resolve the third two-sided file → resolve the README prose → resolve the mechanical rest → `npm install` (both workspaces) → `npx biome format --write .` → run every guardrail → reviewer-inspect the one unguarded item (`scenarioDirOf`) → commit the merge**. No new component, dependency, changeset, or interface is introduced; nothing in the feature is re-litigated, redesigned, or extended.

Verified at the current worktree HEAD (`79dfada`, a descendant of the research's `56b4d2c` that adds only `.pipelines/` commits; merge-base with `trunk` is still `9541456`, branch is 89 behind): a trial `git merge --no-commit --no-ff 95c86bd` produces exactly the 19 conflicting files (all `UU`, zero add/delete), `package.json`/`package-lock.json`/`biome.json`/`src/progress/types.ts`/`testing-project/playwright.config.ts` auto-merge clean (status `M`, not conflicted), and the three `trunk` changesets land as clean adds. The trial merge was aborted; HEAD is unchanged.

## Guardrail scopes

All six project guardrails are fixed commands with no scoped gates, so there is no `{scope}` value to fill.

| Gate | Scope |
| ---- | ----- |
| (none — all guardrails are fixed commands) | None |

## E2E test plan

This reconciliation **adds no new tests**. The acceptance surface is the already-shipped suite plus the repository guardrails, re-driven against the merged tree. Each flow below is a guardrail or inspection a code-writer automates by running it and a reviewer can manually re-drive. The nine skip-feature test files are: `runnability.test.ts`, `providers-required-env.test.ts`, `iteration-report-skipped.test.ts`, `project-args.test.ts`, `config-loads.test.ts`, `skip-misconfigured.test.ts`, `summary.test.ts`, `progress-render.test.ts`, `progress-tracker.test.ts`. All paths below are under the worktree root `/Users/darerodz/Code/skillsmith/.claude/worktrees/37-skip-misconfigured-agents-v3`.

The full guardrail set is run from the worktree root **after** `npm install` (root) and `npm install --prefix testing-project`:

```
npm install                                      # root — installs Biome 2.5.0 binary into node_modules
npm install --prefix testing-project             # testing-project workspace
npx biome format .                               # verify, no rewrite — 0 files need reformatting
npm run lint                                     # biome lint .
npm run typecheck                                # tsc --noEmit
npm test                                         # node --import tsx --test src/__tests__/*.test.ts (27 files)
npm --prefix testing-project run check:config    # config import graph loads without throwing
npx tsx scripts/validate-changesets.ts           # parses changeset contents
npx changeset status --since=origin/trunk        # reports @automattic/skillsmith bumped at minor
```

### Flow 1: PR is mergeable into `trunk` (no remaining conflicts)

- **Steps:** After committing the merge, evaluate the branch's merge state against `trunk` (e.g. `git merge-base --is-ancestor`-style check that `trunk` is incorporated; in practice, the merge commit's second parent is the `trunk` tip and `git diff --name-only --diff-filter=U` is empty). Confirm GitHub no longer reports PR #45 as `CONFLICTING`.
- **Expected:** No conflict markers remain in any file; the branch contains `trunk`'s tip as an ancestor of HEAD; PR #45 is no longer `CONFLICTING`.
- **Traces to:** Acceptance criterion 1 (no remaining merge conflicts, no longer `CONFLICTING`).

### Flow 2: Every one of the 19 files retains both sides

- **Steps:** Inspect each of the 19 previously-conflicting files in the committed merge: `README.md`, `examples/skillsmith.config.ts`, `src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`, `src/__tests__/summary.test.ts`, `src/config/types.ts`, `src/improvement/improver.ts`, `src/pipeline/agent-loop.ts`, `src/pipeline/pipeline.ts`, `src/progress/render.ts`, `src/progress/tracker.ts`, `src/providers/anthropic-api.ts`, `src/providers/gemini-api.ts`, `src/providers/openai-api.ts`, `src/providers/types.ts`, `src/reports/iteration-report.ts`, `src/reports/summary.ts`, `testing-project/eval/utils/verify-e2e.ts`, `testing-project/skillsmith.config.ts`.
- **Expected:** Each file contains both `trunk`'s intervening change (reformat, plus nested-folders/subscription-auth content where applicable) and the branch's skip-feature contribution; neither side dropped or weakened; no code deleted solely to resolve a conflict; no conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain.
- **Traces to:** Acceptance criterion 2.

### Flow 3: Formatting and lint are green under Biome 2.5.0

- **Steps:** With dependencies installed (Biome 2.5.0 in `node_modules`), run `npx biome format .` (verify, no rewrite) and `npm run lint`.
- **Expected:** Both exit 0; the formatter reports no files needing reformatting; lint reports no errors. (Note: `noUnusedImports` warnings exit 0 — see Flow 9.)
- **Traces to:** Acceptance criterion 3.

### Flow 4: Typecheck is green, including at the two meeting points

- **Steps:** Run `npm run typecheck`.
- **Expected:** Exit 0, including (a) the per-scenario `runScenario` call site in `src/pipeline/pipeline.ts`, which must carry `trunk`'s `scenarios: args.runCtx.scenarios` together with the branch's `agentFilter: effectiveFilter` and `skipped: args.runCtx.skipped`; and (b) the 4-argument `writeRunReport(runDirectory, runId, mergedScenarios, runnability.skipped)` signature in `src/reports/iteration-report.ts` and its call sites in `pipeline.ts`.
- **Traces to:** Acceptance criterion 4.

### Flow 5: The shipped skip behavior is observably unchanged (full suite green)

- **Steps:** Run `npm test`.
- **Expected:** Exit 0 with all 27 test files green (the branch's 26 plus `trunk`'s `scenario-filter-selection.test.ts`; `codex.e2e.test.ts` self-guards on `CODEX_E2E=1` and is a no-op without it). The nine skip-feature files pass **as written**, collectively demonstrating: per-provider static misconfiguration detection; cross-phase skip (skipped agent not invoked/provisioned/accounted/re-selected); role-aware consequences (skipped test agent excluded from its lane; skipped judge stops the run before any post-run hook or report; skipped improver finishes the current iteration then halts; multi-role takes the most-severe consequence); exit codes `0`/`1`/`2` with configuration-skip precedence and no vacuous pass; once-per-run id-and-reason surfacing in both the CLI summary and the report's top-level `skipped` array; early-at-detection announcement with the end-of-run summary unchanged and no early announcement when there are no skips; and the hook-readable skipped set.
- **Traces to:** Acceptance criteria 5, 6, 7, 8, 9 (the integration test `skip-misconfigured.test.ts` exercises all-test-misconfigured → exit 2 non-vacuous, judge-misconfigured → stop before post-run, improver-misconfigured → finish-iteration-then-halt, fail+skip → exit 2 precedence; `summary.test.ts` exercises the no-skip / clean-pass-with-skip / empty+skip / fail+skip cases).

### Flow 6: `trunk`'s nested-scenario-folders work is intact

- **Steps:** Confirmed via the full `npm test` (Flow 5) — `trunk`'s `scenario-filter-selection.test.ts` and the `src/scenarios/selection` nested-ID logic pass; `src/pipeline/pipeline.ts` imports from `../scenarios/selection` and uses `selectScenariosByNormalizedFilters` with the `id` field on the `runScenarios` map.
- **Expected:** The full suite passes (not only the skip subset), proving nested-folders behavior survived.
- **Traces to:** Acceptance criterion 5 (nine tests as written) and the spec's Requirement 7.

### Flow 7: The `testing-project` import-cycle fix is preserved

- **Steps:** Run `npm --prefix testing-project run check:config`. Inspect `testing-project/eval/utils/verify-e2e.ts`.
- **Expected:** `check:config` exits 0 (the config import graph loads without throwing); `config-loads.test.ts` passes (in Flow 5); `verify-e2e.ts` derives project names from caller-passed parameters plus `./project-args` (`projectArgs`), with **no** module-initialization-time `import config` back-edge, and forwards the runnable set order-preservingly (4-arg `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)`).
- **Traces to:** Acceptance criterion 7.

### Flow 8: Changesets stay coherent

- **Steps:** Run `npx tsx scripts/validate-changesets.ts` and `npx changeset status --since=origin/trunk`.
- **Expected:** Both exit 0; status reports `@automattic/skillsmith` bumped at `minor` (not patch-only, none-only, empty, or error). The three branch changesets are unchanged: `skip-misconfigured-agents.md` (minor), `early-skip-announcement.md` (patch), `initial-scaffolding.md` (none). The three `trunk` changesets landed clean. No changeset deleted, emptied, downgraded, or added.
- **Traces to:** Acceptance criterion 8.

### Flow 9: Minimal change, no process vocabulary, no orphaned imports

- **Steps:** Review the full reconciled diff against the pre-reconciliation branch tip. Eyeball `npm run lint` output for `noUnusedImports` warnings.
- **Expected:** The diff contains only conflict resolutions and formatter output — no gratuitous refactors. No phase names, no spec/design/plan references, no acceptance-criteria or task identifiers anywhere in code, comments, tests, or documentation (especially the merged README prose and example-config comments). No orphaned imports (e.g. a leftover `UserFacingError` after `trunk`'s `filterScenarios` deletion, or a stray `SkippedAgent`/`projectArgs`).
- **Traces to:** Acceptance criteria 2 (no gratuitous deletion), 9 (minimal), and Requirement 10 (no process vocabulary).

### Flow 10: Nested `scenarioDirOf` survived (reviewer-inspection only — the one unguarded item)

- **Steps:** Inspect the committed `testing-project/eval/utils/verify-e2e.ts`. Confirm the `scenarioDirOf` helper body is **`trunk`'s nested-path form** — it anchors on the `scenarios` path segment (`lastIndexOf('scenarios', specIndex - 1)`) and joins nested segments with `/` to yield IDs like `blocks/counter` — and **not** the branch's flat-only immediate-parent form.
- **Expected:** The committed file keeps `trunk`'s nested `scenarioDirOf` body. **No automated guardrail catches a regression here** (no unit test imports `verify-e2e.ts`'s `scenarioDirOf`; it only affects a live nested-scenario Playwright e2e run, which is not part of `npm test`). This is design-verifiable by inspection only.
- **Traces to:** Acceptance criterion 5 / spec Requirement 7 (nested-folders intact) and the design's "one unguarded failure mode."

## Tasks

> All tasks are **`e2e`-typed**. This is a reconciliation that must **preserve already-shipped, already-tested behavior** — the correctness oracle is the existing suite plus the guardrails (run as end-to-end checks against the merged tree), not new unit tests written via a TDD RED phase. No task introduces a new unit test; the design forbids new behavior, new components, and (per Requirement 9) gratuitous change. Tasks are strictly ordered and dependency-linked: the merge must exist before any conflict can be resolved, all conflicts must be resolved before install/format, and install must precede format (the load-bearing toolchain-order point — the local binary is 2.4.12 until `npm install` runs).

### Task 1: Create the `trunk`→branch merge commit (leave the 19 conflicts staged for resolution)

- **Goal:** Incorporate current `trunk` (tip `95c86bd`) into the branch via a single `git merge` from the current branch HEAD, producing exactly the 19 known content conflicts and the clean auto-merges, without committing yet.
- **Type:** e2e
- **Files to change:** none authored in this task — this is the VCS operation that *produces* the conflicted working tree. The merge brings in `trunk`'s clean files (e.g. `src/scenarios/selection.ts`, `src/__tests__/scenario-filter-selection.test.ts`, the three `trunk` changesets) and auto-merges `package.json`, `package-lock.json`, `biome.json`, `src/progress/types.ts`, `testing-project/playwright.config.ts`.
- **Changes:**
  - From branch HEAD, run `git merge --no-ff 95c86bd` (the `trunk` tip). Expect it to stop with conflicts (exit non-zero) rather than completing — do **not** pass `--abort`.
  - Confirm the conflict set is **exactly** the 19 files (no more, no fewer; all `UU`): `README.md`, `examples/skillsmith.config.ts`, `src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`, `src/__tests__/summary.test.ts`, `src/config/types.ts`, `src/improvement/improver.ts`, `src/pipeline/agent-loop.ts`, `src/pipeline/pipeline.ts`, `src/progress/render.ts`, `src/progress/tracker.ts`, `src/providers/anthropic-api.ts`, `src/providers/gemini-api.ts`, `src/providers/openai-api.ts`, `src/providers/types.ts`, `src/reports/iteration-report.ts`, `src/reports/summary.ts`, `testing-project/eval/utils/verify-e2e.ts`, `testing-project/skillsmith.config.ts`.
  - Confirm (1-line checks) that `package.json`, `package-lock.json`, `biome.json`, `src/progress/types.ts`, and `testing-project/playwright.config.ts` are **auto-merged (not conflicted)**, and that the three `trunk` changesets (`claude-code-subscription-auth.md`, `nested-scenario-folders.md`, `wordpress-coding-standards.md`) landed as clean adds while the branch's three (`skip-misconfigured-agents.md`, `early-skip-announcement.md`, `initial-scaffolding.md`) remain present.
  - **Do not revert** any auto-merged toolchain file; leave `package.json`/`biome.json`/`package-lock.json` at `trunk`'s 2.5.0 state.
- **Depends on:** none
- **Traces to:** Spec Requirement 1 / Acceptance criterion 1 (PR mergeable); Design Decision 1 (single `trunk`→branch merge commit).
- **Acceptance:**
  - The merge is in progress (`MERGE_HEAD` exists) and stopped on conflicts; the merge is **not** committed and **not** aborted.
  - `git diff --name-only --diff-filter=U` lists exactly the 19 files above — no more, no fewer.
  - `package.json` pins `@biomejs/biome` at `2.5.0`; `package-lock.json` has zero `2.4.12` references; `biome.json` is the WordPress config (`indentWidth: 4`, `lineWidth: 80`, `quoteStyle: single`, `trailingCommas: es5`, `semicolons: always`, `arrowParentheses: always`); none of these three is conflicted.
  - `src/progress/types.ts` and `testing-project/playwright.config.ts` are auto-merged, not conflicted.
  - All six changesets are present and non-empty; none deleted or emptied.

### Task 2: Resolve the four hard semantic files

- **Goal:** Resolve the four files where the branch's feature flow must coexist with `trunk`'s content/format, keeping **both** sides whole. Three of the four (`summary.ts`, `tracker.ts`, `agent-loop.ts`) have a pure-reformat `trunk` side (zero `trunk` semantics), so the resolution is "take the branch's logic, in `trunk`'s WordPress format"; one (`pipeline.ts`) interleaves two real changes in disjoint regions. Leave WordPress formatting to Task 6 (do not hand-format in 2.4.12 style), but resolve to semantically correct content now.
- **Type:** e2e
- **Files to change:** `src/pipeline/pipeline.ts`, `src/reports/summary.ts`, `src/progress/tracker.ts`, `src/pipeline/agent-loop.ts`.
- **Changes:**
  - **`src/pipeline/pipeline.ts` (the only two-sided-semantic file; disjoint regions):**
    - Adopt `trunk`'s nested-folders selection refactor: import `normalizeScenarioFilters`, `selectScenariosByNormalizedFilters`, `validateConfiguredScenarioNamesAreUnique` from `../scenarios/selection`; replace the old inline `filterScenarios(...)` in `runPipeline` with the `enumerateScenarios` → `normalizeScenarioFilters(params.scenarios ?? [])` → `validateConfiguredScenarioNamesAreUnique(...)` → `selectScenariosByNormalizedFilters(...)` body; add the `id` field on the `runScenarios` map entries (`{ id, dirName, scenario }`); delete the now-removed local `function filterScenarios`.
    - **Keep** the branch's complete runnability/skip control flow (separate regions): the `../runnability` import (`classifyRunnability`, `decide`, `type SkippedAgent`); `classifyRunnability(config, process.env)`; the judge `STOP_RUN` guard; `runnableTestAgentIds`; `earlySkips` (the non-`STOP_RUN` set) plus the early-announce loop; `skipped: runnability.skipped` on the `RunContext`; `skippedAgents: earlySkips` into the tracker init; **both** 4-arg `writeRunReport(runDirectory, runId, mergedScenarios, runnability.skipped)` calls; the `runnability.improverRunnable` improver-gating plus its early-break; and `ScenarioRunArgs.runnableTestAgentIds`.
    - **Meeting point 1:** the `runScenario` call inside the per-scenario loop must carry all three together — `agentFilter: effectiveFilter` (branch runnable allowlist), `scenarios: args.runCtx.scenarios` (`trunk` nested-folders plumbing), and `skipped: args.runCtx.skipped` (branch skip set) — where `effectiveFilter` is the intersection of any existing per-scenario agent filter with `runnableTestAgentIds`.
    - Care: in the import block, **union** `trunk`'s `../scenarios/selection` imports with the branch's `../runnability` import; drop `trunk`'s now-orphaned `filterScenarios`-era imports and `UserFacingError` only if they become unused after the resolution. No identifier rename is needed (field names match on both sides).
  - **`src/reports/summary.ts` (pure-reformat `trunk` side — take the branch wholesale):** keep the if/else `renderSummaryLines` with `pushSkipBlock(lines, skipped, color)` called **unconditionally after** the if/else (so the skip block runs on both the all-pass and the fail path); the 5th `skipped: SkippedEntry[]` parameter; the `loadSkipped` helper (reads the report's top-level `skipped`, returns `[]` when absent); the `pushSkipBlock` helper (cyan header, `${id}: ${reason}` rows, no-op when empty); and in `prepareSummary` the `const skipped = loadSkipped(...)` plus `const exitCode = skipped.length > 0 ? 2 : allPass ? 0 : 1` (replacing `trunk`'s `allPass ? 0 : 1`). **Do NOT** re-introduce `trunk`'s early `return lines` inside the all-pass branch — that early-return predates the merge-base, is not `trunk`'s intervening work, and reintroducing it would skip `pushSkipBlock` on a clean-pass-with-skip run.
  - **`src/progress/tracker.ts` (pure-reformat `trunk` side; one mandatory rename):** keep the branch's `private readonly interactiveMode` field and the public `get interactive(): boolean { return this.interactiveMode; }`; **rewrite the three `trunk`-side internal `this.interactive` uses** (the assignment plus the two reads) to `this.interactiveMode` (mandatory — a private field `interactive` and a getter `interactive` cannot coexist on the same class). Do **not** rename the `interactive?: boolean` **input option** on `TrackerOptions`/`TrackerInit` (unchanged on both sides). Also keep the branch's `skippedAgents?: { id; reason }[]` on `TrackerInit`, the private `skippedAgents` field plus its init, `skippedAgents: this.skippedAgents.slice()` in the snapshot, and the run-scoped reset comment in `beginIteration`.
  - **`src/pipeline/agent-loop.ts` (pure-reformat `trunk` side; lowest risk):** keep `import type { SkippedAgent } from "../runnability"` and the five `skipped` insertions, each beside the already-present `scenarios`: `RunAgentsParams.skipped`, `RunAgentPairParams.skipped`, the destructures in `runAgents` and `runAgentPair`, the `skipped,` in the `runAgentPair({...})` call, and the `skipped,` in the `agentCtx` literal. No `trunk` logic to merge.
  - Remove all conflict markers from these four files.
- **Depends on:** Task 1
- **Traces to:** Spec Requirement 2 / Acceptance criterion 2 (both sides preserved); Requirement 4 / Acceptance criterion 4 (typecheck at the `runScenario` call site and `writeRunReport` signature); Requirement 5 / Acceptance criterion 5 (`summary.test.ts` exit-2 + skip-block, `progress-*.test.ts`); Requirement 7 (nested-folders intact); Design Decision 2.
- **Acceptance:**
  - None of the four files contains conflict markers.
  - `src/pipeline/pipeline.ts` imports from both `../scenarios/selection` and `../runnability`; its `runPipeline` uses `selectScenariosByNormalizedFilters` and the `id` field on the `runScenarios` map; the local `filterScenarios` is gone; the `runScenario` call carries `agentFilter`, `scenarios`, and `skipped` together; both `writeRunReport` calls pass four arguments ending in `runnability.skipped`.
  - `src/reports/summary.ts` has `pushSkipBlock` invoked unconditionally after the if/else (not inside an early-returning all-pass branch); `exitCode` is `skipped.length > 0 ? 2 : allPass ? 0 : 1`; `loadSkipped`, `pushSkipBlock`, `SkippedEntry`, and the 5th `skipped` param are present; no early `return lines` exists inside the all-pass branch.
  - `src/progress/tracker.ts` has the private `interactiveMode` field and the public `get interactive()` getter, with **zero** remaining internal `this.interactive` references (the input option `interactive?: boolean` is untouched); the `skippedAgents` field/init/snapshot and reset comment are present.
  - `src/pipeline/agent-loop.ts` has the `SkippedAgent` import and all five `skipped` insertions alongside `scenarios`.
  - (Full verification of these criteria is the typecheck + `npm test` run in Task 7; this task's content must be such that those pass.)

### Task 3: Resolve the third two-sided file — `testing-project/eval/utils/verify-e2e.ts`

- **Goal:** Keep the branch's review-1 import-cycle fix **and** adopt `trunk`'s nested `scenarioDirOf` rewrite; the two change-sets occupy disjoint regions, so both survive. This file carries the single unguarded failure mode (the nested `scenarioDirOf` body), so resolve it with explicit care.
- **Type:** e2e
- **Files to change:** `testing-project/eval/utils/verify-e2e.ts`.
- **Changes:**
  - **Keep the branch's review-1 fix:** the `import { projectArgs } from "./project-args"`; the 4-arg signature `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)`; the `...projectArgs(runnableAgentIds, configuredProjectNames)` selectors appended to the `test:e2e` invocation; and **no** config back-edge (there is **no** `import config` — project names come only from caller-passed parameters plus `./project-args`).
  - **Adopt `trunk`'s rewritten `scenarioDirOf`:** the body that anchors on the `scenarios` path segment (`specIndex = lastIndexOf('e2e.spec.mjs')`, `scenariosIndex = lastIndexOf('scenarios', specIndex - 1)`) and returns `scenarioSegments.join('/')` to yield nested IDs like `blocks/counter` — **not** the branch's flat-only immediate-parent body. Also adopt `trunk`'s "normalized scenario directory ID" doc/comment edits (the docblock and the name↔dir map comment).
  - Remove all conflict markers.
- **Depends on:** Task 1
- **Traces to:** Spec Requirement 6 / Acceptance criterion 7 (import-cycle fix preserved, no config back-edge, order-preserving forwarding); Requirement 7 (nested `scenarioDirOf` intact); Requirement 2 (both sides preserved); Design Decision 3.1 and the "one unguarded failure mode."
- **Acceptance:**
  - No conflict markers remain in the file.
  - The file imports `projectArgs` from `./project-args` and exposes the 4-arg `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)`; the `test:e2e` call appends `projectArgs(runnableAgentIds, configuredProjectNames)` selectors.
  - The file contains **no** `import config` / module-initialization-time read of the imported config.
  - `scenarioDirOf` is `trunk`'s nested form (anchors on `'scenarios'` via `lastIndexOf` and `join('/')`), not the flat immediate-parent form. **This is verified by inspection (Flow 10) — no automated guardrail covers it.**

### Task 4: Resolve the `README.md` prose merge

- **Goal:** Fold in **all** of `trunk`'s additive sections and **all** of the branch's additive sections, and genuinely merge the two overlapping paragraphs so neither side is silently dropped. This is the one spot requiring human writing judgment.
- **Type:** e2e
- **Files to change:** `README.md`.
- **Changes:**
  - **Keep all of `trunk`'s additive prose:** the nested-folders selection section (scenario IDs normalized with `/`, the `blocks/counter` example, the `beforeAll … scenarios` record), the claude-code-subscription-auth prose, and the `(scenario.name, agent)` rename.
  - **Keep all of the branch's additive prose:** the `### Exit codes` section, the "When an agent can't run" block, the judge-stops / improver-halt description, the `### Skipped agents in report.json` section, and the hook-context `skipped` field.
  - **Merge the two overlapping paragraphs into one each** (no duplication, no dropped side):
    - The `afterAllScenarios` bullet — the merge currently leaves two adjacent variants (one with `ctx.skipped` / runnable-exclusion prose and `(scenario, agent)`; one with `(scenario.name, agent)` and no skip prose). Produce a **single** bullet that carries the branch's `ctx.skipped` / runnable-exclusion prose **and** `trunk`'s precise wording — use `scenario.name` (not bare `scenario`) and `(scenario.name, agent)`.
    - The self-improvement-summary sentence — same kind of overlap; merge into one sentence carrying both edits.
  - Remove all conflict markers.
  - **Introduce no process vocabulary** — no phase names, no spec/design/plan references, no acceptance-criteria or task identifiers (Requirement 10).
- **Depends on:** Task 1
- **Traces to:** Spec Requirement 2 / Acceptance criterion 2 (both sides preserved); Requirement 7 (nested-folders prose); Requirement 10 (no process vocabulary); Design Decision 3.2.
- **Acceptance:**
  - No conflict markers remain in `README.md`.
  - All of `trunk`'s additive sections (nested-folders selection, subscription-auth) and all of the branch's additive sections (`### Exit codes`, "When an agent can't run", judge-stops/improver-halt, `### Skipped agents in report.json`, hook-context `skipped`) are present.
  - There is exactly one `afterAllScenarios` bullet (the two variants collapsed into one) that contains both the branch's `ctx.skipped` / runnable-exclusion prose and `trunk`'s `scenario.name` / `(scenario.name, agent)` wording; there is exactly one self-improvement-summary sentence carrying both edits.
  - No phase names, spec/design/plan references, or acceptance-criteria/task identifiers appear anywhere in the file.

### Task 5: Resolve the remaining mechanical conflicts (keep branch feature line + adopt `trunk` format)

- **Goal:** Resolve the remaining ten conflicting files, each with a pure-reformat `trunk` side (except the two additive-content-no-overlap config examples): keep the branch's feature line(s) and let Task 6 apply `trunk`'s WordPress format.
- **Type:** e2e
- **Files to change:** `testing-project/skillsmith.config.ts`, `examples/skillsmith.config.ts`, `src/config/types.ts`, `src/improvement/improver.ts`, `src/providers/anthropic-api.ts`, `src/providers/gemini-api.ts`, `src/providers/openai-api.ts`, `src/providers/types.ts`, `src/reports/iteration-report.ts`, `src/progress/render.ts`, `src/__tests__/summary.test.ts`, `src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`.
- **Changes:**
  - **`testing-project/skillsmith.config.ts`:** keep the misconfigured `gpt` agent (`provider: "openai-api"`, no key) and `agents: ["haiku", "gpt"]`; keep the `afterAllScenarios` hook that destructures `{ scenarios, iterationDirectory, config, skipped }` and derives `skippedTestIds` → `runnableAgentIds` + `configuredProjectNames` from `config.roles.test.agents`, calling the 4-arg `runE2eVerification`.
  - **`examples/skillsmith.config.ts`:** keep **both** `trunk`'s subscription-auth comment on the `cc-haiku` agent **and** the branch's skip comments on the api-provider agents (`anthropic-api`/`openai-api`/`gemini-api`) — different blocks, no overlap. **Characterization correction (from the design phase): keep HEAD's `GOOGLE_GENERATIVE_AI_API_KEY`** as the gemini agent's required env, because it matches `src/providers/gemini-api.ts`'s `requiredEnv`. Do not substitute any other key name.
  - **`src/config/types.ts`:** import-line conflict only — **union** the imports (keep `import type { SkippedAgent } from "../runnability"`). Both `RunContext.skipped` and `RunScenario.id`/`dirName` (with `dirName === id`) live in different interfaces and auto-merge in the bodies; keep both.
  - **`src/improvement/improver.ts`:** import/format-only; the branch adds nothing semantic — keep the branch line and let formatting normalize quotes/commas/wraps (including the `.join('\n')` strings).
  - **`src/providers/anthropic-api.ts`, `src/providers/openai-api.ts`, `src/providers/gemini-api.ts`:** keep each provider's `requiredEnv` value.
  - **`src/providers/types.ts`:** keep `Provider.requiredEnv?`.
  - **`src/reports/iteration-report.ts`:** keep the `SkippedAgent` import and the 4-arg `skipped` parameter/field on `writeRunReport` (Meeting point 2).
  - **`src/progress/render.ts`:** keep the cyan `SKIPPED AGENTS` block.
  - **`src/__tests__/summary.test.ts`, `src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`:** keep the branch's new skip test cases (do **not** drop or weaken them); adopt `trunk`'s format on shared/pre-existing tests.
  - Remove all conflict markers from every file above.
- **Depends on:** Task 1
- **Traces to:** Spec Requirement 2 / Acceptance criterion 2 (both sides preserved); Requirement 4 (4-arg `writeRunReport`); Requirement 5 (the skip test cases and the cyan render block); Requirement 6 (the testing-project hook drives the 4-arg `runE2eVerification`); Requirement 10 (no process vocabulary in example comments); Design Decision 3.3 and the design-phase characterization correction on `examples/skillsmith.config.ts`.
- **Acceptance:**
  - None of the listed files contains conflict markers.
  - `testing-project/skillsmith.config.ts` keeps the `gpt` misconfigured agent, `agents: ["haiku", "gpt"]`, and the 4-arg-calling `afterAllScenarios` hook.
  - `examples/skillsmith.config.ts` keeps both the subscription-auth comment on `cc-haiku` and the api-provider skip comments, and the gemini agent's required env is `GOOGLE_GENERATIVE_AI_API_KEY`.
  - `src/config/types.ts` retains `import type { SkippedAgent } from "../runnability"`, `RunContext.skipped`, and `RunScenario.id`/`dirName`.
  - `src/providers/{anthropic,openai,gemini}-api.ts` each retain `requiredEnv`; `src/providers/types.ts` retains `requiredEnv?`.
  - `src/reports/iteration-report.ts` retains the `SkippedAgent` import and the 4-arg `skipped` param/field.
  - `src/progress/render.ts` retains the cyan `SKIPPED AGENTS` block.
  - The three conflicted test files retain the branch's skip test cases (none dropped).
  - No process vocabulary appears in any reconciled comment or test.

### Task 6: Install dependencies, then run the formatter (load-bearing order)

- **Goal:** Land `trunk`'s Biome 2.5.0 binary on disk via `npm install`, **then** normalize every manually-resolved file to WordPress 2.5.0 format. The order is load-bearing: the local binary is 2.4.12 until `npm install` runs, and formatting with the stale binary produces output that fails `trunk`'s 2.5.0 format-verify.
- **Type:** e2e
- **Files to change:** none authored by hand — `npx biome format --write .` rewrites the resolved files to WordPress style; `npm install` may update `package-lock.json`/`node_modules` to the already-merged 2.5.0 state. Do not hand-edit `package.json`, `biome.json`, or `package-lock.json`.
- **Changes:**
  - Run `npm install` (root) and `npm install --prefix testing-project` so `node_modules` reflects `trunk`'s Biome 2.5.0 binary (and any `trunk`-introduced deps). Confirm `node_modules/.bin/biome --version` reports `2.5.0`.
  - Run `npx biome format --write .` to normalize the manually-resolved files.
  - Eyeball the resolved import blocks: `organizeImports` may reorder unioned imports and `--write` can auto-fix some unused imports; if any orphaned import remains (e.g. `UserFacingError`, a stray `SkippedAgent`/`projectArgs`), remove it (it is a `noUnusedImports` warning that does not fail lint — see Task 7).
- **Depends on:** Task 2, Task 3, Task 4, Task 5 (all 19 conflicts must be resolved before formatting, so the formatter sees no conflict markers).
- **Traces to:** Spec Requirement 3 / Acceptance criterion 3 (Biome 2.5.0 WordPress format; exactly-pinned 2.5.0 toolchain); Design Decision 4 and the load-bearing install-before-format order.
- **Acceptance:**
  - `node_modules/.bin/biome --version` reports `2.5.0` (the install ran before the format pass).
  - `npx biome format --write .` completes with no conflict markers in any file (all 19 were resolved first).
  - No orphaned imports remain in the resolved files.
  - (The format result is verified green by Task 7's `npx biome format .` verify pass.)

### Task 7: Run the full local guardrail set green

- **Goal:** Prove the merged, resolved, formatted tree satisfies every guardrail — the correctness oracle for this reconciliation — before committing the merge.
- **Type:** e2e
- **Files to change:** none (verification only; if a guardrail fails, the fix belongs in the relevant resolution task 2–6 and the guardrails are re-run).
- **Changes:** From the worktree root, run and confirm exit 0 for each:
  - `npx biome format .` (verify, no rewrite) — no files need reformatting.
  - `npm run lint` (`biome lint .`) — exit 0 (eyeball for `noUnusedImports` warnings, which exit 0 but signal an orphaned import to remove via Task 6).
  - `npm run typecheck` (`tsc --noEmit`) — exit 0, including the `runScenario` call site (carries `scenarios` + `agentFilter` + `skipped`) and the 4-arg `writeRunReport` signature.
  - `npm test` (`node --import tsx --test src/__tests__/*.test.ts`) — exit 0 with all 27 files green, including the nine skip-feature files as written and `trunk`'s `scenario-filter-selection.test.ts` (`codex.e2e.test.ts` no-ops without `CODEX_E2E=1`).
  - `npm --prefix testing-project run check:config` — exit 0 (config import graph loads without throwing).
  - `npx tsx scripts/validate-changesets.ts` — exit 0.
  - `npx changeset status --since=origin/trunk` — exit 0, reporting `@automattic/skillsmith` bumped at `minor`.
- **Depends on:** Task 6
- **Traces to:** Spec Requirements 3, 4, 5, 6, 7, 8 / Acceptance criteria 3, 4, 5, 6, 7, 8 (and the integration-test-driven criteria for all-misconfigured → exit 2, judge stops, improver halts, fail+skip precedence, no early announcement when no skips); Design "Failure Modes and Observability."
- **Acceptance:**
  - Every command above exits 0.
  - `npm test` reports all 27 test files passing, with the nine skip-feature files green as written.
  - `npx changeset status --since=origin/trunk` reports `@automattic/skillsmith` at `minor` (not patch-only, none-only, empty, or error).
  - `npm --prefix testing-project run check:config` exits 0.
  - No `noUnusedImports` warning remains in `npm run lint` output (any that appeared was fixed in Task 6 and the guardrails re-run).

### Task 8: Reviewer-inspect the unguarded `scenarioDirOf`, verify minimal/clean diff, and commit the merge

- **Goal:** Perform the one inspection no guardrail covers (nested `scenarioDirOf` survived), confirm the diff is minimal and free of process vocabulary, then commit the merge and confirm PR #45 is no longer `CONFLICTING`.
- **Type:** e2e
- **Files to change:** none authored — this task commits the merge produced and resolved by Tasks 1–7.
- **Changes:**
  - **Inspect `testing-project/eval/utils/verify-e2e.ts` in the resolved tree:** confirm `scenarioDirOf` is `trunk`'s nested-path body (anchors on `'scenarios'`, `join('/')`), not the branch's flat immediate-parent body. **This is the single resolution with no automated signal** — it must be confirmed by inspection.
  - **Review the full reconciled diff against the pre-reconciliation branch tip:** confirm it contains only conflict resolutions and formatter output — no gratuitous refactors — and that no phase names, spec/design/plan references, or acceptance-criteria/task identifiers appear anywhere in code, comments, tests, or documentation (especially the README prose and example-config comments).
  - Confirm no changeset was deleted, emptied, downgraded, or added; all six remain.
  - Commit the merge (a standard merge commit; do not author a new changeset). After committing, confirm the branch incorporates `trunk` (the `trunk` tip is an ancestor of HEAD) with no remaining conflicts, and that GitHub no longer reports PR #45 as `CONFLICTING`.
- **Depends on:** Task 7
- **Traces to:** Spec Requirement 1 / Acceptance criterion 1 (mergeable, not `CONFLICTING`); Requirement 7 (nested `scenarioDirOf`); Requirement 9 / Acceptance criterion (minimal diff, only conflict resolutions + formatter output); Requirement 10 (no process vocabulary); Requirement 8 (no changeset deleted/added); Design "the one unguarded failure mode" and Decision 5.
- **Acceptance:**
  - `testing-project/eval/utils/verify-e2e.ts` keeps `trunk`'s nested `scenarioDirOf` body (confirmed by inspection).
  - The merge is committed; HEAD has two parents (the prior branch tip and the `trunk` tip `95c86bd`); no conflict markers remain in any file; `git diff --name-only --diff-filter=U` is empty.
  - The reconciled diff against the pre-reconciliation branch tip contains only conflict resolutions and formatter output — no gratuitous refactors, no process vocabulary.
  - All six changesets are present and unchanged; none added, deleted, emptied, or downgraded.
  - PR #45 is no longer reported as `CONFLICTING`.
