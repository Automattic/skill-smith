# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed: DP1 — Update README usage for nested scenario IDs and scenario-or-folder filters; DP2 — Update README lifecycle, hooks, and output identity documentation; DP3 — Refresh the docs landing page usage examples; DP4 — Audit public comments and examples for identity terminology drift; DP5 — Validate and align release documentation

## Summary

The docs batch satisfies the plan across the README, docs landing page, public comments, e2e helper comments, and release changeset. The user-facing docs describe normalized relative scenario IDs, exact and folder filters, harmless normalization, de-duping, empty/unsafe/unknown failures, and the `scenario.name` boundary without inventing glob/name/absolute-path filtering; maintainer-facing comments and the changeset match the shipped recursive discovery, shared selection, hook-visible `id`/`dirName`, and preserved name-keyed outputs.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass |
| changeset-status | `npx changeset status --since=origin/trunk` | pass |

## Accuracy spot-check

- **DP1:** README usage says CLI positionals and API `run({ scenarios })` share exact scenario ID and parent-folder filter semantics, normalize `./counter`, `counter/`, `foo//bar`, and `foo\bar`, de-dupe overlaps, reject empty/unsafe/unknown filters, and do not match `scenario.name`. This matches `src/scenarios/selection.ts`: `normalizeScenarioFilter` trims, rejects empty with `Scenario IDs must not be empty.`, rejects absolute/UNC/`..`, replaces backslashes with `/`, drops empty and `.` segments, returns `.` for root; `normalizeScenarioFilters` de-dupes in first occurrence order; `matchesScenarioFilter` uses `filter === "." || id === filter || id.startsWith(`${filter}/`)`; unknown messages list available IDs and say to pass a scenario ID or parent folder.
- **DP2:** README lifecycle and hook sections state run-level `scenarios` records expose `id`, `dirName`, and parsed `scenario`, while reports, progress, self-improvement scopes, verification failures, and artifact directories remain keyed by `scenario.name`. This matches `src/config/types.ts` `RunScenario` (`id`, `dirName`, `scenario`), `src/pipeline/pipeline.ts` passing `{ id, dirName, scenario }` into `RunContext.scenarios`, scenario directories created from `scenario.name`, and `VerificationFailure.scenario` remaining a `string` report key.
- **DP3:** `docs/index.html` tells readers nested paths are discovered, shows `skillsmith blocks/counter` as a normalized nested scenario ID, and `skillsmith blocks` as a parent-folder filter, with no mention of scenario-name, glob, regex, or absolute-path filtering. This is consistent with the CLI usage string in `bin/skillsmith.mjs`, which names positionals `[scenario-or-folder-filter ...]`.
- **DP4:** Public comments in `src/config/types.ts` and `src/scenarios/enumerate.ts` document `id` as the stable normalized source-directory identifier and `dirName` as an alias equal to `id`; the implementation sets `dirName: id` for parse-error, shape-error, unresolved-reference, and valid records in `src/scenarios/enumerate.ts`. `testing-project/eval/utils/verify-e2e.ts` comments now say iteration directories are `scenario.name`-keyed while spec paths use normalized `dirName`, matching `nameToDir`, `dirToName`, and `join("eval", "scenarios", dirName, "e2e.spec.mjs")`.
- **DP5:** `.changeset/nested-scenario-folders.md` uses a `minor` bump for `@automattic/skillsmith` and claims recursive discovery, CLI/API scenario-ID or parent-folder filters, hook-visible `RunScenario.id`, and retained `dirName`; these claims match `enumerateScenarios`, `selectScenariosByFilters`, `bin/skillsmith.mjs`, and `RunScenario`. The changeset does not claim report keys, progress identity, self-improvement identity, or artifacts moved to nested source paths.
