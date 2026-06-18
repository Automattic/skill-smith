# Spec review — APPROVED

Spec: `1-spec/spec.md` (#48 — Stop the self-improvement loop from overfitting skills to eval scenarios), commit d58f8ec.

Verdict: **APPROVED.** The prior blocking issue B1 (AC5/AC3 loop-count off-by-one) is
genuinely resolved, the two non-blocking notes (N1, N2) are addressed, and a fresh
adversarial pass over the whole revised spec found no new blocking issues. The spec is
ready for design.

I re-verified the spec's load-bearing factual claims against the code before signing off
(not assuming the prior reviewer's verification carried through the revision).

---

## B1 — RESOLVED (the gating issue from review #1)

B1 rejected AC5 for asserting "exactly N validation transcripts / N+1 improver
invocations," which was off-by-one against the only loop the artifacts describe. The
recommended fix (Option A: keep the described loop, validate every edit including the
last, so the count is N+1 / N+1) has been taken, and AC3 has been reconciled to the same
loop. I re-traced both against the research pseudocode (`spec-research.md:357-365`):

**AC5 — never-approving validator, cap N=2** (`if approve OR round >= cap: break`):

| step | action | improver inv | validation | round after |
|------|--------|--------------|------------|-------------|
| 1 | improve (round 0) | 1 | 0 | 0 |
| 2 | validate; approve? no; `0>=2`? no → improve | 2 | 1 | 1 |
| 3 | validate; approve? no; `1>=2`? no → improve | 3 | 2 | 2 |
| 4 | validate; approve? no; `2>=2`? yes → break | 3 | 3 | — |

Trace = **3 improver invocations, 3 validation transcripts** = N+1 / N+1. The revised AC5
(`spec.md:300-308`) asserts exactly that: "exactly **N+1 improver invocations** and **N+1
validation transcripts** … For the default N=2 that is 3 improver invocations … and 3
validation transcripts (each edit, including the final un-revised one, is reviewed — its
findings feed the warning)." Matches the trace and the termination logic (terminal
validation detects the cap and breaks; the last edit IS validated). The break is on
`round >= cap`, not on the verdict, so it correctly short-circuits before R8's
"revise triggers a revise round" — no contradiction.

**AC3 — happy path, validator approves on round 2, cap 2:**

| step | action | improver inv | validation | round after |
|------|--------|--------------|------------|-------------|
| 1 | improve (round 0): MARKER + LEAK_TOKEN | 1 | 0 | 0 |
| 2 | validate; LEAK present → revise; `0>=2`? no → improve (remove LEAK) | 2 | 1 | 1 |
| 3 | validate; LEAK gone → approve → break | 2 | 2 | — |

Trace = **2 improver invocations, 2 validation transcripts, exactly one revise round.**
The revised AC3 (`spec.md:288-293`) asserts "**2 improver invocations** (first pass + 1
revise round) and **2 validation transcripts** (the round-1 `revise` and the round-2
`approve`)" and states "Traced against the same R6/R7 loop as AC5." Matches the trace.

Both E2E criteria now encode the SAME loop with consistent counts (2/2 on convergence,
N+1/N+1 on cap), the validation count is consistent with terminal-validation termination
(validate every on-disk edit including the last; terminal validation detects the cap and
breaks), and "accepted = validator approved the current on-disk state" (R6) is preserved.
B1 is genuinely closed.

## N1 — RESOLVED (`_candidates.yaml` exclusion mechanism)

The Key-terms entry (`spec.md:46-48`) now reads "the enumerated `*/scenario.yaml` set; a
`_candidates.yaml` is never enumerated and is therefore excluded by construction," dropping
the loose `enumerate.ts:30` line cite. Verified against `enumerate.ts:33-37`:
`enumerateScenarios` only ever reads `scenario.yaml` per directory, so a `_candidates.yaml`
is excluded by never being read. The revised wording states the exactly-correct mechanism.

## N2 — RESOLVED (AC6 deterministic-portion honesty)

AC6 (`spec.md:310-319`) now adds the honest-scope clause: with a *mock* validator the
must-approve fixture "verifies the loop accepts an `approve` verdict (converges without a
revise round) — it does NOT exercise a model's breadth-rule judgment," and the breadth-rule
judgment is "covered by the design-reference real-model check, not this suite." The AC6
prose no longer reads stronger than the mock oracle delivers, and the `and/or` fallback
keeps AC6 testable unconditionally.

---

## Fresh adversarial pass (whole spec, post-revision)

**Factual claims re-verified against code (load-bearing only):**
- Judge skill-blindness — `judge-agent.ts:111` "Do not consult any skill documentation";
  the judge never sees skill text. C1 grounded; the fix lives in the new validator.
- `resolveSelfImprovement` shape/precedence — `self-improvement.ts:37-50`: `overrides ??
  cfg ?? DEFAULTS` precedence + `Math.max(1, …)` clamp. R7's "same shape and precedence as
  `maxIterations`" is accurate. R7 claims parity of shape/precedence only and gives
  `maxValidationRounds` its own default of 2; it does NOT claim default-value parity (the
  `maxIterations` default is 3) — no misclaim.
- Mock testability hook — `mock.ts:61` `systemPrompt.includes("improver agent")` and the
  `GATE`/`MARKER` sentinels (`mock.ts:19-20`); AC3/AC5's LEAK_TOKEN approach mirrors this.
- Outer-cap keep-no-revert precedent — `pipeline.ts:188-208` (`i < maxIterations` guard, no
  revert). Grounds R7/D2 "mirrors outer-cap."
- Backward-compat anchor — `self-improvement-loop.test.ts:90` asserts `!skills.diff`
  (no-git) and uses MOCK_GATE/MARKER. Grounds C4/AC4.
- Improver fail-open — `improver.ts:159-168` logs and returns normally. Grounds R8.

**Internal consistency.** AC3 ↔ R6/R8/R9 (revise-with-findings triggers a revise; approve
breaks; final state leak-free = approved on-disk state) — consistent. AC5 ↔ R7/R8 (cap
break short-circuits before a revise; last edit kept; warning recorded) — consistent. The
two E2E ACs encode one loop. No newly introduced contradiction.

**Faithfulness to intent.** Goal preserved (general guidance; blatant leakage detected
before the edit is accepted) and not upgraded to a generalization guarantee. Hard
constraint 1 (judge stays skill-blind) — C1, verified in code. Hard constraint 2 (no
held-out / small-corpus) — C2, with R3's breadth test as the small-corpus mechanism. Both
constraints faithfully encoded.

**Honest-scope framing.** Prominent and intact — Overview "Honest scope (load-bearing
framing)," C6, R3a (precision bias), D2 honest caveat, AC6's deterministic-portion clause,
Out-of-Scope. Advisory-in-loop / authoritative-at-PR line preserved. No over-claiming.

**Standalone-ness.** spec.md is self-contained (Overview, Key terms, R1–R9, C1–C6,
Out-of-Scope, D2/D5, AC1–AC7). Code file:line references are evidentiary, not reading
dependencies. Implementable without opening intent.md or spec-research.md.

**Testability.** AC1–AC7 are all mock-driven and deterministic, each with an assertable
oracle. The previously-ambiguous AC3/AC5 counts are now pinned (2/2 and N+1/N+1) and
mutually consistent. Every AC is implementable-as-stated.

**No design/implementation leakage.** Requirements state behavior (catch forms a–d,
in-process/ephemeral/no-git capture, role reuse, fail-open) and defer mechanism
(pre-scan-vs-pure-LLM → D5/Out-of-Scope; loop-helper structure left to design). The R9
verdict JSON is a contract that AC2 tests as a pure-function table — appropriate at spec
level, not implementation leakage. Phase hygiene intact.

No remaining blocking issues. Approved for design.
