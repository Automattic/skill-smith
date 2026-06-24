# Spec Review

## Verdict: rejected

## Summary

The spec captures most of the researched requirements and stays largely focused on observable behavior, but it leaves scenario ordering under folder filters ambiguous and does not make the full invalid-scenario preservation requirement testable. These gaps are small but important because downstream implementation and tests could diverge on user-visible run ordering and could accidentally regress unresolved-reference behavior while still satisfying the written acceptance criteria.

## Issues

### Issue 1: Folder filter selection order is underspecified

**What's wrong:** The spec requires no-filter runs to use deterministic scenario ID order and says filtered selections preserve the user's first selected order, but it does not define the order of multiple scenarios matched by a single folder filter. For example, if `blocks` matches `blocks/button` and `blocks/counter`, one implementer could preserve filesystem traversal order, another could use sorted scenario ID order, and another could preserve whatever order recursive discovery returns. The acceptance criteria only assert that both scenarios are selected, not their order.

**Where in spec:** Requirements 9, 21, 24; Acceptance Criteria lines covering folder filters and multiple filter order.

**Suggestion:** Specify that within each normalized filter, all matching scenarios are considered in deterministic scenario ID order, while the sequence of filters follows the user's order and overlapping scenarios are emitted only at their first match. Add an acceptance criterion for a folder filter matching multiple scenarios in non-alphabetical filesystem order to prove the selected order.

**Why it matters:** Run order is user-visible in progress output, reports, hooks, and artifacts. The research explicitly calls for deterministic ordering, and without a precise rule folder-filtered runs may be flaky or inconsistent across platforms.

### Issue 2: Unresolved-reference invalid scenarios are required but not covered by acceptance criteria

**What's wrong:** The requirements say malformed scenario files or unresolved references must continue surfacing as per-scenario errors while other valid scenarios can run, but the acceptance criteria only test malformed YAML. That leaves unresolved skill/rubric references untested even though the research identifies them as part of the existing invalid-scenario behavior that must be preserved.

**Where in spec:** Requirement 8; Acceptance Criteria item for malformed YAML only.

**Suggestion:** Add a Given-When-Then acceptance criterion for a discovered scenario with an unresolved skill or rubric reference alongside a valid scenario, asserting that the unresolved-reference scenario surfaces as a per-scenario error and the valid scenario can still run.

**Why it matters:** Recursive discovery changes how scenarios are enumerated and validated. Without explicit acceptance coverage, an implementation could accidentally abort discovery or skip descendants on unresolved references and still appear to satisfy the current malformed-YAML-only criterion.
