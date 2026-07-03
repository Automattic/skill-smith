# Design Doc Review

## Verdict: rejected

## Summary

This is a strong, unusually thorough design. Every factual claim I spot-checked against the real codebase (branch and `origin/trunk`) holds: the removal surface line-anchors (`parseRubricsSection`/`RUBRICS_HEADING_RE`, the enumeration-time id-validation block, `Scenario.rubrics`, `resolveRubricBlob`, the `# Grading rubrics` injection) are accurate; the `runJudgeAgent` call site already threads `scenario`/`config`/`projectRoot` so no plumbing is needed; the trunk precedents (`# Rubric: <id>` at `judge-agent.ts:105`, the "Do not consult any skill documentation" clause at `:119`, the task-in-user-message pattern at `:181`) exist as cited; `DEFAULT_PATHS` has no `rubrics` entry and `checkPaths` gates only `['skills','scenarios']`, so req 4 needs no config change; all 11 testing briefs carry `# Skills` as the last top-level heading (validating the `stripSkillsSection` design); and the `## Scenario requirements` conversion audit is defensible — I independently re-checked `async-fetch` against the rubric and confirmed its bullets are indeed category-(c) (the rubric's "Async actions" and "Reactivity/directives" sections cover the generator/`yield`, after-yield-mutation, and reactive-binding items), so the "clean floor" classification is correct rather than an under-count. The design keeps the live `{ pass, notes }` judge/reporting/loop intact (does not revert to trunk's structured grader), and the three-change decomposition traces cleanly to the spec.

I am rejecting for one real, actionable gap: the removal surface as presented is **incomplete** — it omits the existing test files that import and assert the very symbols being deleted. Because the design explicitly claims a complete removal ("no dangling references left") and leans on green deterministic gates (AC9) as its correctness proof, an implementer working from the design's Components section alone would delete the production functions and break the build. The information existed in `design-doc-research.md` ("Tests touched") and was silently dropped from the design.

## Issues

### Issue 1: Removal surface omits the existing rubric-machinery tests that reference the deleted symbols

**What's wrong:** The design's Components section and Change 1 enumerate the *production* removal surface precisely, but the design never mentions any test file. The following existing tests directly import or assert symbols the design removes, and will fail to compile or fail assertions the moment the production code is deleted:

- `src/__tests__/rubrics-section.test.ts` — imports `parseRubricsSection` from `../scenarios/enumerate` and exercises it throughout; it becomes a dangling import once `parseRubricsSection`/`RUBRICS_HEADING_RE` are removed. This file is dedicated entirely to the removed parser.
- `src/__tests__/enumerate-rubrics.test.ts` — asserts `scenario.rubrics` (`:66`, `:121`, `:163`, `:180`, `:196`, `:216`, `:237`) and encodes the enumeration-time id-validation behavior (the "ghost"/"never-validated" cases) that req 4/5 remove.
- `src/__tests__/judge-agent.test.ts` — sets `scenario.rubrics` (`:541`, `:610`) and covers `resolveRubricBlob`/rubric-blob assembly, both removed.
- `src/__tests__/core-types.test.ts` — asserts the `.rubrics` field on the `Scenario` type (`:66`) that Change 1 deletes from `src/config/types.ts`.
- `src/__tests__/rubric-loader.test.ts` — exercises `loadRubric`; since `loadRubric` is *repurposed* (not deleted), this may survive, but the design's decision to repurpose vs. delete has direct consequences for whether this file stays, is rewritten, or is dropped — and the design does not say which.

This is precisely the "removal surface is complete and correct... with no dangling references left" property the design asserts, and it is not met: five test files reference the removed surface. It also bears directly on **AC9** (deterministic gates green) — the design's stated proof of correctness — because these tests are part of the "tests" gate and will be red.

**Where in design doc:** `## Components` (Change 1 / `src/scenarios/enumerate.ts`, `src/config/types.ts`, `src/pipeline/judge-agent.ts`), and `## Risks and Open Questions` → "Deterministic test list to specify in the plan" (which describes *new* tests to add but never says the existing rubric-machinery tests are part of the removal surface). `design-doc-research.md` captured this under "Exact removal surface + touched tests › Tests touched" (research lines 54–61); the design silently dropped it.

**Suggestion:** Add the existing test files to the removal surface in the design (they are part of "what must be removed/changed for the removal to be complete"), even while leaving the file-by-file rewrite mechanics to the plan. Concretely: (1) state that `rubrics-section.test.ts` and the `# Rubrics`/`scenario.rubrics` cases in `enumerate-rubrics.test.ts`, `judge-agent.test.ts`, and `core-types.test.ts` must be deleted or rewritten so the deterministic gate stays green; (2) make an explicit decision on `rubric-loader.test.ts` consistent with the "repurpose `loadRubric`" decision (keep and extend for `loadAllRubrics`, vs. delete); (3) reconcile this with the AC9 claim so "green gates" is not asserted while known-red tests remain.

**Why it matters:** Without this, an implementer following the design's Components section removes the production symbols and immediately breaks typecheck/tests — failing AC9, the design's own correctness bar. It is also the exact "incomplete removal / hidden dependency" class the removal-completeness check exists to catch, and it represents research content that was considered and then silently dropped from the design.
