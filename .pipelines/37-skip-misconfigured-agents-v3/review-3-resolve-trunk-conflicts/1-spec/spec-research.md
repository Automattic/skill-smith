# Spec Research

## Rough Idea

> Origin: Owner request during a Radical Pipelines review of pipeline `37-skip-misconfigured-agents-v3` (2026-06-24). The pipeline's PR — [Automattic/skillsmith#45](https://github.com/Automattic/skillsmith/pull/45), _"Skip misconfigured agents across all phases of a run"_ — is open against `trunk` but **GitHub reports it `CONFLICTING`**, and it carries no review approval. The branch is **89 commits behind `trunk`**, which has since adopted Biome 2.5.0 "WordPress" formatting across the whole repository and merged further feature work (e.g. nested scenario folders). Merging `trunk` into the branch conflicts in 19 files. The owner asked to reconcile the branch with current `trunk` and resolve the conflicts so the PR can land — without losing the skip-misconfigured-agents behavior this pipeline already delivered across its `base`, `review-1-fix-circular-import`, and `review-2-early-skip-announcement` runs.

### Goal

PR #45 becomes mergeable into `trunk`: the branch incorporates current `trunk`, every merge conflict is resolved, all repository guardrails pass, and the misconfigured-agent skip behavior already shipped on this branch continues to behave exactly as before — skipped across every phase, announced both early (at detection) and in the end-of-run summary with its id and reason, a non-zero exit on skip, the judge-stops / improver-halts role rules, and the `testing-project` import-cycle fix all preserved.

### Constraints

- Do not regress the skip-misconfigured-agents behavior delivered by this pipeline's `base`, `review-1`, and `review-2` runs.
- Resolve each conflict faithfully — keep both `trunk`'s intervening changes and this branch's feature. Do not drop or weaken either side, and do not delete code merely to make a conflict disappear.
- Conform the reconciled code to `trunk`'s current coding standards and formatting (Biome 2.5.0 "WordPress" style) so the lint/format guardrails pass.
- Minimal: make only the changes needed to reconcile with `trunk` and keep the guardrails green; no gratuitous refactors.
- Keep the changesets coherent with what actually ships.
- No process vocabulary (phase names, spec/design/plan or task identifiers) anywhere in code, comments, tests, or documentation.

### Context

- PR: <https://github.com/Automattic/skillsmith/pull/45>
- Issue: <https://github.com/Automattic/skillsmith/issues/37>
- The 19 files that conflict when merging `trunk`: `README.md`, `examples/skillsmith.config.ts`, the `src/progress`, `src/providers`, `src/reports`, `src/pipeline`, `src/config`, and `src/improvement` modules and their tests, and `testing-project/eval/utils/verify-e2e.ts` plus `testing-project/skillsmith.config.ts`.

### Assumptions / directions to explore (open, not requirements)

- Much of the conflict is the whole-repo Biome 2.5.0 "WordPress" reformat on `trunk` layered over real functional drift (nested scenario folders and similar). Resolution likely means re-applying this branch's feature logic on top of `trunk`'s reformatted-and-extended code, then re-running the formatter — rather than re-litigating the feature itself. _(Open.)_
- The `testing-project/verify-e2e.ts` and `testing-project/skillsmith.config.ts` conflicts may interact with the import-cycle fix from `review-1`; the resolution must preserve that fix so the `config-smoke` guardrail still passes. _(Open.)_
- Whether to reconcile via a `trunk` → branch merge commit or another integration strategy is open for the design phase; the outcome (mergeable, green, behavior preserved) is what matters. _(Open.)_

## Q&A

### Q1: What are the repository guardrails on current `trunk` that define "all guardrails pass", and what is the exact command for each (lint/format/typecheck/tests/config-smoke/changesets)? Is there an aggregate? What runs in CI vs locally?

**A:** No single aggregate `guardrails`/`check` script. The authoritative set is a table in `trunk:.rp.md` (lines 112–120), six named guardrails, plus a format-verify gate that is enforced per CONTRIBUTING but is NOT in the `.rp.md` table:

| Name | Exact command | Phase | Defined in |
|---|---|---|---|
| typecheck | `npm run typecheck` (→ `tsc --noEmit`) | code | `package.json` |
| lint | `npm run lint` (→ `biome lint .`) | code | `package.json` |
| tests | `npm test` (→ `node --import tsx --test src/__tests__/*.test.ts`) | code | `package.json` |
| config-smoke | `npm --prefix testing-project run check:config` (→ imports `./skillsmith.config.ts`) | code | `testing-project/package.json` |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | code, docs | `scripts/validate-changesets.ts` |
| changeset-status | `npx changeset status --since=origin/trunk` | docs | changesets CLI |

- **Format verify (separate, not in the table):** `npx biome format .` (no `--write`) — reports unformatted files and exits non-zero; exits 0 when clean. There is NO `format:check` script; the only format script is `npm run format` (→ `biome format --write .`) which rewrites files. Per `CONTRIBUTING.md:20-22`, lint and format are **separate Biome passes** — both must be green; lint does not check formatting.
- **Authoritative formatter:** Biome **2.5.0**, pinned exactly (no caret) in `package.json` devDependencies. Config in root `biome.json`. "WordPress" style = tab indent, `indentWidth: 4`, `lineWidth: 80`, single quotes, ES5 trailing commas, always-parenthesized arrow params, semicolons always, `organizeImports: on`, VCS-aware (`useIgnoreFile: true`).
- **Measurable "all guardrails pass" criterion** (all exit 0 from worktree root, after `npm ci` and `npm ci --prefix testing-project`): `npx biome format .` && `npm run lint` && `npm run typecheck` && `npm test` && `npm --prefix testing-project run check:config` && `npx tsx scripts/validate-changesets.ts` && `npx changeset status --since=origin/trunk`.

**Reasoning:** CI vs local matters here. The only PR-time CI workflow is `.github/workflows/changeset-gate.yml` (runs `validate-changesets.ts` + `changeset status --since=origin/<base.ref>`). `release.yml` is `workflow_dispatch`-only (push:trunk trigger commented out) and is where lint/typecheck/test run — at release time, not on PRs. Therefore typecheck, lint, tests, config-smoke, and format-verify are enforced by the **pipeline harness locally**, never by a PR GitHub Action. A reconciled branch can be "green on GitHub" while still failing typecheck/lint/tests — they must be run locally. Format-verify runs in neither CI workflow and is the crux of this review (the Biome 2.5.0 reformat), so it must be run explicitly. Engines require Node `>=20.17`; CI pins Node 22.

**Sources:** `trunk:.rp.md` (69, 112–120), `trunk:package.json` (scripts, devDependencies, engines), `trunk:testing-project/package.json` (check:config), `trunk:biome.json`, `trunk:.github/workflows/changeset-gate.yml`, `trunk:.github/workflows/release.yml`, `trunk:scripts/validate-changesets.ts`, `trunk:CONTRIBUTING.md` (5–22). Verified against trunk refs.

### Q2: Trial-merge `trunk` into the branch and give the anatomy of each of the 19 conflicts — pure formatting (a), real functional drift (b), or mixed (c). Confirm the count and list. Does trunk threaten the review-1 import-cycle fix? Where do nested-scenario-folders (or other trunk features) structurally overlap the skip code so naive "take both" would break or drop behavior?

**A:** Trial merge done in a throwaway detached worktree (merge-base `9541456`, branch tip `380b0ff`), inspected, aborted, scratch worktree removed — our `-v3` working tree was never touched and stays clean. **Exactly 19 conflicting files confirmed** (the intent's "19" is correct):

```
README.md
examples/skillsmith.config.ts
src/__tests__/progress-render.test.ts
src/__tests__/progress-tracker.test.ts
src/__tests__/summary.test.ts
src/config/types.ts
src/improvement/improver.ts
src/pipeline/agent-loop.ts
src/pipeline/pipeline.ts
src/progress/render.ts
src/progress/tracker.ts
src/providers/anthropic-api.ts
src/providers/gemini-api.ts
src/providers/openai-api.ts
src/providers/types.ts
src/reports/iteration-report.ts
src/reports/summary.ts
testing-project/eval/utils/verify-e2e.ts
testing-project/skillsmith.config.ts
```

- `src/progress/types.ts` auto-merged cleanly (NOT a conflict). The feature's **new** files (`src/runnability.ts`, `src/__tests__/runnability.test.ts`, `testing-project/eval/utils/project-args.ts`) are added cleanly — they do not exist on trunk.
- **Overarching pattern: every conflict is category (c) mixed.** Trunk's side of nearly every hunk is the Biome 2.5.0 WordPress reformat (single quotes, `( a, b )` spaces, `! x`, `Promise< T >`, `${ x }`, tab indent — near-symmetric add/del numstat confirms reformat). The branch's side is mostly additive feature code. So the resolution rule for almost every file is: **keep the branch's feature lines AND adopt trunk's formatting, then run `npx biome format .`**. A naive "take trunk" silently DROPS the feature; a naive "take HEAD" keeps wrong formatting. There is no pure-(a) and no pure-(b) file.
- **~12 files are mechanical "keep branch feature line + adopt trunk format":** the three providers (`requiredEnv` field), `providers/types.ts` (`requiredEnv?` on interface), `config/types.ts` (import line only — see structural note below), `improvement/improver.ts` (import), `reports/iteration-report.ts` (`SkippedAgent` import + `skipped` param/field on `writeRunReport`), `progress/render.ts` (additive `SKIPPED AGENTS` block), `README.md` / `examples/skillsmith.config.ts` (prose; fold in trunk's `(scenario.name, agent)` nested-folders rename while keeping branch skip prose), and the three test files (`progress-render`, `progress-tracker`, `summary` — keep branch's new skip test cases + trunk-formatted shared tests).
- **4 files need genuine re-application of feature logic onto trunk's new shape (NOT naive take-both):**
  1. **`src/pipeline/pipeline.ts` (10 hunks, the heart).** Branch adds: `classifyRunnability`/`decide`/`SkippedAgent` import, early-skip surfacing, threading `runnability.skipped` into `writeRunReport`, `runnability.improverRunnable` gating + early-break, a `runnableTestAgentIds` allowlist, per-scenario `effectiveFilter` intersection, and `skipped: args.runCtx.skipped` passed to `runScenario`. Trunk ALSO changed logic in the same regions: simplified the `args.selection.map(...)` arrow and **added `scenarios: args.runCtx.scenarios` to the `runScenario` call** (nested-folders plumbing). Resolution must KEEP trunk's `scenarios: args.runCtx.scenarios` AND the branch's `agentFilter: effectiveFilter` + `skipped: args.runCtx.skipped` together in the same call, preserving the branch's runnability/improver control flow. Naive take-trunk drops the skip allowlist/filter; naive take-HEAD breaks nested folders.
  2. **`src/reports/summary.ts` (5 hunks).** Trunk refactored `renderSummaryLines` into an **early-return** shape (`if (allPass) { push PASS; return lines; }` then FAIL block at top level). The branch kept if/else and appended `pushSkipBlock(...)` AFTER the else so it ran on BOTH paths. Resolution must re-insert the skip block so it still executes on both the pass-return and fail paths under trunk's new structure. Also the branch's skip-aware `exitCode = skipped.length>0 ? 2 : allPass ? 0 : 1` (plus `loadSkipped()` helper and the threaded `skipped` param) must win over trunk's hardcoded `allPass ? 0 : 1`. Most likely file to mis-resolve.
  3. **`src/progress/tracker.ts` (4 hunks).** Branch renamed private field `interactive` → `interactiveMode` and added a public `get interactive()` getter. Trunk kept using `this.interactive`. Naive take-both won't compile — every trunk-side `this.interactive` reference must be rewritten to `this.interactiveMode`. Plus a benign skip-comment in the `activeScenarios` reset.
  4. **`src/pipeline/agent-loop.ts` (2 hunks, lower risk).** Branch threads a `skipped,` field into a returned object trunk reformatted; keep `skipped,` + trunk format.

**Reasoning (the two specific risk areas the spec must protect):**
1. **Review-1 import-cycle fix is UNTHREATENED by trunk — holds as-is.** The fix lives in `verify-e2e.ts` (takes `configuredProjectNames`/`runnableAgentIds` as caller-passed params, imports `projectArgs` from the new branch-only `./project-args` module so it does not import the config module) and its caller `skillsmith.config.ts` `afterAllScenarios` (computes those from `config.roles.test.agents` + `ctx.skipped`). Trunk's conflict in both files is **pure reformat** layered over the OLD 2-arg `runE2eVerification(iterationDirectory, scenarios)` / 2-field hook signatures. Trunk never reintroduced a config-module import into `verify-e2e.ts`, never added a `projectArgs`-equivalent, and did not change the hook plumbing the fix relies on. Resolution: keep the branch's expanded signatures + `projectArgs` import, adopt trunk formatting — no re-derivation needed. (One cosmetic trunk doc edit: "scenario directory" → "normalized scenario directory ID"; optional to fold.)
2. **Nested-scenario-folders coexists at the type layer (auto-merged) but shares one call site.** `src/config/types.ts`: trunk added `RunScenario.id` (+ `dirName` compat alias, contract `dirName === id`) for nested folders; branch added `RunContext.skipped` — git auto-merged BOTH interface bodies correctly; only the import line conflicts. The single real overlap is the `runScenario` call in `pipeline.ts` (item 1 above), where trunk's `scenarios: args.runCtx.scenarios` and the branch's `agentFilter`/`skipped` fields must be combined into one call — the one place a careless resolution silently regresses one feature.

**Sources (verified in the trial-merge worktree this session):** `git merge --no-commit --no-ff trunk` output (19 CONFLICT lines); per-file hunk inspection over `<<<<<<<`/`>>>>>>>` markers in all 19 files; `git diff --numstat 9541456 {trunk,380b0ff} -- <files>`; `git show {trunk,380b0ff}:src/config/types.ts`; `git show {trunk,380b0ff}:src/providers/gemini-api.ts`; `git diff 9541456 380b0ff -- src/progress/tracker.ts`; `git ls-tree` confirming `src/runnability.ts` and `testing-project/eval/utils/project-args.ts` are branch-only. Merge aborted, scratch worktree removed, `git worktree list` confirms only original worktrees remain.

### Q3: What changesets exist on the branch, do they pass both changeset guardrails after the merge, and does the reconciliation itself require any changeset change to stay coherent with what ships?

**A:** Branch has three changesets (plus infra `README.md` / `config.json`):

| File | Bump | Origin run | Gist |
|---|---|---|---|
| `initial-scaffolding.md` | `none` | base bootstrap | Release automation scaffold, no consumer-visible change |
| `skip-misconfigured-agents.md` | `minor` | base feature | Skip misconfigured agent; new top-level `report.json` `skipped` array; exit `2` for config error; optional `Provider.requiredEnv`; additive `RunContext.skipped` |
| `early-skip-announcement.md` | `patch` | review-2 | Announce test/improver skips early at detection; mechanism/exit codes/summary/judge-stop unchanged |

- Review-1 (import-cycle fix) added **no** changeset — it is a `testing-project/` fixture-only fix, which `CONTRIBUTING.md` explicitly exempts.
- **They collectively and correctly describe the shipped feature.** Aggregate release effect: **one `minor` bump** of `@automattic/skillsmith` (patch subsumed, `none` bumps nothing).
- **Both changeset guardrails pass after the merge — observed live on the trial-merge state, not inferred:** `node --import tsx scripts/validate-changesets.ts` → EXIT 0; `npx changeset status --since=origin/trunk` → EXIT 0, output `Packages to be bumped at minor: - @automattic/skillsmith`.
- **No changeset is in the 19-file conflict set.** The branch's three and trunk's three (`claude-code-subscription-auth.md`, `nested-scenario-folders.md`, `wordpress-coding-standards.md`) auto-merge cleanly as a union; all six coexist and validate.
- **`minor` is the correct bump** (not breaking). Per the `CONTRIBUTING.md` bump table, additive hook-context fields, a new provider option, and a new optional `report.json` field are all `minor`. Exit code `2` is genuinely new (merge-base `summary.ts` emitted only `0`/`1`) but it does not redefine existing `0`/`1` semantics — `2` only arises in a situation (a skip) that previously could not occur — so it is additive, not `major`/`BREAKING:`. The pre-1.0 guard (version `0.1.0`; validator rejects `major` while `0.x`, requiring `minor` + `BREAKING:` prefix instead) never fires because no changeset is `major`.
- **The reconciliation requires NO changeset change.** (a) Trunk's `validate-changesets.ts` differs from base only by the Biome reformat — validation logic is identical (same `VALID = {patch,minor,major,none}`, same package-name check, same non-empty-body rule, same pre-1.0 `major` rejection); the branch's changesets satisfy all of these (EXIT 0). (b) `.changeset/config.json` is byte-identical across base/branch/trunk; the validator changed by reformat only. (c) The reconciliation is a faithful conflict-resolution + reformat of already-shipped feature code introducing no new consumer-visible behavior beyond what the existing `minor`+`patch` changesets describe; `CONTRIBUTING.md` exempts internal refactors / lint-format / reformatting, so a merge commit is not independently release-relevant.

**Reasoning / measurable requirement:** `changeset status` is path-aware (`config.json:changedFilePatterns` = `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, excluding `src/__tests__/**`); the gate passes because the `minor` changeset *exists*, independent of touched files. So the coherence requirement is: after reconciliation, **`node --import tsx scripts/validate-changesets.ts` exits 0 AND `npx changeset status --since=origin/trunk` exits 0 reporting `@automattic/skillsmith` to be bumped at `minor`** (no patch-only/none-only/empty/error result). Caveat: do not delete or empty any changeset during reconciliation, or the gate could flip.

**Sources:** `git show 380b0ff:.changeset/{skip-misconfigured-agents,early-skip-announcement,initial-scaffolding}.md`; `git diff 9541456 trunk -- .changeset/config.json` (empty); `git show trunk:scripts/validate-changesets.ts` (VALID set, pre-1.0 major rejection, package-name + body rules); `git diff --stat 9541456 trunk -- scripts/validate-changesets.ts` (reformat only); `trunk:CONTRIBUTING.md` (versioning policy, when-required, bump table, pre-1.0 policy, testing-project exemption); `trunk:AGENTS.md`; `git show 9541456:src/reports/summary.ts` (0/1 only) vs `380b0ff` (`skipped.length>0 ? 2 : allPass ? 0 : 1`). Live guardrail runs on merged state: validate-changesets → EXIT 0; changeset status → EXIT 0 "bumped at minor". Trial merge aborted, scratch worktree removed, `-v3` tree clean.

### Q4: What is the verification contract for "skip behavior preserved" — which tests pin which behavior, do any need re-application onto trunk's new shape, and is `npm test` the complete observable proof or is part only checkable via Playwright/wp-env?

**A:** The skip-feature regression suite = **9 named test files**, all of which pass **as-written** after a faithful resolution ("keep the branch's test + adopt trunk format"); none asserts against a removed/renamed trunk shape.

*Branch-only tests (added by this pipeline; absent on trunk):*
- `src/__tests__/runnability.test.ts` (12) — the classifier: missing/empty credential → skip per provider; `claude-code`/`mock` always runnable; judge/improver misconfig flags; dual-role → one entry both roles; `decide()` most-severe; classifier is synchronous, never invokes a provider.
- `src/__tests__/providers-required-env.test.ts` (2) — `Provider.requiredEnv` contract: credentialed providers declare the env var; credential-less providers omit it.
- `src/__tests__/iteration-report-skipped.test.ts` (3) — `report.json` shape: `skipped` is top-level (sibling of `scenarios`), defaults to `[]`, `pass` unchanged.
- `src/__tests__/project-args.test.ts` (5) — the e2e-exclusion **selector logic** (pure core of R10): `projectArgs(runnableIds, configuredNames)` forwards `--project <id>` only for runnable ids that are configured projects, drops unknown ids, forwards nothing when empty.
- `src/__tests__/config-loads.test.ts` (1) — the review-1 import-cycle fix as a node-test (testing-project config imports without throwing, keeps shape); complements the `check:config` guardrail.
- `src/__tests__/skip-misconfigured.test.ts` (10) — the end-to-end integration test driving real `run({cwd})` against on-disk fixtures with `OPENAI_API_KEY` deleted: one skipped test agent while the runnable one is graded + announced once; all-misconfigured → empty non-passing matrix, exit 2; judge stops the run before any hook/report; dual judge+test → stop wins; improver finishes iteration then halts; exit-code precedence (failure + skip → exit 2); early stderr announcement (review-2) for test agent + improver in non-TTY; skip-free mock run emits no early announcement (no false signal).

*Shared files that gained skip cases (3 of the 19 conflicts):*
- `src/__tests__/summary.test.ts` — all-pass + a skip → exit 2 with a distinct skip block.
- `src/__tests__/progress-render.test.ts` — renders a `SKIPPED AGENTS` section (one `id: reason` line per entry); a skip does not inflate the failures count / appear as a failure row; no skips → section omitted.
- `src/__tests__/progress-tracker.test.ts` — seeded `skippedAgents` ride the first paint and survive `beginIteration`; repaint erase count covers the skip rows (review-2 live dashboard).

**Reasoning:** No unit test constructs a `RunScenario`, so none collides with trunk's new `id`/`dirName === id` nested-folders shape. The interfaces the tests DO build (`AgentDefinition`, `Paths`, `NormalizedRoles`, `RunMode`, `SingleRoleInput`, `TestRoleInput`) are field-identical on trunk — trunk added no new required field to any. The integration test's fixtures use flat single-level scenarios (so trunk's `id` = `dirName` = dir name), and trunk still keys `report.scenarios` by `scenario.name` (the fixtures set `name: hello-scenario` distinct from the dir), so its assertions hold — **provided** the `pipeline.ts` conflict is resolved faithfully (combine trunk's `scenarios: args.runCtx.scenarios` with the branch's `skipped`/`agentFilter`). The tests are in effect **acceptance probes for whether the 4 hard source conflicts were resolved faithfully**: `iteration-report-skipped.test.ts` green ⇔ `iteration-report.ts` kept the branch's 4-arg `writeRunReport(...skipped=[])`; `summary.test.ts` exit-2 case green ⇔ `summary.ts` kept the branch's skip-aware exitCode + skip block on both paths under trunk's early-return; `progress-*.test.ts` skip cases green ⇔ `render.ts`/`tracker.ts` resolved correctly. So no test body needs re-application — but a mis-resolved source conflict turns the matching test red.

**`npm test` is the observable proof for 8 of 9 behaviors plus the pure core of the 9th — but the actual live e2e exclusion (R10) is NOT exercised by `npm test`.** `npm test` runs only `src/__tests__/*.test.ts`; it never calls `runE2eVerification`, never boots wp-env, never runs Playwright. `project-args.test.ts` unit-tests the selector assembly in isolation (its own comment: "It is pure, so it is unit-checked here even though the surrounding e2e harness needs wp-env to run"). The live forwarding — Playwright actually running only the forwarded `--project`s and the merged report attributing no e2e failure to a skipped agent — is only provable via `npm --prefix testing-project run test:e2e` under wp-env, which is **not a guardrail** and not in `npm test`. The integration test `skip-misconfigured.test.ts` exercises `run()` via the mock/credential-gated path (no Playwright) — so judge-stop, improver-halt, exit-2, precedence, once-per-run + early announce are all proven without wp-env. **Recommendation:** scope the guardrail-observable success criterion to `npm test` green + `config-smoke` green; mark the full live e2e exclusion (R10) as design-verifiable / outside automated-guardrail scope (its selector logic IS covered by `project-args.test.ts`). Do not claim "R10 verified by `npm test`."

**Sources:** `git ls-tree` branch vs trunk over `src/__tests__/*.test.ts` (branch-only set); `git show 380b0ff:src/__tests__/{runnability,providers-required-env,iteration-report-skipped,project-args,config-loads,skip-misconfigured,summary,progress-render,progress-tracker}.test.ts` (names, bodies, the 4-arg `writeRunReport` call, the project-args "needs wp-env" comment); `git ls-tree 380b0ff -- src/__tests__/fixtures/skip-*-project/` (flat scenarios; fixture `name: hello-scenario`); `git show trunk:src/scenarios/enumerate.ts`, `trunk:src/pipeline/pipeline.ts` (report keyed by `scenario.name`, lines 318/393/542), `trunk:src/pipeline/agent-loop.ts` (`RunAgentsParams.scenarios`), `trunk:src/reports/iteration-report.ts` (3-arg `writeRunReport`), `trunk:src/config/types.ts` (test-stub interfaces field-identical); `package.json:scripts.test`; `testing-project/package.json:scripts.test:e2e`; `verify-e2e.ts` `execFileSync('npm',['run','test:e2e',...])`. Temp extractions cleaned; `-v3` tree clean.

## Research

### Resolution map — the 19 conflicts and how each must be resolved

All 19 are category (c) "mixed" (branch feature line(s) over trunk's Biome reformat). No pure-formatting and no pure-functional-drift file. Two tiers:

- **Mechanical "keep the branch's feature line(s), adopt trunk's WordPress formatting" (~15 files):** `README.md`, `examples/skillsmith.config.ts`, `src/config/types.ts` (import line; interface bodies auto-merged), `src/improvement/improver.ts` (import), `src/providers/{anthropic,gemini,openai}-api.ts` (`requiredEnv` field), `src/providers/types.ts` (`requiredEnv?` on interface), `src/reports/iteration-report.ts` (`SkippedAgent` import + `skipped` param/field), `src/progress/render.ts` (additive `SKIPPED AGENTS` block), `src/__tests__/{summary,progress-render,progress-tracker}.test.ts` (keep branch's new skip cases), `testing-project/eval/utils/verify-e2e.ts` and `testing-project/skillsmith.config.ts` (keep the review-1 expanded signatures + `projectArgs` import — trunk's side is pure reformat over the old signatures).
- **Genuine re-application of feature logic onto trunk's new shape (4 files):**
  1. `src/pipeline/pipeline.ts` — combine trunk's `scenarios: args.runCtx.scenarios` + simplified selection map WITH the branch's `agentFilter: effectiveFilter` + `skipped: args.runCtx.skipped` in the same `runScenario` call, preserving the branch's runnability/improver-gating control flow.
  2. `src/reports/summary.ts` — re-insert the branch's skip block so it runs on BOTH the pass-return and fail paths under trunk's early-return refactor; keep the branch's `skipped.length>0 ? 2 : allPass ? 0 : 1` exitCode + `loadSkipped()`.
  3. `src/progress/tracker.ts` — keep the branch's `interactiveMode` field + `get interactive()` getter; rewrite trunk-side `this.interactive` references to `this.interactiveMode`.
  4. `src/pipeline/agent-loop.ts` — keep the branch's `skipped,` field threaded into trunk's reformatted returned object.

### What trunk added that must survive (do not drop trunk's side)

- **Biome 2.5.0 "WordPress" reformat** of the whole repo — the reconciled code must conform (single quotes, tab indent / width 4, line width 80, `( a, b )` spacing, `! x`, `Promise< T >`, ES5 trailing commas, always-parenthesized arrow params, semicolons, organized imports). Enforced by `npm run lint` (`biome lint .`) + `npx biome format .` (separate passes; both must pass).
- **Nested scenario folders:** `RunScenario.id` (+ `dirName` compat alias, contract `dirName === id`), `scenarios: args.runCtx.scenarios` plumbed into `runScenario`, the `(scenario.name, agent)` rename in prose/examples, and `enumerateScenarios` producing `{id, dirName, name, nameSource}`. The type-layer additions auto-merged; the only hand-merge is the `runScenario` call site in `pipeline.ts`.
- Other trunk changesets/feature work (e.g. `claude-code-subscription-auth`) that did not conflict must remain present after the merge.

### What this branch shipped that must be preserved unchanged (do not drop the branch's side)

The full skip-misconfigured-agents behavior from `base` + `review-1` + `review-2` (the authoritative contracts are the prior specs/design docs under `.pipelines/37-skip-misconfigured-agents-v3/{base,review-1-fix-circular-import,review-2-early-skip-announcement}/`):
- Misconfigured agents (statically: `openai-api`→`OPENAI_API_KEY`, `anthropic-api`→`ANTHROPIC_API_KEY`, `gemini-api`→`GOOGLE_GENERATIVE_AI_API_KEY`; `claude-code`/`mock`/`codex` never statically misconfigurable) are skipped across every phase — no invocation, no provisioning, no accounting, no re-selection.
- Role-aware consequences: test → exclude lane; judge → stop run before any hook/report; improver → finish current iteration then halt; multi-role → most-severe wins. Routed through the single `decide()` policy seam (only "warn" shipped).
- Exit codes: `0` clean, `1` genuine eval failure, `2` any configuration skip (precedence over `1`; all-misconfigured is not a vacuous pass).
- Surfacing: each skip announced once with id + reason, visually distinct from a failure, in the CLI summary and in `report.json`'s top-level `skipped` array; **plus** the review-2 early announcement at detection (cyan `SKIPPED AGENTS` live-dashboard section in interactive mode, riding the tracker's first paint; early stderr line in non-interactive/verbose) — additive, end-of-run summary unchanged.
- Hook contract: `RunContext.skipped` readable from `beforeAll` onward.
- review-1 import-cycle fix: `testing-project` config import graph loads cleanly (`config-smoke` green); `verify-e2e.ts` has no module-init read of the imported `config`, obtains project names via caller-passed params + the branch-only `project-args.ts`; `--project` forwarding preserves runnable-set order.

### Verification surface (what makes the outcome observable)

- **All guardrails (Q1):** `npx biome format .`, `npm run lint`, `npm run typecheck`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk` — all exit 0 from the worktree root after `npm ci` (root + testing-project). Note these are local/harness guardrails; the only PR-time GitHub Action is the changeset gate, so a "green on GitHub" PR can still fail typecheck/lint/tests locally.
- **Behavior preservation (Q4):** the 9 skip-feature tests pass as-written under `npm test`; they double as acceptance probes for the 4 hard source resolutions. The full **live** e2e exclusion (R10) is design-verifiable only (requires Playwright/wp-env, not a guardrail); its selector logic is covered by `project-args.test.ts`.
- **Changeset coherence (Q3):** existing `minor`+`patch`+`none` changesets already describe the shipped feature, pass both changeset guardrails as-is, and need no change; `@automattic/skillsmith` resolves to a single `minor` bump.

### Integration strategy

The intent leaves the integration strategy (trunk→branch merge commit vs. other) to the design phase; what matters is the observable outcome (PR #45 reports mergeable, guardrails green, behavior preserved). Research confirms a `git merge trunk` into the branch produces exactly the 19 conflicts above and is a viable strategy; the design phase chooses the mechanics.

## Consolidated Requirements

Each requirement is an observable outcome of a successful reconciliation. Verification commands are run from the worktree root after `npm ci` (root) and `npm ci --prefix testing-project`.

1. **PR #45 is mergeable into `trunk`.** After reconciliation, the branch incorporates current `trunk` (it is no longer behind in a way that conflicts), and GitHub no longer reports the PR as `CONFLICTING` — i.e. the branch and `trunk` have no remaining merge conflicts.

2. **Every merge conflict is resolved with both sides preserved.** All 19 conflicting files (`README.md`, `examples/skillsmith.config.ts`, `src/__tests__/{progress-render,progress-tracker,summary}.test.ts`, `src/config/types.ts`, `src/improvement/improver.ts`, `src/pipeline/{agent-loop,pipeline}.ts`, `src/progress/{render,tracker}.ts`, `src/providers/{anthropic-api,gemini-api,openai-api,types}.ts`, `src/reports/{iteration-report,summary}.ts`, `testing-project/eval/utils/verify-e2e.ts`, `testing-project/skillsmith.config.ts`) are resolved such that **both** `trunk`'s intervening change (Biome reformat + nested scenario folders and other feature work) **and** this branch's skip-misconfigured-agents feature are retained. No conflict is resolved by dropping or weakening either side, and no code is deleted merely to make a conflict disappear.

3. **The reconciled code conforms to trunk's Biome 2.5.0 "WordPress" formatting and lint rules.** `npx biome format .` exits 0 (no files would be rewritten) and `npm run lint` exits 0.

4. **The code typechecks and builds against trunk's current types.** `npm run typecheck` (`tsc --noEmit`) exits 0 — including the call sites where trunk's nested-folders shape and the branch's skip fields meet (the `runScenario` call combines trunk's `scenarios` with the branch's `agentFilter`/`skipped`; `writeRunReport` retains its 4-arg skip-bearing signature).

5. **The skip-misconfigured-agents behavior is observably unchanged.** `npm test` exits 0 with all 9 skip-feature tests green as-written — `runnability.test.ts`, `providers-required-env.test.ts`, `iteration-report-skipped.test.ts`, `project-args.test.ts`, `config-loads.test.ts`, `skip-misconfigured.test.ts`, `summary.test.ts`, `progress-render.test.ts`, `progress-tracker.test.ts` — collectively pinning: per-provider static misconfiguration detection; cross-phase skip (no invocation/provisioning/accounting/re-selection); role-aware consequences (test→exclude, judge→stop-run-before-any-hook/report, improver→finish-iteration-then-halt, multi-role→most-severe); exit codes `0`/`1`/`2` with config-error precedence and no vacuous pass when all are misconfigured; the once-per-run id+reason announcement distinct from a failure, in the CLI summary and `report.json`'s top-level `skipped` array; and the review-2 early-at-detection announcement (interactive live-dashboard section + non-interactive early stderr) with the end-of-run summary unchanged.

6. **The testing-project import-cycle fix (review-1) is preserved.** `npm --prefix testing-project run check:config` exits 0 (the config import graph rooted at `skillsmith.config.ts` loads without throwing), `config-loads.test.ts` passes, `verify-e2e.ts` still obtains project names via caller-passed parameters plus the `project-args` module (no module-initialization-time read of the imported `config`), and the `--project` selector forwarding preserves runnable-set order.

7. **Trunk's intervening feature work is intact.** Nested-scenario-folders behavior (e.g. `RunScenario.id`/`dirName === id`, scenarios plumbed into `runScenario`, `enumerateScenarios`) and any other non-conflicting trunk changes remain present and functional after the merge (covered by the full `npm test` suite passing, not only the skip-feature subset).

8. **Changesets stay coherent with what ships.** `npx tsx scripts/validate-changesets.ts` exits 0 and `npx changeset status --since=origin/trunk` exits 0 reporting `@automattic/skillsmith` to be bumped at `minor` (not patch-only/none-only/empty, no error). The existing `skip-misconfigured-agents.md` (`minor`), `early-skip-announcement.md` (`patch`), and `initial-scaffolding.md` (`none`) accurately describe the shipped feature; no changeset is deleted, emptied, or downgraded, and no new changeset is required for the reconciliation itself.

9. **The change is minimal.** Only the changes needed to reconcile with `trunk` and keep the guardrails green are made; no gratuitous refactors beyond faithful conflict resolution and applying the formatter.

10. **No internal-process vocabulary leaks.** No phase names, spec/design/plan references, or acceptance-criteria/task identifiers appear in any reconciled code, comment, test, or documentation.

### Out of scope (exclusions surfaced during clarification)

- Re-litigating, redesigning, or extending the skip-misconfigured-agents feature itself (the policy, the classifier scope, the role rules, exit codes, surfacing) — this run only reconciles already-shipped behavior with `trunk`.
- Adding the "fail"/"skip" policies, runtime/deep error classification, or any feature beyond what `base`/`review-1`/`review-2` shipped.
- Authoring a new changeset for the merge, or changing `.changeset/config.json` / the validation script (no change needed).
- Verifying the **live** end-to-end Playwright exclusion (R10) as a guardrail — it requires wp-env/Playwright and is design-verifiable, not part of `npm test`; only its selector logic (`project-args.test.ts`) is guardrail-observable.
- Choosing the integration mechanics (merge commit vs. alternative) — left to the design phase; only the outcome (mergeable, green, behavior preserved) is required here.
- Changes to CI workflows or the guardrail set on `trunk`.
