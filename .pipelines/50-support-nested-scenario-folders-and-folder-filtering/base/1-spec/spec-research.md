# Spec Research

## Rough Idea

# Support nested scenario folders and folder filtering

> Source: GitHub issue #50: https://github.com/Automattic/skillsmith/issues/50.
> This file is self-contained; agents do not need to open the source issue.

## Goal

Skillsmith consumers can organize scenarios in nested folders under `scenarios/`, and Skillsmith still discovers and runs them. Consumers can also filter runs to scenarios inside a specific folder, similar to Playwright's folder-based filtering.

## Assumptions / directions to explore

Treat the Playwright behavior as a useful model, but confirm during spec/design whether Skillsmith should match it exactly or only support the same core workflow.

## Q&A

### Q1: How does Skillsmith currently discover scenario files and accept scenario filters, and what observable behavior exists for flat folders, nested folders, and CLI path arguments today?

**A:** Skillsmith currently discovers scenarios only as one-level-flat directories under `config.paths.scenarios`: it reads direct children of the configured scenarios root, looks for `<child>/scenario.yaml`, and does not recurse. The scenario filter ID is the direct folder name (`dirName`), while run/report output uses `scenario.name` from YAML. Filters are accepted through the API as `run({ scenarios: [...] })` and through CLI positional args such as `skillsmith counter config-fetch`. No filters or an empty list run all discovered scenarios. Filters are trimmed, empty-after-trim filters are rejected, duplicate filters are de-duped preserving first occurrence, and filters match exactly against discovered direct directory names. Flat folders such as `eval/scenarios/counter/scenario.yaml` are discovered and selectable as `counter`. Nested folders such as `eval/scenarios/group/case/scenario.yaml` are ignored unless `group/scenario.yaml` also exists, and arguments like `group/case`, `case`, `eval/scenarios/counter`, `./eval/scenarios/counter`, absolute paths, or `counter/` are not normalized to IDs and would be unknown. Unsupported option-like args such as `--scenario counter` fail in the parser before a run starts.

**Reasoning:** `enumerateScenarios()` uses `readdirSync(scenariosRoot)` and checks only `join(scenariosRoot, entry, "scenario.yaml")`, storing `dirName: entry`. `filterScenarios()` builds a map by `dirName`, trims/de-dupes raw filters, rejects empty strings, and throws a user-facing unknown-scenario error when a filter is not an exact `dirName`. Tests confirm flat-folder behavior and filter semantics.

**Sources:** `src/scenarios/enumerate.ts:21-87`; `src/pipeline/pipeline.ts:85-88`; `src/pipeline/pipeline.ts:448-480`; `src/pipeline/pipeline.ts:496-560`; `bin/skillsmith.mjs:20-35`; `bin/skillsmith.mjs:74-79`; `src/runner.ts:6-15,29-38`; `README.md:31-44`; `src/__tests__/scenarios.test.ts:11-26`; `src/__tests__/scenario-selection.test.ts:113-267`; command `node --import tsx --test "src/__tests__/scenarios.test.ts"` passed.

### Q2: What folder-filtering behavior should Skillsmith expose for nested scenarios when modeled after Playwright, and which parts should be exact requirements versus out of scope?

**A:** Skillsmith should expose Playwright-like positional folder filters as literal scenario-directory path filters, not Playwright's full regex/file/test filtering model. The CLI/API shape should remain `skillsmith <scenario-or-folder> [more...]` and `run({ scenarios: ["<scenario-or-folder>", ...] })`. Filters should be relative to `config.paths.scenarios`; a filter such as `blocks/counter` refers to `${projectRoot}/${config.paths.scenarios}/blocks/counter`. A folder filter selects all descendant scenarios, so `skillsmith blocks` runs scenarios under `blocks/`. A full relative scenario directory selects one scenario. Matching should be exact-or-descendant path matching, not substring matching. Multiple filters should union and de-dupe. Empty and unknown filters should remain pre-run user-facing errors. Scenario selection identity should remain directory-based, but nested selectable IDs should be normalized relative directory paths such as `blocks/counter` rather than `scenario.name`.

Out of scope: Playwright regex semantics; file-level or line-level selection such as `scenario.yaml` or `scenario.yaml:42`; title/name grep or filtering by `scenario.name`; glob syntax; absolute paths or `..` traversal; and agent/project filtering.

**Reasoning:** Current Skillsmith selection is top-level-only and exact-match. Playwright's useful model here is the user-facing convention that passing a directory runs tests beneath that directory; copying all of Playwright's filter semantics would add complexity not implied by the issue.

**Sources:** `README.md:37-46`; `README.md:54-55`; `src/runner.ts:6-14`, `src/runner.ts:29-38`; `bin/skillsmith.mjs:20-30`, `bin/skillsmith.mjs:74-79`; `src/scenarios/enumerate.ts:13-38`; `src/pipeline/pipeline.ts:448-480`; `src/__tests__/scenario-selection.test.ts:135-203`, `221-267`; Playwright CLI docs <https://playwright.dev/docs/test-cli>; Playwright running tests docs <https://playwright.dev/docs/running-tests#run-specific-tests>.

### Q3: For nested discovery itself, what observable behavior should be required for nested folders, parent folders that also contain scenarios, ordering, duplicate names, and invalid/non-scenario directories?

**A:** Nested discovery should recurse under `config.paths.scenarios` and discover any directory containing `scenario.yaml`, not only immediate children. The scenario's selection ID should be its relative directory path under `paths.scenarios` (for example `blocks/counter`), preserving the existing directory-ID contract. If a parent folder contains `scenario.yaml` and child folders also contain scenarios, both the parent scenario and child scenarios should be included; finding a parent scenario should not stop traversal. Discovery order should be deterministic, preferably sorted by relative directory ID. Explicit user filters should continue to preserve user-provided order after trimming and de-duping. Duplicate parsed `scenario.name` values should fail clearly before ambiguous execution, listing the duplicate name and directory IDs, because downstream artifacts and reports use `scenario.name`. Non-directories should be ignored. Directories without `scenario.yaml` should be ignored as scenarios but traversed as grouping folders. Directories with malformed/unparseable `scenario.yaml` or unresolved references should remain included as per-scenario errors, while other valid scenarios continue to run.

**Reasoning:** Current discovery only walks `paths.scenarios/*/scenario.yaml`, so nested support is an extension. The stable user-facing selector today is `dirName`, not `scenario.name`; for nested scenarios, the minimal compatible extension is to make `dirName` a relative path. Downstream behavior uses `scenario.name` for run artifact directories and report keys, so duplicate names must be rejected to avoid overwrite/collision. Invalid scenario YAML already remains visible as a skipped/failing scenario instead of aborting all discovery, while directories without `scenario.yaml` are currently ignored.

**Sources:** `src/scenarios/enumerate.ts:13-20`, `33-38`; `src/scenarios/enumerate.ts:42-58`, `75-83`; `README.md:37-44`; `src/pipeline/pipeline.ts:456-480`; `src/__tests__/scenario-selection.test.ts:173-203`, `245-255`; `src/pipeline/pipeline.ts:501-560`; `src/reports/iteration-report.ts:35-58`; `testing-project/eval/utils/verify-e2e.ts:34-40`; `src/__tests__/scenario-report.test.ts:18-33`.

### Q4: What path normalization, validation, error-message, and backward-compatibility behavior should be required for folder filters across CLI and API?

**A:** Scenario folder filters should use one shared CLI/API normalization and validation path. Each CLI positional/API string should be trimmed. Empty-after-trim values should keep the current error, `Scenario IDs must not be empty.` Separators should normalize to `/`, accepting Windows `\` as a user-input separator. Harmless relative syntax should be stripped or collapsed: `counter/` to `counter`, `./counter` to `counter`, `foo//bar` to `foo/bar`, and `foo\bar` to `foo/bar`. `.` or `./` should be treated as the scenarios root filter, equivalent to selecting all scenarios. Unsafe paths should be rejected before matching: POSIX absolute paths, Windows absolute paths, UNC paths, and any traversal segment (`..`, `../x`, `x/../y`). Matching should remain against scenario directory IDs relative to `config.paths.scenarios`, not `scenario.name`. Existing flat IDs such as `counter` must keep selecting `eval/scenarios/counter/scenario.yaml`. De-duping should occur after normalization, so `counter`, `./counter`, and `counter/` run once. Unknown filters should fail before hooks/agent work and list available normalized scenario IDs while preserving the current style, e.g. `Unknown scenario: missing` or `Unknown scenarios: missing, absent` followed by an `Available scenarios:` list.

**Reasoning:** Current behavior is exact, trimmed directory-ID matching only, with no path normalization beyond `.trim()`. Existing tests and README establish the compatibility floor: empty/no filter runs all; values are trimmed; duplicates are de-duped; unknown IDs fail before hooks and list available directory IDs; matching uses directory names, not `scenario.name`. For folder filters, benign path spelling should work naturally for CLI/API users, while absolute paths and `..` should be validation errors because filters are intended to stay inside `config.paths.scenarios`.

**Sources:** `src/pipeline/pipeline.ts:448-480`; `src/pipeline/pipeline.ts:82-90`; `src/scenarios/enumerate.ts:21-86`; `src/runner.ts:6-14`, `src/runner.ts:29-38`; `bin/skillsmith.mjs:20-31`, `bin/skillsmith.mjs:74-79`; `src/__tests__/scenario-selection.test.ts:135-203`, `:215-267`; `README.md:37-46`; probe command `node --import tsx -e ...` observed current unknown errors for `counter/`, `./counter`, `.`, `./`, `../counter`, `/tmp/counter`, `counter\`, and `eval/scenarios/counter`.

### Q5: Which user-visible outputs and documentation should change so nested scenario IDs and folder filters are understandable and verifiable?

**A:** Documentation and user-facing output should make nested scenario IDs and folder filters understandable. README usage/lifecycle docs should define a scenario ID as the relative path from `config.paths.scenarios` to a directory containing `scenario.yaml` (for example `blocks/counter`), document that passing `blocks` selects all descendant scenarios, and clarify matching, trimming, duplicate handling, and empty filters. CLI usage should change from `[scenario-dir ...]` to something like `[scenario-or-folder ...]`. Unknown-filter errors should list nested relative IDs and explain that users can pass a scenario ID or parent folder. Console summaries, `summary.txt`, report JSON, run logs, progress/failure displays, and artifact paths should expose the stable nested scenario ID wherever users need to verify which scenario ran; if `scenario.name` remains useful, it should be secondary metadata. Tests should cover nested enumeration, exact nested ID filters, folder filters, overlapping filter de-dupe, empty/unknown pre-run errors, CLI usage wording, report/summary display of nested IDs, artifact locations, and hook-visible scenario records.

**Reasoning:** Current docs and outputs are built around one-level scenario directories and often use `scenario.name` as visible identity. Nested IDs and folder filters would be confusing unless the selector-visible ID is consistently exposed where users select, inspect, or debug scenarios. The most important change is to make the relative path scenario ID visible in docs, errors, summaries, logs, progress, and artifacts enough that users can tell what ran.

**Sources:** `README.md:37-46`; `README.md:54-56`; `README.md:69-72`, `98-112`, `138-165`; `README.md:204-210`; `bin/skillsmith.mjs:20-36`; `src/scenarios/enumerate.ts:13-16`, `33-37`; `src/pipeline/pipeline.ts:448-480`; `src/pipeline/pipeline.ts:300-304`, `358-360`, `496-562`; `src/reports/scenario-report.ts:31-35`, `94-103`; `src/reports/iteration-report.ts:33-69`, `153-162`; `src/reports/summary.ts:85-107`, `123-149`, `152-246`; `src/progress/tracker.ts:10-13`, `95-110`, `158-168`, `180-196`; `src/__tests__/scenario-selection.test.ts:113-203`, `245-267`; `src/__tests__/summary.test.ts:40-79`, `121-177`, `255-286`; `src/__tests__/scenario-report.test.ts:18-33`.

### Q6: Are changes to report keys, artifact directory layout, and duplicate `scenario.name` handling necessary requirements for nested folder filtering, or should they be constrained to preserve existing report/artifact compatibility?

**A:** Changes to report keys and artifact directory layout should not be requirements for issue #50. Scope should preserve existing report/artifact compatibility. The minimum requirements are recursive discovery, relative directory paths as selectable/filterable IDs, exact scenario-directory and folder-prefix filters, continued use of `scenario.name` as the existing report/progress/self-improvement identity, current artifact/report layout such as `iteration-N/<scenario.name>/<agent>/...`, and clear pre-run handling for duplicate `scenario.name` values instead of silently changing report keys to path IDs.

**Reasoning:** Issue #50 asks for nested scenario folders and folder filtering similar to Playwright's folder-based filtering; it does not ask for report or artifact redesign. Skillsmith already separates selection identity (`dirName`) from report identity (`scenario.name`). Downstream public data shapes use `scenario.name` broadly, and changing them would shift documented semantics and run layout. The repository's versioning policy treats report JSON shape/layout changes and same-named field semantic shifts as release-relevant/breaking. Duplicate `scenario.name` is the compatibility pressure point; supporting duplicates would require a larger report/artifact redesign, so duplicate names should remain unsupported and fail clearly.

**Sources:** Issue #50 goal; Playwright CLI docs <https://playwright.dev/docs/test-cli>; `README.md:37-45`; `README.md:56-71`; `README.md:96-112`, `README.md:138-165`; `src/scenarios/enumerate.ts:7-15`, `src/scenarios/enumerate.ts:33-83`; `src/pipeline/pipeline.ts:448-480`; `src/pipeline/pipeline.ts:496-562`; `src/reports/iteration-report.ts:33-70`; `src/reports/scenario-report.ts:31-35`, `src/reports/scenario-report.ts:94-103`; `src/reports/summary.ts:85-112`; `src/improvement/context.ts:79-137`; `src/improvement/verify.ts:105-139`; `CONTRIBUTING.md:21-32`, `CONTRIBUTING.md:41-51`; `package.json:1-4`.

## Research

No separate research requests were recorded outside the Q&A above; each answer includes codebase and documentation research with sources.

## Consolidated Requirements

1. Skillsmith must discover scenarios recursively under the configured `config.paths.scenarios` directory, treating every directory that contains `scenario.yaml` as a scenario directory regardless of nesting depth.
2. Skillsmith must continue to discover and run existing flat scenarios exactly as before, so a flat scenario at `scenarios/counter/scenario.yaml` remains selectable with the filter `counter`.
3. Each discovered scenario must have a stable selectable scenario ID equal to its normalized relative directory path from `config.paths.scenarios`, using `/` separators, such as `counter` or `blocks/counter`.
4. Discovery must include both a parent directory scenario and descendant directory scenarios when both contain `scenario.yaml`; finding `parent/scenario.yaml` must not prevent discovery of `parent/**/scenario.yaml`.
5. Discovery must ignore non-directories and treat directories without `scenario.yaml` as grouping folders to traverse, not as scenarios.
6. Existing invalid-scenario behavior must be preserved: malformed scenario YAML or unresolved references must surface as per-scenario errors while other valid discovered scenarios can still run.
7. Discovery and no-filter runs must use deterministic scenario ordering by scenario ID so repeated runs are predictable.
8. CLI positional arguments and API `run({ scenarios })` values must accept the same scenario-or-folder filter syntax and produce the same selection behavior.
9. Each filter must be trimmed; an empty-after-trim filter must fail before hooks, run directory creation, or agent work with the existing `Scenario IDs must not be empty.` style of error.
10. Filter normalization must accept harmless folder spelling variations: trailing slashes, leading `./`, repeated separators, and Windows `\` separators must normalize to `/`-separated scenario IDs.
11. A filter of `.` or `./` must select the scenarios root and therefore match all discovered scenarios.
12. Filters must be constrained to `config.paths.scenarios`: absolute POSIX paths, absolute Windows paths, UNC paths, and any `..` traversal segment must fail before matching with a clear validation error.
13. A normalized filter must match a scenario when it is exactly equal to the scenario ID or when it names an ancestor folder of that scenario ID; matching must be path-segment based, not substring based.
14. A full scenario ID filter such as `blocks/counter` must select only that scenario unless other descendant scenarios exist beneath that exact directory.
15. A folder filter such as `blocks` must select all discovered descendant scenarios under `blocks/` and must not select unrelated IDs such as `my-blocks/counter` or `blocks-old/counter`.
16. Multiple filters must select the union of all matching scenarios while de-duping overlaps after normalization, preserving the user's first selected order.
17. An unknown filter that matches no scenario ID and no folder containing scenarios must fail before hooks, run directory creation, or agent work, and must list available normalized scenario IDs.
18. Scenario selection must remain based on scenario directory IDs, not `scenario.name` values from `scenario.yaml`.
19. Duplicate `scenario.name` values among discovered scenarios must fail clearly before agent work, listing the duplicate name and the scenario IDs that conflict, because existing reports and artifacts use `scenario.name` as their identity.
20. Existing report JSON keys, progress identity, self-improvement behavior, and artifact directory layout based on `scenario.name` must remain compatible; this feature must not redesign reports or move artifacts to nested source-path directories.
21. User-visible documentation and CLI usage must define scenario IDs as relative paths from `config.paths.scenarios`, explain exact scenario filters and folder filters with nested examples, and update usage wording from scenario-only directories to scenario-or-folder filters.
22. Unknown-filter messaging must make clear that users may pass either a scenario ID or a parent folder filter and must show nested scenario IDs in the available list.
23. The implementation must include acceptance coverage for recursive discovery, flat-scenario backward compatibility, exact nested scenario filters, folder filters, overlapping filter de-dupe, normalization cases, invalid path rejection, empty and unknown pre-run errors, parent-and-child scenario discovery, duplicate `scenario.name` rejection, and updated docs/CLI usage.
