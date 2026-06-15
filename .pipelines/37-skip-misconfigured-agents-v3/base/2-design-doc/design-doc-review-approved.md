# Design Doc Review — APPROVED

**Target:** `2-design-doc/design-doc.md`
**Reviewer:** design-doc-reviewer (adversarial cross-check)
**Verdict:** APPROVED — complete, correct/feasible, spec-faithful, internally consistent, and standalone-buildable. Non-blocking notes below; none gates implementation.

---

## Scope of this review

Checked `design-doc.md` against the approved spec (`1-spec/spec.md`), the settled research record (`2-design-doc/design-doc-research.md`), and the **actual code** in the worktree. Every cited file/symbol/line was spot-checked; every load-bearing mechanic was traced against the real control flow.

## What I verified against real code (all confirmed)

- **Exit-code chokepoint (§7.1).** `prepareSummary` (`src/reports/summary.ts:52-77`) takes only `{ runDirectory, runId }`, reads `report.json`, and does `allPass = rows.length > 0 && rows.every(isRowPass)`, `exitCode = allPass ? 0 : 1`. The number threads out via `emitSummary` (`:80-83`) → `runPipeline` `return emitSummary(prepared)` (`pipeline.ts:265`) → `run()` returns it (`runner.ts:32`). The `skipped.length>0 ? 2 : (allPass ? 0 : 1)` rule is producible here by reading a new top-level `parsed.skipped`; the third code needs only be **produced**, not plumbed. Confirmed.
- **`Provider.requiredEnv?` is additive (§4.1).** `Provider = { readonly id; invoke }` (`src/providers/types.ts:50-53`), re-exported publicly (`src/index.ts:32`). `openai-api.ts:8` returns the exact string `"OPENAI_API_KEY is not set"` from `invoke` — matching the design's reason `"<VAR> is not set"`, so the static descriptor and the runtime guard agree. `getProvider` (`registry.ts:23-29`) is importable by an internal classifier module (it is not in `index.ts`, but the classifier lives under `src/`). The in-invoke key checks are pinned by `vercel-providers.test.ts:67-94` via a `withEnv` helper — the design correctly keeps `requiredEnv` **purely additive**, NOT a replacement of those checks (R2.3/R11.1 preserved). Confirmed.
- **Top-level `skipped` in `report.json` (§4.3/§4.4).** `writeRunReport` (`iteration-report.ts:153-164`) writes `{ runId, pass, scenarios }` and returns `pass`; a 4th passthrough param is a clean additive change. `loadRows` (`summary.ts:85-113`) reads only `parsed.scenarios`, so an absent `skipped` is harmless for the matrix path. The existing per-cell `SKIPPED` `Cell` (`verdict.ts:9-12,26-28`; rendered yellow at `summary.ts:233-237`) is genuinely a separate, review-level concept — the design's "top-level signal, not a Cell" reasoning is correct and the closed `Cell` set stays untouched. Confirmed.
- **`RunContext.skipped` readonly (§4.2).** `RunContext` (`config/types.ts:144-150`) is built once (`pipeline.ts:100-106`) and is the base every hook context `extends` (`ScenarioContext`/`AgentContext`/iteration contexts, `:157-224`). Adding the field at construction makes it visible to `beforeAll` (`pipeline.ts:328-336`) and every derived context (R10.1/AC9). It is a public export (`index.ts:18`) but additive. Confirmed.
- **Judge-stop `return 2` before any hook/report (§6.1).** The classifier can run between `loadConfig`/`checkPaths`/`resolveSelfImprovement` (`pipeline.ts:82-84`) and the `runCtx`/tracker construction (`:100-117`). `beforeAll` fires inside `runOneIteration` (`:328`) and `afterAll` lives in the loop's `finally` (`:252-262`), both **after** the point where judge-stop returns — so neither fires, and no report is written. `runner.ts:40-43` maps `PreconditionError`/`UserFacingError` → `1`, so a direct `return 2` from `runPipeline` is the correct way to avoid colliding with the unknown-provider→1 path (R7, §9). Confirmed feasible exactly as written.
- **Improver-halt + finalPass suppression (§6.2).** The in-loop improver branch is `pipeline.ts:188-208`; the extra final sweep is `:215-246` (gated on `finalPass && lastWasSubset && mode==="self-improvement" && !mergedPass`). Both are gateable on "improver runnable." The improver already swallows its own error (`improver.ts:148-168`), so error containment (§6.5) holds. Confirmed.
- **Dead-lane degenerate case (§6.4 / R5.5).** Traced the empty-runnable-set path end to end: `runAgents` → `Promise.all([])` (no agent dirs); `aggregateScenarioReport` finds no agent dirs → `agents={}`, `agentsList.length===0` → `allPass=false` (`scenario-report.ts:82-92`); `isRowPass` returns false for empty `sortedAgents` (`summary.ts:309-317`); the non-empty `skipped` array forces `2` first. No vacuous pass, no special-case branch needed — matches the design's claim exactly. Confirmed.
- **e2e forwarding (§10.2/§10.4).** `playwright.config.ts:23` does `config.roles.test.agents.map((agentId) => ({ name: agentId, … }))` over `AgentDefinition[]` — `name` is set to the **object**, a real pre-existing bug; the fix to `name: agent.id` is correct and is required for `--project <id>` binding and for `parsePlaywrightReport`'s `projectName`→agent attribution (`verify-e2e.ts:198-207`). `runE2eVerification(iterationDirectory, scenarios)` (`verify-e2e.ts:30`) has exactly one caller — the `afterAllScenarios` hook (`testing-project/skillsmith.config.ts:54-57`), whose ctx is `IterationCompleteHookContext extends RunContext`, so `ctx.skipped` is available. Adding `runnableAgentIds` as a 3rd param is contained. The build-side scan (`verify-e2e.ts:45-67`) naturally finds nothing for a skipped agent (no `workspace/plugin-*`), so "no build-side filter" (§10.3) is correct. Confirmed.

## Coverage check (every requirement / AC has a mechanism)

R1–R12 and AC1–AC13 each map to a concrete, feasible mechanism (design §13). I independently re-walked the non-obvious ones (R3.3 re-selection, R5.4 anti-regression, R5.5 all-misconfigured, R6.1–R6.4, R10.1/R10.2) against the code and found no requirement or AC left without a working design.

## Spec fidelity (stays within scope)

- Does **not** build a retroactive result-purge — R3.4 is correctly stated as a setup-only-trivial invariant (§1.2, §13.1).
- Ships **only** "warn"; "fail"/"skip" are localized future additions inside `decide` and the exit rule (§3.2). No deferred runtime classifier introspection is added.
- Unknown provider stays a hard abort on its existing `PreconditionError→1` path, explicitly NOT a per-agent skip (§9, R7).
- No new requirements; no re-opened settled decisions; no scope creep. R12.4 honored — the doc names everything in plain domain terms ("skipped", "runnable") and the produced-code constraint is restated for the implementer.

## Consistency

One source of truth — the classifier's `skipped` set, shape `{ id, roles, reason }` — is consistent across `report.json` (§4.3), `RunContext.skipped` (§4.2), and the e2e forward (§10.2). Backward-compat (R11) holds: with an empty skipped set the new path is inert (§8). No internal contradictions found.

---

## Non-blocking notes (clarity only — do not gate implementation)

1. **Tighten the "intersect with any existing `agentIdFilter`" wording (§5 point 2, §11).** The runnable allowlist must be applied at the `runAgents` read site **unconditionally, in every iteration and mode** — not merely merged into the per-scenario `agentFilter`. In the real code, `selectScenarios` returns `agentFilter: undefined` for iteration 1 and for `all`/`failed-scenarios` modes (`select-scenarios.ts:39-65`), and `runAgents` then reads the **full** `config.roles.test.agents` (`agent-loop.ts:81-86`). The design's separate §5-point-3 R3.3 argument ("re-selection only ever narrows") is correct only because a skipped agent produces no cell and so is never re-selected — but that is a *secondary* guarantee; the load-bearing exclusion is the run-scoped allowlist at both read sites. The doc already names both read sites (tracker init + agent loop) and says "run-scoped allowlist," so the mechanism is right; the phrase "intersect … with any existing per-scenario `agentIdFilter`" should not be read as "only when a per-scenario filter is present." A one-line clarification ("apply the runnable allowlist whether or not a per-scenario filter exists; when one exists, intersect") would remove any ambiguity.

2. **State the report-read default for R11.1 fidelity (§7.1).** `prepareSummary` must treat a missing/absent top-level `skipped` as `[]` (old reports, and the iteration-level reports never carry it), so `skipped.length` is safe and a no-misconfig run produces an identical exit code to today. This is an obvious implementation detail and `loadRows` already does the analogous `scenarios ?? {}` default, but stating it makes the R11.1/AC13 "identical behavior" guarantee explicit.

3. **`roles` shape is a new domain concept, not the provider `Role` type.** The design's `roles` (test/judge/improver) on a `skipped` entry is distinct from `src/providers/types.ts:16`'s `Role = "testing" | "judge"`. The doc never claims to reuse that type, so there is no error — just worth keeping the implementer aware so the new field is not accidentally typed as the provider `Role`.

None of the above changes a decision or a mechanism; the doc is buildable as written.
