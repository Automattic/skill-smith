# Code Review 1: Rejected

## Verdict

Rejected.

## Findings

### T3/T4: Unsafe-filter error omits required constraints

- **Severity:** Medium
- **Files:** `src/scenarios/selection.ts:27-30`, `src/__tests__/scenario-filter-selection.test.ts:59-65`
- **Issue:** `normalizeScenarioFilter` rejects absolute paths, Windows absolute/root-relative paths, UNC paths, and `..` traversal segments, but the user-facing error only says: `Pass a relative scenario ID or parent folder under config.paths.scenarios.` The design doc requires invalid-filter errors to identify the bad filter, state that filters are relative to `config.paths.scenarios`, and mention absolute paths, UNC paths, and `..` traversal segments. The current tests only assert a loose `relative scenario ID` phrase, so this requirement is not enforced.
- **Why it matters:** Users receiving an invalid-filter failure for a UNC path or traversal segment are not told the specific rejected path forms. This misses the required clear validation guidance and the T3 acceptance requirement for clear invalid-filter `UserFacingError`s.
- **Redispatch:** T3, T4
- **Required fix:** Update the invalid-filter `UserFacingError` message to mention the rejected forms, for example: `Scenario filters must be relative to config.paths.scenarios and must not be absolute paths, UNC paths, or contain '..' segments.` Tighten the selection tests to assert that the message includes absolute path, UNC path, and `..` traversal guidance.

## Verified Working

- Recursive discovery emits flat, nested, parent/child, malformed, unresolved-reference, and grouping-directory scenarios in deterministic normalized ID order.
- Shared selection handles trimming, duplicate filter de-duping, `.` root filters, exact filters, folder filters, segment-aware non-matches, overlap de-duping, unknown-filter errors, and `scenario.name` non-matching.
- Duplicate configured `scenario.name` values fail before run side effects, while synthetic malformed/shape-invalid names are excluded.
- Pipeline selection happens before run directory creation, hooks, progress, or agent work for empty, invalid, unknown, and duplicate-name failures.
- CLI usage was limited to the allowed code-phase usage wording update; no README or `docs/index.html` documentation-phase updates were included.
- Changeset exists with a minor bump and describes recursive discovery, scenario-or-folder filters, and `RunScenario.id`.

## Commands Run

- `git diff --stat 3af90255b1ec137691a227393cf283dbfea2fff7..HEAD`
- `git diff --name-only 3af90255b1ec137691a227393cf283dbfea2fff7..HEAD`
- `npm run typecheck`
- `npm test`

## Guardrail Notes

- `npm run typecheck` passed.
- `npm test` passed.
- Full guardrail record from T7 reports successful completion of `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, and `npx tsx scripts/validate-changesets.ts`.
