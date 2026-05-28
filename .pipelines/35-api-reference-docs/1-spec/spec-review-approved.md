# Spec review — APPROVED

Reviewing `spec.md` (commit `f54fd27`) against `requirements.md`, the iteration-1 review (`spec-review-1-rejected.md`), the iteration-2 review (`spec-review-2-rejected.md`), and the actual source tree on the branch.

This is the third pass. The previous reviewer confirmed B1–B17 from iteration 1 were resolved; my scope here is B18 (one blocking factual error) and the four non-blocking items N13–N16, plus an adversarial spot-check of the rest of the iteration-3 diff for any newly introduced errors.

## B18 — verified fixed

§A.5.5 previously claimed "All **seven** fields are required" — wrong; the validator at `src/scenarios/enumerate.ts:100-115` checks six fields (`name`, `description`, `skills`, `prompt`, `acceptance`, `rubrics`).

The revised spec at line 268 now says:

> All six required fields (`name`, `description`, `skills`, `prompt`, `acceptance`, `rubrics`) are checked by the shape validator at `src/scenarios/enumerate.ts:100-115`.

Six fields enumerated inline, matching the validator and the source's own malformed-shape error string. The phrasing makes drift between count and list impossible. ✓

## N13–N16 — verified fixed

| ID | Status | Verification |
|---|---|---|
| N13 — `checkPaths` reason strings | **resolved** | §A.5.8 (lines 372-376) now enumerates the three reason-string formats verbatim and cites `src/pipeline/pipeline.ts:565-583`. Cross-checked against source lines 565-583: `paths.${key} → ${dir} (does not exist)` (line 570), `paths.${key} → ${dir} (not a directory)` (line 574), `"paths.base is empty"` (line 578). All three strings match exactly; the cited line range is accurate. The bullet also ties them back to the precondition-failure envelope in §A.5.2, closing the loop the iteration-2 reviewer asked for. |
| N14 — `beforeScenario` / `afterScenario` on enumeration-errored scenarios | **resolved** | §A.5.4 (line 245) adds a new bullet stating the per-scenario hooks bracket every scenario unconditionally, with source citation `src/pipeline/pipeline.ts:517-555`. Verified against source: `beforeScenario` is called at lines 517-523 (before the `try` block), `runAgents` is gated on `error === undefined` at line 526, and `afterScenario` is called in the `finally` at lines 547-554. The "only the agent-pair hooks are suppressed" claim is correct. The bullet also calls out the workspace-defense implication for `afterScenario` authors, which is the practical reason the distinction matters. |
| N15 — `Scenario` `[key: string]: unknown` index signature | **resolved** | §A.5.5 (line 273) adds a new paragraph citing `src/config/types.ts:123-131`. Verified against source: `Scenario` interface spans lines 123-131 with the index signature at line 130. The paragraph correctly notes the round-trip via `ctx.scenario` and draws the parallel to `AgentDefinitionInput`'s `[key: string]: unknown` (already called out in §A.5.1 line 102). Internal consistency is good. `Scenario` is exported from `src/index.ts:21`, so a doc author can document the index signature against the public type. |
| N16 — `testing-project/` callout in the index | **resolved** | §A.2 (line 57) flipped from "may optionally include" to "should include", matching the iteration-2 suggestion to honour requirements §9 strictly. Callout is still constrained to one line, which keeps the index thin. |

## Adversarial spot-check on the iteration-3 diff

Ran `git diff 95380f7 f54fd27` to inspect the full delta. The diff is tight: exactly the four targeted edits, no collateral changes elsewhere. Specifically I confirmed:

- No regressions in the firing-order diagram at §A.5.4 (lines 222-237) — the new N14 bullet adds context, doesn't contradict the diagram's per-scenario annotation.
- The N14 bullet's reference to enumeration error strings (`unresolved reference: …`, `scenario.yaml parse error: …`, `scenario.yaml malformed: …` — see §A.5.5) cross-checks cleanly against the actual strings in §A.5.5 (lines 270-271 for parse/malformed, line 283 for unresolved-reference).
- N15's claim about ergonomic affordance ("hook authors writing a scenario-tag pattern") is forward-pointing prose — not a factual claim about current code, and consistent with the type's actual shape.
- The N13 bullet expansion in §A.5.8 does not duplicate the precondition-envelope coverage in §A.5.2 — it adds the reason-string verbatims that §A.5.2 declined to enumerate inline, and back-references §A.5.2 for the envelope.
- B18's revised phrasing closes the door on the same drift bug recurring: the count and the list are now tied together on the same line, so a future contributor editing one without the other will be visibly inconsistent.

No new factual errors introduced. No new internal contradictions. No new ambiguities. The Acceptance Criteria block was untouched (correctly — the §A.5.5 change is a wording/factual fix, not a scope change).

## Summary

B18 is genuinely fixed and the fix's enumerative phrasing prevents the same class of bug from coming back. N13–N16 all picked up the iteration-2 reviewer's suggestions verbatim and with accurate source citations. Nothing else moved.

The spec is now ready to drive Phase 2 (Design doc) without forcing downstream phases to invent answers to questions the spec should have settled.

Approved.

— spec-reviewer (iteration 3)
