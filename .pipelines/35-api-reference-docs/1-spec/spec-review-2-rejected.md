# Spec review — iteration 2 — REJECTED

Reviewing `spec.md` (commit `95380f7`) against `requirements.md`, the iteration-1 review feedback in `spec-review-1-rejected.md`, and the actual source tree on the branch.

## Iteration-1 blockers — verification

The spec-writer's claim that B1–B17 are addressed checks out. I re-walked each one against the source.

| ID | Status | Notes |
|---|---|---|
| B1 — missing-rubric behaviour | **resolved** | §A.5.5 (line 280) now correctly describes the `unresolved reference: …` enumeration error and the agent-loop short-circuit. The `"TO BE FILLED"` fallback is documented as effectively dead code. Verified against `src/scenarios/enumerate.ts:62-86`, `src/pipeline/pipeline.ts:513-540`, `src/pipeline/judge-agent.ts:98`. |
| B2 — unknown-scenario singular/plural | **resolved** | §A.5.2 (lines 162-178) documents both branches verbatim and ties them to `src/pipeline/pipeline.ts:472-477`. Acceptance §4 (line 485) names both. |
| B3 — positional-arg trimming / empty / dedup | **resolved** | §A.5.2 (lines 135-139) documents trimming, exact match, empty rejection (`"Scenario IDs must not be empty."`), and silent de-duplication. Sources at `src/pipeline/pipeline.ts:459-466`. |
| B4 — README sentence verbatim | **resolved** | §D.1 (line 437) now quotes the line verbatim ("`No CLI flags are supported yet; option-like arguments such as \`--scenario\` fail before a run starts.`"). Confirmed against current `README.md:46`. |
| B5 — `process.loadEnvFile` + `tsx/esm` precision | **resolved** | §A.5.2 (lines 149-151) names `process.loadEnvFile` explicitly, mentions the Node >= 20.12 floor, and describes `tsx/esm` as a side-effect import. |
| B6 — four argv-parsing strings | **resolved** | §A.5.2 (lines 182-192) enumerates all four error strings verbatim. Acceptance §4 (line 485) lists them again. Verified against `bin/skillsmith.mjs:32-67`. |
| B7 — `tokenUsage` invariants + mock values | **resolved** | §A.5.6 (lines 306-310) documents the omission rule, the mock provider's deterministic numbers, and both invariants (`totalTokens === inputTokens + outputTokens`; `cachedInputTokens` is a subset). |
| B8 — two more `review` shapes | **resolved** | §A.5.6 (lines 314-319) now enumerates all six review shapes including `"unparseable"` (`src/pipeline/judge-agent.ts:77-84`) and `"judge dispatch failed"` (`src/pipeline/agent-loop.ts:250`). |
| B9 — `selfImprovement` defaults source | **resolved** | §A.5.3 (lines 196-211) now names `src/config/self-improvement.ts` as the source of truth for defaults, calls out the `Math.max(1, …)` clamp at line 46, and distinguishes the validator (`validate.ts:188-194`) from the clamp. The `mode: "test-only"` default is also called out. |
| B10 — aggregator + verification strings | **resolved** | §A.5.6 (lines 321-333) lists all six aggregator error strings as stable contract and documents the verification-gate `"; "` append plus the `"verification gate reported failure"` default note. Verified against `src/reports/iteration-report.ts:38,51,58`, `src/reports/scenario-report.ts:59,67,71`, and `src/improvement/verify.ts:142-145`. |
| B11 — `RunOptions.cwd` semantics | **resolved** | §A.5.1 (line 120) documents `cwd` as the search start (not project root), explains the one-level walk, and even gives the canonical foot-gun example. |
| B12 — `tryHook` non-Error throws + log location | **resolved** | §A.5.4 (line 241) names the log line format, ties iteration-scoped hooks to `${iterationDirectory}/run.log` and run-scoped to run-root `run.log`, and notes the `String(err)` coercion. |
| B13 — "self-contained vs no excerpts" clarification | **resolved** | §A.1.1 (line 45) adds the cross-link allowance and pins `programmatic.md` to a minimal `run()` example rather than a full `defineConfig` body. |
| B14 — type-stability callout location | **resolved** | §A.4 (line 80) and §A.6 (line 377) both lock the callout to `run-artifacts.md`, as a single combined callout immediately after the JSON shape examples for `ScenarioAgentEntry` and `IterationReport.scenarios`. Acceptance §12 (line 493) matches. |
| B15 — stability-and-extension-points home | **resolved** | §A.4 (line 79) and §A.5.9 (line 372) assign it to `programmatic.md`. Acceptance §11 (line 492) matches. |
| B16 — custom-providers wording | **resolved** | §A.5.7 (line 362) makes the section a reserved one-paragraph dead-end with a "Downstream phases must not expand this section beyond a single paragraph" rule. |
| B17 — anchor on content, not line number | **resolved** | §D.1 (line 439) tells the implementer to `grep` for the sentence rather than rely on the line number. |

Most of the non-blocking observations from iteration 1 (N1, N2, N3, N7, N8, N9, N11, N12) also picked up real fixes in the revision — well done on the cleanup pass.

## However, a new blocking finding has emerged.

### B18. `scenario.yaml` field count is off by one (§A.5.5, line 267)

§A.5.5 says, verbatim:

> All **seven** fields are required by the shape check at `src/scenarios/enumerate.ts:100-115`.

There are six required fields, not seven. The YAML block immediately above (spec lines 254-265) lists six: `name`, `description`, `skills`, `prompt`, `acceptance`, `rubrics`. The source check at `src/scenarios/enumerate.ts:100-115` validates exactly those six keys. And the source's own malformed-shape error string — which the spec quotes one line below — also lists six fields:

```
"scenario.yaml malformed: expected name/description/skills/prompt/acceptance/rubrics"
```

A docs author following the spec literally would write a prose claim ("seven required fields") that contradicts the YAML schema block on the same page, contradicts the source error message they would presumably also paste verbatim, and contradicts the source code itself. Since the spec is the source of truth from which the reference is built, this is the same class of issue as the iteration-1 factual errors (B1, B2, B4): a normative statement that, taken at face value, would direct the reference to enshrine an incorrect claim.

**Fix.** Change "All **seven** fields" to "All **six** fields" on spec line 267. Optionally also reword the surrounding sentence to enumerate them inline so the count and the list cannot drift again. Suggested:

> All six required fields (`name`, `description`, `skills`, `prompt`, `acceptance`, `rubrics`) are checked by the shape validator at `src/scenarios/enumerate.ts:100-115`. A scenario with a missing or malformed YAML body is emitted with one of the following enumeration errors and skipped from agent runs (source: `src/scenarios/enumerate.ts:42-58`):

This is a one-word fix in the strict interpretation, but the more enumerative phrasing prevents the same drift bug from recurring.

---

## Non-blocking observations (could be cleaned up in iteration 3 but not required for approval)

### N13. `checkPaths` reason strings inside the precondition body (§A.5.8)

§A.5.8 (line 369) says `checkPaths` requires `paths.skills`, `paths.scenarios`, `paths.rubrics` to exist as directories. That's accurate. But the *reason strings* that show up inside a precondition-failure body when these checks fail are themselves part of the user-visible CLI surface and aren't enumerated anywhere in the spec. From `src/pipeline/pipeline.ts:565-583`:

- `"paths.<key> → <abs-path> (does not exist)"`
- `"paths.<key> → <abs-path> (not a directory)"`
- `"paths.base is empty"`

These appear as bullet items inside the `"skillsmith: precondition failed\n  - …\n  - …"` envelope documented in §A.5.2. A reader hitting one of these in CI will pattern-match on the prefix; documenting them as stable (or non-contractual) closes the loop. Suggest a one-bullet note in §A.5.8 listing the three formats, and pointing back at §A.5.2's precondition envelope.

Non-blocking because the *outer* envelope is documented and reviewer can recognise the format; only the reason-string verbatims are missing.

### N14. `beforeScenario` / `afterScenario` on enumeration-errored scenarios (§A.5.4)

The §A.5.4 firing diagram and the bullets that follow don't explicitly tell the hook author what happens to `beforeScenario` and `afterScenario` when a scenario carries an enumeration error (e.g. `unresolved reference: rubric "<id>"`). From `src/pipeline/pipeline.ts:517-553`:

- `beforeScenario` fires unconditionally before the `try` block.
- `runAgents` is skipped when `error !== undefined`.
- `aggregateScenarioReport` still runs (the scenario row gets persisted with `error`).
- `afterScenario` fires in the `finally`, so it also runs for the errored scenario.

So the per-scenario hooks bracket every scenario, including errored ones — the agent-pair hooks (`beforeTestAgent`, `afterTestAgent`, the `before/afterJudgeAgent` pair) are the only ones that get suppressed (because `runAgents` is the gate). Hook authors writing `afterScenario` to read the per-agent workspace need to know they can be called on a scenario whose workspace was never populated.

Suggested addition to the §A.5.4 behavioural-guarantees bullets:

> `beforeScenario` and `afterScenario` fire on every scenario, including those skipped due to enumeration errors (`unresolved reference: …`, `scenario.yaml parse error: …`, `scenario.yaml malformed: …`). Only the agent-pair hooks (`beforeTestAgent` / `afterTestAgent` / `beforeJudgeAgent` / `afterJudgeAgent`) are suppressed on the errored path, because the agent loop is short-circuited.

Non-blocking because the hook diagram's `per scenario` annotation already implies it; making it explicit is just a tightening.

### N15. `Scenario` interface has `[key: string]: unknown` index signature (§A.5.1, §A.5.5)

`src/config/types.ts:123-131` shows `Scenario` carries a `[key: string]: unknown` index signature alongside the six declared fields. That means a `scenario.yaml` author may add arbitrary extra keys (e.g. `tags`, `category`) and they will round-trip through enumeration into the runtime `Scenario` object available to hooks. The spec lists `Scenario` in §A.5.1 but doesn't call out the index signature, and §A.5.5's YAML schema doesn't mention that extra keys are allowed.

This is an unmentioned ergonomic affordance — hook authors who use a scenario tag pattern would want to know it's supported. Worth a half-sentence in `scenarios-and-rubrics.md` or `agents-and-roles.md`. The pattern parallels `AgentDefinitionInput`'s `[key: string]: unknown`, which the spec *does* call out for provider-specific knobs (line 102).

Non-blocking; this is an additive disclosure, not a correction.

### N16. `testing-project/` callout in the index (§A.2)

Following up on iteration-1's N6: §A.2 (line 57) now permits an *optional* one-line callout pointing at `testing-project/`. The requirements doc (§9) explicitly named it as an in-scope reference asset, so leaving it optional is on the soft side but not wrong. Worth flipping the wording from "may optionally include" to "should include" if the spec-writer wants to honour the requirements doc strictly; either is acceptable.

Non-blocking.

---

## Summary

Almost all of iteration 1's 17 blocking findings are genuinely resolved against source. The revision is materially better than the original and the new acceptance-criterion phrasing is tight.

One new factual error (B18 — wrong field count for `scenario.yaml`) blocks approval on the same grounds the previous review applied: the spec is the canonical text the reference will paraphrase, and an off-by-one in a normative claim would propagate into the public docs. It's a one-word change.

The four N-numbered items (N13–N16) are tidy-up; address only if convenient.

Address B18. N-numbered items optional.

— spec-reviewer (iteration 2)
