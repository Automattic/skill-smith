# Code Plan Review

## Verdict: rejected

## Summary

The plan is broadly aligned with the spec and design on recursive discovery, normalized IDs, shared selection, pre-side-effect failures, preserved `scenario.name` outputs, CLI usage, and the changeset. However, it violates the phase convention against test planning by prescribing specific test files and coverage tasks throughout the code plan, and it leaves the duplicate-name provenance marker as an implementation-time design choice. These issues are significant enough to reject because they either constrain code-writers outside the allowed plan scope or force them to make hidden design decisions mid-task.

## Issues

### Issue 1: The plan prescribes test files and test coverage instead of only observable acceptance

**What's wrong:** The code plan repeatedly tells code-writers which test files to edit/create and which test coverage to add. The reviewer instructions explicitly require flagging plans that specify which unit or end-to-end tests to write; tests are the code-writer's responsibility through TDD and browser/end-to-end verification derived from task behavior. Task 5 is entirely a test-coverage task rather than an implementation task, and Tasks 2, 3, 4, and 6 include test files in `Files` plus coverage instructions in `Changes`.

**Where in plan:** Task 2 `Files` includes `src/__tests__/scenarios.test.ts` and fixture directories; Task 3 `Files` includes `src/__tests__/scenario-selection.test.ts` and its acceptance says "focused selection tests"; Task 4 `Files` includes `src/__tests__/scenario-selection.test.ts`; Task 5 is titled "Add end-to-end nested discovery and compatibility coverage" and all of its `Changes` prescribe integrated coverage; Task 6 includes `src/__tests__/scenario-selection.test.ts` and parser assertion changes.

**Suggestion:** Remove test files and coverage-writing instructions from implementation tasks. Keep each task's acceptance criteria as observable behavior only, and keep verification commands if that is part of the plan convention. Fold Task 5's observable integrated behavior into acceptance criteria for the implementation tasks or final guardrail task without directing writers to add specific tests or test files.

**Why it matters:** The code plan should define what must be true, not how the code-writer must test it. Prescribing tests can conflict with the TDD workflow, overconstrain implementation, and violates the explicit no-test-planning requirement for this phase.

### Issue 2: Duplicate-name provenance marker is left as an unresolved design choice

**What's wrong:** Task 3 says to "expose or add a minimal internal marker" distinguishing real configured names from synthetic stub names, but does not specify the actual record shape or ownership of that marker. The current code has only `EnumeratedScenario { scenario, dirName, error? }` and `stubScenario(dirName)` creates synthetic names from directory names. Without a concrete field or helper contract, different code-writers could implement incompatible approaches such as `hasConfiguredName`, `synthetic`, a symbol, an exported helper, or string-based inference. This is exactly the kind of mid-task design decision the plan should eliminate.

**Where in plan:** Task 3, `Changes` bullet: "expose or add a minimal internal marker on enumerated records that distinguishes real configured names from synthetic stub names".

**Suggestion:** Specify the exact minimal contract in the plan, for example adding `hasConfiguredName: boolean` or `nameSource: "configured" | "synthetic"` to `EnumeratedScenario`, setting it in `src/scenarios/enumerate.ts`, and documenting that it is internal to enumeration/selection and not copied to `RunScenario` or hook contexts.

**Why it matters:** Duplicate-name validation is a core design decision: malformed YAML and shape-invalid stubs must be excluded, while unresolved-reference records must be included. Leaving the provenance mechanism unspecified risks inconsistent public type exposure, brittle error-string inference, or failures to satisfy the duplicate-name acceptance criteria.
