# Code Plan: Leaner judge briefs — natural-language rubrics and an auto-supplied task

## Overview

This plan implements the approved design (`2-design-doc/design-doc.md`, commit `21e405c`) for the review-2 revision of the #55 pipeline. It removes the review-1 `# Rubrics` id-list machinery from Skillsmith so `JUDGE.md` becomes fully opaque prose, delivers rubric content to the judge by loading **all** rubrics from the configured path (with two prompt guardrails so the `JUDGE.md` prose selects which apply), and auto-supplies the testing agent's task (minus its `# Skills` section) to the judge on every run. It then converts all 11 `testing-project` `JUDGE.md` files to the new shape and amends the existing changeset. The live `{ pass, notes }` judge, `classifyVerdict`, reporting, and the self-improvement loop are untouched.

Order rationale: the change is planned so **every commit keeps the gates green** (AC9). The two additive primitives land first with their own tests (Task 1 `stripSkillsSection`, Task 2 `loadAllRubrics`), because they can be added without breaking anything. Then the judge is rewired to consume them and its tests are rewritten in the same task (Task 3), so no test asserts a removed symbol at any commit. Only then is the now-orphaned enumeration/type/loader machinery deleted together with the tests that reference it (Tasks 4–6), each self-contained. The `testing-project` `JUDGE.md` conversion (Task 7) and the changeset amend (Task 8) follow. Task 7 reconciles the existing static-file conformance test (`src/__tests__/testing-project-scenarios.test.ts`, which asserts the old rubric-by-id `JUDGE.md` shape) **in the same commit** as the 11-file conversion — updating its assertions to the opaque shape before/with the file edits — so the `test` gate stays green through the conversion rather than going red on 11 scenarios' assertions. Because the deterministic primitives are added before the machinery they replace is removed, and each task that changes a file's asserted shape rewrites its dependent tests in the same commit, the `typecheck`/`lint`/`test` gates stay green after every task.

All tasks are `tdd` per spec req 12 (this change is deterministic: parsing removal, prompt assembly, config, `JUDGE.md` conversion). No task runs the full scenario suite or the self-improvement loop. Task 7 (the `testing-project` `JUDGE.md` content conversion) is also `tdd`: its deliverable is a deterministic content conversion of 11 briefs whose conformance is asserted by a static-file `node:test` — an existing conformance test (`testing-project-scenarios.test.ts`) is updated assertion-first to the opaque-`JUDGE.md` shape, then the 11 files are edited until it and `check:config` pass. No live scenario is run.

## Guardrail scopes

No scoped gates were passed for this run. The code-writers run the fixed guardrail commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`.

| Gate | Scope |
| ---- | ----- |
| None | None |

## E2E test plan

This change is deterministic. There is no browser/scenario end-to-end flow to automate within the pipeline (full behavioral verification stays manual/owner-run, spec req 12). The "flows" below are the spec's acceptance criteria expressed as concrete, observable behaviors that the deterministic unit/integration tests (owned per-task by the code-writer-tdd) and the `testing-project` assertion/`check:config` gates re-drive. They are the reviewer's manual re-drive script; they are **not** instructions to run the scenario suite.

### Flow 1: Opaque `JUDGE.md` — enumeration parses nothing structured

- **Steps:** Enumerate a scenario whose `JUDGE.md` is prose only, with no `# Rubrics` heading. Also enumerate a scenario whose `JUDGE.md` prose mentions a rubric name that has no matching file.
- **Expected:** Both scenarios are discovered and runnable. `scenario.judgeBrief` holds the file verbatim. Enumeration produces no error about a missing/malformed rubric section and no error about the unresolved prose rubric reference. `Scenario.rubrics` does not exist on the type; nothing reads it.
- **Traces to:** Acceptance criteria 1, 4; Edge case "mistyped rubric reference is not detected".

### Flow 2: Prose rubric reference is graded against (prompt assembly)

- **Steps:** Configure a rubrics path containing one or more rubric files. Run the judge for a scenario whose `JUDGE.md` names a rubric in prose.
- **Expected:** The assembled judge system prompt contains a `# Grading rubrics` section whose body includes every loaded rubric's content verbatim, each under a self-identifying `# Rubric: <id>` header (G1), preceded by a one-line selection instruction telling the judge to apply only the rubric(s) the brief names (G2). The rubric bodies reach the judge; the judge's `{ pass, notes }` verdict is what flows downstream.
- **Traces to:** Acceptance criterion 2. (Whether the judge *acts* on the named rubric is behavioral, verified manually — spec req 12/R3.)

### Flow 3: Rubrics are optional — no path or empty path

- **Steps:** Run the judge for a scenario with (a) `paths.rubrics` unset, and (b) `paths.rubrics` set to an empty directory.
- **Expected:** In both cases the assembled prompt has no `# Grading rubrics` section, the judge run completes, and no rubric-related error or validation failure is raised.
- **Traces to:** Acceptance criterion 3.

### Flow 4: The judge receives the task automatically, skill-agnostically

- **Steps:** Run the judge for any scenario whose `TESTING-AGENT.md` contains a `# Skills` section (e.g. `# Skills\n- wp-interactivity-api`).
- **Expected:** The assembled judge system prompt contains the testing task under a dedicated heading placed immediately after the `judgeBrief`, and that task text is the `TESTING-AGENT.md` content with its `# Skills` section removed. Neither the `# Skills` heading, its list items, nor any surrounding skill-identifying prose from that section appears. The `JUDGE.md` need not restate the task.
- **Traces to:** Acceptance criteria 5, 6.

### Flow 5: Verdict and downstream wiring unchanged

- **Steps:** Complete a judge run and record its result.
- **Expected:** The verdict is `{ pass, notes }`, parsed and stored exactly as before; `classifyVerdict` handles it unchanged; the report and self-improvement context still receive the verbatim notes and failing scenarios' skill files. No change to the user message (still purely the produced files).
- **Traces to:** Acceptance criterion 7.

### Flow 6: `testing-project` fully converted

- **Steps:** Inspect every `testing-project/eval/scenarios/*/JUDGE.md`. Run `npm test` (which includes the updated `testing-project-scenarios.test.ts` conformance assertions) and `npm --prefix testing-project run check:config`.
- **Expected:** No file contains a `## Scenario requirements` block or a `# Rubrics` id-list. Each references its rubric in prose. Each retains its `## Environment` and `## Live checks` content. Scenario-specific mechanism checks that were unique judge signal survive under a `## What to check` heading where present. The rubric file `eval/rubrics/wp-interactivity-api-best-practices.md` is byte-for-byte unchanged. `paths.rubrics: './eval/rubrics'` is still configured. The updated conformance test asserts the new opaque shape (no `# Rubrics` heading, no rubric-id bullet, prose rubric reference present, `## Environment`/`## Live checks` retained, rubric not inlined, removed env vars gone, live checks present, no JSON-output instruction) and passes; `check:config` passes.
- **Traces to:** Acceptance criterion 8; spec reqs 9, 10.

### Flow 7: Deterministic gates green with a coherent changeset

- **Steps:** Run `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`.
- **Expected:** All pass. Exactly one `minor` `@automattic/skillsmith` changeset exists for this line of work, and its text describes the final natural-language-rubric + auto-supplied-task model (not the reversed rubric-by-id model).
- **Traces to:** Acceptance criterion 9; spec req 11.

## Tasks

### Task 1: Add `stripSkillsSection` to `enumerate.ts`

- **Goal:** Provide a pure helper that returns a testing brief with its `# Skills` section removed, reusing the existing `# Skills` boundary logic. This is the primitive the judge uses to build the skill-agnostic task. It is added first (additive, breaks nothing).
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/enumerate.ts` (add the export)
  - `src/__tests__/` (new coverage for `stripSkillsSection`; a new dedicated test file such as `strip-skills-section.test.ts` is acceptable — the code-writer-tdd selects the tests)
- **Changes:**
  - Add and export `stripSkillsSection( testingBrief: string ): string`. It must reuse the same boundary logic `parseListSection` (`enumerate.ts:39-69`) uses: normalize line endings (`\r\n?` → `\n`) before matching; find the first heading (via `HEADING_RE`, `:11`) whose trailing text matches `SKILLS_HEADING_RE` (`:13`) at any depth; then remove from that heading line through the line **before** the next heading of the **same-or-shallower** depth (or through EOF when none follows). Return the remaining lines rejoined.
  - When the brief has **no** `# Skills` heading, return it unchanged.
  - Do **not** alter `parseListSection`, `parseSkillsSection`, `HEADING_RE`, or `SKILLS_HEADING_RE` — they stay and are still used for skill loading.
  - Co-locate the helper near the heading regexes it depends on. (A more general `stripSection( brief, isHeading )` factoring is acceptable, but only the `# Skills` call site exists today.)
  - Add JSDoc describing the section-removal contract (heading through the line before the next same-or-shallower heading, or EOF; no-op when absent; line endings normalized).
- **Depends on:** none
- **Traces to:** Spec reqs 6, 7; Design decision "Auto-supply the task via the judge system prompt, minus `# Skills`"; Design Components → `enumerate.ts` (new strip helper); Acceptance criteria 5, 6.
- **Acceptance:**
  - Given a brief with a `# Skills` section between two other sections, the returned string omits the `# Skills` heading and its entire body, and preserves the sections before and after it intact.
  - Given a brief whose `# Skills` section is the **last** section (heading + list through EOF), the returned string ends cleanly with the section removed and no trailing skill content.
  - Given a `# Skills` section that contains prose around/instead of the list, the whole section (heading through the next same-or-shallower heading or EOF) is removed — no skill-identifying text leaks.
  - Given a brief with **no** `# Skills` heading, the input is returned unchanged.
  - Input using `\r\n` line endings is handled (matching succeeds and the section is removed) exactly as with `\n`.
  - A `## Skills` (deeper-depth) heading is matched at any depth per the existing boundary rule, consistent with `parseSkillsSection`.

### Task 2: Add `loadAllRubrics` to `rubric-loader.ts`

- **Goal:** Provide a directory-level rubric loader that enumerates every top-level `*.md` under a rubrics root, loads each via the existing `loadRubric` (retaining md-link expansion), sorts deterministically, dedupes, wraps each under a G1 self-identifying header, and returns `undefined` when there is nothing to load. This is added while the old id-based path (`resolveRubricBlob`) is still in place, so nothing breaks.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/rubric-loader.ts` (add `loadAllRubrics`; keep `loadRubric`)
  - `src/__tests__/rubric-loader.test.ts` (keep existing `loadRubric` cases; add `loadAllRubrics` cases, reusing/extending the `fixtures/rubrics/multi.md` + `sub/helper.md` fixtures)
- **Changes:**
  - Add and export `loadAllRubrics( rubricsRoot: string ): string | undefined`:
    - Return `undefined` when `rubricsRoot` does not exist (`existsSync` false) or contains no top-level `*.md` files.
    - Enumerate **top-level** `*.md` files under `rubricsRoot` (do not recurse into sub-dirs for the top-level listing — companions are pulled in only via `loadRubric`'s md-link expansion). Sort filenames **ascending** before loading (determinism; `readdirSync` is unordered — mirror the id-sort convention at `enumerate.ts:263`).
    - For each top-level file, call `loadRubric( <basename-without-`.md`>, rubricsRoot )` so in-tree md-linked companions are expanded for free.
    - **Dedupe by resolved path** so a companion that is itself also a top-level `.md` does not appear twice.
    - Wrap each loaded rubric under a **G1** self-identifying header `# Rubric: <id>` where `<id>` is the filename without `.md` (the string an author references). The rubric file's own H1 travels verbatim inside the body (via `loadRubric`'s `=== <rel> ===\n<text>` output). Join the per-rubric blocks with blank lines.
    - **Guard per-file reads**: one unreadable rubric file must degrade to *skipping that file* rather than aborting — do not let a single bad read throw out of `loadAllRubrics`. (Failure mode from the design: load-all enumerates existing files so `loadRubric`'s throw-on-missing is largely mooted, but the read is still guarded.)
  - Keep `loadRubric` exactly as-is (it is now the per-file primitive of load-all, no longer orphaned). Keep all existing `rubric-loader.test.ts` cases (they still describe live `loadRubric` behavior).
  - The G2 selection lead-in line is **not** added here; the caller (`buildJudgeSystemPrompt`, Task 3) prepends it so it precedes the rubric bodies. `loadAllRubrics` returns only the rubric bodies wrapped with G1 headers.
- **Depends on:** none
- **Traces to:** Spec reqs 3, 4; Design decisions "Rubric delivery = load-all-from-path (Mechanism A) + two guardrails" and "Determinism — the load-all is sorted"; Design Components → `rubric-loader.ts`; Acceptance criteria 2, 3.
- **Acceptance:**
  - Given a rubrics root with multiple top-level `*.md` files, the returned blob contains each rubric's content, ordered by filename ascending regardless of filesystem enumeration order.
  - Each rubric appears under a `# Rubric: <id>` header where `<id>` is its filename without `.md`, and the rubric's own body (including its H1) is present verbatim below it.
  - A rubric whose md-links reference an in-tree companion has that companion's content included (via `loadRubric`), and the companion does not also appear as a duplicate top-level entry (dedupe by resolved path).
  - Given a rubrics root that does not exist, the function returns `undefined`.
  - Given a rubrics root that exists but contains no `*.md` files, the function returns `undefined`.
  - Given one unreadable top-level rubric file alongside readable ones, the readable rubrics are returned and the unreadable one is skipped without throwing.
  - The returned value contains no G2 selection lead-in line (that is the caller's responsibility).

### Task 3: Rewire the judge to auto-supply the task and load all rubrics

- **Goal:** In `judge-agent.ts`, replace the per-scenario `resolveRubricBlob` id-injection with `loadAllRubrics`, inject the skill-stripped task into the system prompt, and add the G2 selection lead-in — then rewrite the judge-agent rubric tests to the new shape in the same task so no gate goes red. The user message and verdict pipeline stay untouched.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/judge-agent.ts`
  - `src/__tests__/judge-agent.test.ts` (rewrite the rubric cases; keep the non-rubric cases; add the new task-injection and load-all assertions)
- **Changes:**
  - **Imports:** replace `import { loadRubric } from '../scenarios/rubric-loader'` (`:10`) with `import { loadAllRubrics } from '../scenarios/rubric-loader'`; add `import { stripSkillsSection } from '../scenarios/enumerate'`.
  - **Remove** `resolveRubricBlob` (`:122-138`) entirely.
  - **In `runJudgeAgent`** (`:50-106`):
    - Replace the `resolveRubricBlob( scenario, config, projectRoot )` call (`:65`) with a load-all: when `config.paths.rubrics` is set, compute `loadAllRubrics( resolve( projectRoot, config.paths.rubrics ) )`; otherwise `undefined`. (`resolve` is already imported at `:2`.)
    - Compute the task string: `const task = stripSkillsSection( scenario.testingBrief )`.
    - Call `buildJudgeSystemPrompt( scenario, config, task, rubricBlob )` (new `task` param — see below).
    - Leave `buildUserMessage(...)` (`:67-71`), the provider invoke, `parseJudgeJson`, and the `{ pass, notes }` return path unchanged.
    - Optional (kept minimal, not required by acceptance): a `log.info` line noting the count of rubrics loaded / that the task was supplied, in the existing `scope` (`judge:<scenario>@<agent>`). No new log contract.
  - **Change `buildJudgeSystemPrompt`'s signature** to `( scenario: Scenario, config: SkillsmithConfig, task: string, rubricBlob?: string ): string`. It stays a **pure string builder** (no filesystem access).
    - Assemble sections in order: `[ judgeBrief, taskSection, outputInstruction (+recursion guard), gradingRubrics?, rolePrompt? ]`.
    - `taskSection`: the `task` string under a dedicated heading `# Testing task`, placed **immediately after** `scenario.judgeBrief` and **before** `outputInstruction`. Always present (auto-supply is unconditional, req 6).
    - `gradingRubrics`: emitted **only** when `rubricBlob` is defined and non-empty (mirrors current `:207`). Its body is the **G2** selection lead-in line followed by the `rubricBlob` (which already carries G1 per-rubric headers from Task 2), under the existing `# Grading rubrics` heading (keep that heading name, `:208`). G2 text conveys: the rubrics below are shared, reusable grading criteria; apply **only** the rubric(s) this scenario's brief refers to; treat the rest as reference-only that must not affect the verdict.
    - `rolePrompt`: unchanged (`# Role instructions` when `config.roles.judge.prompt` is set).
  - **Update JSDoc** on `runJudgeAgent` (`:37-49`) and `buildJudgeSystemPrompt` (`:171-188`) to describe the auto-supplied `# Testing task` section and the load-all `# Grading rubrics` section (G1/G2). Do not describe `Scenario.rubrics` (removed in Task 4).
  - **`buildUserMessage` (`:293-312`) stays unchanged** — user message remains purely the produced files; its `_scenario` param stays deliberately unused.
  - **Rewrite `judge-agent.test.ts` rubric cases** in the same task (removal-surface reconciliation, AC9):
    - Update the shared `makeScenario` helper / call sites so `buildJudgeSystemPrompt` is called with the new `task` argument.
    - Rewrite the `buildJudgeSystemPrompt` rubric-blob cases (`:170-201`) to the new shape: rubric blob present ⇒ `# Grading rubrics` section present with the G2 lead-in and the blob; no/empty blob ⇒ no `# Grading rubrics` section. Keep the "other sections intact" case (`:203-...`) and extend it to also assert the `# Testing task` section is present.
    - Rewrite the `runJudgeAgent` rubric-resolution cases (`:528-635`) off `scenario.rubrics`: instead, seed rubric **files** under `paths.rubrics` and assert load-all behavior — all rubric bodies present under `# Grading rubrics` when `paths.rubrics` is set and the dir has files; no `# Grading rubrics` section when `paths.rubrics` is unset or the dir is empty. Remove all `scenario.rubrics = [...]` assignments (`:541`, `:610`).
    - Add new deterministic coverage: the auto-supplied task appears in the system prompt with its `# Skills` section removed; the task is placed after the `judgeBrief`; the user message still contains only the produced files (no task text).
    - Keep untouched: the `{ pass, notes }` / JSON-parse / recursion-guard / role-section / `buildUserMessage` file-inlining cases.
- **Depends on:** Task 1 (`stripSkillsSection`), Task 2 (`loadAllRubrics`)
- **Traces to:** Spec reqs 3, 4, 6, 7, 8; Design decisions "Rubric delivery = load-all-from-path + guardrails", "Auto-supply the task via the judge system prompt, minus `# Skills`", "Keep the live `{ pass, notes }` judge unchanged"; Design Components → `judge-agent.ts`; Acceptance criteria 2, 3, 5, 6, 7.
- **Acceptance:**
  - The assembled judge system prompt contains a `# Testing task` section, placed after the `judgeBrief` and before the `# Output format` section, holding the testing brief with its `# Skills` section removed. This section is present on every judge run regardless of config.
  - When `paths.rubrics` is set and the directory has rubric files, the prompt contains a `# Grading rubrics` section with the G2 selection instruction (apply only the rubric(s) the brief names; others are reference-only) followed by all loaded rubric bodies (each under its G1 `# Rubric: <id>` header), with the rubric content verbatim.
  - When `paths.rubrics` is unset, no `# Grading rubrics` section appears and the run completes without error.
  - When `paths.rubrics` points at an empty directory, no `# Grading rubrics` section appears and the run completes without error.
  - The judge user message is unchanged: it contains only the produced files and no task text.
  - The verdict path is unchanged: a `{ pass, notes }` JSON reply parses and returns as before; recursion-guard, output-format, and role-instructions sections still appear.
  - No code in `judge-agent.ts` references `scenario.rubrics` or `resolveRubricBlob`.

### Task 4: Remove the `# Rubrics` machinery from enumeration

- **Goal:** Delete the review-1 `# Rubrics` parser, its enumeration-time id validation, the `rubricsRoot` plumbing, and the `Scenario.rubrics` writes from `enumerate.ts`, and reconcile the enumeration tests in the same task so the gates stay green. After this, enumeration reads `JUDGE.md` verbatim and parses nothing structured from it.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/enumerate.ts`
  - `src/__tests__/rubrics-section.test.ts` (DELETE)
  - `src/__tests__/enumerate-rubrics.test.ts` (REWRITE to the opaque-`JUDGE.md` model, or DELETE — see below)
- **Changes:**
  - In `enumerate.ts`:
    - Remove `RUBRICS_HEADING_RE` (`:15`) and `parseRubricsSection` (`:122-128`, including its JSDoc `:101-121`).
    - Remove the rubric parse+validate block in `scenarioFromBriefs` (`:311-325`) and stop writing `rubrics` in the scenario literal (`:330`) and in `stubScenario` (`:359`).
    - Remove the `rubricsRoot` plumbing: the computed `rubricsRoot` in `enumerateScenarios` (`:204-207`), the argument passed to `scenarioFromBriefs` (`:235`), and the `rubricsRoot` parameter (`:288`). After removal, `enumerateScenarios` no longer computes or threads a rubrics root.
    - Update the JSDoc on `EnumeratedScenario` (`:149-172`), `enumerateScenarios` (`:174-197`), `scenarioFromBriefs` (`:266-282`), and `stubScenario` (`:341-350`) to drop every mention of `# Rubrics`/`rubrics`.
    - **Keep** `parseListSection`, `HEADING_RE`, `SKILLS_HEADING_RE`, `parseSkillsSection`, `normalizeSkillId`, and the `stripSkillsSection` added in Task 1 — the `# Skills` section is still parsed for skill loading, and skill existence-validation is unchanged.
    - Do **not** import `Scenario`-`rubrics`-related types; `Scenario` import stays (still used).
  - Delete `src/__tests__/rubrics-section.test.ts` outright: it imports `parseRubricsSection` (`:3`) and every case exercises the removed parser; nothing in it survives.
  - Rewrite `src/__tests__/enumerate-rubrics.test.ts` to the opaque-`JUDGE.md` model, or delete it. If rewritten, it must assert the **new** invariants and drop every `scenario.rubrics`/id-validation case: (a) a `JUDGE.md` that is prose only enumerates with no error and its content is read verbatim into `scenario.judgeBrief`; (b) a `JUDGE.md` whose prose names a rubric with no matching file does **not** produce an enumeration error and does not mark the scenario errored (AC1, AC4); (c) with a `rubrics` path set or unset, no rubric existence-validation runs. Remove all `assert...scenario.rubrics` assertions and all `# Rubrics` fixtures. (Keeping the file as a home for AC1/AC4 assertions is preferred over deleting, so those criteria retain explicit coverage; either satisfies AC9.)
- **Depends on:** Task 3 (the last production reader of `scenario.rubrics`/`resolveRubricBlob` is removed there, so this deletion leaves no dangling production reference)
- **Traces to:** Spec reqs 1, 5; Design decision "`JUDGE.md` is fully opaque — remove the review-1 `# Rubrics` machinery"; Design Components → `enumerate.ts` and "Modified/removed — existing rubric-machinery tests"; Acceptance criteria 1, 4, 8.
- **Acceptance:**
  - `enumerate.ts` exports no `parseRubricsSection` and defines no `RUBRICS_HEADING_RE`; no code parses a `# Rubrics` section.
  - Enumerating a scenario whose `JUDGE.md` is prose only (no `# Rubrics` heading) yields a runnable scenario with no error and `scenario.judgeBrief` equal to the file content verbatim.
  - Enumerating a scenario whose `JUDGE.md` prose names a rubric with no matching file yields no enumeration error and does not mark the scenario errored.
  - `enumerateScenarios` no longer computes or threads a `rubricsRoot`, and `scenarioFromBriefs` no longer takes one.
  - The `# Skills` parsing and skill existence-validation behavior is unchanged (existing skill-related enumeration tests still pass).
  - `rubrics-section.test.ts` is gone; no test imports `parseRubricsSection`.

### Task 5: Remove `Scenario.rubrics` from the config types

- **Goal:** Delete the `Scenario.rubrics?` field and its JSDoc from `src/config/types.ts`, and update the one `core-types.test.ts` case that asserts it, keeping the `Paths.rubrics` cases intact.
- **Type:** tdd
- **Files to change:**
  - `src/config/types.ts`
  - `src/__tests__/core-types.test.ts` (remove/update the `Scenario.rubrics` case only)
- **Changes:**
  - In `src/config/types.ts`: remove the `Scenario.rubrics?` field and its JSDoc (`:197-202`). Keep `Paths.rubrics?` (`:146-155`) exactly as-is (optional, no default, no start-up existence gate). Ensure no remaining JSDoc in this file references parsing a `# Rubrics` section.
  - In `src/__tests__/core-types.test.ts`: remove/update the `Scenario.rubrics` assertion block (`:58-66`) so it no longer references the removed field; a `@ts-expect-error` guard for `scenario.rubrics` (mirroring the existing `description`/`prompt`/`acceptance` guards at `:69-88`) is an acceptable way to assert the field is gone. **Keep** the `Paths.rubrics` cases (`:90-113`) unchanged — `Paths.rubrics?` stays optional and those assertions remain valid.
- **Depends on:** Task 4 (enumeration no longer writes `Scenario.rubrics`) and Task 3 (judge no longer reads it) — both readers/writers gone before the type field is deleted, so this removal compiles cleanly.
- **Traces to:** Spec req 1; Design Components → `src/config/types.ts` and "Modified/removed — existing rubric-machinery tests" (`core-types.test.ts` UPDATE); Acceptance criterion 8.
- **Acceptance:**
  - `Scenario` no longer declares a `rubrics` field; accessing `scenario.rubrics` is a type error.
  - `Paths.rubrics?` remains an optional field with no default and no existence gate; the `Paths.rubrics` type tests still pass.
  - `typecheck` passes with no dangling references to `Scenario.rubrics`.

### Task 6: Confirm `rubric-loader.ts` / `loadRubric` is retained and integrated

- **Goal:** Verify (and, if any cleanup remains, complete) that `loadRubric` is retained as the per-file primitive of `loadAllRubrics` and is no longer orphaned, and that `rubric-loader.test.ts` keeps its `loadRubric` cases. This is a small consolidation checkpoint ensuring the removal surface left no orphan and no dangling import.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/rubric-loader.ts` (verify only; expected no further change beyond Task 2)
  - `src/__tests__/rubric-loader.test.ts` (verify the `loadRubric` cases remain and the `loadAllRubrics` cases from Task 2 are present)
- **Changes:**
  - Confirm `loadRubric` is still exported and is called by `loadAllRubrics` (its production caller after `resolveRubricBlob` was removed in Task 3). No functional change to `loadRubric`.
  - Confirm no production or test file imports `loadRubric` for the removed id-injection path (the only remaining production caller is `loadAllRubrics`).
  - If any orphaned import or dead reference remains from Tasks 2–5, remove it here. (Expected: none — this task is a guard against a dangling symbol.)
- **Depends on:** Task 2, Task 3
- **Traces to:** Design Components → `rubric-loader.ts` ("Repurposed, not deleted") and "Modified/removed — existing rubric-machinery tests" (`rubric-loader.test.ts` KEEP+extend); Spec req 3.
- **Acceptance:**
  - `loadRubric` remains exported and is called only by `loadAllRubrics` in production.
  - `rubric-loader.test.ts` retains its original `loadRubric` cases and includes the `loadAllRubrics` cases.
  - No file imports a removed rubric symbol; `typecheck` and `test` pass.

### Task 7: Convert the 11 `testing-project` `JUDGE.md` files to the new shape

- **Goal:** Rewrite all 11 scenario `JUDGE.md` files: drop the `# Rubrics` id-list and the `## Scenario requirements` block, reference the rubric in prose, re-home scenario-specific unique mechanism checks under a `## What to check` heading (only where such residue exists), and keep `## Environment` and `## Live checks`. The rubric file content stays unchanged.
- **Type:** tdd — **justification:** the deliverable is a deterministic content conversion of 11 author-facing brief files whose acceptance is checked by a **static-file `node:test` assertion** (an existing conformance test, `testing-project-scenarios.test.ts`, updated assertion-first) plus the `check:config` gate. That file-shape assertion **is** a unit test, so this is textbook TDD: update the assertions to the new opaque-`JUDGE.md` shape first (RED), then edit the 11 `JUDGE.md` files until the assertions and `check:config` pass (GREEN). No scenario suite and no self-improvement loop is run (consistent with spec req 12). There is no end-to-end flow here — no scenario run, no live environment, no browser — so this routes to `code-writer-tdd`, not `code-writer-e2e`.
- **Files to change:**
  - `testing-project/eval/scenarios/async-fetch/JUDGE.md`
  - `testing-project/eval/scenarios/config-fetch/JUDGE.md`
  - `testing-project/eval/scenarios/counter/JUDGE.md`
  - `testing-project/eval/scenarios/derived-double/JUDGE.md`
  - `testing-project/eval/scenarios/focus-trap-menu/JUDGE.md`
  - `testing-project/eval/scenarios/fruit-list-each/JUDGE.md`
  - `testing-project/eval/scenarios/independent-counters/JUDGE.md`
  - `testing-project/eval/scenarios/minimal-scaffold/JUDGE.md`
  - `testing-project/eval/scenarios/paginated-list/JUDGE.md`
  - `testing-project/eval/scenarios/shared-state/JUDGE.md`
  - `testing-project/eval/scenarios/toggle-visibility/JUDGE.md`
  - `src/__tests__/testing-project-scenarios.test.ts` (UPDATE — an existing static-file `node:test` conformance test that asserts the **old** rubric-by-id `JUDGE.md` shape for all 11 scenarios; it must be reconciled to the new opaque shape **in this same task/commit** so the `test` gate stays green. Do **not** add a second, overlapping conformance test — extend this file, which already iterates all 11 scenarios and owns the fixtures/helpers.)
- **Changes (apply the conversion rule to each file):**
  1. **Drop** the trailing `# Rubrics` heading and its id-list (all 11 currently list exactly `- wp-interactivity-api-best-practices`).
  2. **Add** one plain-prose rubric-reference sentence naming the rubric by its human title, e.g. *"Also grade the produced code against the WordPress Interactivity API best-practices rubric."* (ordinary prose — Skillsmith parses nothing from it). Place it near the intro, after the opening prose.
  3. **Reword the intro** so any phrase referencing the removed list ("the requirements below") becomes "the task it was given".
  4. **Drop** the `## Scenario requirements` heading and its category-(a) bullets (task duplication — now auto-supplied) and category-(c) bullets (generic criteria already covered by the auto-loaded rubric).
  5. **Preserve** category-(b) bullets — scenario-specific mechanism checks that are neither in the task nor in the rubric — **re-homed** under a `## What to check` heading. Add `## What to check` **only when there is (b) residue**; omit it entirely for the clean cases.
  6. **Keep** `## Environment` and `## Live checks` as-is.
  - Per-scenario (b) residue to preserve under `## What to check` (from the design's per-scenario audit; the code-writer re-homes these specific checks faithfully, reusing existing wording):
    - `counter`: **none** — no `## What to check`; reduces to intro + rubric-reference + `## Environment` + `## Live checks` (see design worked Example 2, verbatim shape).
    - `async-fetch`: minimal — one weak URL-literal check the auto-task already carries; a `## What to check` is optional (discretion). Prefer omitting unless the URL-literal check is judged unique enough to keep.
    - `minimal-scaffold`: **high** — (i) the `console.log("iapi-ready")` call lives inside a store init callback (not top-level, not a `data-wp-on--*` handler, not `data-wp-watch`); (ii) the wrapper carries `data-wp-init="callbacks.<name>"`. Follow design worked Example 1 shape verbatim.
    - `config-fetch`: **high** — `wp_interactivity_config()` (not state/context); `getConfig()` read; `X-WP-Nonce` from config; exact server APIs (`rest_url('wp/v2/posts/1')`, `wp_create_nonce('wp_rest')`).
    - `derived-double`: **high** — derived getter vs stored mutable field; action mutates only the counter, never `double`; directive references the derived getter (`state.double`), not inline arithmetic.
    - `focus-trap-menu`: **highest** — single boolean drives drawer + `aria-expanded`; Tab/Shift+Tab trap via directives (not `addEventListener`); Escape close via directive; instance-scoped focus return (not global `querySelector`); real server-rendered anchors.
    - `fruit-list-each`: **high** — `data-wp-each` + `<template>` (not PHP `foreach`); in-place `.push("Mango")` (not array reassign); per-item text via `data-wp-text` on the per-iteration context.
    - `paginated-list`: **highest** — `data-wp-router-region` with stable id; `withSyncEvent`; generator + `yield import('@wordpress/interactivity-router')` + `actions.navigate(href)`; server `$_GET['pg']` slice; `supports.interactivity` / `clientNavigation` nuance; SDP gotcha on Prev/Next omission.
    - `independent-counters`: **moderate** — per-instance value in local context (`getContext()`), not global state.
    - `shared-state`: **moderate** — value in global `state.*` (not context); shared namespace matches `store()`.
    - `toggle-visibility`: **moderate** — single boolean drives both `aria-expanded` and the paragraph's `hidden`/negation.
  - The rubric file `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` is **not** touched (req 10). `testing-project/skillsmith.config.ts` keeps `paths.rubrics: './eval/rubrics'` (not touched).
  - **Reconcile the existing conformance test `src/__tests__/testing-project-scenarios.test.ts` (assertion-first, RED before the file edits).** This is a static-file `node:test` (it imports `node:test`, `node:fs`, `enumerateScenarios`; it runs no scenario, no browser, no `wp-env`). It currently asserts the **old** rubric-by-id shape for all 11 `JUDGE.md` files and will turn the `test` gate red the moment the files are converted, so it must be rewritten in this same task. Specifically, in the test `each JUDGE.md references the rubric by id, drops the removed env vars, and keeps live checks` (currently `~:195-248`):
     - **Remove** the `# Rubrics`-heading assertion (`~:202-206`, `assert.match( brief, /^#+\s+Rubrics$/im, ... )`) and the rubric-id-bullet assertion (`~:207-211`, the `^\s*-\s+${ RUBRIC_ID }\s*$` match). These check exactly the structure this task removes.
     - **Add** the new opaque-shape invariants for each of the 11 files: no `# Rubrics` heading; no `## Scenario requirements` heading; a prose rubric reference is present (assert on a stable fragment of the human-title reference sentence, e.g. `Interactivity API best-practices rubric`, aligned with the prose sentence chosen in step 2); `## Environment` and `## Live checks` headings are present.
     - **Keep** the still-valid assertions unchanged: rubric NOT inlined via `RUBRIC_SENTINEL` (`~:212-215`); the removed env vars `$SKILLSMITH_JUDGE_URL` / `$SKILLSMITH_POST_ID` absent and `$SKILLSMITH_PLUGIN_SLUG` retained (`~:217-231`); the per-scenario `liveChecks` fragments present (`~:234-239`); no `{ pass` JSON-output instruction (`~:243-246`).
     - **Update** the file-level JSDoc (`~:9-21`) so it describes the opaque-`JUDGE.md` contract (each `JUDGE.md` references the shared best-practices rubric in **natural-language prose**, not a `# Rubrics` id-section) instead of the reversed rubric-by-id model.
     - **Update the `RUBRIC_ID` / `RUBRIC_SENTINEL` usage** to the new shape: `RUBRIC_SENTINEL` and its rubric-not-inlined check stay (that invariant is still true); `RUBRIC_ID` (`~:67`) is no longer used by the id-bullet assertion — remove it (and its comment) once the id-bullet check is dropped, or repurpose it only if a remaining assertion still needs it (none does after the rewrite).
     - Do **not** add a second, overlapping conformance test file; this file is the single home for the converted-`JUDGE.md` conformance assertions.
     - Leave the other tests in this file untouched (`every scenario has both two-file briefs…`, `all 11 scenarios enumerate cleanly…`, `the anchors cover exactly the shipped scenario set`, `each TESTING-AGENT.md preserves the prompt…`, `_candidates.yaml no longer documents the legacy … rubrics shape`) — they remain valid.
- **Depends on:** Task 4 (enumeration no longer parses `# Rubrics`, so the converted opaque files enumerate cleanly)
- **Traces to:** Spec reqs 9, 10; Design decision "`testing-project` conversion rule — preserve unique judge checks, do NOT wholesale-delete `## Scenario requirements`"; Design worked conversion examples; Acceptance criteria 8, 9 (the in-task conformance-test reconciliation keeps the `test` gate green).
- **Acceptance:**
  - No `testing-project/eval/scenarios/*/JUDGE.md` contains a `## Scenario requirements` block or a `# Rubrics` id-list.
  - Every converted `JUDGE.md` references its rubric in prose and retains its `## Environment` and `## Live checks` content.
  - Every scenario with category-(b) residue (all except `counter`, and `async-fetch` at discretion) has its unique mechanism checks preserved under a `## What to check` heading; `counter` has no `## What to check`.
  - `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` is byte-for-byte unchanged, and `paths.rubrics: './eval/rubrics'` is still configured.
  - `src/__tests__/testing-project-scenarios.test.ts` no longer asserts a `# Rubrics` heading or a rubric-id bullet for any `JUDGE.md`; it asserts the new opaque invariants (no `# Rubrics`, no `## Scenario requirements`, prose rubric reference present, `## Environment`/`## Live checks` present) and retains the still-valid checks (rubric-not-inlined, removed env vars absent / plugin slug retained, live-check fragments present, no JSON-output instruction). Its file-level JSDoc describes the opaque-`JUDGE.md` model.
  - `npm test` passes (the reconciled conformance test included) and `npm --prefix testing-project run check:config` passes — the `test` gate stays green through the conversion.

### Task 8: Amend the existing changeset to the final model

- **Goal:** Amend `.changeset/flexible-scenarios-judge-verification.md` so the PR ships one coherent `minor` release note describing the final natural-language-rubric + auto-supplied-skill-agnostic-task model, rather than a note describing rubric-by-id followed by a note reversing it. (Alternative: add a second `minor` changeset — not chosen; recorded below.)
- **Type:** tdd
- **Files to change:**
  - `.changeset/flexible-scenarios-judge-verification.md`
- **Changes:**
  - Keep the front matter `"@automattic/skillsmith": minor` (pre-1.0 policy; still `BREAKING:`-prefixed since scenario briefs change shape). Keep the changeset filename.
  - Rewrite the body so it describes the **final** behavior: `JUDGE.md` is fully opaque prose (no `# Rubrics` section, no id-matching, no enumeration-time rubric validation); a scenario author names the rubric to grade against in natural-language prose; Skillsmith loads **all** rubrics from the optional `paths.rubrics` location and injects them into the judge prompt (the prose selects which apply); the `Scenario` type no longer carries a `rubrics` field; `paths.rubrics` stays optional (no default, no existence gate); the judge is auto-supplied the testing agent's task (minus its `# Skills` section) on every run, keeping the judge skill-agnostic; the verdict stays `{ pass, notes }` and reporting/self-improvement are unchanged.
  - Remove the review-1 sentences that describe the reversed rubric-by-id model (the `# Rubrics` id-section, `Scenario.rubrics` regaining, and id-resolved injection). Keep the changeset a single coherent note; do not describe the intermediate reversed model.
  - **Alternative recorded (not chosen):** add a second `minor` changeset for this revision. Both satisfy "a `minor` changeset is recorded, pre-1.0", but two notes would ship a rubric-by-id note followed by a reversal — the design recommends amending for one coherent note.
  - **Do not** add a `testing-project`-only changeset for the `JUDGE.md` conversion — `testing-project` changes do not bump the package (req 11).
- **Depends on:** none (may be done at any point; ordered last so the note matches the final shipped surface)
- **Traces to:** Spec req 11; Design Open Question "Changeset: amend vs. add" (recommendation: amend); Risk R5; Acceptance criterion 9.
- **Acceptance:**
  - Exactly one `@automattic/skillsmith` `minor` changeset exists for this line of work; no second changeset was added and no separate `testing-project` bump was created.
  - The changeset body describes the final natural-language-rubric + auto-supplied-skill-agnostic-task model and contains no description of the rubric-by-id `# Rubrics` section as the shipped behavior.
  - `npx tsx scripts/validate-changesets.ts` passes (valid front matter, valid `minor` bump, valid body).
