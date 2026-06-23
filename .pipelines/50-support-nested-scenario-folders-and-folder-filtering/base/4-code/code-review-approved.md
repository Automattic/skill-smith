# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed: T1 Add canonical scenario IDs to discovered and run scenario types; T2 Make scenario enumeration recursive and deterministic; T3 Add shared filter normalization, matching, and duplicate-name validation; T4 Wire shared selection and duplicate-name validation into the pipeline before side effects; T5 Update CLI usage wording for scenario-or-folder filters; T6 Add the release changeset; T7 Run final guardrails and fix integration regressions; post-approval e2e helper fix in `testing-project/eval/utils/verify-e2e.ts`.

## Summary

The implementation remains aligned with the approved spec, design, and code plan: recursive discovery, normalized scenario IDs, shared folder-aware selection, pre-side-effect validation, CLI wording, and the minor changeset are present with tests, while public reports/progress/artifacts remain keyed by `scenario.name`. The iteration-3 e2e helper fix correctly maps flat and nested Playwright report file paths back to normalized scenario IDs such as `counter` and `blocks/counter`; I found no blocking regression.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| typecheck | `npm run typecheck` | pass |
| lint | `npm run lint` | pass |
| tests | `npm test` | pass |
| config-smoke | `npm --prefix testing-project run check:config` | pass |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass |

## Behavior verification

- Inspected `testing-project/eval/utils/verify-e2e.ts`; `scenarioDirOf()` now splits Playwright report file paths on POSIX or Windows separators, finds `e2e.spec.mjs`, anchors after a preceding `scenarios` segment when present, and joins all path segments before the spec file as the scenario ID.
- Exercised the new mapping cases with the helper logic:

```text
counter/e2e.spec.mjs -> counter
blocks/counter/e2e.spec.mjs -> blocks/counter
/tmp/project/eval/scenarios/blocks/counter/e2e.spec.mjs -> blocks/counter
```

- Ran focused scenario tests: `node --import tsx --test src/__tests__/scenario-selection.test.ts src/__tests__/scenario-filter-selection.test.ts src/__tests__/scenarios.test.ts` — 29/29 passed, including nested folder filter hook-visible IDs and flat scenario compatibility.

## Issues

None.
