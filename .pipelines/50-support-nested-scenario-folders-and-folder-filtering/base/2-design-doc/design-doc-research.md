# Design Research: Nested scenario folders and folder filtering

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### Approach and component boundaries

Current ownership is concentrated in a few modules. Scenario discovery and the `EnumeratedScenario` shape live in `src/scenarios/enumerate.ts`; discovery currently reads only direct children of `paths.scenarios`, checks `<child>/scenario.yaml`, parses/validates it, and never descends. Parsed scenario types live in `src/config/types.ts`, where `RunScenario` currently carries `{ dirName, scenario }`. Initial filter selection is a private `filterScenarios` helper in `src/pipeline/pipeline.ts`; it trims filters, rejects empty strings, de-dupes exact trimmed strings, matches exact `dirName`, and throws `UserFacingError` for unknown IDs. The public API path is `src/runner.ts` (`run(options)` forwards `options.scenarios` to `runPipeline`), while the CLI path is `bin/skillsmith.mjs` (positionals forwarded unchanged to `run({ scenarios })`). Self-improvement reselection in `src/pipeline/select-scenarios.ts` is intentionally keyed by `scenario.name`, not by directory identity.

Downstream compatibility pressure comes from existing `scenario.name` usage: artifact directories are based on `scenario.name`, iteration report keys are `scenarioName`, progress uses scenario names, and self-improvement report matching/agent filtering use `scenario.name`. There is currently no explicit duplicate `scenario.name` check, so the new duplicate-name requirement should be added before agent work to avoid report/artifact ambiguity rather than changing report identities.

Three implementation options were considered:

1. Minimal reuse of `dirName` as the normalized nested scenario ID. This is the smallest change and preserves flat IDs, but makes the `dirName` name misleading once values contain `/` and does not make the selection identity explicit.
2. Add explicit `id` as the canonical selectable source-path identity while keeping `dirName` as a compatibility alias equal to `id`. This is slightly broader but clarifies the model: `id` is used for discovery/selection/errors, while `scenario.name` remains the report/artifact/progress/self-improvement identity.
3. Introduce a stronger split between discovery records and run records, including fields such as `{ id, sourceDirectory, scenario, error? }`, and convert to run records later. This is the cleanest long-term model but more invasive than the issue needs.

Recommended architecture from the research is option 2: add `id` to discovered/run scenario records, keep `dirName` populated with the same value for compatibility, make discovery recursive and deterministic, move normalization/validation/matching into a shared scenario-selection module under `src/scenarios/`, and call selection plus duplicate-name validation in `runPipeline` immediately after enumeration and before run directory creation. Current pipeline ordering already filters before `mkdirSync(runDirectory)`, so preserving that location keeps empty/invalid/unknown filters and duplicate names before hooks, run directories, or agent work.

Sources: `src/scenarios/enumerate.ts:7-11`, `src/scenarios/enumerate.ts:21-87`; `src/config/types.ts:123-155`; `src/runner.ts:29-38`; `bin/skillsmith.mjs:20-31`, `bin/skillsmith.mjs:74-79`; `src/pipeline/pipeline.ts:82-91`, `src/pipeline/pipeline.ts:448-481`, `src/pipeline/pipeline.ts:496-562`; `src/reports/iteration-report.ts:33-69`; `src/reports/scenario-report.ts:94-103`; `src/progress/tracker.ts:95-111`, `src/progress/tracker.ts:329-333`; `src/pipeline/select-scenarios.ts:45-65`; `src/improvement/context.ts:123-137`; `README.md:37-44`.

### Recursive discovery details

Discovery should replace the one-level `readdirSync(scenariosRoot)` loop with a recursive walk rooted at `join(projectRoot, paths.scenarios)`. Preserve the current behavior that a missing scenarios root returns `[]`. Start walking from children of the scenarios root, not the root itself, so every emitted scenario ID is non-empty and relative to the configured scenarios directory. For each child directory, compute the ID by accumulating directory-name path segments and joining them with literal `/`; do not derive IDs from OS-native relative strings. If the directory contains `scenario.yaml`, parse and emit a scenario record with `id` and `dirName` set to that normalized ID. Always continue recursing into child directories even when the current directory has a valid scenario file, malformed scenario file, or unresolved references.

Ordering should be deterministic by scenario ID. Sort child directory names before recursing for stable traversal and sort final discovered records by ID using a locale-independent comparator such as `a < b ? -1 : a > b ? 1 : 0`, rather than `localeCompare`, to avoid locale/platform drift. No-filter runs use enumeration order for the first iteration, so discovery ordering is the source of deterministic no-filter scenario order.

Malformed YAML, malformed shapes, and unresolved references should preserve the current per-scenario-error model. The existing parser catches YAML errors, shape validation errors, and missing skill/rubric references, creates a stub scenario, attaches an `error`, and continues enumerating. Recursion should turn that logic into a helper that takes the normalized ID and returns an `EnumeratedScenario`, then recurses into children afterward. Pipeline behavior already skips agent work for errored scenarios while reporting the scenario error, and self-improvement selection keeps enumeration-error scenarios, so the design should not turn these into discovery-wide failures.

The current `isDirectorySafe` helper uses `statSync(...).isDirectory()`, which follows symlinks. Recursive traversal should avoid symlink cycles by using directory entries (`readdirSync(dir, { withFileTypes: true })`) and treating only `dirent.isDirectory()` entries as directories. Symlinks and unusual filesystem entries should be ignored as non-directories for recursive discovery. If implementation instead keeps `statSync` following symlinks, it must include a `realpath` visited-set cycle guard.

Useful test seams include direct unit tests for `enumerateScenarios(paths, projectRoot)`, API-level tests through `run({ cwd, scenarios })`, CLI tests through `bin/skillsmith.mjs`, hook fixtures that record `dirName`, and `selectScenarios` tests for self-improvement preservation of enumeration-error scenarios.

Sources: `src/scenarios/enumerate.ts:21-87`, `src/scenarios/enumerate.ts:39-83`, `src/scenarios/enumerate.ts:89-115`; `src/util/fs.ts:8-13`; `src/pipeline/pipeline.ts:82-91`, `src/pipeline/pipeline.ts:143-147`, `src/pipeline/pipeline.ts:305-308`, `src/pipeline/pipeline.ts:513-546`; `src/reports/scenario-report.ts:94-103`; `src/pipeline/select-scenarios.ts:29-31`, `src/pipeline/select-scenarios.ts:45-47`; `src/__tests__/scenarios.test.ts:11-26`; `src/__tests__/scenario-selection.test.ts:113-267`; `src/__tests__/select-scenarios.test.ts:106-124`; `src/__tests__/fixtures/target-project/skillsmith.config.ts:41-44`.

### Filter normalization, validation, matching, and errors

The selection implementation should be a shared pure helper used by `runPipeline`, so CLI and API remain identical through the existing `bin/skillsmith.mjs -> run({ scenarios }) -> runPipeline` path. The current pipeline already filters before run directory creation, so keeping the call at that point preserves pre-hook/pre-agent failure timing.

For each raw filter in user order, trim first and preserve the current exact empty error `Scenario IDs must not be empty.`. Reject absolute/UNC paths before separator normalization so unsafe inputs cannot be collapsed into relative filters. Rejection conditions should include POSIX absolute paths starting with `/`, Windows absolute/root-relative/UNC paths as detected by `path.win32.isAbsolute(trimmed)`, and forward-slash UNC spelling starting with `//`. Then replace backslashes with `/`, collapse repeated separators, remove leading `./` segments, handle `.`/`./` as the root filter represented by `.`, remove trailing slashes except for root, split on `/`, drop harmless `.` segments, and reject any segment exactly equal to `..`. This normalizes examples such as `counter/ -> counter`, `./counter -> counter`, `foo//bar -> foo/bar`, `foo\\bar -> foo/bar`, and `.` or `./ -> .`, while rejecting `/tmp/counter`, `C:\tmp\counter`, `\\server\share`, and `foo/../bar`.

Duplicate filters should be de-duped after trim, normalization, and validation, but before matching. This makes `counter`, `./counter`, and `counter/` one filter while still rejecting invalid raw inputs. Matching should use normalized scenario IDs only, never `scenario.name`. A filter matches when it is `.`; when it exactly equals a scenario ID; or when the scenario ID starts with `filter + "/"`. That gives path-segment ancestor matching without substring matches. For selection, iterate normalized filters in preserved user order, iterate each filter's matches in deterministic scenario-ID order, maintain a selected-ID set, and emit each scenario only at its first match. Compute matches for all filters before returning selection; any normalized filter with no matches is an unknown filter and should fail the run instead of returning partial selection.

Error style should remain `UserFacingError`, which the runner prints without an `Error:` prefix. Empty filters keep the exact current message. Invalid filters should use a clear message such as:

```text
Invalid scenario filter: ../counter

Scenario filters must be relative to config.paths.scenarios and must not be absolute paths, UNC paths, or contain '..' segments.
```

Unknown filters should preserve the current `Unknown scenario(s)` leading style while adding the new folder-filter hint and listing normalized available IDs in deterministic order, for example:

```text
Unknown scenario: missing

Pass a scenario ID or parent folder relative to config.paths.scenarios.

Available scenarios:
- blocks/button
- blocks/counter
- counter
```

Recommended test seams are pure unit exports such as `normalizeScenarioFilter`, `normalizeScenarioFilters`, `scenarioFilterMatches`, and `selectScenariosByFilters`, plus API/CLI integration through the existing `scenario-selection` tests to verify parity and pre-run failure timing.

Sources: `src/pipeline/pipeline.ts:82-91`, `src/pipeline/pipeline.ts:448-481`; `src/runner.ts:39-43`; `src/util/errors.ts:1-6`; `src/scenarios/enumerate.ts:21-37`, `src/scenarios/enumerate.ts:39-83`; `src/__tests__/scenario-selection.test.ts:113-267`; `bin/skillsmith.mjs:20-31`, `bin/skillsmith.mjs:74-80`.

### Compatibility boundaries, duplicate names, docs, and observability

Duplicate `scenario.name` validation should run across all discovered scenarios, not only selected scenarios, because the spec says duplicate names among discovered scenarios must fail and existing downstream identities are name-keyed. The least confusing ordering is: load config and check paths; enumerate all scenarios; normalize/validate raw filter syntax; validate duplicate scenario names across discovered records; then match filters and report unknown filters. Duplicate-name failures should be `UserFacingError`s before run directory creation, hooks, progress, or agent work, and list normalized scenario IDs, for example:

```text
Duplicate scenario.name values are not supported because reports and artifacts are keyed by scenario.name.

Duplicate scenario.name "Counter":
- counter
- blocks/counter
```

The components that must remain keyed by `scenario.name` are the artifact layout (`iteration-N/<scenario.name>/...`), scenario report identity, iteration/top-level report keys, summary display that reads report keys, progress tracking, self-improvement reselection, improver context/failing-skill lookup, verification hook failure contract, and hook/log scopes. The normalized scenario ID should be used for discovery, selection, filter errors, duplicate-name conflict lists, documentation, hook-visible scenario identity (`RunScenario.id` plus existing `dirName` alias), and optionally run logs. Nested IDs should not become report keys or artifact directory names.

User-facing documentation and usage need updates. CLI usage in `bin/skillsmith.mjs` should describe `[scenario-or-folder ...]` and mention that filters are scenario IDs or parent folders relative to `config.paths.scenarios`. README usage should define a scenario ID as the normalized `/`-separated relative path from `config.paths.scenarios` to a directory containing `scenario.yaml`, show examples such as `skillsmith counter`, `skillsmith blocks/counter`, and `skillsmith blocks`, document trimming/normalization/de-dupe/empty/unknown behavior, and state that filters never match `scenario.name`. Lifecycle/artifact docs should clarify that run artifacts and report keys continue to use `scenario.name`, while hook-visible selected scenarios carry normalized IDs. `docs/index.html` examples should also include nested and folder filters.

Failure/observability decisions: enumeration errors keep current per-scenario reporting and skipped/failing behavior; invalid filters, unknown filters, and duplicate names are pre-run `UserFacingError`s; unknown filters list available normalized IDs plus a hint that scenario IDs or parent folders are accepted; selected nested IDs should be visible in run logs or hook context without changing progress/report identities. A changeset is required because the feature changes consumer-visible CLI/filter behavior and likely adds `RunScenario.id`; as an additive feature under `0.x`, this should be a minor changeset unless implementation chooses a breaking semantic.

Sources: `src/pipeline/pipeline.ts:93-115`, `src/pipeline/pipeline.ts:358-361`, `src/pipeline/pipeline.ts:501`, `src/pipeline/pipeline.ts:517-523`; `src/reports/scenario-report.ts:31-36`, `src/reports/scenario-report.ts:94-99`; `src/reports/iteration-report.ts:33-39`, `src/reports/iteration-report.ts:115-145`, `src/reports/iteration-report.ts:153-162`; `src/reports/summary.ts:85-112`, `src/reports/summary.ts:140-148`; `src/progress/tracker.ts:95-111`, `src/progress/tracker.ts:158-169`; `src/pipeline/select-scenarios.ts:6-15`, `src/pipeline/select-scenarios.ts:43-63`; `src/improvement/context.ts:123-136`; `src/config/types.ts:144-155`, `src/config/types.ts:184-194`; `src/improvement/verify.ts:105-123`; `bin/skillsmith.mjs:34-36`; `README.md:37-46`, `README.md:54-55`, `README.md:78-80`, `README.md:204-210`; `docs/index.html:339-353`; `CONTRIBUTING.md:21-52`; `package.json:1-4`.

## Topics

### Topic: End-to-end approach and component boundaries

- **Spec link:** Requirements 1-10, 18-25, 28-31; acceptance criteria for flat/nested discovery, deterministic ordering, CLI/API parity, folder filters, duplicate-name rejection, and compatibility of report/progress/artifact identities.
- **Options:**
  1. Reuse `dirName` as the normalized nested scenario ID everywhere.
  2. Add a canonical `id` field for selectable scenario identity and keep `dirName` as a compatibility alias.
  3. Introduce a larger discovery/run-record split with a richer source-directory model.
- **Trade-offs:** Option 1 is smallest but leaves an ambiguous name for nested IDs. Option 2 adds a small type/interface change while making identity boundaries explicit. Option 3 is architecturally cleanest but increases implementation scope and compatibility risk.
- **Decision:** Use explicit `id` as the canonical normalized scenario ID and retain `dirName` as a compatibility alias equal to `id`. Move filter normalization/validation/matching into a shared `src/scenarios` selection module, call it from `runPipeline` after enumeration and before run directory creation, and keep reports/progress/self-improvement/artifact paths keyed by `scenario.name`.
- **Rationale:** This satisfies nested selection and CLI/API parity while preserving current public behavior for flat IDs and `scenario.name`-based outputs. It also gives downstream code a precise name for source-path selection identity without forcing a report/artifact redesign explicitly ruled out by the spec.

### Topic: Recursive discovery algorithm and invalid scenario handling

- **Spec link:** Requirements 1-9, 28-31; acceptance criteria for flat and nested discovery, parent+child scenarios, grouping folders, non-directories, deterministic no-filter runs, malformed YAML, and unresolved references.
- **Options:**
  1. Depth-first recursive traversal that emits any directory containing `scenario.yaml` and always continues to descendants.
  2. Stop recursion below a discovered scenario directory.
  3. Use a glob-style `**/scenario.yaml` search and derive scenario IDs from matched file paths.
- **Trade-offs:** Option 1 directly satisfies parent+child discovery and grouping-folder traversal. Option 2 is simpler but violates the parent+descendant requirement. Option 3 is concise but would add more path-normalization edge cases and possibly new dependencies or platform-specific behavior.
- **Decision:** Implement explicit recursive traversal from children of `config.paths.scenarios`, accumulating path segments and joining with `/` for IDs. Emit a scenario record for every directory with `scenario.yaml`, continue into descendants regardless of current-directory validity, ignore non-directory entries, avoid following symlinked directories unless guarded by a visited-realpath set, and return records sorted by scenario ID with a locale-independent comparator.
- **Rationale:** This realizes recursive nested discovery while preserving existing per-scenario error behavior and deterministic run order. Segment accumulation avoids platform-specific separators and makes flat IDs unchanged.

### Topic: Filter normalization, matching, and selection order

- **Spec link:** Requirements 10-28; acceptance criteria for CLI/API parity, trimming, normalization, invalid path rejection, exact/folder matching, overlap de-dupe, unknown errors, and directory-ID rather than `scenario.name` selection.
- **Options:**
  1. Extend the current private `filterScenarios` helper in `pipeline.ts`.
  2. Move normalization, validation, and matching into a shared pure `src/scenarios/selection.ts` module and call it from `runPipeline`.
  3. Normalize CLI arguments separately before passing them to `run`, while keeping API filtering in `pipeline.ts`.
- **Trade-offs:** Option 1 is small but leaves difficult-to-unit-test private logic. Option 2 gives one testable implementation shared by CLI/API. Option 3 risks CLI/API drift and violates the spec's same-behavior requirement.
- **Decision:** Create a shared scenario-selection module with pure normalization and matching helpers. Normalize each filter by trimming, rejecting empty/absolute/UNC/traversal inputs, normalizing separators and harmless relative spelling, representing root as `.`, and de-duping normalized filters before matching. Match `.` to all scenarios and otherwise match exact IDs or IDs under `filter + "/"`. Process filters in user order and matches in deterministic ID order, emitting overlapping scenarios only once at their first match.
- **Rationale:** This exactly maps the spec's scenario-or-folder filter semantics to normalized scenario IDs while preserving current pre-run error timing and CLI/API parity.

### Topic: Duplicate `scenario.name` handling and compatibility boundaries

- **Spec link:** Requirements 29-31; acceptance criteria for duplicate-name failure and report/progress/self-improvement/artifact compatibility.
- **Options:**
  1. Allow duplicate names and change reports/artifacts/progress to key by scenario ID.
  2. Validate duplicates only among selected scenarios.
  3. Validate duplicates among all discovered scenarios and preserve all existing `scenario.name`-keyed outputs.
- **Trade-offs:** Option 1 would support more layouts but violates the spec's no-redesign constraint. Option 2 is less disruptive for targeted runs but conflicts with the spec's “among discovered scenarios” wording and leaves ambiguous discovery sets. Option 3 is stricter but preserves compatibility and makes ambiguity fail clearly.
- **Decision:** Validate duplicate `scenario.name` values across all discovered scenarios after filter syntax normalization/validation and before filter matching, run directory creation, hooks, progress, or agent work. Keep reports, progress, self-improvement, hook scopes, and artifact paths keyed by `scenario.name`; use normalized IDs only for selection, conflict lists, docs, and hook-visible metadata.
- **Rationale:** Existing public artifacts and reports depend on `scenario.name`; duplicate names would collide or overwrite. Failing early with conflicting normalized IDs satisfies the spec without redesigning downstream output shapes.

### Topic: Documentation, CLI usage, and changeset

- **Spec link:** Requirements 32-34; acceptance criterion for users understanding nested scenario IDs and folder filters from CLI usage and documentation.
- **Options:**
  1. Update only CLI usage.
  2. Update CLI usage, README selection/lifecycle documentation, and docs landing examples.
  3. Add a separate long-form nested-scenarios guide.
- **Trade-offs:** Option 1 is insufficient for API users and edge cases. Option 2 covers the existing user-facing surfaces without overproducing docs. Option 3 may be useful later but is unnecessary for the feature scope.
- **Decision:** Update CLI usage from `[scenario-dir ...]` to `[scenario-or-folder ...]`; update README to define scenario IDs as relative normalized paths, explain exact and folder filters with nested examples, document trimming/normalization/de-dupe/empty/unknown behavior, clarify filters do not match `scenario.name`, and preserve `scenario.name` artifact/report identity; update `docs/index.html` examples. Record a minor changeset for the consumer-visible feature.
- **Rationale:** The spec requires users to understand nested IDs and folder filters from user-facing docs. A changeset is required by repo convention because this changes CLI/API behavior, not only prose.

### Topic: Failure modes and observability

- **Spec link:** Requirements 8, 12, 16-17, 26-27, 29-31; acceptance criteria for malformed/unresolved scenarios, invalid/empty/unknown filters, duplicate names, and compatible nested run outputs.
- **Options:**
  1. Surface nested IDs broadly by changing reports/progress/artifact identities.
  2. Keep existing identities and surface nested IDs only where selection/debugging needs them: errors, docs, hook context, and optionally run logs.
- **Trade-offs:** Option 1 improves source-path visibility but violates compatibility constraints. Option 2 preserves public output contracts but relies on duplicate-name validation to prevent ambiguity.
- **Decision:** Keep enumeration errors as per-scenario reportable errors; make empty, invalid, unknown, and duplicate-name failures `UserFacingError`s before run side effects; include normalized scenario IDs in unknown available lists and duplicate conflict lists; add `id` to hook-visible scenario records and optionally print run roster entries as `<id> (name: <scenario.name>)` without changing progress/report keys.
- **Rationale:** This preserves current observability for errors and reports while making nested selection debuggable enough for users and tests.

## Open Questions

- The implementation plan should choose exact exported helper names and whether helpers live in a single `src/scenarios/selection.ts` file or split between `ids.ts` and `selection.ts`; the design only requires one shared CLI/API implementation.
- The final invalid-filter message wording can vary, but it must clearly identify the bad filter, state that filters are relative to `config.paths.scenarios`, and mention absolute paths, UNC paths, and `..` traversal segments.

## Risks

- Treating symlinked directories as non-directories avoids recursive cycles but may be a subtle change for users who currently rely on flat symlinked scenario directories; if implementation follows symlinks instead, it must add a visited-realpath cycle guard.
- Validating duplicate `scenario.name` across all discovered scenarios can make a targeted run fail because of duplicates outside the selected filter. This is intentional per spec, but should be documented and tested because it is stricter than selected-only validation.
- Adding `RunScenario.id` is additive but public hook-context surface area; it should be reflected in docs and a changeset.
