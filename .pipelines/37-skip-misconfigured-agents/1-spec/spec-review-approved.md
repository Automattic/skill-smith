# Spec Review

## Verdict: approved

## Summary

The single AC1 contradiction that drove the second rejection is genuinely
resolved, and it introduced no new defect. The prior three issues remain fixed.

**The AC1 fix (re-review #3 focus).** Spec-review-2 rejected because AC1's Given
had been widened to "missing **or** invalid" credential while its Then still
asserted *unconditional* total absence from every numerator/denominator and
verdict math "identical to only the N-1" — which collided with AC7b / Open
Decision 7 (under forward-only a runtime-detected agent that PASSed an earlier
scenario keeps that PASS counted). The revision adopts suggestion (a): AC1's
Given is now "exactly one has a **missing credential** (deterministically
detected pre-flight, before any phase work)" — "or invalid" dropped — and a new
clause in the Note (spec.md:308-310) states the AC is "scoped to the
missing-credential (pre-flight) case so total absence holds unconditionally; the
runtime-detected invalid-credential path … is covered by AC7/AC7b, whose
accounting depends on Open Decision 7."

This is a real fix, not papering:
- For a pure pre-flight missing-credential agent, exclusion happens *before any
  phase work*, so the agent provably records nothing. Total absence therefore
  holds **unconditionally** — Open Decision 7 (which governs only results
  recorded *before* runtime detection) cannot apply, because no such results can
  exist. AC1's unconditional Then is now always true.
- AC1 (pre-flight missing) and AC7/AC7b (runtime invalid) now cover **disjoint**
  cases. The runtime invalid-credential path is owned solely by AC7/AC7b, which
  retain the Open Decision 7 deferral note. There is no longer any run that AC1
  and AC7b describe with opposite verdicts. The contradiction is gone.
- The edit introduced no new defect: AC2 and AC3 reference "the run from AC1,"
  which remains a coherent (now more narrowly scoped) run — one
  missing-credential tester among N across multiple scenarios/iterations — so no
  cross-reference broke. AC1's pre-flight framing is consistent with AC6
  (pre-flight detection prevents phase work). No dangling or orphaned assertion.

**Prior three issues remain resolved.**
- Issue 1 (forward-only vs retroactive): Open Decision 7 (spec.md:263-272) plus
  R3's holds-either-way invariant — "no result produced by a misconfigured agent
  on or after the invocation that triggered detection is ever counted"
  (spec.md:98-102) — and AC7b assert the common invariant and defer the rest.
- Issue 2 (per-scenario vs whole-run empty denominator): R5 split into R5a/R5b
  (spec.md:132-159), AC11a/AC11b (spec.md:409-433), and Open Decision 3
  (spec.md:240-245) covering both outcome *type* and *granularity*, with the
  no-silent-pass invariant stated for both scopes.
- Issue 3 (AC1 over-constraint on surface): AC1's final clause is scoped to the
  pass/fail *result* (verdict + per-scenario pass math) with the Open Decision 4
  deferral note (spec.md:301-307). The new missing-credential scoping further
  hardens this.

**Codebase re-verification (worktree, this re-review).** The load-bearing
current-behaviour claims still hold: `src/reports/scenario-report.ts:82-92`
gates pass on `agentsList.length > 0` and `classifyVerdict(...).kind === "PASS"`
(the numerator/denominator math R4 targets); `src/reports/iteration-report.ts`
(`scenariosAllPass`/`agentsAllPass`) fails an empty scenario/run set (the
R5a/R5b degenerate case); `src/pipeline/select-scenarios.ts:68-94`
(`collectFailingAgents`) re-selects on `entry.error` / non-PASS (the
re-selection bug R2 fixes); `src/reports/verdict.ts:10-12` defines a `SKIPPED`
kind that today counts as non-PASS. `src/config/types.ts` carries the config
types the hooks contract (R7/AC8/AC9) builds on.

The requirements map cleanly to the codebase, the seven Open Decisions are
genuine WHAT forks correctly deferred each with a holds-either-way invariant,
the ACs are in testable Given-When-Then form with invariant-anchored assertions
wherever they touch a deferred fork, scope is bounded, and there is no material
HOW bleed. The spec is ready to advance to the design phase.
