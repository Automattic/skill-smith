# Spec: Nested scenario folders and folder filtering

## Overview

Skillsmith users should be able to organize scenarios in nested folders beneath the configured scenarios directory without losing discovery or selection support. Any directory under `config.paths.scenarios` that contains a `scenario.yaml` file is a scenario directory, whether it is a direct child or deeply nested.

Users should also be able to limit a run to a specific scenario directory or to all scenarios beneath a parent folder, using the same positional CLI arguments and API `run({ scenarios })` filters that already exist. Filters are relative to `config.paths.scenarios`, use normalized `/`-separated scenario IDs, and preserve existing flat-scenario behavior.

## Requirements

1. Skillsmith must discover scenarios recursively under the configured `config.paths.scenarios` directory.
2. A scenario directory is any directory under `config.paths.scenarios` that contains `scenario.yaml`, regardless of nesting depth.
3. Existing flat scenarios must remain compatible: a scenario at `scenarios/counter/scenario.yaml` must remain selectable as `counter`.
4. Each discovered scenario must have a stable selectable scenario ID equal to the scenario directory path relative to `config.paths.scenarios`, normalized with `/` separators, such as `counter` or `blocks/counter`.
5. If a parent directory and one or more descendant directories each contain `scenario.yaml`, all of those scenarios must be discovered.
6. Non-directories must not be treated as scenarios.
7. Directories without `scenario.yaml` must not be treated as scenarios, but their descendants must still be eligible for discovery.
8. Existing invalid-scenario behavior must be preserved: malformed scenario files or unresolved references must surface as per-scenario errors while other valid discovered scenarios can still run.
9. Discovery and no-filter runs must use deterministic scenario ordering by scenario ID.
10. CLI positional arguments and API `run({ scenarios })` values must accept the same scenario-or-folder filter syntax and produce the same scenario selection behavior.
11. Each filter must be trimmed before validation and matching.
12. Empty-after-trim filters must fail before hooks, run directory creation, or agent work with the existing `Scenario IDs must not be empty.` style of error.
13. Filter normalization must accept harmless folder spelling variations: trailing slashes, leading `./`, repeated separators, and Windows `\` separators.
14. Normalized filters must use `/` separators.
15. A filter of `.` or `./` must select the scenarios root, equivalent to selecting all discovered scenarios.
16. Filters must be constrained to `config.paths.scenarios`.
17. Absolute POSIX paths, absolute Windows paths, UNC paths, and filters containing any `..` traversal segment must fail before matching with a clear validation error.
18. A normalized filter must match a scenario when it exactly equals the scenario ID or when it names an ancestor folder of the scenario ID.
19. Folder filter matching must be path-segment based, not substring based.
20. A full scenario ID filter such as `blocks/counter` must select that scenario and any descendant scenarios beneath that exact directory, if such descendants exist.
21. A folder filter such as `blocks` must select all discovered scenarios under `blocks/` and must not select unrelated IDs such as `my-blocks/counter` or `blocks-old/counter`.
22. Multiple filters must select the union of all matching scenarios.
23. Overlapping or duplicate filters must be de-duped after normalization.
24. When filters are provided, selected scenarios must preserve the user's first selected order after normalization and de-duping.
25. Unknown filters that match no scenario ID and no folder containing scenarios must fail before hooks, run directory creation, or agent work.
26. Unknown-filter errors must list available normalized scenario IDs and make clear that users may pass either a scenario ID or a parent folder filter.
27. Scenario selection must be based on scenario directory IDs, not on `scenario.name` values from `scenario.yaml`.
28. Duplicate `scenario.name` values among discovered scenarios must fail clearly before agent work, listing the duplicate name and the conflicting scenario IDs.
29. Existing report JSON keys, progress identity, self-improvement behavior, and artifact directory layout based on `scenario.name` must remain compatible.
30. This feature must not redesign reports or move artifacts into directories based on nested source paths.
31. User-facing documentation and CLI usage must define scenario IDs as relative paths from `config.paths.scenarios`.
32. User-facing documentation and CLI usage must explain exact scenario filters and folder filters with nested examples, and must describe trimming, normalization, duplicate handling, empty-filter errors, and unknown-filter errors.
33. CLI usage wording must describe positional arguments as scenario-or-folder filters rather than only direct scenario directories.

## Out of Scope

- Playwright-compatible regex filtering semantics.
- File-level or line-level selection, such as filtering by `scenario.yaml` or `scenario.yaml:42`.
- Filtering by scenario title or by `scenario.name`.
- Glob syntax.
- Accepting absolute paths as scenario filters.
- Accepting `..` traversal in scenario filters.
- Agent filtering or project filtering.
- Redesigning report JSON shapes, progress identity, self-improvement identity, or artifact directory layout.
- Supporting duplicate `scenario.name` values in one discovered scenario set.

## Acceptance Criteria

- Given a flat scenario at `scenarios/counter/scenario.yaml`, when Skillsmith discovers scenarios, then `counter` is discovered with scenario ID `counter`.
- Given a nested scenario at `scenarios/blocks/counter/scenario.yaml`, when Skillsmith discovers scenarios, then `blocks/counter` is discovered with scenario ID `blocks/counter`.
- Given scenarios at `scenarios/blocks/scenario.yaml` and `scenarios/blocks/counter/scenario.yaml`, when Skillsmith discovers scenarios, then both `blocks` and `blocks/counter` are discovered.
- Given a non-directory entry under `config.paths.scenarios`, when Skillsmith discovers scenarios, then that entry is not treated as a scenario.
- Given a grouping directory without `scenario.yaml` that contains descendant scenarios, when Skillsmith discovers scenarios, then the grouping directory is not treated as a scenario and its descendant scenarios are discovered.
- Given discovered scenario IDs in nested folders, when Skillsmith runs with no filters, then scenarios run in deterministic scenario ID order.
- Given one discovered scenario has malformed YAML and another discovered scenario is valid, when Skillsmith runs all scenarios, then the malformed scenario surfaces as a per-scenario error and the valid scenario can still run.
- Given CLI positional filters and API `run({ scenarios })` filters with the same values, when Skillsmith selects scenarios, then both entry points select the same scenario IDs.
- Given the filter `counter`, when a flat scenario ID `counter` exists, then only `counter` and any descendants beneath `counter/` are selected.
- Given the filter `blocks/counter`, when scenario ID `blocks/counter` exists, then `blocks/counter` is selected.
- Given the folder filter `blocks`, when scenarios `blocks/counter` and `blocks/button` exist, then both are selected.
- Given the folder filter `blocks`, when scenario IDs `my-blocks/counter` and `blocks-old/counter` also exist, then those unrelated scenarios are not selected.
- Given filters `counter`, `./counter`, and `counter/`, when scenario ID `counter` exists, then `counter` is selected once.
- Given filter `foo//bar`, when scenario ID `foo/bar` exists, then `foo/bar` is selected.
- Given filter `foo\bar`, when scenario ID `foo/bar` exists, then `foo/bar` is selected.
- Given filter `.` or `./`, when scenarios are discovered, then all discovered scenarios are selected.
- Given a filter containing only whitespace, when Skillsmith starts scenario selection, then it fails before hooks, run directory creation, or agent work with `Scenario IDs must not be empty.`
- Given a POSIX absolute path filter, when Skillsmith starts scenario selection, then it fails before matching with a clear validation error.
- Given a Windows absolute path filter, when Skillsmith starts scenario selection, then it fails before matching with a clear validation error.
- Given a UNC path filter, when Skillsmith starts scenario selection, then it fails before matching with a clear validation error.
- Given a filter containing a `..` traversal segment, when Skillsmith starts scenario selection, then it fails before matching with a clear validation error.
- Given filters `blocks` and `blocks/counter`, when both filters match `blocks/counter`, then `blocks/counter` is selected once.
- Given multiple filters that match scenarios in a user-provided order, when Skillsmith selects scenarios, then the selected scenario order follows the user's first selected order after normalization and de-duping.
- Given an unknown filter `missing`, when Skillsmith starts scenario selection, then it fails before hooks, run directory creation, or agent work, lists available normalized scenario IDs, and explains that a scenario ID or parent folder may be passed.
- Given a discovered scenario whose `scenario.name` is `Counter`, when the user filters by `Counter` but no scenario directory ID or parent folder `Counter` exists, then the filter is unknown.
- Given two discovered scenarios have the same `scenario.name`, when Skillsmith starts a run, then it fails before agent work and lists the duplicate name and the conflicting scenario IDs.
- Given a nested scenario runs successfully, when reports, progress output, self-improvement behavior, and artifact directories are produced, then their existing `scenario.name`-based identities and layout remain compatible.
- Given users read the CLI usage and documentation, when they need to run nested scenarios, then they can identify that scenario IDs are relative paths from `config.paths.scenarios` and that parent folders can be used as filters.
