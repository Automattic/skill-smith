# Spec Review

## Verdict: rejected

## Summary

The revision is strong and the three prior issues are genuinely fixed, not
papered over:

- **Prior Issue 1 (forward-only vs retroactive).** Now an explicit **Open
  Decision 7** with a stated holds-either-way invariant in R3 ("no result
  produced by a misconfigured agent on or after the invocation that triggered
  detection is ever counted"), R4 names the one case the two readings differ on,
  and a new **AC7b** asserts the common invariant and defers the rest. Resolved.
- **Prior Issue 2 (per-scenario vs whole-run + empty denominator).** R5 split
  into **R5a/R5b**, AC11 split into **AC11a/AC11b**, and Open Decision 3 now
  explicitly covers both outcome *type* and *granularity*. The no-silent-pass
  invariant is stated for both scopes. Resolved.
- **Prior Issue 3 (AC1 over-constraint on verdict).** AC1's final clause is now
  scoped to the pass/fail *result* (verdict + per-scenario pass math) and
  carries a note deferring matrix/CLI surface to Open Decision 4. Resolved.

I re-verified the load-bearing current-code claims against the worktree:
`scenario-report.ts:82-92` gates pass on `agentsList.length > 0` and
`classifyVerdict(...).kind === "PASS"` (the numerator/denominator math R4
targets); `iteration-report.ts:166-188` fails an empty scenario/run set (the
R5a/R5b degenerate case); `select-scenarios.ts:68-94` re-selects on
`entry.error`/non-PASS (the confirmed re-selection bug R2 fixes);
`config/types.ts:144` defines `RunContext`, hooks extend it, and the
`beforeAll → beforeTestAgent → afterAll` lifecycle is real (R7/AC8/AC9); the
env-var providers do missing-credential checks (R3 pre-flight branch). The
requirements map cleanly, the seven Open Decisions are genuine WHAT forks
correctly deferred with holds-either-way invariants, and there is no material
HOW bleed.

It is rejected for one new contradiction the revision introduced at the headline
acceptance criterion: AC1 was widened to admit the *invalid-credential*
(runtime-detected) case in its Given, but its Then still asserts an
*unconditional* total absence from all numerators and denominators — which
directly contradicts AC7b and Open Decision 7 (forward-only). This is a
WHAT-level contradiction between two ACs, not a deferrable fork, and it
re-opens precisely the seam the prior rejection's Issue 1 closed elsewhere.

## Issues

### Issue 1 — AC1's "missing OR invalid credential" Given collides with its unconditional total-absence Then, contradicting AC7b / Open Decision 7

**What's wrong:** AC1's **Given** is "exactly one [agent] has a **missing or
invalid** credential" — explicitly admitting the *invalid* credential case,
which R3 classifies as **runtime-detected** (it only surfaces on the first live
call, possibly on the second or third scenario). AC1's **Then** then asserts,
unconditionally, that "the misconfigured agent appears in **no** scenario's
pass/fail numerator or denominator" and that the result is "identical to a run
configured with only the N-1 well-configured agents."

But AC7b and Open Decision 7 establish that, under the **forward-only**
resolution, a runtime-detected agent that PASSed scenario A *before* detection
keeps that PASS in scenario A's accounting ("under forward-only the agent's A
PASS still counts"). In that resolution the misconfigured agent DOES appear in
scenario A's numerator/denominator, and the run is NOT "identical to only the
N-1 configured" — scenario A carries an extra counted PASS. So for the
invalid-credential sub-case AC1 admits, AC1's Then is false under a live option
of Open Decision 7, and AC1 and AC7b assert opposite things about the same run.

The contradiction is invisible only if AC1 is silently read as restricted to the
*missing*-credential (pure pre-flight) sub-case, where no earlier results exist
and total absence is guaranteed. But AC1's Given says "missing **or** invalid,"
so that restriction is not stated and an implementer choosing forward-only will
reasonably read AC1 as failing on a PASS-then-detected tester while AC7b says
that exact run is correct.

**Where in spec:** AC1 (lines 290-305, esp. the Given at 291-293 "missing or
invalid credential" and the Then at 294-299 "appears in no scenario's pass/fail
numerator or denominator" / "identical to a run configured with only the N-1"),
versus AC7b (lines 361-374), R3's forward-only invariant (lines 93-102), R4's
"one case the two readings differ" paragraph (lines 122-130), and Open Decision
7 (lines 263-272).

**Suggestion:** Pick one:
- (a) **Restrict AC1's Given to the pre-flight / missing-credential case**
  (drop "or invalid"), so the agent provably records nothing before exclusion
  and the unconditional total-absence Then is always true regardless of Open
  Decision 7. Leave the invalid-credential/runtime path entirely to AC7 and
  AC7b, which already handle it with the proper deferral note. This is the
  cleanest fix and keeps AC1 a clean, decision-independent headline.
- (b) Keep "missing or invalid" but **add the Open Decision 7 deferral note to
  AC1** (mirroring AC7b) and reword the Then to the invariant that holds either
  way — e.g. "the triggering misconfiguration and all of the agent's on/after-
  detection work contribute to no numerator or denominator; whether any
  earlier-recorded PASS is also excluded is Open Decision 7" — rather than the
  unconditional "no scenario's numerator or denominator" / "identical to only
  N-1."

**Why it matters:** AC1 is the headline acceptance criterion and the prompt's
flagship example is the "invalid API token" — the very case that surfaces at
runtime mid-run. As written, two implementers (forward-only vs retroactive) will
disagree on whether a PASS-then-detected tester satisfies AC1, and one of them
will read AC1 and AC7b as mutually contradictory. That is the same observable-
verdict divergence the prior rejection's Issue 1 was rejected for; the revision
fixed it in R3/R4/AC7/AC7b but reintroduced it at AC1 by widening the Given to
"or invalid" without carrying the matching deferral.
