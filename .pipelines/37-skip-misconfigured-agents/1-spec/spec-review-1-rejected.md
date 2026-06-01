# Spec Review

## Verdict: rejected

## Summary

The spec is strong on structure, requirements coverage, and faithfulness to the
codebase. I verified its current-code claims against the worktree: `verdict.ts`
does define a `SKIPPED` kind that today counts as a non-PASS (so it fails pass
math via the `kind === "PASS"` checks in `scenario-report.ts:85-91` and
`iteration-report.ts:185`); `select-scenarios.ts:82` treats `entry.error` as a
re-selectable failure; the three env-var providers
(`anthropic-api.ts`/`openai-api.ts`/`gemini-api.ts`) return `"<KEY> is not set"`
while `claude-code` has no env guard and `codex` surfaces credential errors
through the SDK; hook contexts all extend `RunContext` and the lifecycle order
matches. The nine requirements map cleanly to the consolidated requirements, the
six Open Decisions are genuine WHAT forks correctly left to design (not dodged
settled requirements), and the ACs are in Given-When-Then form with
invariant-anchored assertions where they touch a deferred fork. There is no
material HOW bleed.

It is rejected for three issues where the spec leaves an *observable* outcome
ambiguous enough that two implementers could build divergent, both-defensible
behaviour, and where two requirements directly conflict on a point no AC pins
down. These are not deferrable-to-design forks — they are gaps/contradictions in
the WHAT itself.

## Issues

### Issue 1 — Runtime detection: forward-only vs retroactive exclusion is contradictory and untestable

**What's wrong:** R2 and R3 frame runtime detection as forward-only ("from that
point the agent is treated as misconfigured for the rest of the run and does no
further work", "does no further work in any phase"). R4 frames exclusion as
total and retroactive ("excluded from the matrix verdict entirely"; "neither in
the numerator nor the denominator of any scenario's or the run's pass/fail
computation"). These conflict for the realistic case where an agent succeeds on
early work and only later trips a misconfiguration-class error: consider a tester
that PASSes scenario A, then on scenario B fails with an auth error and is
declared misconfigured. Is scenario A's already-collected PASS row retroactively
removed from pass/fail accounting (R4, "entirely"), or kept because detection is
forward-only and only stops *future* work (R2/R3)? The two readings yield
different scenario-A verdicts and different run verdicts. No AC resolves it: AC7
only asserts "no further work" and "excluded from pass/fail accounting" without
saying whether already-recorded results for that agent are purged.

**Where in spec:** R2 (lines 69-79), R3 (lines 82-91), R4 (lines 93-105), AC7
(lines 278-289).

**Suggestion:** State the invariant explicitly — e.g. "once an agent is
determined misconfigured at runtime, ALL of its results across the entire run
(including any recorded before detection) are excluded from pass/fail
accounting" (retroactive), OR "results recorded before the misconfiguration was
discovered remain counted; only subsequent work is skipped" (forward-only). Then
add/extend an AC: given a tester that passes scenario A and is then
runtime-detected misconfigured on scenario B, assert what scenario A's
accounting shows. This is a real WHAT decision, not an Open-Decision fork; the
spec must pick one or explicitly add it to the deferred list with an invariant
that holds either way (and currently no such invariant is stated).

**Why it matters:** This is the single most likely real-world path for the
prompt's flagship "invalid API token" example (the token is only discovered bad
on the first live call, which may be the second or third scenario). Two
implementers will reasonably build opposite behaviours and both claim to satisfy
R2/R3/R4. The run verdict — the product's core output — can differ between them.

### Issue 2 — R5/AC11 conflates per-scenario and whole-run "all testers misconfigured," and never reconciles the per-scenario empty denominator with R4

**What's wrong:** R5 and AC11 say "every testing agent **for a scenario, or for
the whole run**" must reach an explicit outcome, treating the two as one case
under Open Decision 3. But they are observably different and interact with R4
differently. Whole-run: every tester is misconfigured → one run-level outcome.
Per-scenario: scenario X's only testers are all misconfigured while scenario Y
has survivors → after R4 excludes the misconfigured agents from X's denominator,
X has an *empty* denominator. The spec never says what verdict an
empty-denominator scenario gets, nor how that rolls up into a run that has other
passing scenarios. R4 mandates exclusion from the denominator; R5 mandates an
explicit non-silent outcome — but for the per-scenario case these two pull in
different directions (exclusion produces exactly the "empty set" R5 forbids
silently passing on), and no AC asserts the per-scenario verdict. Open Decision 3
only names the *outcome type* (abort / inconclusive / fail); it does not address
*granularity* (does a single all-misconfigured scenario abort the whole run, or
just mark that one scenario inconclusive while others proceed?).

**Where in spec:** R5 (lines 107-114), AC11 (lines 319-327), Open Decision 3
(lines 193-194), interacting with R4 (lines 93-105).

**Suggestion:** Either (a) split R5/AC11 into the per-scenario case and the
whole-run case and state the invariant for each (e.g. "a scenario whose entire
tester denominator is excluded is surfaced explicitly and does not count as a
silent pass; whether it aborts the run or marks the scenario inconclusive is
Open Decision 3"), or (b) explicitly fold the granularity question into Open
Decision 3 and write AC11 to assert the invariant that holds for *both* scopes
(no silent empty-set pass at *either* the scenario or run level). As written,
the per-scenario empty-denominator verdict is undefined and untestable.

**Why it matters:** A run with one all-misconfigured scenario and several
healthy scenarios is a common, realistic mix. Whether it aborts everything,
fails just that scenario, or reports it inconclusive is a user-visible verdict
difference with no current answer — and it sits at the seam between two
requirements (R4 exclude vs R5 surface) that the spec treats independently.

### Issue 3 — AC1 over-constrains the verdict relative to R4 and collides with Open Decision 4 and AC14

**What's wrong:** AC1 asserts the run's verdict is "computed exactly as if only
the N-1 agents had been configured" and the misconfigured agent "appears in no
scenario's pass/fail numerator or denominator." The numerator/denominator clause
is exactly R4 and is fine. But "computed exactly as if only the N-1 agents had
been configured" is stronger than R4 and collides with Open Decision 4
(true-absence vs present-but-marked-skipped). Under the present-but-marked
option, the matrix *shape* and CLI presentation are NOT "as if only N-1 were
configured" — there is an extra visibly-marked row (indeed R8/AC4 *require* it to
be visually present and distinct). So an implementer choosing the
marked-skipped surface could fail AC1 on a literal reading while fully
satisfying R4, R8, and Open Decision 4. AC1 should constrain the *pass/fail math*
(which R4 fixes regardless of surface), not the whole observable verdict
artifact.

**Where in spec:** AC1 (lines 228-236), versus R4 (lines 93-105), Open Decision 4
(lines 197-199), R8/AC4 (lines 153-161, 252-259).

**Suggestion:** Reword AC1's final clause to assert the invariant that holds
regardless of Open Decision 4 — e.g. "the run's pass/fail *result* (PASS/FAIL and
the per-scenario pass math) is identical to a run configured with only the N-1
agents," explicitly scoping the equivalence to the verdict math rather than the
full matrix/CLI artifact, and note it defers surface shape to Open Decision 4
(mirroring how AC7/AC8/AC11 carry their deferral notes).

**Why it matters:** AC1 is the headline acceptance criterion. As written it can
be read to silently pre-decide Open Decision 4 in favour of true-absence, which
contradicts the spec's own statement that the surface is deferred. Two
implementers will disagree on whether a marked-skipped implementation passes
AC1.
