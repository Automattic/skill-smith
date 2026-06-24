# Code Plan Review

## Verdict: rejected

## Summary

The revised plan fixes the prior rejection issues: it no longer prescribes specific test files or a test-only implementation task, and it gives the duplicate-name provenance marker an exact internal `EnumeratedScenario.nameSource: "configured" | "synthetic"` contract that is not copied to `RunScenario` or public outputs. However, the pipeline wiring task now contradicts the design's required early-failure ordering by placing duplicate-name validation immediately after enumeration without first normalizing and validating user filter syntax. That leaves code-writers with an ambiguous ordering decision and can produce the wrong user-facing failure when invalid filters and duplicate names coexist.

## Issues

### Issue 1: Pipeline task orders duplicate-name validation before filter syntax validation

**What's wrong:** The design doc explicitly preserves this early-failure order in `runPipeline`: load config and paths, enumerate scenarios, normalize/validate filter syntax, validate duplicate real configured `scenario.name` values, match filters, then create the run directory or run hooks/agents. Task 4 instead says to call duplicate-name validation "Immediately after enumeration" and only then replace the private `filterScenarios` helper with shared selection. Because Task 3 includes empty/invalid filter validation inside selection, this plan implies duplicate-name failures may be thrown before invalid filter syntax is even checked. Two code-writers could implement different precedence, and one could ship behavior that contradicts the design.

**Where in plan:** Task 4, `Changes` bullets: "Immediately after enumeration, call duplicate-name validation across the full discovered set" and "Replace the private `filterScenarios` helper... with the shared selection module".

**Suggestion:** Revise Task 4 to specify the exact orchestration order: after enumeration, use the shared selection module to trim/normalize/dedupe and validate raw filters for empty/absolute/UNC/`..` failures; then validate duplicate configured names across the full discovered set; then perform unknown-filter matching/selection; only after those steps build `runScenarios`, create the run directory, initialize progress, fire hooks, or invoke agents. If the intended helper API bundles normalization and matching together, split or name the pure helper responsibilities in the plan so this ordering is unambiguous.

**Why it matters:** Requirement 17 and the design's failure-mode contract require invalid filters to fail before matching with a clear validation error, and the design specifically places filter syntax validation before duplicate-name validation. Getting this wrong degrades user-facing diagnostics and weakens the pre-side-effect ordering guarantee the plan is supposed to implement.
