# Design Research: Reconcile the skip-misconfigured-agents branch with current `trunk`

> Scope reminder: this is a **reconciliation/review** run. Decisions here are about
> HOW to merge `trunk` into the branch so PR #45 becomes mergeable, the guardrails go
> green, and the already-shipped skip-misconfigured-agents behavior is preserved
> unchanged. We do not re-litigate the feature's WHAT (policy, classifier scope, role
> rules, exit codes, surfacing) — those were decided in `base`/`review-1`/`review-2`.

## Key facts (confirmed this session)

- Branch HEAD: `56b4d2c` (= prior branch tip `380b0ff` plus the spec/intent commits
  for this review run, all under `.pipelines/`). `380b0ff` is an ancestor of HEAD.
- `trunk` tip: `95c86bd` ("Merge pull request #52 … nested-scenario-folders"; the
  WordPress/Biome-2.5.0 reformat landed in `24021e1` / merge `f202e01`).
- Merge-base(HEAD, trunk): `9541456` — unchanged from the spec-research trial merge,
  because the only commits HEAD added on top of `380b0ff` touch `.pipelines/` only.
- HEAD is 89 commits behind trunk.
- Branch changesets present: `early-skip-announcement.md`, `initial-scaffolding.md`,
  `skip-misconfigured-agents.md` (+ `.changeset/README.md`).

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### Conflict set is stable against current HEAD `56b4d2c` (not just `380b0ff`)

Trial merge in a throwaway detached worktree at `56b4d2c`, `git merge --no-commit --no-ff 95c86bd`:

- Exactly the same **19 files** conflict — no more, no fewer — all `UU` (both-modified
  content conflicts); zero add/delete (`AA`/`DU`/`UD`) conflicts. List byte-identical to
  spec-research's. The three `.pipelines/`-only commits HEAD added on top of `380b0ff`
  (`1712bc2`, `ca34570`, `56b4d2c`) introduce no new conflicts (trunk never touches
  `.pipelines/`).
- Merge-base is still `9541456` (`git merge-base 56b4d2c 95c86bd` == `git merge-base
  380b0ff 95c86bd`). So the spec-research per-file conflict anatomy from `380b0ff`
  transfers 1:1. Branch is 89 commits behind (`git rev-list --count 56b4d2c..95c86bd`).
- Cleanup verified: merge aborted, scratch worktree removed, `git worktree list` clean,
  our `-v3` tree HEAD still `56b4d2c`.

**Implication:** the reconciliation merges trunk into current HEAD `56b4d2c`; the
spec-research resolution map applies unchanged. Source: researcher trial merge this session.

### Changeset gate is mechanism-agnostic (merge vs rebase produce the same result)

The only changeset CI is `.github/workflows/changeset-gate.yml` (two steps):
- `npx tsx scripts/validate-changesets.ts` — parses changeset file *contents* only; zero
  git/history/merge awareness. Invisible to merge-vs-rebase.
- `npx changeset status --since=origin/trunk` — implemented (in
  `@changesets/git`) as `getDivergedCommit` → `git merge-base <ref> HEAD` → `git diff
  --name-only <mergeBase>`. After either a merge commit or a rebase, the merge-base of HEAD
  and origin/trunk becomes trunk's tip, the branch-only changesets
  (`skip-misconfigured-agents.md` minor, `early-skip-announcement.md` patch) are in the
  diff, so the gate reports `@automattic/skillsmith` bumped at **minor** → exit 0.
- No changeset file is in the 19-file conflict set. `initial-scaffolding.md` exists on both
  branch and trunk and is byte-identical, so it auto-merges (not a conflict). The merge
  cannot drop a changeset **provided** resolution never deletes/empties one (a resolution
  discipline, not a mechanism property).
- PR #45 keeps `base.ref = trunk` regardless of mechanism; no re-targeting.

Sources: `.github/workflows/changeset-gate.yml`; `scripts/validate-changesets.ts`;
`node_modules/@changesets/git/dist/changesets-git.esm.js` (`getDivergedCommit`).

### The 4 hard conflicts — verified against real current file contents (with a correction)

Researcher diffed each file trunk-vs-merge-base whitespace-insensitively
(`git diff -w 9541456 95c86bd -- <file>`). **Correction to spec-research's framing:**
for 3 of the 4 files (`summary.ts`, `tracker.ts`, `agent-loop.ts`), trunk's ENTIRE change
is the pure Biome WordPress reformat — **zero semantic trunk change**. The shapes
spec-research attributed to "trunk also changed logic" (the summary early-return, the
`scenarios: args.runCtx.scenarios` call arg) **already existed at the merge-base** — they
are not trunk's intervening work. So 3 of 4 resolutions are strictly "take the branch's
logic, in trunk's WordPress format" with no trunk logic to merge. Only **`pipeline.ts`** has
genuine trunk-side semantic work (the nested-folders scenario-selection refactor, PR #52),
and it lands in **different regions** than the skip-feature code.

**1. `src/pipeline/pipeline.ts`** — the only file with real two-sided semantics.
- Trunk's real changes (vs merge-base): import block drops `filterScenarios`-era imports +
  `UserFacingError`, adds from `../scenarios/selection`:
  `normalizeScenarioFilters`, `selectScenariosByNormalizedFilters`,
  `validateConfiguredScenarioNamesAreUnique`; `runPipeline` replaces inline `filterScenarios(...)`
  with `enumerateScenarios` → `normalizeScenarioFilters(params.scenarios ?? [])` →
  `validateConfiguredScenarioNamesAreUnique(...)` → `selectScenariosByNormalizedFilters(...)`;
  the `runScenarios` map gains an `id` field (`{ id, dirName, scenario }`); the local
  `function filterScenarios` is deleted.
- The `runScenario` call site itself: trunk did NOT change it beyond reformat — at merge-base
  (base lines 367-377) the call already carried BOTH `agentFilter` AND
  `scenarios: args.runCtx.scenarios`. The branch's call (branch lines 447-458) already combines
  all three: `agentFilter: effectiveFilter` (454) + `scenarios: args.runCtx.scenarios` (457,
  kept from base) + `skipped: args.runCtx.skipped` (458), preceded by the `effectiveFilter`
  intersection (branch 437-446).
- Field names match across sides — no rename: `RunAgentsParams`/`ScenarioRunArgs` use
  `scenarios: RunScenario[]`, `agentFilter` (threaded to runAgents as `agentIdFilter`),
  `skipped: ReadonlyArray<SkippedAgent>`. Trunk's `runScenario` sig uses the same.
- Branch runnability plumbing to preserve (separate regions): `import { classifyRunnability,
  decide, type SkippedAgent } from "../runnability"`; `classifyRunnability(config, process.env)`;
  judge STOP_RUN guard; `runnableTestAgentIds`; `earlySkips` (non-STOP_RUN) + early-announce loop;
  `skipped: runnability.skipped` on RunContext; `skippedAgents: earlySkips` into tracker init;
  the two 4-arg `writeRunReport(runDirectory, runId, mergedScenarios, runnability.skipped)` calls;
  `runnability.improverRunnable` improver-gating + early-break; `ScenarioRunArgs.runnableTestAgentIds`.
- Care points: combine trunk's `../scenarios/selection` imports WITH the branch's `../runnability`
  import in the import block; in the runPipeline selection region adopt trunk's
  `selectScenariosByNormalizedFilters` + `id` while keeping the branch's runnability wiring just
  after it.

**2. `src/reports/summary.ts`** — pure-reformat trunk side; take the branch wholesale.
- Identifiers unchanged on trunk (`prepareSummary`, `emitSummary`, `renderSummaryLines`,
  `PreparedSummary`). Branch adds `loadSkipped`, `pushSkipBlock`, `SkippedEntry`.
- The early-return shape **predates the merge-base** (base `renderSummaryLines` already had
  `if (allPass) { push PASS; return lines } …FAIL… return lines`). It is NOT trunk's work and
  NOT the obstacle.
- The branch CONVERTED that early-return into if/else and appended an unconditional
  `pushSkipBlock(lines, skipped, color)` after the if/else, so the skip block runs on BOTH the
  all-pass and fail paths (branch 164-192). Plus a 5th `skipped: SkippedEntry[]` param,
  `pushSkipBlock` (branch 201-213, cyan header, `${id}: ${reason}` rows, no-op when empty),
  `prepareSummary`'s `const skipped = loadSkipped(reportPath)` + `const exitCode =
  skipped.length > 0 ? 2 : allPass ? 0 : 1` (replaces trunk's `allPass ? 0 : 1`), and `loadSkipped`
  (branch 139-153, reads report's top-level `skipped`, `[]` when absent).
- CAUTION: do NOT re-introduce trunk's early `return lines` inside the allPass branch — it would
  skip `pushSkipBlock` on a clean-pass-with-skip run.

**3. `src/progress/tracker.ts`** — pure-reformat trunk side; the rename is mandatory to compile.
- Trunk added NO new `this.interactive` use (`-w` diff shows zero +/- on any interactive line).
- Trunk's interactive refs (conflict region): field decl line 70 `private readonly interactive`,
  assignment line 89, reads at lines 113 and 250. (Line 24 `interactive?: boolean` on
  `TrackerOptions` is the input option — unchanged on both sides, NOT renamed.)
- Branch renames to `private readonly interactiveMode` (line 71), assignment 91, reads 116/255,
  and adds a public `get interactive(): boolean { return this.interactiveMode; }` (lines 124-126).
- **Why the rename is mandatory:** TypeScript forbids a private field `interactive` AND a getter
  `interactive` on the same class (duplicate identifier). So trunk's `private readonly interactive`
  cannot coexist with the branch's `get interactive()`. The 3 internal uses (assignment + 2 reads)
  and the field decl must all move to `interactiveMode`.
- Also keep (no collision): `skippedAgents?: {id;reason}[]` on `TrackerInit` (line 13), private
  `skippedAgents` field (79) + init (96), `skippedAgents: this.skippedAgents.slice()` in the
  snapshot (251), and the run-scoped reset comment in `beginIteration` (145-146).

**4. `src/pipeline/agent-loop.ts`** — pure-reformat trunk side; lowest risk.
- Not a "returned object" (`runAgents`/`runAgentPair` return `Promise<void>`); `skipped` is
  threaded through object literals passed onward and the `AgentContext`.
- Branch adds `import type { SkippedAgent } from "../runnability"` + 5 `skipped` insertions:
  `RunAgentsParams.skipped` (35), `RunAgentPairParams.skipped` (129), destructures in `runAgents`
  (80) and `runAgentPair` (78), `skipped,` in the `runAgentPair({...})` call (111), and `skipped,`
  in the `agentCtx` literal (91). `scenarios` already present at merge-base at all these spots, so
  only `skipped` folds in alongside it. The other `skipped`/`SKIPPED` tokens are pre-existing
  string literals identical on both sides.

Sources: read-only `git show {95c86bd,56b4d2c,9541456}:<file>` and `git diff -w` per file, this
session; line numbers as cited above.

### Repo convention: features land as merge commits; trunk→branch catch-up merges are precedented

`git log --first-parent origin/trunk` — every feature lands as a GitHub merge commit
(`Merge pull request #NN from Automattic/worktree-…`; 49 merges across 439 commits). Direct
precedent for the exact catch-up pattern: `92819e0 "Merge trunk into nested-scenario-folders
branch"` plus several `Merge branch 'trunk' into <feature>` commits. The branch itself
already contains one such catch-up: `1c0b666 "Merge branch 'trunk' into
worktree-37-skip-misconfigured-agents-v3"`. No rebase/linear-history norm exists;
`CONTRIBUTING.md`/`AGENTS.md` only cover changesets/release flow, neither requires rebase nor
forbids merge commits.

### The ~15 mechanical conflicts — verified, with TWO more hidden-semantics corrections

Researcher ran `git diff -w 9541456 95c86bd` (whitespace-insensitive, trunk-vs-base) per file.
Most are pure-reformat trunk side, but **two more files have hidden trunk semantics** the
"mechanical" label would have missed:

**`testing-project/eval/utils/verify-e2e.ts` — a THIRD two-sided file (not mechanical).**
- Trunk's nested-folders work rewrote the `scenarioDirOf` helper: base/branch body takes the
  spec's immediate parent segment (`if (segments.length >= 2) return
  segments[segments.length-2]`); trunk's body anchors on the `scenarios` segment and joins nested
  segments with `/` to yield nested IDs like `blocks/counter` (`specIndex =
  lastIndexOf('e2e.spec.mjs')`; `scenariosIndex = lastIndexOf('scenarios', specIndex-1)`;
  `return scenarioSegments.join('/')`). The branch still has the OLD body and must adopt trunk's.
- Trunk also updated docs/comments ("maps back to the scenario directory" → "the normalized
  scenario directory ID"; the name↔dir map comment; the `scenarioDirOf` docblock).
- Trunk did NOT (verified): reintroduce a config back-edge (only `node:*` + `@automattic/skillsmith`
  type imports, no `import config`); add a `projectArgs`-equivalent; change the hook plumbing; or
  change `runE2eVerification` arity (stayed 2-arg `(iterationDirectory, scenarios)`). `scenarios`
  is `RunScenario[]` on all sides; `RunScenario.id` lives in config/types.ts; verify-e2e still reads
  `s.dirName`/`s.scenario.name` — nothing new about the `scenarios` param beyond `scenarioDirOf`.
- The branch's review-1 fix lives in DIFFERENT regions: `import { projectArgs } from "./project-args"`;
  4-arg signature `(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)`; the
  `...projectArgs(runnableAgentIds, configuredProjectNames)` selectors appended to the `test:e2e`
  call. No module-init config read (there is no `import config`). The two change-sets don't overlap.

**`testing-project/skillsmith.config.ts` — trunk pure reformat.** Branch adds the misconfigured
`gpt` agent (`provider: "openai-api"`, no key) + `agents: ["haiku","gpt"]`; the `afterAllScenarios`
hook destructures `{ scenarios, iterationDirectory, config, skipped }` and derives
`skippedTestIds`→`runnableAgentIds` + `configuredProjectNames` from `config.roles.test.agents`,
calling the 4-arg `runE2eVerification`. Keep all of it + WordPress format.

**`README.md` — genuine paragraph-level OVERLAP.** Trunk added the nested-folders selection
section (scenario IDs normalized with `/`, `blocks/counter`, the `beforeAll … scenarios` record),
the subscription-auth prose (PR #47), and the `(scenario.name, agent)` rename. Branch added the
`### Exit codes` section, the "When an agent can't run" block, judge-stops/improver-halt, `###
Skipped agents in report.json`, and the hook-context `skipped` field. **The true overlap** (same
paragraph edited by both sides): the `afterAllScenarios` bullet — trunk reworded it to "…each spec
runs across the configured testing-agent projects … maps each failing spec back to its
`(scenario.name, agent)` pair…"; the branch reworded the SAME bullet to add "…reads `ctx.skipped`
… runs Playwright only against the runnable … a skipped agent gets no Playwright project…" with
`(scenario, agent)`. Plus the self-improvement-summary sentence is the same kind of overlap. These
two paragraphs need a real merge (branch's skip/runnable prose carrying trunk's `(scenario.name,
agent)` wording); everything else is non-overlapping additive sections, keep both.

**`examples/skillsmith.config.ts` — real trunk content, NO overlap.** Trunk added the
subscription-auth comment on the `cc-haiku` agent (PR #47); branch added skip comments on the
api-provider agents (`anthropic-api`/`openai-api`/`gemini-api`). Different blocks — keep both.

**`src/config/types.ts` — import-line conflict only (despite trunk adding fields).** Trunk added
`RunScenario.id` (+ `dirName` alias, `dirName === id`); branch added `RunContext.skipped` + `import
type { SkippedAgent } from "../runnability"`. Different interfaces → both bodies auto-merge; only
the import line conflicts. Union the imports; both `RunContext.skipped` and `RunScenario.id`/`dirName`
retained.

**`src/improvement/improver.ts`** — pure reformat (`-w` diff is quotes/commas/wraps only,
incl. the `.join('\n')` strings); branch adds nothing semantic; import/format-only.

**All pure "keep branch line + adopt trunk format" (verified pure-reformat trunk side):**
`src/providers/{anthropic,gemini,openai}-api.ts` (keep `requiredEnv`), `src/providers/types.ts`
(keep `requiredEnv?`), `src/reports/iteration-report.ts` (keep `SkippedAgent` import + 4-arg
`skipped` param/field), `src/progress/render.ts` (keep the cyan `SKIPPED AGENTS` block),
`src/__tests__/{summary,progress-render,progress-tracker}.test.ts` (keep the branch's new skip
cases, adopt format on shared tests).

### Biome toolchain lands on 2.5.0 automatically via the merge

Verified in a throwaway merge worktree (`/tmp/skillsmith-toolchain-merge`, detached @`56b4d2c`,
aborted & removed):
- Branch pins `@biomejs/biome` **2.4.12** (== merge-base); trunk pins **2.5.0**. The only
  branch-vs-trunk `package.json` diff is that one line; branch == base, so a clean 3-way merge
  takes trunk's `2.5.0` — no risk of keeping the old pin (confirmed merged `package.json` = 2.5.0).
- `package.json`, `biome.json`, and `package-lock.json` are **NOT in the 19-conflict set** — branch
  never diverged from base on any of them, so trunk's change wins cleanly.
- `biome.json` auto-merges to trunk's 2.5.0 WordPress config (`indentWidth:4`, `lineWidth:80`,
  `quoteStyle:single`, `trailingCommas:es5`, `semicolons:always`, `arrowParentheses:always`).
- `package-lock.json` auto-merges to a 2.5.0-consistent lockfile (`@biomejs/biome` 2.5.0, all
  `@biomejs/cli-*` at 2.5.0, ZERO 2.4.12 references) — coherent, no manual edit needed. CI's
  `npm ci` validates lock-vs-package; both at 2.5.0 satisfies it.
- Operational steps after resolving the 19 files: (1) keep the auto-merged package.json/biome.json/
  package-lock.json (don't revert); (2) `npm install` (or `npm ci`) to put the 2.5.0 binary in
  `node_modules` so formatting uses trunk's exact binary (Requirement 3); (3) `npx biome format
  --write .` to normalize the manually-resolved files to WordPress style; (4) optional `npx biome
  format --check .` + `npx biome lint .` to confirm zero drift before committing.

Sources: `git show {56b4d2c,95c86bd,9541456}:package.json`; `git diff {9541456,56b4d2c} 95c86bd --
biome.json`; trial merge output (merged package.json/biome.json/lockfile all 2.5.0; none in the
`--diff-filter=U` set); per-file `git diff -w` and `git show` as cited; worktree removed, clean.

### Verification surface, CI nuance, and failure-mode → guardrail mapping (current trunk)

**Guardrail commands (byte-identical on trunk + branch — no drift):** `npm run lint` (`biome lint
.`), `npm run typecheck` (`tsc --noEmit`), `npm test` (`node --import tsx --test src/__tests__/
*.test.ts`), `npm run format` (`biome format --write .`; verify form `npx biome format .`/`--check`),
testing-project `check:config` (`node --import tsx -e "await import('./skillsmith.config.ts')"` — the
config-smoke that throws if a config import-cycle/eager back-edge regresses),
`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`.

**CI nuance (state precisely in the design):** the ONLY PR-triggered workflow is
`.github/workflows/changeset-gate.yml` (`on: pull_request: branches:[trunk]`), which runs only the
two changeset commands. The workflow that runs lint/typecheck/test (`release.yml`) is
`workflow_dispatch`-only (its `push: branches:[trunk]` trigger is commented out). So lint, typecheck,
test, format-verify, and config-smoke are **local/manual guardrails for this reconciliation, NOT
automatic PR CI** — PR #45 can be "green on GitHub" (changeset gate) while still failing them
locally. They must be run locally to validate the merge.

**`npm test` breadth post-merge (Requirement 7):** the glob `src/__tests__/*.test.ts` is unchanged,
so post-merge it runs the UNION = 27 files (branch's 26 + trunk-only `scenario-filter-selection.test.ts`,
the nested-folders selection tests). All must pass, not only the 9 skip tests. `codex.e2e.test.ts`
matches the glob but self-guards on `CODEX_E2E=1` → no-op without it; safe.

**The 9 skip-feature tests — all present on branch; 3 conflicted, 6 added-clean:** conflicted (UU):
`summary.test.ts`, `progress-render.test.ts`, `progress-tracker.test.ts` (exist on both sides);
added-clean (branch-only, no conflict): `runnability.test.ts`, `providers-required-env.test.ts`,
`iteration-report-skipped.test.ts`, `project-args.test.ts`, `config-loads.test.ts`,
`skip-misconfigured.test.ts`.

**Failure-mode → specific catch (verified by reading test bodies):**
- `pipeline.ts` drops `scenarios` → **typecheck fails** (`ScenarioRunArgs.scenarios` required) +
  selection tests exercise the path. Drops `agentFilter`/`skipped` → **`skip-misconfigured.test.ts`
  fails** (asserts exit 2, the skipped `gpt` has no cell in `report.scenarios["hello-scenario"]`, no
  workspace dir, appears in top-level `report.skipped`) AND typecheck fails (the `skipped` param is
  required down `RunAgentsParams`/`RunAgentPairParams`). The integration fixtures are FLAT
  (`eval/scenarios/hello/`), so trunk's nested `id`=`dirName`=`hello`, reports key by `scenario.name`
  (`hello-scenario`) — no nested-folders collision in this test.
- `summary.ts` early-return reintroduced → **`summary.test.ts:311`** ("all-pass matrix plus a skipped
  agent exits 2 with a distinct skip block") fails its `/SKIPPED AGENTS/` and `=== 2` assertions;
  reinforced by `:406` (empty+skip→2) and `:329` (fail+skip precedence).
- `tracker.ts` rename incomplete (a `this.interactive` left) → **typecheck fails** (assigning to the
  now getter-only `interactive`, or duplicate-identifier private field + getter). `progress-tracker.
  test.ts` uses the unchanged `interactive: true` INPUT option + `skippedAgents` seed, so the test
  itself wouldn't directly catch a leftover — typecheck is the gate.
- `iteration-report.ts` loses the 4-arg `skipped` → **typecheck fails AND
  `iteration-report-skipped.test.ts:29`** (direct 4-arg `writeRunReport` call asserting top-level
  `parsed.skipped`).
- `verify-e2e.ts` review-1 fix dropped (config back-edge reintroduced) → **`config-loads.test.ts` +
  `check:config`** throw on import; reverting to the 2-arg signature → **typecheck fails** at the
  `skillsmith.config.ts` 4-arg call site.

**THE ONE UNGUARDED GAP — nested `scenarioDirOf` dropped.** If the resolution keeps the branch's
flat-only `scenarioDirOf` instead of trunk's nested-path body, it **compiles and passes `npm test`**
(no unit test imports `verify-e2e.ts`'s `scenarioDirOf`), and only breaks a LIVE nested-scenario
Playwright e2e run (`npm run test:e2e`, not a guardrail). This is a reviewer-inspection item, not a
guardrail-caught one.

**Design-only live-e2e boundary (record precisely):** `npm test` does NOT run the testing-project
Playwright e2e (`test:e2e` = `playwright test`, invoked only during a live skillsmith run via
`afterAllScenarios`, needing wp-env/Playwright/real providers). So the live `--project` runnable
exclusion AND `scenarioDirOf` nested parsing are OUT of the automated guardrail surface. Their
guardrail-observable proxies: `project-args.test.ts` (the pure `--project` selector logic),
`config-loads.test.ts`+`check:config` (config graph loads), and trunk's
`scenario-filter-selection.test.ts`/`scenario-selection.test.ts` (the `src/scenarios/selection`
nested-ID logic — NOT `verify-e2e.ts`'s `scenarioDirOf`).

Sources: `git show {95c86bd,56b4d2c}:package.json`/`testing-project/package.json` (identical scripts);
`.github/workflows/changeset-gate.yml` + `git show 95c86bd:.github/workflows/release.yml`
(workflow_dispatch-only); `git ls-tree -r {95c86bd,56b4d2c} -- src/__tests__/` + `comm`; test bodies
`git show 56b4d2c:src/__tests__/{skip-misconfigured,summary,iteration-report-skipped,progress-tracker}.test.ts`;
`git show 95c86bd:biome.json`; local `node_modules/.bin/biome --version` = 2.4.12; disposable `/tmp`
biome probes (all removed).

## Topics

<!-- One ## Topics entry per design decision, each tracing to a spec requirement/AC. -->

### Topic: Integration strategy — how trunk is incorporated into the branch

- **Spec link:** Requirement 1 (PR mergeable into trunk) / AC "no remaining merge
  conflicts, no longer CONFLICTING"; Requirement 9 (minimal change); the spec leaves the
  mechanism to the design phase ("Choosing the integration mechanics … is a later-phase
  decision; only the observable outcome … is required").
- **Options:**
  1. **Single `trunk` → branch merge commit** (`git merge <trunk-tip>` into the branch),
     resolving all 19 conflicts in one pass, then committing the merge.
  2. **Rebase** the branch onto trunk, replaying each branch commit and resolving conflicts
     per-commit.
  3. **Squash / reset / recreate-branch** — collapse the branch and re-apply the feature as
     a fresh diff onto trunk.
- **Trade-offs:**
  - Conflict-resolution count: merge resolves the 19 conflicts **once**; rebase re-surfaces
    the whole-repo Biome-reformat collision against the feature lines on **every** branch
    commit that touched any of the 19 files (~75 feature commits over the merge-base) — the
    classic "rebase across a repo-wide reformat" trap, with an independent mis-resolution
    risk each time, especially on the 4 hard semantic conflicts. Squash still resolves 19
    once but with the downsides below.
  - PR #45 history: merge preserves every existing commit/SHA, review threads anchored to
    commits, and `git blame`; rebase and squash rewrite SHAs (force-push, orphaned review
    comments) and squash also collapses the 3-run provenance the `.pipelines/` artifacts
    document.
  - Guardrails/CI: **mechanism-agnostic** — the changeset gate yields the same green result
    for merge and rebase (see Research). No guardrail favors any mechanism.
  - Repo convention: features land as merge commits; trunk→branch catch-up merges are
    directly precedented (`92819e0`; this branch's own `1c0b666`). No rebase/linear-history
    norm.
- **Decision:** Option 1 — a single `trunk` → branch merge commit into the current branch
  HEAD (`56b4d2c`), resolving the 19 conflicts in one guided pass using the per-file
  resolution map, then running the formatter and committing the merge.
- **Rationale:** Lowest mis-resolution risk (resolve once, not ×75), preserves PR #45's
  open-review history intact, keeps all changesets untouched, satisfies the
  minimal-change requirement, and matches the repo's established convention and this
  branch's own prior catch-up merge. No guardrail prefers another mechanism, so the
  human/risk factors decide — and they all point to the merge commit.

### Topic: Resolution of the 4 hard semantic conflicts

- **Spec link:** Requirement 2 (both sides preserved, neither dropped/weakened) /
  AC "each file contains both trunk's change and the branch's contribution"; Requirement 4
  (typechecks — the `runScenario` call site and `writeRunReport` signature) / AC typecheck;
  Requirement 5 (skip behavior unchanged — the `summary.test.ts` exit-2 + skip-block, and
  `progress-*.test.ts` cases that probe `summary.ts`/`tracker.ts`/`render.ts`); Requirement 7
  (trunk's nested-folders intact).
- **Resolution model:** This is not a free design choice — the "both sides preserved"
  requirement plus the verified file contents *determine* each resolution. The decision is to
  apply, for each file, the verified target below, then run the formatter.
  1. **`src/pipeline/pipeline.ts`** — adopt trunk's nested-folders selection refactor (the
     `../scenarios/selection` imports, the `enumerateScenarios`+`normalizeScenarioFilters`+
     `validateConfiguredScenarioNamesAreUnique`+`selectScenariosByNormalizedFilters` body, the
     `id` field on the `runScenarios` map, the deleted local `filterScenarios`) AND keep the
     branch's complete runnability/skip control flow — the `../runnability` import, the
     classifier call, judge STOP_RUN guard, `runnableTestAgentIds`, `earlySkips` + early-announce,
     `skipped` on RunContext, `skippedAgents` into the tracker, the two 4-arg `writeRunReport`
     calls, improver-gating + early-break — including the `runScenario` call that already carries
     `agentFilter: effectiveFilter` + `scenarios: args.runCtx.scenarios` + `skipped:
     args.runCtx.skipped` together. WordPress format throughout. Field names already match
     (no rename needed).
  2. **`src/reports/summary.ts`** — take the branch's logic wholesale (the if/else
     `renderSummaryLines` with `pushSkipBlock` called unconditionally AFTER the if/else so it
     runs on both the all-pass and fail paths; the skip-aware `exitCode = skipped.length>0 ? 2 :
     allPass ? 0 : 1`; `loadSkipped`/`pushSkipBlock`/`SkippedEntry`), in WordPress format. There
     is no trunk logic to preserve. Explicit caution: do NOT keep trunk's early `return lines`
     inside the allPass branch, or the skip block is skipped on a clean-pass-with-skip run.
  3. **`src/progress/tracker.ts`** — keep the branch's `private readonly interactiveMode` field
     + public `get interactive(): boolean` getter, and rewrite the 3 trunk-side `this.interactive`
     internal uses (assignment + 2 reads) to `this.interactiveMode` (mandatory — a private field
     and a getter cannot share the name `interactive`). Keep the branch's `skippedAgents`
     field/init/snapshot and the run-scoped reset comment. WordPress format.
  4. **`src/pipeline/agent-loop.ts`** — keep the `SkippedAgent` import and the 5 `skipped`
     insertions, each beside the already-present `scenarios`. No trunk logic to merge.
     WordPress format.
- **Decision:** Resolve each of the 4 files to its verified target above, then `npx biome
  format .`. The acceptance probes are the skip-feature tests: `iteration-report-skipped.test.ts`
  ⇔ #1 kept the 4-arg `writeRunReport`; `summary.test.ts` exit-2 case ⇔ #2 correct;
  `progress-render.test.ts`/`progress-tracker.test.ts` ⇔ #2/#3/`render.ts` correct;
  `npm run typecheck` ⇔ #1's call site and #3's rename compile.
- **Rationale:** The verified diffs show 3 of 4 have no trunk-side semantics, so "take the
  branch in trunk's format" is faithful "both sides preserved" (trunk's contribution is exactly
  the format). Only `pipeline.ts` interleaves two real changes, and they occupy disjoint regions,
  so both can be kept whole. This is the minimal faithful resolution (Requirement 9) and the only
  one that keeps every skip-feature test green as written (Requirement 5).

### Topic: Resolution of the ~15 mechanical conflicts (with the two extra two-sided files)

- **Spec link:** Requirement 2 (both sides preserved) / AC "each file contains both sides";
  Requirement 6 (testing-project import-cycle fix preserved) / AC config-smoke + order-preserving
  forwarding; Requirement 7 (trunk's nested-folders intact); Requirement 10 (no process vocabulary
  — relevant to README/examples prose).
- **Resolution model:** As with Topic 2, the verified file contents determine each resolution.
  The set splits three ways:
  - **Two-sided (real trunk + real branch semantics) — `testing-project/eval/utils/verify-e2e.ts`.**
    A third file like `pipeline.ts`. Keep the branch's review-1 fix (the `projectArgs` import, the
    4-arg `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds,
    configuredProjectNames)` signature, the `projectArgs(...)` selectors on the `test:e2e` call, no
    config back-edge) AND adopt trunk's rewritten `scenarioDirOf` (anchor on the `scenarios`
    segment, join nested segments with `/`) plus its "normalized scenario directory ID" doc edits.
    The two change-sets occupy disjoint regions; both survive. WordPress format.
  - **Content overlap requiring a true prose merge — `README.md`.** Fold in all of trunk's
    nested-folders + subscription-auth additive sections AND all of the branch's skip-feature
    additive sections; for the two overlapping paragraphs (the `afterAllScenarios` bullet and the
    self-improvement summary) merge both edits into one sentence — the branch's `ctx.skipped` /
    runnable-exclusion prose carrying trunk's `(scenario.name, agent)` precision (use
    `scenario.name`, not bare `scenario`).
  - **Mechanical "keep branch feature line(s) + adopt trunk WordPress format" (the rest).**
    `testing-project/skillsmith.config.ts` (keep the `gpt` agent + 4-arg-calling hook derivation);
    `examples/skillsmith.config.ts` (keep trunk's subscription-auth comment on `cc-haiku` AND the
    branch's skip comments on the api providers — different blocks); `src/config/types.ts` (union
    imports; `RunContext.skipped` + `RunScenario.id`/`dirName` both auto-merge); `src/improvement/
    improver.ts` (import/format-only); `src/providers/{anthropic,gemini,openai}-api.ts`
    (`requiredEnv`); `src/providers/types.ts` (`requiredEnv?`); `src/reports/iteration-report.ts`
    (`SkippedAgent` import + 4-arg `skipped`); `src/progress/render.ts` (cyan `SKIPPED AGENTS`
    block); `src/__tests__/{summary,progress-render,progress-tracker}.test.ts` (branch skip cases +
    format on shared tests).
- **Decision:** Resolve each file to its verified target above (two-sided merge for verify-e2e.ts,
  prose merge for README.md, keep-branch+format for the rest), then run the formatter.
- **Rationale:** Faithfully preserves both sides for Requirement 2, keeps the review-1 import-cycle
  fix intact for Requirement 6 (no config back-edge reintroduced; `projectArgs` order-preserving
  forwarding kept) while absorbing trunk's nested-scenario `scenarioDirOf` for Requirement 7, and
  is minimal (Requirement 9). The README prose merge is the one spot requiring genuine human
  judgment rather than mechanical take-both; flagging it prevents a silent drop of either side.

### Topic: Toolchain adoption (Biome 2.4.12 → 2.5.0)

- **Spec link:** Requirement 3 (reconciled code conforms to trunk's Biome 2.5.0 WordPress
  formatting and lint rules; "uses the same exactly-pinned Biome 2.5.0 toolchain as trunk") / AC
  `npx biome format .` and `npm run lint` exit 0.
- **Options:**
  1. **Let the merge auto-adopt trunk's 2.5.0 toolchain** (package.json pin, biome.json config,
     package-lock.json all auto-merge to 2.5.0 because the branch never diverged from base on them),
     then `npm install` to sync the binary and `npx biome format --write .` to normalize the
     manually-resolved files.
  2. Hand-edit the Biome pin / config / lockfile during resolution.
- **Decision:** Option 1. Do not hand-edit any of the three toolchain files; rely on the clean
  one-sided auto-merge to 2.5.0. After resolving the 19 conflicts: `npm install` (puts the 2.5.0
  binary in `node_modules`), then `npx biome format --write .` over the resolved files, then verify
  with `npx biome format --check .` + `npm run lint`.
- **Rationale:** Verified that package.json, biome.json, and package-lock.json are all outside the
  19-conflict set and auto-merge cleanly to a coherent 2.5.0 state (lockfile has zero 2.4.12
  references), so a hand-edit would be redundant and risk introducing drift — violating the
  minimal-change requirement. Using the 2.5.0 binary from `node_modules` (after `npm install`) to
  run the formatter is what makes the resolved hunks byte-match trunk's formatting, satisfying
  Requirement 3's "exactly-pinned 2.5.0 toolchain" and the format-verify guardrail.

### Topic: Components, interfaces, and data flow at the meeting points

- **Spec link:** Requirement 4 (typechecks where trunk's nested-folders shape and the branch's skip
  fields meet — the per-scenario run call and the run-report writer signature); Requirement 2 (both
  contributions retained); Requirement 7 (nested-folders intact).
- **Approach / mental model:** This reconciliation is a **3-way merge of two non-overlapping feature
  surfaces over a shared whole-repo reformat.** Trunk's intervening work is two features (nested
  scenario folders — `RunScenario.id`/`dirName`, the `../scenarios/selection` selection pipeline, the
  rewritten `scenarioDirOf`; and claude-code-subscription-auth — doc/comment only) plus the Biome
  2.5.0 WordPress reformat. The branch's work is the skip-misconfigured-agents feature (base +
  review-1 import-cycle fix + review-2 early announcement). The implementer's job is to lay the
  branch's feature surface onto trunk's reformatted-and-extended code, keeping both, then run the
  formatter. No component is redesigned; no new component is introduced by this run.
- **Component map (touched-vs-untouched):**
  - New files added clean by the branch (NOT on trunk, no conflict): `src/runnability.ts` (the
    classifier `classifyRunnability` + `decide` + `SkippedAgent`/`RunnabilityResult`),
    `src/__tests__/runnability.test.ts`, `testing-project/eval/utils/project-args.ts`,
    `src/__tests__/{providers-required-env,iteration-report-skipped,project-args,config-loads,
    skip-misconfigured}.test.ts`. These land untouched.
  - The 19 conflicting files: resolved per Topics 2-3.
  - New files added clean by trunk (the nested-folders selection module `src/scenarios/selection.ts`
    and its tests, etc.): land untouched; the branch absorbs them by importing from them in
    `pipeline.ts`.
  - Untouched-but-relevant: `src/progress/types.ts` (auto-merged clean — the branch's
    `RunSnapshot.skippedAgents` field plus trunk's reformat); `src/config/normalize.ts` (relied on by
    the review-1 fix for order-preserving id derivation, not modified); `testing-project/
    playwright.config.ts` (the review-1/base project-name fix; verify it's not re-conflicted — it was
    not in the 19).
- **The two interface meeting points (Requirement 4):**
  1. **The per-scenario run call (`runScenario` in `pipeline.ts`).** One call must carry trunk's
     `scenarios: args.runCtx.scenarios` (nested-folders plumbing) AND the branch's
     `agentFilter: effectiveFilter` (runnable allowlist) AND `skipped: args.runCtx.skipped`. Field
     names already align across `RunAgentsParams`/`ScenarioRunArgs` on both sides (no rename). The
     `effectiveFilter` is the intersection of any existing per-scenario filter with
     `runnableTestAgentIds`. If a careless resolution drops `scenarios`, nested folders break; if it
     drops `agentFilter`/`skipped`, the skip allowlist regresses.
  2. **The run-report writer (`writeRunReport` in `iteration-report.ts`).** Retains the branch's
     4-arg skip-bearing signature `writeRunReport(runDirectory, runId, mergedScenarios,
     runnability.skipped)`, so the top-level `skipped` array still lands in `report.json`. Trunk's
     side is reformat only.
- **Data flow (unchanged from the shipped feature; reconciliation must not alter it):** the
  classifier's `skipped` set is the single source of truth, threaded three ways — into `report.json`
  (machine surface + exit-code signal via `summary.ts`'s `skipped.length>0 ? 2 : allPass ? 0 : 1`),
  onto `runCtx.skipped` (hook context, readable from `beforeAll`), and through the e2e hook's
  `runnableAgentIds`/`configuredProjectNames` into the Playwright `--project` selectors. The
  early-announcement (review-2) seeds `RunSnapshot.skippedAgents` for the interactive dashboard and
  emits an early stderr line in non-interactive mode. Nested-folders adds an orthogonal data path
  (scenario `id`/`dirName` through `selection` → `runScenario` → `scenarioDirOf`); the two paths meet
  only at the `runScenario` call site (point 1) and are otherwise disjoint.
- **Decision:** No interface is changed by this run beyond what the two features already defined; the
  reconciliation preserves both the branch's additive signatures (`Provider.requiredEnv?`,
  `RunContext.skipped`, the 4-arg `writeRunReport`, the 4-arg `runE2eVerification`, the
  `RunSnapshot.skippedAgents` field, the `get interactive()` accessor) and trunk's additive shapes
  (`RunScenario.id`/`dirName`, the `selection` module API). The only hand-authored reconciliations are
  at the two meeting points above plus the README prose merge.
- **Rationale:** Because the two feature surfaces are field-disjoint everywhere except the single
  `runScenario` call and share no renamed identifier (verified in Topics 2-3), preserving both is a
  faithful union rather than a redesign — satisfying Requirements 2, 4, and 7 with the minimal change
  Requirement 9 demands.

### Topic: Dependencies

- **Spec link:** Requirement 3 (same exactly-pinned Biome 2.5.0 toolchain as trunk); Requirement 9
  (minimal change — no gratuitous additions).
- **Decision / findings:**
  - **No NEW dependency is introduced by the reconciliation.** The reconciliation adopts trunk's
    already-pinned dependency set wholesale via the merge. The one toolchain change — Biome
    `2.4.12` → `2.5.0` — is trunk's, not ours, and arrives through the clean auto-merge of
    `package.json` + `package-lock.json` (Topic 3). The branch's own feature added no runtime
    dependency in `base`/`review-1`/`review-2` (the classifier is pure TS reading `process.env`).
  - **Internal modules the design depends on (relied on, not modified):** `src/runnability.ts`
    (the classifier, branch-only, lands clean); trunk's `src/scenarios/selection.ts` (the
    nested-folders selection API that `pipeline.ts` must import from); `src/config/normalize.ts`
    (order-preserving id derivation the review-1 fix relies on); `testing-project/eval/utils/
    project-args.ts` (the order-preserving `--project` selector builder).
  - **External / services:** none added. The e2e path's dependency on Playwright + wp-env is
    unchanged and remains outside the guardrail set (Topic 4 / design-only).
  - **Operational dependency:** after the merge, `npm install` (root) and `npm install --prefix
    testing-project` must run so `node_modules` reflects trunk's 2.5.0 binary and any
    trunk-introduced deps before the guardrails are run.

### Topic: Changesets — coherence preserved with no change

- **Spec link:** Requirement 8 (changesets stay coherent; `@automattic/skillsmith` bumped at
  `minor`; no changeset deleted/emptied/downgraded; no new changeset for the reconciliation).
- **Decision:** Make NO changeset change. The branch's three changesets
  (`skip-misconfigured-agents.md` minor, `early-skip-announcement.md` patch,
  `initial-scaffolding.md` none) and trunk's three auto-merge as a union (none is in the 19-conflict
  set; `initial-scaffolding.md` is byte-identical across sides). After the merge,
  `npx tsx scripts/validate-changesets.ts` exits 0 and `npx changeset status --since=origin/trunk`
  reports `@automattic/skillsmith` bumped at `minor` (verified live on the trial-merge state in
  spec-research Q3). Do not author a reconciliation changeset (the merge introduces no new
  consumer-visible behavior beyond what the existing changesets describe; CONTRIBUTING exempts
  merges/reformats).
- **Rationale:** The changeset gate is mechanism-agnostic and passes on the merged state as-is
  (Research). The only discipline required is the negative one — never delete/empty a changeset
  during resolution. This is a constraint to honor, not a design choice with alternatives.

### Topic: Failure modes and observability

- **Spec link:** Requirements 1, 3-8 (every observable outcome the guardrails verify); the
  acceptance criteria are the failure detectors.
- **Failure modes of THIS reconciliation and how each is detected:**
  - **A merge conflict left unresolved / a feature line dropped** → `npm run typecheck` and/or the
    matching skip-feature test goes red. Precise map (from Topic 4 research): drop `scenarios` in the
    `runScenario` call → typecheck; drop `agentFilter`/`skipped` → `skip-misconfigured.test.ts` +
    typecheck; reintroduce summary early-return → `summary.test.ts:311`; incomplete tracker rename →
    typecheck; drop the 4-arg `writeRunReport` → `iteration-report-skipped.test.ts:29` + typecheck;
    reintroduce the config back-edge in verify-e2e → `config-loads.test.ts` + `check:config`; revert
    verify-e2e to 2-arg → typecheck at the config call site.
  - **Formatting drift (resolved file not in WordPress 2.5.0 style)** → `npx biome format .` (verify)
    reports the file; caught before commit. Mitigation: run `npx biome format --write .` with the
    2.5.0 binary over every resolved file.
  - **Orphaned import after a union resolution** (e.g. keeping `UserFacingError` after trunk's
    `filterScenarios` deletion) → `biome lint`'s `noUnusedImports` WARNS but exits 0 (soft signal,
    not a hard gate). The hard gate for MISSING imports is typecheck; for ORPHANED imports a reviewer
    must eyeball lint output (do not rely on its exit code). `organizeImports` may reorder unioned
    import blocks → re-run biome over every resolved file.
  - **A changeset accidentally dropped/emptied** → `npx changeset status --since=origin/trunk` would
    no longer report `minor` (or `validate-changesets.ts` fails on an empty body). Mitigation: never
    edit a changeset during resolution.
  - **THE UNGUARDED FAILURE MODE — nested `scenarioDirOf` dropped.** Keeping the branch's flat-only
    `scenarioDirOf` body compiles and passes `npm test` (no unit imports it); it breaks only a live
    nested-scenario Playwright e2e run, which is not a guardrail. **Detection is by reviewer
    inspection only** — confirm trunk's nested `scenarioDirOf` body is the one kept.
- **Observability of a successful reconciliation:** the full guardrail set exits 0 from the worktree
  root after `npm install` (root + testing-project): `npx biome format .` && `npm run lint` &&
  `npm run typecheck` && `npm test` (all 27 files) && `npm --prefix testing-project run check:config`
  && `npx tsx scripts/validate-changesets.ts` && `npx changeset status --since=origin/trunk`; plus
  GitHub no longer reporting PR #45 as CONFLICTING. Note (Topic 4): of these, only the two changeset
  commands run as PR CI — the rest are local/manual and MUST be run locally to validate the merge.

### Topic: Verification procedure (the ordered HOW for the implementer)

- **Spec link:** Requirements 1-9 (the merge must end with every guardrail green and the PR
  mergeable).
- **Decision — the ordered procedure (records HOW, leaves task sequencing to the plan phase):**
  1. From the branch HEAD, `git merge <trunk-tip>` (single merge commit).
  2. Resolve the 19 conflicts to their verified targets (Topics 2-3): the 4 hard files, the two
     extra two-sided files (`verify-e2e.ts`, README prose merge), the mechanical rest. Let
     `package.json`/`biome.json`/`package-lock.json` and `src/progress/types.ts` auto-merge; do not
     revert the toolchain files.
  3. `npm install` (root) and `npm install --prefix testing-project` so the 2.5.0 Biome binary and
     any trunk deps are on disk.
  4. `npx biome format --write .` (with the 2.5.0 binary) over the resolved files.
  5. Run the full guardrail set; eyeball `biome lint` output for orphaned-import warnings (soft).
  6. Reviewer inspection of the one unguarded item: trunk's nested `scenarioDirOf` body kept.
  7. Commit the merge; confirm GitHub no longer reports PR #45 CONFLICTING.
- **Rationale:** The order is load-bearing in one place — `npm install` must precede the format pass
  so the 2.5.0 (not stale 2.4.12) binary normalizes the files (Requirement 3). The rest is the
  natural merge→resolve→verify flow. Sequencing into discrete plan tasks is the plan phase's job.

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- **Exact line placement of each resolved hunk under trunk's reformatted file.** The design fixes
  WHAT each resolution must contain (verified targets) and the WordPress format to apply; the precise
  post-merge line numbers are an implementation detail the merge itself produces. Deferred to the
  code phase.
- **The README two-paragraph prose merge wording.** The design fixes that the `afterAllScenarios`
  bullet and self-improvement summary must carry the branch's skip/runnable prose AND trunk's
  `(scenario.name, agent)` precision; the exact final sentence wording is a writing detail for the
  code phase (it must introduce no process vocabulary — Requirement 10).
- **Whether `src/progress/types.ts` and `testing-project/playwright.config.ts` remain
  non-conflicting at merge time.** Spec-research's trial merge (at `380b0ff`) and the researcher's
  (at `56b4d2c`) both produced exactly the 19 conflicts with these auto-merging/absent from the set;
  the code phase should confirm at actual merge time (a 1-line check), but no design depends on a
  different outcome.

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **(High, mitigable) The unguarded `scenarioDirOf` resolution.** Dropping trunk's nested-path
  `scenarioDirOf` (keeping the branch's flat-only body) compiles, passes `npm test`, and passes every
  guardrail — it only breaks a live nested-scenario Playwright e2e run, which is not automated. This
  is the single resolution where the automated suite gives no signal. Mitigation: explicit
  reviewer-inspection step (Verification procedure step 6) confirming trunk's `scenarioDirOf` body is
  kept; the design-doc-writer should surface this prominently.
- **(Medium, mitigable) Formatting with the stale 2.4.12 binary.** The local `node_modules/.bin/biome`
  is 2.4.12 until `npm install` runs; formatting before the install can produce 2.4.x output that
  differs from trunk's 2.5.0 style and fails Requirement 3's format-verify. Mitigation: the ordered
  `npm install`-before-format step (Verification procedure steps 3-4).
- **(Medium) Orphaned imports pass lint.** `biome lint`'s `noUnusedImports` is a non-failing warning,
  so an orphaned import (e.g. `UserFacingError` if `filterScenarios` is removed but its import isn't,
  or a stray `SkippedAgent`/`projectArgs`) won't fail `npm run lint`. Typecheck is the hard gate for
  MISSING imports but not orphaned ones. Mitigation: eyeball lint output; run biome `--write` which
  can auto-fix unused imports.
- **(Low) `pipeline.ts` is the highest-complexity single resolution.** It is the only file
  interleaving two real changes (trunk's selection refactor + the branch's runnability flow). Its
  acceptance probes (`skip-misconfigured.test.ts` + the selection tests + typecheck) are strong, so a
  mis-resolution is caught — but it warrants the most care during resolution.
- **(Low) CI gives a false sense of green.** Only the changeset gate runs on PR #45; lint/typecheck/
  test/format/config-smoke do NOT auto-run. A reviewer relying on GitHub's green check alone would
  miss a broken merge. Mitigation: the design/plan must require the full local guardrail run as the
  acceptance gate, not the PR's CI status.
- **(Low) Scope discipline.** Requirement 9 (minimal) + Requirement 10 (no process vocabulary) mean
  the resolution must not introduce refactors beyond faithful conflict resolution + formatter output,
  and the README prose merge must avoid phase/spec/plan vocabulary. Flagged for the writer and code
  reviewer.
