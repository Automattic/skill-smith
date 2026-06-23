# Design Doc Review

## Verdict: rejected

## Summary

The design is mostly well structured and traces the major discovery, filtering, compatibility, documentation, and error requirements back to the approved spec. However, it has two correctness gaps that would lead implementers toward behavior that either violates the malformed-scenario compatibility requirement or conflicts with existing error/report types. These should be resolved before implementation planning.

## Issues

### Issue 1: Duplicate-name validation can falsely override malformed-scenario handling

**What's wrong:** The design requires duplicate `scenario.name` validation across “all discovered scenarios” but does not distinguish real parsed `scenario.name` values from synthetic stub names used for malformed YAML or malformed scenario shapes. In the current code, invalid scenarios are represented by a stub `Scenario` plus an `error`; if the implementation follows the design literally and validates duplicate names across all emitted records, an invalid scenario's synthetic name could collide with a valid scenario's real name and turn a per-scenario parse/shape error into a pre-run duplicate-name failure. That would prevent the other valid scenario from running, contradicting the spec's requirement that malformed scenarios surface as per-scenario errors while other valid discovered scenarios can still run.

**Where in design doc:** Sections “Approach” lines 15-17, “Recursive discovery data flow” lines 55-57, “User-facing errors” lines 144-152, and “Decision: Reject duplicate `scenario.name` values across all discovered scenarios” lines 216-221.

**Suggestion:** Specify the duplicate-name algorithm's treatment of errored enumeration records. For example: validate duplicates only among records with successfully parsed scenario files and real `scenario.name` values, while malformed/shape-invalid records keep their per-scenario errors and use their normalized ID only as reporting fallback; or explicitly mark whether an emitted record has a real configured name and exclude synthetic stub names from duplicate-name checks. Also state how unresolved-reference records are handled, since they do have a valid parsed `scenario.name` and should likely participate in duplicate validation.

**Why it matters:** Requirements 8 and 29 must both hold. Without this distinction, a single malformed scenario can cause a side-effect-free global duplicate-name failure instead of the existing per-scenario error model, silently dropping the guarantee that valid scenarios still run alongside invalid ones.

### Issue 2: Scenario record interface uses `Error` where the codebase uses string scenario errors

**What's wrong:** The proposed `RunScenario`/discovered record shape shows `error?: Error`, but the existing `EnumeratedScenario`, pipeline, report aggregation, summary rendering, improver context, and tests all use `error?: string` / `scenarioError?: string`. The design elsewhere describes preserving existing per-scenario error reporting, but this interface points implementers at an incompatible type and serialization shape.

**Where in design doc:** Section “Scenario record shape” lines 37-45.

**Suggestion:** Change the design interface to use `error?: string` for enumerated/run scenario records, or explicitly separate an internal caught exception from the user-facing serialized scenario error string. Keep the public/report-facing value as a string unless the design intentionally includes all downstream type/report changes, which would be beyond the spec.

**Why it matters:** Implementing `error?: Error` literally would fight existing TypeScript types and report code (`aggregateScenarioReport` expects a string), and could produce non-serializable or inconsistent JSON output. The spec requires preserving existing invalid-scenario behavior and report compatibility, so the design should not introduce an ambiguous error representation.
