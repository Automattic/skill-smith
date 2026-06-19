# What

The code phase added recursive scenario discovery, normalized scenario IDs, shared scenario-or-folder filtering, duplicate `scenario.name` validation, CLI usage wording, and a minor changeset.

# Why

This lets users organize scenarios in nested folders and run either specific scenario IDs or whole parent folders while preserving existing name-based reports, progress, self-improvement behavior, and artifact layout.

# How

Discovery now walks every directory beneath `config.paths.scenarios`, emits any directory containing `scenario.yaml`, assigns an `id` equal to the normalized relative path, and keeps `dirName` as an alias. A shared selection module trims, validates, normalizes, de-dupes, and matches filters using exact or segment-aware folder semantics, then the pipeline applies this selection before creating run directories or firing hooks. Duplicate configured scenario names are rejected before agent work using internal name provenance so malformed synthetic stubs keep their per-scenario errors.

# Key decisions

- `scenario.name` remains the identity for reports, progress output, self-improvement, and artifacts.
- Invalid filters fail early and explain that filters are relative to `config.paths.scenarios` and cannot be absolute paths, UNC paths, or contain `..` segments.
- CLI positional arguments continue flowing unchanged into the API path so CLI and API filtering share one implementation.
