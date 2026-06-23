# Design Doc: Reconcile the skip-misconfigured-agents branch with current `trunk`

## Overview

The `skip-misconfigured-agents` feature branch (pull request #45, _"Skip misconfigured agents across all phases of a run"_) is open against `trunk` but GitHub reports it `CONFLICTING`. The branch is 89 commits behind `trunk`, which has since (a) adopted Biome 2.5.0 "WordPress" formatting across the whole repository and (b) merged further feature work — notably nested scenario folders and claude-code-subscription-auth documentation. Merging current `trunk` into the branch conflicts in **19 files**. The branch has already delivered, across its prior `base`, `review-1-fix-circular-import`, and `review-2-early-skip-announcement` runs, the behavior that skips statically misconfigured agents across every phase of a run.

This is a **reconciliation only**: the feature is not re-litigated, redesigned, or extended. The design is to perform a single `trunk`→branch merge commit and resolve every one of the 19 conflicts so that **both** sides are retained — `trunk`'s intervening changes (the Biome 2.5.0 reformat, nested scenario folders, subscription-auth docs) **and** the branch's already-shipped skip-misconfigured-agents behavior. After the merge resolves, the toolchain auto-adopts Biome 2.5.0, the formatter is re-run with that exact binary, and the full local guardrail set must pass. Mechanically, this is a **3-way merge of two field-disjoint feature surfaces layered over a shared whole-repo reformat**; the only places the two surfaces meet require hand judgment, and the rest are "keep the branch's feature line, in trunk's format."

## Approach

The implementer's mental model: trunk's intervening work is two features plus a reformat, and the branch's work is one feature. None of the three overlap semantically except at two narrow, named interface points. So the reconciliation is a faithful **union**, not a redesign.

End-to-end:

1. **Merge.** From the current branch HEAD, `git merge <trunk-tip>` — a single merge commit. This produces exactly 19 conflicted files (all content `UU` conflicts; zero add/delete conflicts), verified at the actual current HEAD. The toolchain files (`package.json`, `package-lock.json`, `biome.json`) are **not** in the conflict set; they auto-merge cleanly to trunk's Biome 2.5.0 state.
2. **Resolve.** Resolve each of the 19 files to its determined target (see Components and Key Decisions). Three categories: four genuinely two-sided files needing interleaving, one file (`README.md`) needing a true prose merge, and the rest "keep the branch's feature line(s), adopt trunk's WordPress format."
3. **Install, then format.** `npm install` (root) and `npm install --prefix testing-project` so the **Biome 2.5.0 binary** lands in `node_modules`. **Only then** `npx biome format --write .` to normalize the manually-resolved files. This order is load-bearing: the local binary is 2.4.12 until the install runs, and formatting with the stale binary produces output that fails trunk's 2.5.0 format-verify.
4. **Verify.** Run the full local guardrail set (see Failure Modes and Observability). Eyeball `biome lint` output for orphaned-import warnings (a soft signal — see Risks). Perform the one reviewer-inspection item: confirm trunk's nested `scenarioDirOf` body survived (the single unguarded failure mode).
5. **Commit and confirm.** Commit the merge; confirm GitHub no longer reports PR #45 as `CONFLICTING`.

This run **introduces no new component, no new dependency, no new changeset, and no interface change** beyond what the two feature surfaces already defined. The only hand-authored reconciliations are the two interface meeting points and the README prose merge.

## Components

No component is redesigned and none is introduced by this run. The relevant components split into four groups.

### New files added clean by the branch (no conflict — land untouched)

- `src/runnability.ts` — the static classifier: `classifyRunnability(config, env)` returning `RunnabilityResult`, plus `decide(...)` and the `SkippedAgent` type. Pure TypeScript reading `process.env`; no runtime dependency.
- `src/__tests__/runnability.test.ts`, `providers-required-env.test.ts`, `iteration-report-skipped.test.ts`, `project-args.test.ts`, `config-loads.test.ts`, `skip-misconfigured.test.ts` — six of the nine skip-feature tests (the other three are in the conflict set).
- `testing-project/eval/utils/project-args.ts` — the order-preserving `--project` selector builder used by the review-1 import-cycle fix.

### New files added clean by trunk (no conflict — land untouched; branch absorbs them by importing)

- `src/scenarios/selection.ts` — the nested-folders selection API: `normalizeScenarioFilters`, `selectScenariosByNormalizedFilters`, `validateConfiguredScenarioNamesAreUnique`. `pipeline.ts` must import from this module after the merge.
- Trunk's nested-folders selection tests (e.g. `scenario-filter-selection.test.ts`, `scenario-selection.test.ts`) — they exercise `src/scenarios/selection`, not `verify-e2e.ts`'s `scenarioDirOf`.

### The 19 conflicting files (resolved per Key Decisions)

The four two-sided files and the rest. Listed and categorized in Key Decisions § Decision 2 and § Decision 3.

### Untouched-but-relevant (auto-merge clean; relied on, not modified)

- `src/progress/types.ts` — carries the branch's `RunSnapshot.skippedAgents` field plus trunk's reformat; auto-merges. (The code phase should confirm it is still non-conflicting at actual merge time — a 1-line check; no design depends on a different outcome.)
- `src/config/normalize.ts` — order-preserving id derivation the review-1 fix relies on; not modified.
- `testing-project/playwright.config.ts` — the review-1/base project-name fix; verify it is not re-conflicted (it was not in the 19).
- `package.json`, `package-lock.json`, `biome.json` — auto-merge to the Biome 2.5.0 toolchain; **do not revert** them.
- The changeset files — auto-merge as a union (see Dependencies and Key Decisions § Decision 5).

## Interfaces and Data Flow

This run changes **no interface**. It preserves the additive signatures both features already defined and unions them. The two interface "meeting points" are where trunk's nested-folders shape and the branch's skip fields coexist; both are in `src/pipeline/pipeline.ts` and `src/reports/iteration-report.ts`.

### Preserved additive interfaces (neither side renamed an identifier)

Branch side:
- `Provider.requiredEnv?` (on `src/providers/types.ts`) and the per-provider `requiredEnv` values (`anthropic-api.ts`, `openai-api.ts`, `gemini-api.ts`).
- `RunContext.skipped: ReadonlyArray<SkippedAgent>` (on `src/config/types.ts`).
- The 4-argument `writeRunReport(runDirectory, runId, mergedScenarios, skipped)` (on `src/reports/iteration-report.ts`).
- The 4-argument `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)` (on `testing-project/eval/utils/verify-e2e.ts`).
- `RunSnapshot.skippedAgents` (on `src/progress/types.ts`) and `TrackerInit.skippedAgents` (on `src/progress/tracker.ts`).
- The public accessor `get interactive(): boolean` on the progress tracker (backed by a private `interactiveMode` field).
- `RunAgentsParams.skipped`, `RunAgentPairParams.skipped`, `ScenarioRunArgs.runnableTestAgentIds` (on `src/pipeline/agent-loop.ts` / `pipeline.ts`).

Trunk side:
- `RunScenario.id` plus its `dirName` alias (`dirName === id`) (on `src/config/types.ts`).
- The `src/scenarios/selection` module API (above).

Field names align across both sides everywhere they meet — `RunAgentsParams`/`ScenarioRunArgs` use `scenarios: RunScenario[]` and `agentFilter` (threaded to `runAgents` as `agentIdFilter`) on both branch and trunk. There is **no rename to reconcile** at any meeting point. (The one rename in the whole reconciliation is internal to `tracker.ts`: trunk's private `interactive` field must become `interactiveMode` so it can coexist with the branch's `get interactive()` getter — see Key Decisions § Decision 2.3.)

### Meeting point 1 — the per-scenario run call (`runScenario` in `pipeline.ts`)

A single call must carry all three field groups together:

```ts
// in runScenario(args), inside the per-scenario loop:
const effectiveFilter = /* intersection of any per-scenario filter with runnableTestAgentIds */;
runScenario({
    // ...
    agentFilter: effectiveFilter,        // branch: runnable allowlist
    scenarios: args.runCtx.scenarios,    // trunk: nested-folders plumbing
    skipped: args.runCtx.skipped,        // branch: skip set
});
```

`effectiveFilter` is the intersection of any existing per-scenario agent filter with `runnableTestAgentIds`. Dropping `scenarios` breaks nested folders (and fails typecheck — `ScenarioRunArgs.scenarios` is required); dropping `agentFilter`/`skipped` regresses the skip allowlist (and fails `skip-misconfigured.test.ts` plus typecheck — `skipped` is required down `RunAgentsParams`/`RunAgentPairParams`). Verified at current HEAD: in the merged file this call already combines all three on the HEAD side of the conflict.

### Meeting point 2 — the run-report writer (`writeRunReport` in `iteration-report.ts`, called from `pipeline.ts`)

The branch's 4-argument skip-bearing signature is retained so the top-level `skipped` array still lands in `report.json`:

```ts
mergedPass = writeRunReport(runDirectory, runId, mergedScenarios, runnability.skipped);
```

Verified at current HEAD: each `writeRunReport` conflict region has the branch's 4-arg form on the HEAD side and trunk's 3-arg form (`writeRunReport(runDirectory, runId, mergedScenarios)`) on the trunk side. The resolution keeps the 4-arg HEAD side at every such region. Dropping the 4th argument fails `iteration-report-skipped.test.ts:29` and typecheck.

### Data flow (unchanged from the shipped feature — the reconciliation must not alter it)

The classifier's `skipped` set is the single source of truth, threaded three ways:

1. **Into `report.json`** — via the 4-arg `writeRunReport`, as a machine surface and as the exit-code signal that `summary.ts` reads (`skipped.length > 0 ? 2 : allPass ? 0 : 1`).
2. **Onto `runCtx.skipped`** — the hook context, readable from the earliest `beforeAll` hook onward.
3. **Through the e2e hook** — `runnableAgentIds`/`configuredProjectNames` derived from `config.roles.test.agents`, forwarded order-preservingly into the Playwright `--project` selectors via `projectArgs(...)`.

The review-2 early-announcement seeds `RunSnapshot.skippedAgents` for the interactive dashboard and emits an early `stderr` line in non-interactive mode. Nested-folders adds an **orthogonal** data path (scenario `id`/`dirName` flowing through `src/scenarios/selection` → `runScenario` → `scenarioDirOf`); the two paths meet only at Meeting point 1 and are otherwise disjoint.

## Key Decisions

### Decision 1: Integrate via a single `trunk`→branch merge commit

- **Choice:** From the current branch HEAD, perform one `git merge <trunk-tip>`, resolve all 19 conflicts in one pass, run the formatter, and commit the merge.
- **Alternatives:** (a) Rebase the branch onto trunk, resolving conflicts per replayed commit; (b) squash/reset/recreate the branch as a fresh diff onto trunk.
- **Trade-offs:** A merge resolves the 19 conflicts **once**. A rebase re-surfaces the whole-repo Biome reformat against the feature lines on **every** branch commit that touched any of the 19 files (~75 commits over the merge-base) — the classic "rebase across a repo-wide reformat" trap, with an independent mis-resolution risk on each pass, worst on the hard semantic files. Merge preserves every existing commit/SHA, the PR's open review threads, and `git blame`; rebase and squash rewrite SHAs (force-push, orphaned review comments), and squash also collapses the three-run provenance the `.pipelines/` artifacts document. The guardrail/CI outcome is **mechanism-agnostic** — the changeset gate yields the same green result for merge or rebase — so no guardrail favors any mechanism, and the human/risk factors decide. Repo convention reinforces the merge: every feature lands as a GitHub merge commit, trunk→branch catch-up merges are directly precedented (`92819e0 "Merge trunk into nested-scenario-folders branch"`), and this branch already contains one such catch-up (`1c0b666`). No rebase/linear-history norm exists.
- **Traces to:** Requirement 1 (PR mergeable into trunk) / AC "no remaining merge conflicts, no longer CONFLICTING"; Requirement 9 (minimal change). The spec explicitly defers the mechanism to the design phase.

### Decision 2: Resolve the four genuinely two-sided files by interleaving both sides

The "both sides preserved" requirement plus the verified file contents **determine** each resolution; this is not a free design choice. Apply each target, then run the formatter.

**2.1 `src/pipeline/pipeline.ts`** — the only file interleaving two real semantic changes, in disjoint regions. Adopt trunk's nested-folders selection refactor: the `../scenarios/selection` imports (`normalizeScenarioFilters`, `selectScenariosByNormalizedFilters`, `validateConfiguredScenarioNamesAreUnique`); the `runPipeline` body that replaces the old inline `filterScenarios(...)` with `enumerateScenarios` → `normalizeScenarioFilters(params.scenarios ?? [])` → `validateConfiguredScenarioNamesAreUnique(...)` → `selectScenariosByNormalizedFilters(...)`; the `id` field on the `runScenarios` map (`{ id, dirName, scenario }`); and the deletion of the local `function filterScenarios`. **Also keep** the branch's complete runnability/skip control flow (separate regions): the `../runnability` import; `classifyRunnability(config, process.env)`; the judge `STOP_RUN` guard; `runnableTestAgentIds`; `earlySkips` (non-`STOP_RUN`) plus the early-announce loop; `skipped: runnability.skipped` on `RunContext`; `skippedAgents: earlySkips` into the tracker init; the two 4-arg `writeRunReport(...)` calls; the `runnability.improverRunnable` improver-gating plus early-break; and the `runScenario` call carrying `agentFilter: effectiveFilter` + `scenarios: args.runCtx.scenarios` + `skipped: args.runCtx.skipped` together (Meeting point 1). Care point: in the import block, combine trunk's `../scenarios/selection` imports **with** the branch's `../runnability` import; in the selection region, adopt trunk's `selectScenariosByNormalizedFilters` + `id` while keeping the branch's runnability wiring just after it. Drop trunk's now-removed `filterScenarios`-era imports and `UserFacingError` if they become orphaned. WordPress format throughout. No rename needed (field names match).

**2.2 `src/reports/summary.ts`** — trunk's side is a **pure reformat** (zero semantic trunk change). Take the branch's logic wholesale, in WordPress format: the if/else `renderSummaryLines` with `pushSkipBlock(lines, skipped, color)` called **unconditionally after** the if/else (so the skip block runs on both the all-pass and the fail path); the skip-aware `exitCode = skipped.length > 0 ? 2 : allPass ? 0 : 1` in `prepareSummary` (replacing trunk's `allPass ? 0 : 1`); the 5th `skipped: SkippedEntry[]` param; and the `loadSkipped` (reads the report's top-level `skipped`, `[]` when absent) and `pushSkipBlock` (cyan header, `${id}: ${reason}` rows, no-op when empty) helpers. **Explicit caution:** do NOT re-introduce trunk's early `return lines` inside the all-pass branch — the early-return shape predates the merge-base and is **not** trunk's intervening work; reintroducing it would skip `pushSkipBlock` on a clean-pass-with-skip run and fail `summary.test.ts:311`.

**2.3 `src/progress/tracker.ts`** — trunk's side is a **pure reformat** (no new `this.interactive` use). Keep the branch's `private readonly interactiveMode` field plus the public `get interactive(): boolean { return this.interactiveMode; }`, and **rewrite the three trunk-side `this.interactive` internal uses** (the assignment plus two reads) to `this.interactiveMode`. This rename is **mandatory to compile**: TypeScript forbids a private field `interactive` and a getter `interactive` on the same class (duplicate identifier), so trunk's `private readonly interactive` cannot coexist with the branch's `get interactive()`. (The `interactive?: boolean` **input option** on `TrackerOptions`/`TrackerInit` is unchanged on both sides and is NOT renamed.) Also keep the branch's `skippedAgents?: { id; reason }[]` on `TrackerInit`, the private `skippedAgents` field plus its init, `skippedAgents: this.skippedAgents.slice()` in the snapshot, and the run-scoped reset comment in `beginIteration`. WordPress format.

**2.4 `src/pipeline/agent-loop.ts`** — trunk's side is a **pure reformat** (lowest risk). Keep the `import type { SkippedAgent } from "../runnability"` and the five `skipped` insertions, each beside the already-present `scenarios`: `RunAgentsParams.skipped`, `RunAgentPairParams.skipped`, the destructures in `runAgents` and `runAgentPair`, the `skipped,` in the `runAgentPair({...})` call, and the `skipped,` in the `agentCtx` literal. No trunk logic to merge. WordPress format.

- **Alternatives (for 2.2/2.3/2.4):** "merge trunk's logic too." Rejected because the whitespace-insensitive diff (`git diff -w <merge-base> <trunk-tip>`) confirms trunk's entire change on these three files is the reformat — there is no trunk logic to merge, so "take the branch in trunk's format" is the faithful both-sides resolution (trunk's contribution **is** the format).
- **Traces to:** Requirement 2 (both sides preserved) / AC "each file contains both sides"; Requirement 4 (typechecks — the `runScenario` call site and `writeRunReport` signature) / AC typecheck; Requirement 5 (skip behavior unchanged — `summary.test.ts` exit-2 + skip-block; `progress-*.test.ts`) / AC the nine tests pass; Requirement 7 (trunk's nested-folders intact).

### Decision 3: Resolve the remaining 15 files in three sub-categories

**3.1 Two-sided (real trunk + real branch semantics) — `testing-project/eval/utils/verify-e2e.ts`.** A third file like `pipeline.ts`. **Keep** the branch's review-1 fix (the `projectArgs` import, the 4-arg `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)` signature, the `...projectArgs(runnableAgentIds, configuredProjectNames)` selectors appended to the `test:e2e` call, and **no** config back-edge — there is no `import config`). **AND adopt** trunk's rewritten `scenarioDirOf` (anchor on the `scenarios` path segment via `lastIndexOf('scenarios', specIndex - 1)`, then `scenarioSegments.join('/')` to yield nested IDs like `blocks/counter`) plus trunk's "normalized scenario directory ID" doc/comment edits. The two change-sets occupy **disjoint regions** (verified at current HEAD: three conflict regions — the import block, the docblock+signature, the `test:e2e` call — all carry the `projectArgs`/4-arg branch side on HEAD, while the `scenarioDirOf` body around line 291 auto-merged to trunk's nested form). Both survive. Trunk did NOT change `runE2eVerification` arity beyond the branch's 4-arg extension, reintroduce a config back-edge, or add a `projectArgs`-equivalent. WordPress format.

**3.2 Content overlap requiring a true prose merge — `README.md`.** Fold in **all** of trunk's additive sections (the nested-folders selection prose — scenario IDs normalized with `/`, `blocks/counter`, the `beforeAll … scenarios` record; the subscription-auth prose; the `(scenario.name, agent)` rename) **and all** of the branch's additive sections (`### Exit codes`, the "When an agent can't run" block, judge-stops/improver-halt, `### Skipped agents in report.json`, the hook-context `skipped` field). For the **two overlapping paragraphs** — the `afterAllScenarios` bullet and the self-improvement-summary sentence — merge both edits into one: the branch's `ctx.skipped` / runnable-exclusion prose **carrying** trunk's `(scenario.name, agent)` precision (use `scenario.name`, not bare `scenario`). Verified at current HEAD: the merge leaves both `afterAllScenarios` variants adjacent (one with `ctx.skipped`/`(scenario, agent)`, one with `(scenario.name, agent)` and no skip prose); the merged paragraph must combine the skip prose with the `scenario.name` wording. This is the one spot requiring genuine human judgment rather than mechanical take-both — flagged to prevent a silent drop of either side. The merged prose must introduce **no process vocabulary** (Requirement 10).

**3.3 Mechanical "keep branch feature line(s) + adopt trunk WordPress format" (the rest).** Trunk's side on each is a pure reformat:
- `testing-project/skillsmith.config.ts` — keep the misconfigured `gpt` agent (`provider: "openai-api"`, no key) + `agents: ["haiku", "gpt"]`, and the `afterAllScenarios` hook that destructures `{ scenarios, iterationDirectory, config, skipped }` and derives `skippedTestIds` → `runnableAgentIds` + `configuredProjectNames` from `config.roles.test.agents`, calling the 4-arg `runE2eVerification`.
- `examples/skillsmith.config.ts` — keep **both** trunk's subscription-auth comment on the `cc-haiku` agent AND the branch's skip comments on the api-provider agents (`anthropic-api`/`openai-api`/`gemini-api`); different blocks, no overlap.
- `src/config/types.ts` — **import-line conflict only.** Union the imports (keep `import type { SkippedAgent } from "../runnability"`); both `RunContext.skipped` and `RunScenario.id`/`dirName` live in different interfaces and auto-merge.
- `src/improvement/improver.ts` — import/format-only; the branch adds nothing semantic (the `-w` diff is quotes/commas/wraps, including the `.join('\n')` strings).
- `src/providers/{anthropic,gemini,openai}-api.ts` — keep `requiredEnv`.
- `src/providers/types.ts` — keep `requiredEnv?`.
- `src/reports/iteration-report.ts` — keep the `SkippedAgent` import + the 4-arg `skipped` param/field (Meeting point 2).
- `src/progress/render.ts` — keep the cyan `SKIPPED AGENTS` block.
- `src/__tests__/{summary,progress-render,progress-tracker}.test.ts` — keep the branch's new skip cases; adopt format on shared tests.

- **Traces to:** Requirement 2 (both sides preserved) / AC "each file contains both sides"; Requirement 6 (testing-project import-cycle fix preserved — `verify-e2e.ts` keeps the `projectArgs` fix and no config back-edge) / AC config-smoke + order-preserving forwarding; Requirement 7 (nested-folders `scenarioDirOf` intact); Requirement 10 (no process vocabulary — README/examples prose).

### Decision 4: Auto-adopt trunk's Biome 2.5.0 toolchain via the merge, then `npm install` before formatting

- **Choice:** Do not hand-edit `package.json`, `biome.json`, or `package-lock.json`. Rely on the clean one-sided auto-merge to Biome 2.5.0. After resolving the 19 files: `npm install` (root) and `npm install --prefix testing-project` to put the 2.5.0 binary in `node_modules`, **then** `npx biome format --write .` over the resolved files, then verify with `npx biome format .` (verify, no rewrite) + `npm run lint`.
- **Alternatives:** Hand-edit the Biome pin / config / lockfile during resolution. Rejected — redundant and drift-prone.
- **Trade-offs / verification:** The three toolchain files are **outside** the 19-conflict set (the branch never diverged from the merge-base on any of them), so trunk's 2.5.0 wins cleanly in a 3-way merge. Verified at current HEAD: the merged `package.json` pins `@biomejs/biome": "2.5.0"`; `biome.json` is the WordPress config (`indentWidth: 4`, `lineWidth: 80`, `quoteStyle: single`, `trailingCommas: es5`, `semicolons: always`, `arrowParentheses: always`); the merged `package-lock.json` has **zero** `2.4.12` references. The order is load-bearing: the local binary is **2.4.12 until `npm install` runs** (verified), so formatting before the install produces 2.4.x output that fails the 2.5.0 format-verify.
- **Traces to:** Requirement 3 (reconciled code conforms to trunk's Biome 2.5.0 WordPress formatting and lint; uses the same exactly-pinned 2.5.0 toolchain) / AC `npx biome format .` and `npm run lint` exit 0.

### Decision 5: Make no changeset change

- **Choice:** Touch no changeset. The branch's three changesets (`skip-misconfigured-agents.md` minor, `early-skip-announcement.md` patch, `initial-scaffolding.md` none) and trunk's three (`claude-code-subscription-auth.md`, `nested-scenario-folders.md`, `wordpress-coding-standards.md`) auto-merge as a union — none is in the 19-conflict set, and `initial-scaffolding.md` is byte-identical across sides. Author **no** reconciliation changeset.
- **Alternatives:** Add a reconciliation changeset, or edit/downgrade an existing one. Rejected — the merge introduces no consumer-visible behavior beyond what the existing changesets describe, and `CONTRIBUTING` exempts merges/reformats; the spec forbids a new changeset for the reconciliation.
- **Trade-offs:** The changeset gate is mechanism-agnostic. After the merge, `npx tsx scripts/validate-changesets.ts` (parses contents only — zero git awareness) exits 0, and `npx changeset status --since=origin/trunk` (computes `merge-base` then `git diff --name-only`) finds the branch-only `skip-misconfigured-agents.md` (minor) + `early-skip-announcement.md` (patch) in the diff and reports `@automattic/skillsmith` bumped at **minor** → exit 0. Verified at current HEAD: the merge leaves all changesets present. The only discipline required is the **negative** one — never delete or empty a changeset during resolution.
- **Traces to:** Requirement 8 (changesets coherent; `@automattic/skillsmith` bumped at minor; no changeset deleted/emptied/downgraded; no new changeset).

## Dependencies

- **No new runtime or external dependency** is introduced by this reconciliation. The branch's feature added none (the classifier is pure TypeScript reading `process.env`). The e2e path's dependency on Playwright + wp-env is unchanged and remains outside the guardrail set.
- **The one toolchain change is trunk's, not ours:** Biome `2.4.12` → `2.5.0`, arriving through the clean auto-merge of `package.json` + `package-lock.json` (Decision 4).
- **Internal modules relied on (not modified):** `src/runnability.ts` (the classifier, branch-only, lands clean); trunk's `src/scenarios/selection.ts` (the nested-folders selection API `pipeline.ts` imports from); `src/config/normalize.ts` (order-preserving id derivation the review-1 fix relies on); `testing-project/eval/utils/project-args.ts` (the order-preserving `--project` selector builder).
- **Operational dependency:** after the merge, `npm install` (root) and `npm install --prefix testing-project` must run so `node_modules` reflects trunk's 2.5.0 binary and any trunk-introduced deps **before** the guardrails are run.

## Failure Modes and Observability

The acceptance criteria are the failure detectors. **CI nuance (load-bearing):** the only PR-triggered workflow is `.github/workflows/changeset-gate.yml`, which runs only the two changeset commands. The workflow that runs lint/typecheck/test (`release.yml`) is `workflow_dispatch`-only. So **lint, typecheck, test, format-verify, and config-smoke are local/manual guardrails for this reconciliation, NOT automatic PR CI** — PR #45 can show "green on GitHub" (changeset gate) while still failing them locally. They MUST be run locally to validate the merge.

### Failure-mode → specific catch (verified by reading the test bodies)

| Mis-resolution | Caught by |
| --- | --- |
| Drop `scenarios` in the `runScenario` call | typecheck (`ScenarioRunArgs.scenarios` required) + the selection tests |
| Drop `agentFilter`/`skipped` in the `runScenario` call | `skip-misconfigured.test.ts` (asserts exit 2; skipped `gpt` has no cell in `report.scenarios["hello-scenario"]`, no workspace dir, appears in top-level `report.skipped`) + typecheck |
| Reintroduce trunk's summary early-return inside the all-pass branch | `summary.test.ts:311` (`/SKIPPED AGENTS/` + `=== 2`); reinforced by `:406` (empty+skip→2) and `:329` (fail+skip precedence) |
| Incomplete `tracker.ts` rename (a `this.interactive` left) | typecheck (duplicate-identifier private field + getter, or assigning to a getter-only) |
| Drop the 4-arg `writeRunReport` | `iteration-report-skipped.test.ts:29` (direct 4-arg call asserting top-level `parsed.skipped`) + typecheck |
| Reintroduce the config back-edge in `verify-e2e.ts` | `config-loads.test.ts` + `check:config` (throw on import) |
| Revert `verify-e2e.ts` to the 2-arg signature | typecheck at the `skillsmith.config.ts` 4-arg call site |
| A changeset accidentally dropped/emptied | `npx changeset status --since=origin/trunk` no longer reports minor (or `validate-changesets.ts` fails on an empty body) |

### THE ONE UNGUARDED FAILURE MODE — nested `scenarioDirOf` dropped

If the resolution keeps the branch's **flat-only** `scenarioDirOf` (immediate-parent segment) instead of trunk's nested-path body, the code **compiles and passes `npm test`** — no unit test imports `verify-e2e.ts`'s `scenarioDirOf` — and breaks only a **live** nested-scenario Playwright e2e run (`npm run test:e2e`, not a guardrail). The automated suite gives **no signal** here. **Detection is by reviewer inspection only:** confirm trunk's nested `scenarioDirOf` body (the one anchoring on `'scenarios'` and `join('/')`) is the one kept. This is the highest-priority manual check of the reconciliation. (Verified at current HEAD the merge auto-takes trunk's nested body around line 291, but the resolver must confirm it survives the final committed file rather than assume it.)

### Soft signals (do not rely on exit code)

- **Orphaned imports** (e.g. a leftover `UserFacingError` after trunk's `filterScenarios` deletion, or a stray `SkippedAgent`/`projectArgs`) → `biome lint`'s `noUnusedImports` **warns but exits 0**. Typecheck is the hard gate for **missing** imports but not orphaned ones. Mitigation: eyeball the lint output; `npx biome format --write .` / `--write` can auto-fix unused imports; `organizeImports` may reorder unioned import blocks, so re-run biome over every resolved file.

### Observability of a successful reconciliation

The full guardrail set exits 0 from the worktree root after `npm install` (root + testing-project):

```
npx biome format .                              # verify, no rewrite — no files need reformatting
npm run lint                                    # biome lint .
npm run typecheck                               # tsc --noEmit
npm test                                        # 27 files (branch's 26 + trunk's scenario-filter-selection.test.ts); all green
npm --prefix testing-project run check:config   # config import graph loads without throwing
npx tsx scripts/validate-changesets.ts          # exit 0
npx changeset status --since=origin/trunk        # @automattic/skillsmith bumped at minor
```

plus GitHub no longer reporting PR #45 as `CONFLICTING`. `npm test` runs the **union** of 27 files post-merge (the glob `src/__tests__/*.test.ts` is unchanged); all must pass, not only the nine skip tests (Requirement 7). `codex.e2e.test.ts` matches the glob but self-guards on `CODEX_E2E=1` → no-op without it.

## Risks and Open Questions

### Risks

- **(High, mitigable) The unguarded `scenarioDirOf` resolution.** Dropping trunk's nested-path `scenarioDirOf` compiles, passes `npm test`, and passes every guardrail; it only breaks a live nested-scenario Playwright e2e run, which is not automated. **Mitigation:** the explicit reviewer-inspection step above — confirm trunk's `scenarioDirOf` body is kept. This is the single resolution where the automated suite gives no signal; surface it prominently to the plan and code phases.
- **(Medium, mitigable) Formatting with the stale 2.4.12 binary.** The local `node_modules/.bin/biome` is 2.4.12 until `npm install` runs (verified); formatting before the install produces 2.4.x output that fails the 2.5.0 format-verify. **Mitigation:** the ordered `npm install`-before-format step (Decision 4).
- **(Medium) Orphaned imports pass lint.** `noUnusedImports` is a non-failing warning. **Mitigation:** eyeball lint output; run biome `--write`, which can auto-fix unused imports.
- **(Low) `pipeline.ts` is the highest-complexity single resolution** — the only file interleaving two real changes. Its acceptance probes (`skip-misconfigured.test.ts` + the selection tests + typecheck) are strong, so a mis-resolution is caught, but it warrants the most care.
- **(Low) CI gives a false sense of green.** Only the changeset gate runs on PR #45. **Mitigation:** the acceptance gate is the **full local** guardrail run, not the PR's CI status.
- **(Low) Scope discipline.** Requirement 9 (minimal) + Requirement 10 (no process vocabulary) mean no refactors beyond faithful conflict resolution + formatter output, and the README prose merge must avoid phase/spec/plan vocabulary.

### Open Questions (deferred to the implementation phases)

- **Exact post-merge line placement of each resolved hunk.** The design fixes WHAT each resolution must contain (verified targets) and the WordPress format to apply; the precise line numbers are an implementation detail the merge itself produces. Deferred to the code phase.
- **The README two-paragraph prose merge wording.** The design fixes that the `afterAllScenarios` bullet and self-improvement summary must carry the branch's skip/runnable prose AND trunk's `(scenario.name, agent)` precision; the exact final sentences are a writing detail for the code phase (no process vocabulary — Requirement 10).
- **Whether `src/progress/types.ts` and `testing-project/playwright.config.ts` remain non-conflicting at merge time.** Trial merges at the prior tips and at current HEAD all produced exactly the 19 conflicts with these auto-merging/absent; the code phase should confirm at actual merge time (a 1-line check), but no design depends on a different outcome.
