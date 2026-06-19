# Design Doc: Nested scenario folders and folder filtering

## Overview

Skillsmith will support scenarios located at any depth below the configured `config.paths.scenarios` directory. A scenario directory is any directory below that root containing `scenario.yaml`; its selectable scenario ID is the directory path relative to the scenarios root, normalized with `/` separators, such as `counter` or `blocks/counter`.

The design adds an explicit normalized scenario `id` for discovery and selection while preserving `scenario.name` as the identity used by reports, progress output, self-improvement, and artifact directories. Discovery becomes recursive and deterministic, and scenario filtering moves into a shared pure selection module so CLI positional arguments and API `run({ scenarios })` use exactly the same scenario-or-folder semantics.

## Approach

Scenario enumeration will walk the configured scenarios root recursively. The walk starts at the root's children, accumulates directory-name path segments, and joins those segments with literal `/` to produce stable scenario IDs independent of the host operating system. Every directory with `scenario.yaml` emits an `EnumeratedScenario` with `id` and compatibility alias `dirName` set to the normalized ID. The walker continues into descendants even if the current directory is itself a scenario, has malformed YAML, or has unresolved references, so parent and child scenarios can coexist and invalid scenarios do not hide valid descendants.

Scenario selection will be centralized in a new shared module under `src/scenarios/`. The module accepts discovered scenario records and raw user filters, trims and validates each filter, normalizes harmless spelling differences, de-dupes normalized filters in user order, and matches filters against normalized scenario IDs. A filter selects a scenario when it is the root filter `.`, exactly equals the scenario ID, or names an ancestor directory of the scenario ID using segment-aware `filter + "/"` matching. Matching never uses `scenario.name`.

`runPipeline` will preserve the current early-failure ordering: load config and paths, enumerate scenarios, normalize/validate filter syntax, validate duplicate `scenario.name` values across all discovered scenarios, match filters, and only then create the run directory, run hooks, start progress, or invoke agents. This keeps empty, invalid, unknown, and duplicate-name failures side-effect-free while retaining the existing per-scenario error behavior for malformed scenario files and unresolved references.

Reports, progress, self-improvement, hook scopes, and artifact paths remain keyed by `scenario.name` to avoid redesigning public output shapes. Normalized IDs are used for discovery, selection, filter errors, duplicate-name conflict lists, hook-visible metadata, and documentation. Duplicate `scenario.name` values are rejected before agent work because existing downstream outputs cannot represent them safely.

## Components

- `src/scenarios/enumerate.ts` — modified to recursively discover scenarios, compute normalized scenario IDs from accumulated path segments, populate both `id` and `dirName`, ignore non-directory entries, preserve per-scenario parse/reference errors, and return deterministic ID-sorted records.
- `src/config/types.ts` — modified so `RunScenario` and related discovered scenario records expose canonical `id: string` while keeping `dirName: string` as a compatibility alias equal to `id`.
- `src/scenarios/selection.ts` or equivalent new module — owns pure filter normalization, validation, de-duping, matching, selection ordering, unknown-filter errors, and duplicate `scenario.name` validation. Exact exported helper names are left to implementation planning, but CLI and API must share this single implementation.
- `src/pipeline/pipeline.ts` — modified to call the shared selection and duplicate-name validation immediately after enumeration and before run directory creation. The existing private `filterScenarios` helper should be removed or reduced to a thin wrapper around the shared module.
- `src/runner.ts` — remains the public API entry point. It continues forwarding `run({ scenarios })` to `runPipeline`, thereby inheriting the shared filter behavior.
- `bin/skillsmith.mjs` — continues forwarding positional arguments unchanged to `run({ scenarios })`; usage text changes from direct scenario directories to scenario-or-folder filters.
- `src/pipeline/select-scenarios.ts`, report modules, progress tracking, self-improvement modules, and artifact layout code — intentionally remain keyed by `scenario.name`. They should receive records that also have `id`, but their existing identity semantics are not redesigned.
- Documentation surfaces (`README.md`, `docs/index.html`, CLI usage) — updated to define normalized relative scenario IDs, exact and folder filters, normalization and error behavior, duplicate handling, and the distinction between selectable IDs and `scenario.name` output identities.
- `.changeset/*.md` — a minor changeset is required because nested discovery and folder filtering are consumer-visible CLI/API behavior changes and `RunScenario.id` is an additive public surface.

## Interfaces and Data Flow

### Scenario record shape

Discovered/run scenario records should carry a canonical normalized ID and the existing directory-name alias:

```ts
type RunScenario = {
  /** Normalized path relative to config.paths.scenarios, using / separators. */
  id: string;
  /** Compatibility alias for id; flat scenarios remain unchanged. */
  dirName: string;
  scenario: Scenario;
  error?: Error;
};
```

For a flat scenario at `scenarios/counter/scenario.yaml`, `id === dirName === "counter"`. For a nested scenario at `scenarios/blocks/counter/scenario.yaml`, `id === dirName === "blocks/counter"`. `scenario.name` remains the configured display/report/artifact identity and is not used for filtering.

### Recursive discovery data flow

1. `enumerateScenarios(paths, projectRoot)` resolves the scenarios root from `projectRoot` and `paths.scenarios`.
2. If the root is missing, it returns `[]`, preserving existing behavior.
3. It reads directory entries with `withFileTypes: true` and processes only `dirent.isDirectory()` entries. Non-directories, symlinks, and unusual filesystem entries are not scenarios and are not recursed into.
4. For each child directory, it appends the child name to the accumulated segment list and computes `id = segments.join("/")`.
5. If `<directory>/scenario.yaml` exists, it parses and validates the scenario. YAML, shape, skill-reference, and rubric-reference failures are captured as a per-scenario `error` on an emitted record, matching current behavior.
6. It continues recursing into child directories regardless of whether the current directory emitted a valid or errored scenario.
7. It returns all records sorted by normalized ID using a locale-independent comparator (`a < b ? -1 : a > b ? 1 : 0`). No-filter runs therefore execute in deterministic scenario ID order.

If implementation chooses to follow symlinked directories instead of ignoring them, it must maintain a `realpath` visited set to avoid cycles. The preferred design is not to follow symlinked directories for recursive discovery.

### Filter normalization and validation

Raw CLI positionals and API `run({ scenarios })` values flow unchanged into `runPipeline`; the shared selection module performs all normalization.

For each raw filter, in user order:

1. Trim leading and trailing whitespace.
2. If the result is empty, throw the existing user-facing message: `Scenario IDs must not be empty.`
3. Reject unsafe path forms before separator normalization:
   - POSIX absolute paths beginning with `/`
   - Windows absolute or root-relative paths detected by `path.win32.isAbsolute(trimmed)`
   - UNC paths, including backslash UNC paths and forward-slash spelling beginning with `//`
4. Replace `\` with `/`.
5. Collapse repeated separators.
6. Remove harmless leading `./` segments and internal `.` segments.
7. Treat `.` and `./` as the scenarios-root filter, represented internally as `.`.
8. Remove trailing slashes except for root.
9. Split on `/` and reject any segment exactly equal to `..`.
10. Join remaining segments with `/` to produce the normalized filter.

Examples:

| Raw filter | Normalized filter | Result |
| --- | --- | --- |
| `counter` | `counter` | valid |
| `./counter` | `counter` | valid |
| `counter/` | `counter` | valid |
| `foo//bar` | `foo/bar` | valid |
| `foo\\bar` | `foo/bar` | valid |
| `.` or `./` | `.` | valid root filter |
| `/tmp/counter` | none | invalid absolute path |
| `C:\\tmp\\counter` | none | invalid Windows absolute path |
| `\\\\server\\share` | none | invalid UNC path |
| `foo/../bar` | none | invalid traversal segment |

After normalization and validation, duplicate normalized filters are removed while preserving first occurrence order.

### Filter matching and selection

Selection receives discovered scenarios sorted by ID and normalized filters in preserved user order.

For a normalized filter `filter` and scenario ID `id`:

```ts
filter === "." || id === filter || id.startsWith(`${filter}/`)
```

This makes folder matching path-segment based, not substring based: `blocks` matches `blocks/counter`, but not `my-blocks/counter` or `blocks-old/counter`. A full scenario ID such as `blocks/counter` selects that scenario and any descendant scenarios under `blocks/counter/`.

For each normalized filter, matching scenarios are considered in deterministic ID order. A selected-ID set prevents duplicate emission. If multiple filters overlap, a scenario is emitted at the first filter that matches it; later filters skip it but may emit their other matches. Unknown filters are detected before returning the selection: if any normalized filter matches no scenario ID and no folder containing scenarios, the run fails rather than producing a partial selection.

### User-facing errors

All selection and duplicate-name failures use `UserFacingError` so the runner prints clear messages without an `Error:` prefix.

Empty filter:

```text
Scenario IDs must not be empty.
```

Invalid filter wording may vary, but must identify the bad filter and state the constraint:

```text
Invalid scenario filter: ../counter

Scenario filters must be relative to config.paths.scenarios and must not be absolute paths, UNC paths, or contain '..' segments.
```

Unknown filters should retain the existing `Unknown scenario` / `Unknown scenarios` leading style while adding folder-filter guidance and deterministic available normalized IDs:

```text
Unknown scenario: missing

Pass a scenario ID or parent folder relative to config.paths.scenarios.

Available scenarios:
- blocks/button
- blocks/counter
- counter
```

Duplicate scenario names fail before agent work and list the duplicate configured name plus conflicting normalized IDs:

```text
Duplicate scenario.name values are not supported because reports and artifacts are keyed by scenario.name.

Duplicate scenario.name "Counter":
- counter
- blocks/counter
```

### Testing strategy

The implementation should include tests at these seams:

- Unit tests for recursive `enumerateScenarios(paths, projectRoot)` covering flat scenarios, nested scenarios, parent-and-child scenarios, grouping directories, non-directories, malformed YAML, unresolved references, ignored symlinks/non-directories, and deterministic ID ordering.
- Unit tests for pure selection helpers covering trimming, empty filters, absolute/UNC/traversal rejection, separator normalization, `.` root filters, duplicate normalized filters, exact matching, folder matching, substring non-matches, overlap de-duping, user-order processing, deterministic per-filter match order, unknown-filter available lists, and `scenario.name` non-matching.
- API integration tests through `run({ cwd, scenarios })` and CLI integration tests through `bin/skillsmith.mjs` using identical filter values to prove parity.
- Pre-run failure timing tests showing empty, invalid, unknown, and duplicate-name failures happen before hooks, run directory creation, progress, or agent work.
- Compatibility tests showing nested scenario success still writes report keys, progress identities, self-improvement identities, and artifact directories based on `scenario.name`.
- Hook/context tests showing selected scenario records expose normalized `id` and compatibility `dirName`.

## Key Decisions

### Decision: Add canonical scenario IDs while preserving `dirName`

- **Choice:** Add `id` as the canonical selectable scenario identity, normalized relative to `config.paths.scenarios`, and keep `dirName` as an alias equal to `id` for compatibility.
- **Alternatives:** Reuse only `dirName`; introduce a broader discovery/run record split with source-directory metadata.
- **Trade-offs:** A new `id` field is a small public type change, but it clarifies selection identity and avoids overloading `dirName` once values contain `/`. A larger model split would be cleaner long term but is more invasive than this feature needs.
- **Traces to:** Requirements 3-4, 10, 28, 30-31; acceptance criteria for flat `counter`, nested `blocks/counter`, CLI/API parity, `scenario.name` non-filtering, and compatible report/progress/artifact identities.

### Decision: Recursive deterministic discovery from path segments

- **Choice:** Walk children under `config.paths.scenarios` recursively, accumulate directory-name segments, emit any directory containing `scenario.yaml`, continue into descendants, ignore non-directory entries, and sort final records by normalized ID using a locale-independent comparator.
- **Alternatives:** Stop recursion once a scenario directory is found; use glob-style `**/scenario.yaml` matching and derive IDs from file paths.
- **Trade-offs:** Explicit recursion is slightly more code than a glob, but avoids new dependencies and path-normalization ambiguity. Continuing below scenario directories is required for parent and child scenarios to coexist.
- **Traces to:** Requirements 1-9; acceptance criteria for nested discovery, parent+child scenarios, non-directories, grouping directories, deterministic no-filter order, malformed YAML, and unresolved references.

### Decision: Preserve per-scenario enumeration errors

- **Choice:** Malformed YAML, invalid scenario shapes, and unresolved skill/rubric references remain per-scenario errors on emitted records while discovery continues to other scenarios and descendants.
- **Alternatives:** Fail the whole discovery pass on the first invalid nested scenario; skip invalid scenario directories entirely.
- **Trade-offs:** Per-scenario errors require stub records and downstream skipped/failing handling, but preserve existing behavior and allow valid scenarios to run in the same invocation.
- **Traces to:** Requirement 8; acceptance criteria for malformed YAML and unresolved references coexisting with valid scenarios.

### Decision: Shared pure filter selection module

- **Choice:** Move trimming, validation, normalization, de-duping, matching, unknown-filter errors, and duplicate-name validation into shared code under `src/scenarios/`, called by `runPipeline` for both CLI and API invocations.
- **Alternatives:** Extend the private `filterScenarios` helper in `pipeline.ts`; normalize CLI arguments separately from API filters.
- **Trade-offs:** A shared module requires modest refactoring and exported test seams, but prevents CLI/API drift and makes edge-case behavior unit-testable.
- **Traces to:** Requirements 10-28; acceptance criteria for CLI/API parity, normalization, invalid path rejection, root filters, exact and folder filters, overlap de-duping, unknown filters, and `scenario.name` non-filtering.

### Decision: Normalize harmless filter spelling but reject unsafe paths

- **Choice:** Trim filters, keep the exact empty-filter error, accept trailing slashes, leading `./`, repeated separators, Windows `\` separators, and `.`/`./` root filters, but reject absolute POSIX paths, Windows absolute/root-relative paths, UNC paths, and any `..` segment before matching.
- **Alternatives:** Use `path.normalize`; accept absolute paths that happen to point inside the scenarios root; reject all filters containing path separators.
- **Trade-offs:** Custom normalization is more explicit than `path.normalize`, but it preserves user-friendly folder spelling while enforcing the spec's relative-only security boundary. Rejecting absolute paths is stricter but avoids ambiguity and traversal risk.
- **Traces to:** Requirements 11-17; acceptance criteria for whitespace errors, `foo//bar`, `foo\bar`, `.`, POSIX absolute, Windows absolute, UNC, and `..` traversal filters.

### Decision: Segment-aware folder matching and first-match emission

- **Choice:** Match filters against normalized scenario IDs using `.` root, exact equality, or `id.startsWith(filter + "/")`; process filters in normalized user order, matches in deterministic ID order, and emit each scenario only once at its first match.
- **Alternatives:** Substring matching; global sort after collecting all matches; emit duplicates for overlapping filters.
- **Trade-offs:** Segment-aware matching avoids surprising matches like `blocks` selecting `my-blocks/counter`. First-match emission preserves user order while keeping output duplicate-free.
- **Traces to:** Requirements 18-25; acceptance criteria for exact filters, folder filters, deterministic folder order, substring non-matches, normalized duplicate filters, overlapping filters, and user-provided order.

### Decision: Fail unknown filters before run side effects

- **Choice:** After normalization and duplicate-name validation, every normalized filter must match at least one scenario or folder containing scenarios; otherwise throw a `UserFacingError` listing available normalized scenario IDs and explaining that scenario IDs or parent folders are accepted.
- **Alternatives:** Ignore unknown filters; run partial selection for known filters and warn about unknown filters.
- **Trade-offs:** Failing fast is stricter, but it prevents accidental incomplete runs and preserves existing unknown-scenario error behavior while teaching the new folder-filter syntax.
- **Traces to:** Requirements 26-27; acceptance criteria for unknown `missing` and filter-by-`scenario.name` being unknown.

### Decision: Reject duplicate `scenario.name` values across all discovered scenarios

- **Choice:** Validate duplicate `scenario.name` values across the full discovered set before filter matching side effects and fail with the duplicate name plus conflicting normalized IDs.
- **Alternatives:** Allow duplicates by redesigning reports/artifacts around scenario IDs; validate duplicates only among selected scenarios.
- **Trade-offs:** Full-set validation can make a targeted run fail because of duplicates outside the selected folder, but the spec requires discovered duplicates to fail and existing name-keyed outputs cannot safely represent duplicates.
- **Traces to:** Requirements 29-31; acceptance criteria for duplicate-name failure and compatible reports, progress, self-improvement, and artifact directories.

### Decision: Keep public outputs keyed by `scenario.name`

- **Choice:** Reports, progress output, self-improvement matching, verification hook failure contracts, hook/log scopes, and artifact directories continue using `scenario.name`; nested source IDs are only added where selection/debugging needs them.
- **Alternatives:** Redesign output keys and artifact layout around normalized scenario IDs.
- **Trade-offs:** Keeping name-based outputs preserves compatibility but requires duplicate-name rejection to avoid ambiguity. ID-based outputs would improve source-path visibility but are explicitly out of scope.
- **Traces to:** Requirements 30-31; acceptance criterion for nested scenario runs preserving report JSON keys, progress identity, self-improvement behavior, and artifact layout.

### Decision: Update existing docs and record a minor changeset

- **Choice:** Update CLI usage, README, and `docs/index.html` to describe scenario IDs as normalized paths relative to `config.paths.scenarios`, exact and folder filters, normalization/de-dupe/error behavior, `scenario.name` non-filtering, and preserved name-based outputs; add a minor changeset.
- **Alternatives:** Update only CLI usage; add a separate long-form guide.
- **Trade-offs:** Updating existing docs covers the surfaces users already read without creating unnecessary new documentation structure. A changeset is required because CLI/API behavior changes.
- **Traces to:** Requirements 32-34; acceptance criterion for users understanding nested scenario IDs and folder filters from CLI usage and documentation.

## Dependencies

- Node.js filesystem APIs: `readdirSync(..., { withFileTypes: true })` for directory traversal and `Dirent.isDirectory()` to avoid following symlinks by default.
- Node.js path APIs: `join` for filesystem paths and `path.win32.isAbsolute` for Windows absolute/root-relative filter detection, even when running on non-Windows hosts.
- Existing Skillsmith config and scenario parsing modules for YAML parsing, shape validation, and skill/rubric reference validation.
- Existing `UserFacingError` utility for clean CLI/API error presentation.
- Existing report, progress, self-improvement, hook, and artifact modules, which remain compatible and name-keyed.
- No new external runtime dependency is required for discovery or filtering.
- A new changeset file is required by repository convention for the consumer-visible feature.

## Failure Modes and Observability

- Missing scenarios root returns an empty discovered set as it does today.
- Non-directory entries, symlinks, and unusual filesystem entries under the scenarios root are ignored for discovery. If symlink traversal is implemented instead, cycle protection via visited realpaths is mandatory.
- Malformed YAML, invalid scenario shapes, and unresolved skill/rubric references produce per-scenario errors on the affected scenario records. Other valid scenarios, including descendants and siblings, remain eligible to run.
- Empty filters fail before matching with `Scenario IDs must not be empty.`
- Absolute, UNC, and traversal filters fail before matching with a clear invalid-filter `UserFacingError`.
- Unknown filters fail before hooks, run directory creation, progress, or agent work, and list deterministic available normalized scenario IDs plus a hint that parent folders may be passed.
- Duplicate `scenario.name` values fail before run side effects and list the duplicate name with conflicting normalized IDs.
- No-filter and filtered selections are deterministic by normalized scenario ID within the relevant filter scope.
- Nested source IDs are observable in selection errors, duplicate-name conflict lists, hook-visible scenario records (`id` and `dirName`), documentation, and optionally run roster logs. They do not replace `scenario.name` in report keys, progress display, self-improvement identity, or artifact directory layout.

## Risks and Open Questions

- Exact exported helper names and file organization for the selection module are intentionally left to implementation planning. The design requirement is a single shared CLI/API implementation with unit-testable pure helpers.
- Invalid-filter message wording can vary, but it must identify the bad filter, state that filters are relative to `config.paths.scenarios`, and mention absolute paths, UNC paths, and `..` traversal segments.
- Ignoring symlinked directories avoids recursive cycles but may surprise users who relied on flat symlinked scenario directories. Following symlinks is acceptable only with explicit cycle protection.
- Validating duplicate `scenario.name` values across all discovered scenarios is stricter than selected-only validation and can fail targeted runs because of unrelated duplicate names. This is intentional per the spec and should be documented and tested.
- Adding `RunScenario.id` is additive but public hook-context surface area. Documentation and the changeset should describe the new normalized ID field and the continued `dirName` alias.
