# Code Plan: Nested scenario folders and folder filtering

## Overview

Implement nested scenario discovery first, then introduce canonical normalized scenario IDs, centralize user filter normalization and folder-aware selection, wire that shared selection into the pipeline before any run side effects, and finally update CLI usage plus the release changeset. Code-writers must work test-first for each task: first add or adjust focused failing coverage for the task's observable behavior, then implement the smallest change that satisfies it, then run the task-specific verification command(s) and the final guardrail suite when integration is complete. This plan intentionally keeps report keys, progress labels, self-improvement identity, and artifact directories based on `scenario.name`; normalized IDs are for discovery, selection, errors, hook-visible scenario records, and duplicate-name diagnostics.

## Tasks

### Task 1: Add canonical scenario IDs to discovered and run scenario types

- **ID:** T1
- **Goal:** Expose a normalized scenario directory ID while preserving `dirName` as a compatibility alias.
- **Files:**
  - `src/config/types.ts`
  - `src/scenarios/enumerate.ts`
  - Any compile-error call sites surfaced by `npm run typecheck` that construct or consume `RunScenario` or `EnumeratedScenario`
- **Changes:**
  - Add `id: string` to `RunScenario` in `src/config/types.ts` with semantics “path relative to `config.paths.scenarios`, normalized with `/` separators”.
  - Add `id: string` to `EnumeratedScenario` in `src/scenarios/enumerate.ts`.
  - Preserve `dirName: string` on both types and treat it as an alias that must always equal `id`.
  - Update any existing construction of `RunScenario` or `EnumeratedScenario` so flat scenarios currently discovered as `counter` have `id === dirName === "counter"`.
  - Do not change `ScenarioContext.scenario`, report key types, progress types, self-improvement inputs, or artifact-directory naming in this task.
- **Depends on:** none
- **Traces to:** Spec requirements 3-4, 28, 30-31; acceptance criteria for flat `counter` IDs, filtering by IDs rather than `scenario.name`, and name-based report/progress/artifact compatibility; design decision “Add canonical scenario IDs while preserving `dirName`”.
- **Acceptance:**
  - Flat scenario records expose `id` and `dirName` with identical values such as `counter`.
  - Existing consumers that receive `RunScenario[]` can access `scenario.id` without losing `dirName`.
  - No public output is renamed from `scenario.name` to the new ID.
  - Task verification: `npm run typecheck` succeeds after the implementation.

### Task 2: Make scenario enumeration recursive and deterministic

- **ID:** T2
- **Goal:** Discover every directory below `config.paths.scenarios` that contains `scenario.yaml`, including nested and parent/child scenarios, while preserving per-scenario error behavior.
- **Files:**
  - `src/scenarios/enumerate.ts`
  - `src/__tests__/scenarios.test.ts`
  - Test fixture directories under `src/__tests__/fixtures/proj1/eval/scenarios/` or additional focused fixture directories under `src/__tests__/fixtures/`
- **Changes:**
  - Replace the current one-level `readdirSync(scenariosRoot)` loop with recursive traversal starting at direct children of the scenarios root.
  - Use `readdirSync(directory, { withFileTypes: true })` and process only entries where `dirent.isDirectory()` is true; non-directories, symlinks, and unusual entries are ignored and not recursed into.
  - Accumulate directory-name path segments and compute `id = segments.join("/")` for every potential scenario directory.
  - When `<directory>/scenario.yaml` exists, emit an `EnumeratedScenario` whose `id` and `dirName` are that normalized ID.
  - Continue recursing into descendants even when the current directory has `scenario.yaml`, malformed YAML, an invalid scenario shape, or unresolved skill/rubric references.
  - Keep the existing per-scenario string `error` behavior for YAML parse errors, malformed shapes, and unresolved references; valid siblings and descendants must still be emitted.
  - Sort the final returned records by normalized ID using a locale-independent comparator (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`).
- **Depends on:** T1
- **Traces to:** Spec requirements 1-9; acceptance criteria for flat discovery, nested discovery, parent-and-child discovery, non-directory ignoring, grouping-directory traversal, deterministic no-filter order, malformed YAML coexistence, and unresolved-reference coexistence; design decisions “Recursive deterministic discovery from path segments” and “Preserve per-scenario enumeration errors”.
- **Acceptance:**
  - `scenarios/counter/scenario.yaml` is discovered as ID `counter`.
  - `scenarios/blocks/counter/scenario.yaml` is discovered as ID `blocks/counter`.
  - If both `scenarios/blocks/scenario.yaml` and `scenarios/blocks/counter/scenario.yaml` exist, both IDs are returned.
  - A grouping directory without `scenario.yaml` is not emitted, but descendant scenarios under it are emitted.
  - Non-directories and symlinked directories under the scenarios root are not emitted as scenarios.
  - Invalid scenario files and unresolved references still produce per-scenario errors without preventing valid discovered scenarios from being returned.
  - Returned records are ordered by normalized ID, so no-filter runs inherit deterministic scenario order.
  - Task verification: `npm test -- src/__tests__/scenarios.test.ts` and `npm run typecheck` succeed after the implementation.

### Task 3: Add shared filter normalization, matching, and duplicate-name validation

- **ID:** T3
- **Goal:** Centralize pure scenario-or-folder filter behavior so CLI and API selection share exactly the same semantics.
- **Files:**
  - `src/scenarios/selection.ts` (new)
  - `src/__tests__/scenario-selection.test.ts` or a new focused unit test file under `src/__tests__/`
  - `src/util/errors.ts` only if additional `UserFacingError` imports or exports are needed; do not change error presentation behavior otherwise
- **Changes:**
  - Create a shared module under `src/scenarios/` that exports pure helpers for:
    - Trimming raw filters and preserving the exact empty-filter error: `Scenario IDs must not be empty.`
    - Rejecting unsafe filters before matching: POSIX absolute paths beginning with `/`, Windows absolute/root-relative paths via `path.win32.isAbsolute(trimmed)`, UNC paths including `\\server\share` and leading `//`, and any `..` segment after separator normalization.
    - Normalizing harmless spelling variations: replace `\` with `/`, collapse repeated separators, remove harmless leading `./` and internal `.` segments, remove trailing slashes except for the root filter, normalize `.` and `./` to internal filter `.`.
    - De-duping normalized filters while preserving first occurrence order.
    - Matching a normalized filter to a scenario ID when `filter === "." || id === filter || id.startsWith(`${filter}/`)`.
    - Selecting scenarios by processing normalized filters in user order, considering matching scenarios in deterministic ID order, and emitting each scenario only at its first match.
    - Detecting unknown filters before returning a selection; errors must retain the existing `Unknown scenario` / `Unknown scenarios` leading style, list available normalized scenario IDs in deterministic order, and explain that users may pass either a scenario ID or parent folder relative to `config.paths.scenarios`.
    - Validating duplicate real configured `scenario.name` values across all discovered scenarios and throwing a `UserFacingError` that lists the duplicate name and conflicting normalized IDs.
  - Ensure duplicate-name validation excludes synthetic stub names from malformed YAML or shape-invalid records but includes unresolved-reference records whose scenario metadata parsed successfully.
  - To support the previous bullet without guessing from `error` strings in future tasks, expose or add a minimal internal marker on enumerated records that distinguishes real configured names from synthetic stub names; keep this marker internal and do not redesign reports.
  - Ensure selection and validation never match on `scenario.name`.
  - Use `UserFacingError` for all empty, invalid, unknown, and duplicate-name failures.
- **Depends on:** T2
- **Traces to:** Spec requirements 10-29; acceptance criteria for CLI/API parity, trimming, empty-filter failures, spelling normalization, root filters, relative-only constraints, exact/folder matching, segment-aware non-matches, duplicate/overlap de-duping, user-order processing, unknown-filter errors, filtering not using `scenario.name`, and duplicate `scenario.name` failures; design decisions “Shared pure filter selection module”, “Normalize harmless filter spelling but reject unsafe paths”, “Segment-aware folder matching and first-match emission”, “Fail unknown filters before run side effects”, and “Reject duplicate `scenario.name` values across all discovered scenarios”.
- **Acceptance:**
  - Filters `counter`, `./counter`, and `counter/` normalize to one effective filter and select `counter` once.
  - `foo//bar` and `foo\bar` select ID `foo/bar`.
  - `.` and `./` select all discovered scenarios.
  - Whitespace-only filters throw `Scenario IDs must not be empty.`
  - POSIX absolute paths, Windows absolute/root-relative paths, UNC paths, and filters with `..` segments throw clear invalid-filter `UserFacingError`s before matching.
  - Folder filter `blocks` selects `blocks/button`, `blocks/counter`, and `blocks/zebra` in ID order, while not selecting `my-blocks/counter` or `blocks-old/counter`.
  - Overlapping filters emit each scenario only at its first matching filter and preserve user-provided normalized filter order for non-overlapping matches.
  - Unknown filters list deterministic available normalized scenario IDs and state that scenario IDs or parent folders may be passed.
  - Filtering by a configured `scenario.name` such as `Counter` is unknown unless a matching scenario directory ID or folder exists.
  - Duplicate real `scenario.name` values fail with the duplicate name and conflicting IDs; malformed/shape-invalid synthetic stub names do not trigger this failure.
  - Task verification: the focused selection tests and `npm run typecheck` succeed after the implementation.

### Task 4: Wire shared selection and duplicate-name validation into the pipeline before side effects

- **ID:** T4
- **Goal:** Ensure API `run({ scenarios })` and CLI positionals use shared scenario-or-folder selection and all selection failures happen before hooks, run directory creation, progress, or agent work.
- **Files:**
  - `src/pipeline/pipeline.ts`
  - `src/runner.ts` only if type forwarding must be adjusted; preserve public API shape
  - `src/__tests__/scenario-selection.test.ts`
- **Changes:**
  - In `runPipeline`, keep the existing ordering of `loadConfig`, `checkPaths`, self-improvement resolution, and `enumerateScenarios`.
  - Immediately after enumeration, call duplicate-name validation across the full discovered set.
  - Replace the private `filterScenarios` helper in `src/pipeline/pipeline.ts` with the shared selection module from T3; remove the old exact-`dirName`-only matching implementation.
  - Preserve no-filter and empty-array behavior as “run all discovered scenarios” in deterministic ID order.
  - Build `runScenarios` from selected scenarios with both `id` and `dirName`, keeping `scenario.name` unchanged.
  - Ensure `RunContext.scenarios` and hook-visible scenario records expose `id` and `dirName` equal to the normalized ID.
  - Keep `runScenario`, reports, progress, self-improvement selection, verification, and artifact paths keyed by `scenario.name`.
  - Ensure empty, invalid, unknown, and duplicate-name failures are thrown before `mkdirSync(runDirectory)`, before progress tracker work, before hooks, and before agent invocation.
- **Depends on:** T3
- **Traces to:** Spec requirements 10, 26-31; acceptance criteria for API/CLI parity, deterministic no-filter runs, pre-side-effect filter failures, duplicate-name pre-agent failure, hook-visible IDs, and compatibility of report/progress/self-improvement/artifact identities; design decisions “Shared pure filter selection module”, “Reject duplicate `scenario.name` values across all discovered scenarios”, and “Keep public outputs keyed by `scenario.name`”.
- **Acceptance:**
  - API and CLI runs with the same filter values select the same normalized scenario IDs.
  - No-filter and `scenarios: []` runs execute all discovered scenarios in deterministic ID order.
  - Empty, invalid, unknown, and duplicate-name failures leave no run directory, call no hooks, and invoke no agents.
  - Hook-visible `RunContext.scenarios` entries include `id` and `dirName` for nested scenarios.
  - A successful nested scenario run still writes report JSON keys, progress output, self-improvement inputs, and artifact directories using `scenario.name`.
  - Task verification: `npm test -- src/__tests__/scenario-selection.test.ts` and `npm run typecheck` succeed after the implementation.

### Task 5: Add end-to-end nested discovery and compatibility coverage

- **ID:** T5
- **Goal:** Prove the integrated feature works through realistic API and CLI runs, including nested source paths and preserved name-based outputs.
- **Files:**
  - `src/__tests__/scenario-selection.test.ts`
  - `src/__tests__/smoke.test.ts` if broad run-output compatibility coverage fits better there
  - Fixture scenario directories under `src/__tests__/fixtures/target-project/eval/scenarios/`
  - Fixture rubrics and skills under `src/__tests__/fixtures/target-project/eval/rubrics/` and `src/__tests__/fixtures/target-project/skills/` only if new fixtures require them
- **Changes:**
  - Extend the target-project fixtures with nested scenarios that have distinct `scenario.name` values and valid existing skill/rubric references.
  - Add integrated coverage showing no-filter runs include nested scenarios in deterministic ID order while reports remain keyed by `scenario.name`.
  - Add integrated coverage for exact nested filters such as `blocks/counter`, parent folder filters such as `blocks`, root filters `.`/`./`, normalized duplicate filters, and overlapping filters in user order.
  - Add integrated coverage for substring non-matches (`blocks` must not select `my-blocks/counter` or `blocks-old/counter`).
  - Add integrated coverage for malformed nested scenarios and unresolved-reference nested scenarios coexisting with valid scenarios.
  - Add integrated coverage for duplicate configured `scenario.name` failures, including the conflicting normalized IDs.
  - Add integrated coverage showing CLI positionals and API `run({ scenarios })` pass through the same selection semantics for matching filters.
  - Keep the tests focused on observable behavior; do not add report-shape redesign expectations.
- **Depends on:** T4
- **Traces to:** All spec acceptance criteria for integrated behavior, especially malformed/unresolved coexistence, CLI/API parity, folder filtering, pre-side-effect errors, duplicate-name failures, and name-based output compatibility; design testing strategy for integration, failure timing, compatibility, and hook/context seams.
- **Acceptance:**
  - Integrated API and CLI checks demonstrate nested scenarios can be selected by exact ID and by ancestor folder.
  - Integrated checks demonstrate invalid, unknown, and duplicate-name failures occur before hooks and run-directory creation.
  - Integrated checks demonstrate nested successful runs retain existing report keys and artifact paths based on `scenario.name`.
  - Task verification: `npm test -- src/__tests__/scenario-selection.test.ts src/__tests__/smoke.test.ts` and `npm run typecheck` succeed after the implementation.

### Task 6: Update CLI usage wording for scenario-or-folder filters

- **ID:** T6
- **Goal:** Ensure command-line help/error usage no longer describes positionals as only direct scenario directories.
- **Files:**
  - `bin/skillsmith.mjs`
  - `src/__tests__/scenario-selection.test.ts`
- **Changes:**
  - Change the usage string emitted when CLI argument parsing fails from `[scenario-dir ...]` to wording that identifies positionals as scenario-or-folder filters, for example `[scenario-or-folder-filter ...]`.
  - Keep CLI argument parsing behavior unchanged: positionals are forwarded unchanged to `run({ scenarios })` so shared selection performs trimming, normalization, validation, and de-duping.
  - Adjust existing CLI parser assertions so they verify the new wording.
- **Depends on:** T4
- **Traces to:** Spec requirements 10 and 34; acceptance criteria for CLI/API parity and users being able to identify scenario-or-folder filters from CLI usage; design component `bin/skillsmith.mjs`.
- **Acceptance:**
  - Unsupported CLI option errors still print usage without an `Error:` prefix.
  - The usage text describes positional arguments as scenario-or-folder filters.
  - CLI positionals are still passed unchanged to the shared API selection path.
  - Task verification: `npm test -- src/__tests__/scenario-selection.test.ts` succeeds after the implementation.

### Task 7: Add the release changeset

- **ID:** T7
- **Goal:** Record the consumer-visible behavior and public type-surface change for release.
- **Files:**
  - `.changeset/nested-scenario-folders.md` (new)
- **Changes:**
  - Add a changeset for `@automattic/skillsmith` with a `minor` bump, because the package is pre-1.0 and this adds consumer-visible CLI/API behavior plus `RunScenario.id` as an additive public surface.
  - Summarize that scenarios are now discovered recursively, filters may target scenario IDs or parent folders, and `RunScenario.id` exposes the normalized relative path while `dirName` remains available as an alias.
  - Do not mark this as `major`.
- **Depends on:** T4
- **Traces to:** Repository convention in `AGENTS.md`; design decision “Update existing docs and record a minor changeset”; spec requirements 1, 10, 32-34 as release-relevant user behavior.
- **Acceptance:**
  - The changeset file exists under `.changeset/` and names `@automattic/skillsmith` with a `minor` bump.
  - The changeset describes recursive discovery, scenario-or-folder filters, and the normalized ID field.
  - Task verification: `npx tsx scripts/validate-changesets.ts` succeeds after the implementation.

### Task 8: Run final guardrails and fix integration regressions

- **ID:** T8
- **Goal:** Verify the full implementation satisfies repository guardrails without expanding scope.
- **Files:**
  - Only files already touched by T1-T7, if guardrails reveal implementation regressions
- **Changes:**
  - Run the full required guardrail suite from the repository root:
    - `npm run typecheck`
    - `npm run lint`
    - `npm test`
    - `npm --prefix testing-project run check:config`
    - `npx tsx scripts/validate-changesets.ts`
  - Fix only defects directly related to the nested discovery, selection, CLI usage, or changeset work above.
  - Confirm no documentation tasks are included in this code phase; README and `docs/index.html` updates belong to the documentation plan.
- **Depends on:** T1, T2, T3, T4, T5, T6, T7
- **Traces to:** All spec acceptance criteria; all design decisions; user-provided guardrails.
- **Acceptance:**
  - All required guardrail commands complete successfully.
  - The final implementation preserves name-based reports, progress, self-improvement behavior, and artifact layout while supporting normalized nested scenario IDs and folder filters.
  - The committed changes include the changeset and do not include unrelated scope.
