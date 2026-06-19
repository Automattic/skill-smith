# What

The code phase added recursive scenario discovery, normalized scenario IDs, shared scenario-or-folder filtering, duplicate `scenario.name` validation, CLI usage wording, a minor changeset, and a testing-project e2e verification helper fix for nested scenario spec paths.

# Why

This lets users organize scenarios in nested folders and run either specific scenario IDs or whole parent folders while preserving existing name-based reports, progress, self-improvement behavior, artifact layout, and e2e failure attribution.

# How

Discovery now walks every directory beneath `config.paths.scenarios`, emits any directory containing `scenario.yaml`, assigns an `id` equal to the normalized relative path, and keeps `dirName` as an alias. A shared selection module trims, validates, normalizes, de-dupes, and matches filters using exact or segment-aware folder semantics, then the pipeline applies this selection before creating run directories or firing hooks. Duplicate configured scenario names are rejected before agent work using internal name provenance so malformed synthetic stubs keep their per-scenario errors. The testing-project e2e verifier now derives failure scenario IDs from all path segments before `e2e.spec.mjs`, anchored after a `scenarios` segment when present, so paths like `blocks/counter/e2e.spec.mjs` map back to `blocks/counter` instead of `counter`.

# Key decisions

- `scenario.name` remains the identity for reports, progress output, self-improvement, and artifacts.
- Invalid filters fail early and explain that filters are relative to `config.paths.scenarios` and cannot be absolute paths, UNC paths, or contain `..` segments.
- CLI positional arguments continue flowing unchanged into the API path so CLI and API filtering share one implementation.
- E2e verification preserves flat-path attribution while supporting nested scenario IDs in Playwright report paths.
