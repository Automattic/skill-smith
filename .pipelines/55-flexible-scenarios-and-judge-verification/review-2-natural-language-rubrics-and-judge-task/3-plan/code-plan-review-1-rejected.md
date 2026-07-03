# Code Plan Review

## Verdict: rejected

## Summary

The plan is well-structured, and the great majority of its load-bearing claims check out against the real codebase (both branch and, transitively, the trunk-derived state on this branch). The gate commands all resolve and terminate green on the current worktree (`typecheck`, `lint`, `test` — 381 pass / 2 skip / 0 fail, `check:config`, `validate-changesets`). The `Guardrail scopes` section correctly records `None / None` (no scoped gates were passed this run). The removal surface for the production symbols (`parseRubricsSection`/`RUBRICS_HEADING_RE`, the enumeration id-validation, `Scenario.rubrics`, `resolveRubricBlob`, `# Grading rubrics` id-injection) and their dedicated tests (`rubrics-section.test.ts`, `enumerate-rubrics.test.ts`, `judge-agent.test.ts`, `core-types.test.ts`, `rubric-loader.test.ts`) is accurate and the anchor line numbers largely match. The new-behavior design (`loadAllRubrics` sorted/deduped/G1, `stripSkillsSection` reusing the `# Skills` boundary logic, task injected into the judge SYSTEM prompt with `buildUserMessage` and `{ pass, notes }` untouched, optional `paths.rubrics`) is faithfully translated into Tasks 1–3, and the additive-first / delete-with-tests ordering (Tasks 1→6) genuinely keeps the core gates green at each commit. The changeset amend (Task 8) is correct and sufficient.

However, the plan is rejected for one gate-breaking omission that invalidates its central AC9 "gates green at every commit" claim: an existing `testing-project` conformance test asserts the *old* rubric-by-id `JUDGE.md` shape and is not in the removal surface, so Task 7 turns the `test` gate red. A second, lower-severity issue: Task 7's `Type` is `e2e`, which mis-routes deterministic markdown + assertion-test work to the wrong code-writer.

## Issues

### Issue 1: Task 7 turns the `test` gate red — `testing-project-scenarios.test.ts` asserts the old `# Rubrics` id-list shape and is not reconciled

**What's wrong:** `src/__tests__/testing-project-scenarios.test.ts` contains a test — `each JUDGE.md references the rubric by id, drops the removed env vars, and keeps live checks` (lines 195–248) — that asserts, for **every** one of the 11 `testing-project` `JUDGE.md` files, the exact structure Task 7 removes:

- line 202–206: `assert.match( brief, /^#+\s+Rubrics$/im, ... )` — requires a `# Rubrics` heading in each `JUDGE.md`.
- line 207–211: `assert.match( brief, new RegExp( \`^\\s*-\\s+${ RUBRIC_ID }\\s*$\`, 'm' ), ... )` where `RUBRIC_ID = 'wp-interactivity-api-best-practices'` (line 67) — requires the rubric-id bullet.

Task 7 drops the `# Rubrics` heading and its id-list from all 11 files. The moment it does, these two assertions fail and `npm test` goes RED. The file also carries a stale file-level JSDoc describing the reversed model (lines 9–21, e.g. ":15 … references the shared best-practices rubric by id (a `# Rubrics` section listing …)") and the now-misleading `RUBRIC_ID`/`RUBRIC_SENTINEL` constants (lines 63–67) that presume the id-list shape.

This file is a plain `node:test` static-file assertion test (it imports `node:test`, `node:fs`, and `enumerateScenarios`; it runs no scenario, no browser, no `wp-env` — `grep` for `runJudgeAgent|playwright|wp-env|spawn` returns 0). It is exactly the kind of conformance test Task 7 says it will *add* — but the plan never mentions that an equivalent test **already exists** and will actively contradict the conversion.

**Where in plan:** Task 7 (Files to change / Changes / Acceptance), and the plan's Order rationale + Flow 6 + Flow 7, all of which claim the `test` gate stays green through the `testing-project` conversion. It is also absent from the plan's implicit removal surface. (Note: the approved design doc's removal-surface list, lines 70–80, also omits this file — the gap originates upstream — but the plan is what must be executable, and as written Task 7 cannot satisfy its own "npm test passes" acceptance.)

**Suggestion:** Add `src/__tests__/testing-project-scenarios.test.ts` to Task 7's Files to change (the same task that converts the 11 `JUDGE.md` files, so the commit stays green), with an explicit rewrite decision for the lines 195–248 test: replace the `# Rubrics`-heading assertion (204–206) and the rubric-id-bullet assertion (207–211) with the **new** invariants — no `# Rubrics` heading, no `## Scenario requirements` block, a prose rubric reference present, `## Environment` and `## Live checks` retained. Keep the still-valid assertions (rubric NOT inlined via `RUBRIC_SENTINEL` at 212–215; removed env vars 217–231; live-check fragments 234–239; no `{ pass` output instruction 243–246). Update the file JSDoc (9–21) and the `RUBRIC_ID`/`RUBRIC_SENTINEL` usage to the new shape. Then decide whether Task 7's *new* assertion test is still needed or whether extending this existing file is the cleaner home (it already iterates all 11 scenarios and has the fixtures/helpers) — the plan should not add a second, overlapping conformance test without reconciling the first.

**Why it matters:** AC9 requires the deterministic gates green, and the plan's entire ordering rationale rests on "every commit keeps the gates green." Task 7 as written produces a commit where `npm test` fails on 11 scenarios' assertions, so both Task 7's acceptance ("`npm ... run check:config` passes; the assertion test passes") and Flow 7 ("All pass") are unsatisfiable as specified. A code-writer executing Task 7 verbatim would ship a red `test` gate.

### Issue 2: Task 7's `Type: e2e` is wrong — it is deterministic markdown conversion plus a static-file assertion test, which is `tdd` work

**What's wrong:** Task 7 is typed `e2e`, which routes it to `code-writer-e2e` — the agent whose job is "implementing the planner's e2e test specs … as automated end-to-end tests." Task 7 produces (a) deterministic edits to 11 markdown briefs and (b) a static-file assertion test that reads the converted files and asserts on their headings/content. There is no end-to-end flow — no scenario run, no live environment, no browser. The deliverable test is a plain `node:test` unit/integration assertion identical in kind to the existing `testing-project-scenarios.test.ts` and `testing-project-judge-config.test.ts` (both ordinary unit tests). The task's own justification — "it produces no unit-testable production code" — conflates "no production *code*" with "no unit test": the file-shape assertion the task requires **is** a unit test, and writing that assertion first and making the files conform is textbook TDD.

**Where in plan:** Task 7 → `Type: e2e` and its justification paragraph; and the Overview/Order-rationale note (lines 9 / plan §Tasks preamble) that singles out Task 7 as the one `e2e` task.

**Suggestion:** Retype Task 7 as `tdd` (write/adjust the conformance assertions first, then edit the 11 `JUDGE.md` files until the assertions and `check:config` pass). Remove the "e2e because it produces no unit-testable code" justification; replace it with the accurate statement that the deliverable is a deterministic content conversion whose acceptance is checked by a static-file assertion test plus `check:config` — no scenario suite is run (consistent with spec req 12). Since Issue 1's fix already puts the assertion work in a `node:test` file, `tdd` is the coherent routing.

**Why it matters:** The `Type` field selects the executing agent. Routing a deterministic markdown + unit-assertion task to `code-writer-e2e` risks it being executed against the wrong workflow (authoring an "end-to-end test flow" that does not exist here), while the `tdd` writer is the one equipped to drive assertion-first conformance edits. Correct `Type` selection is part of a feasible, unambiguous plan.

## Non-blocking notes (not rejection reasons, for the writer's awareness)

- **Anchor drift (cosmetic):** Task 5 cites `Paths.rubrics?` at `types.ts:146-155`; the field is actually at `:150-154`. The `Scenario.rubrics` anchor (`:197-202`) is exact. The design states line numbers are indicative anchors, not contracts, so this is not a defect — just flagging for accuracy.
- **`runJudgeAgent` call shape:** Task 3 / the design describe the judge receiving `scenario, config, projectRoot`. In the real code these arrive as a single options object at `agent-loop.ts:273-283` (`runJudgeAgent( { scenario, config, projectRoot, ... } )`). All three are in scope inside `runJudgeAgent`, so Task 3 is feasible as written; no change required.
- **`enumerate-rubrics.test.ts` (Task 4):** its `# Rubrics` fixtures are synthetic in-test `judgeBrief` strings, independent of the real `testing-project` files, so Task 4's delete-or-rewrite decision correctly and fully covers it — no interaction with Issue 1.
