# Spec review #1 — REJECTED

Spec: `1-spec/spec.md` (#48 — Stop the self-improvement loop from overfitting skills to eval scenarios)

Verdict: **REJECTED** — one blocking internal inconsistency in a load-bearing,
testable acceptance criterion (AC5). The rest of the spec is strong: faithful to
the intent and both hard constraints, honest-scope framing preserved, no goal
substitution, no implementation leakage, and standalone. Fix the AC5 counting and
the spec is ready.

I verified the spec's factual claims against the code before reviewing — improver
(`src/improvement/improver.ts`), context (`src/improvement/context.ts`), pipeline
loop (`src/pipeline/pipeline.ts:188-208`), judge skill-blindness
(`src/pipeline/judge-agent.ts:111`), role plumbing
(`src/config/types.ts`, `validate.ts`, `normalize.ts`), `resolveSelfImprovement`
(`src/config/self-improvement.ts`), the backward-compat anchor
(`src/__tests__/self-improvement-loop.test.ts`), and the mock testability hook
(`src/providers/mock.ts:61`). They hold. The blocking issue is internal to the
spec, not a code-mismatch.

---

## BLOCKING

### B1 — AC5 transcript/invocation counts contradict the only loop shape the artifacts describe (off-by-one)

**Where:** AC5 (`spec.md:295-298`):

> the inner loop terminates at `maxValidationRounds` (no hang — **exactly N
> validation transcripts / N+1 improver invocations**) …

**The contradiction.** R7 (`spec.md:139-145`) defines the default cap of 2 as
"the improver's first pass plus up to **2 revise rounds**," and the only loop
shape in the artifacts is the research pseudocode (`spec-research.md:357-365`),
with `round` starting at 0 and the cap check `round >= cap` placed *after* each
validation:

```
improver.invoke(original context)        // round 0  → improver invocation #1
loop:
  re-read skills root
  verdict = validator.invoke(...)         // validation transcript
  if approve OR round >= cap: break
  improver.invoke(... + feedback)         // revise round → improver invocation
  round++
```

Trace it with a never-approving validator and `cap = maxValidationRounds = 2`:

| step | action | improver invocations | validation transcripts | round after |
|------|--------|----------------------|------------------------|-------------|
| 1 | improve (round 0) | 1 | 0 | 0 |
| 2 | validate; `0 >= 2`? no → improve | 2 | 1 | 1 |
| 3 | validate; `1 >= 2`? no → improve | 3 | 2 | 2 |
| 4 | validate; `2 >= 2`? yes → break | 3 | 3 | — |

Result: **3 improver invocations, 3 validation transcripts** (i.e. N+1 / N+1).

AC5 asserts **N+1 improver invocations (3) and exactly N validation transcripts
(2)**. The improver count matches; the validation count is off by one. The
described loop validates the *final* edit (the validation that detects the cap and
breaks) — so it produces N+1 validations, not N. To get exactly N validations you
would have to either (a) check the cap *before* the terminal validation, which
leaves the last edit un-reviewed and changes "accepted = validator approved the
current on-disk state" (R6), or (b) restructure the loop counting. The spec does
not say which, and a test author implementing AC5 ("exactly N validation
transcripts") cannot do so unambiguously — the off-by-one directly determines the
termination condition and what counts as a stable, assertable oracle.

**Why blocking, not minor.** AC5's whole value is being a precise no-hang oracle
with exact counts ("exactly N validation transcripts / N+1 improver
invocations"). As written it is unimplementable-as-stated against the only loop the
artifacts describe, and the discrepancy is in the termination logic, not cosmetic.

**To fix (pick one and make the spec self-consistent end-to-end):**
- **Option A (recommended — keep the described loop):** change AC5 to "**N+1
  validation transcripts** / N+1 improver invocations" for cap N, and confirm R6/R7
  language matches (every edit, including the last, is validated; the terminal
  validation is what detects the cap). This keeps "accepted = validator approved
  the current on-disk state" intact and keeps the last edit reviewed (its findings
  feed the warning).
- **Option B:** if the intent really is exactly N validations, state explicitly in
  R7 that the cap is checked *before* validating the final revise (so the last edit
  is **not** re-reviewed on cap), and reconcile that with R6's "accepted = approved
  current on-disk state" and with R7's warning (the warning would then fire without
  a final validation confirming residual leakage). Then make AC3's convergence
  counts consistent with the same loop.

Whichever is chosen, also sanity-check **AC3** against it: AC3 ("≥1 revise round
occurred," converges on round-2 approve) must produce counts consistent with the
same loop shape and the same cap semantics, so the two E2E ACs don't encode two
different loops. State the expected (improver-invocation, validation-transcript)
counts for the AC3 happy path too, so both E2E criteria pin the *same* loop.

---

## NON-BLOCKING (fix opportunistically; not gating)

### N1 — `_candidates.yaml` exclusion: mechanism/citation imprecise (Key terms, `spec.md:47`)

The spec says the corpus "Excludes any `_candidates.yaml` (not enumerated)" and the
research cites `enumerate.ts:30`. Verified: `enumerateScenarios`
(`src/scenarios/enumerate.ts:33-37`) only ever reads `scenario.yaml` per directory
— so a `_candidates.yaml` is excluded *by never being read*, not by an explicit
exclusion at line 30 (line 30 is just `const out = []`). The spec's **claim is
substantively correct** (candidates are not in the corpus); only the cited
mechanism/line is loose. Optional: soften to "the corpus is the enumerated
`*/scenario.yaml` set; `_candidates.yaml` is never enumerated" and drop the precise
line cite, or let design carry it. Not gating — it does not change any requirement
or AC.

### N2 — AC6's deterministic strength is softer than the prose suggests (acknowledge, don't over-claim)

AC6 ("domain vocabulary … is never flagged"; de-fingerprinted skill APPROVED) is
deterministic **only** via either the optional `leakage-scan.test.ts` pre-scan unit
(conditional on the design electing a pre-scan, per D5) **or** the must-approve
mock fixture. With a *mock* validator the fixture tests the loop's handling of an
`approve` verdict, not the validator's breadth-rule *judgment* — the real
breadth-rule judgment under a model is explicitly a "design reference, not part of
this suite" (`spec.md:271-272`, `304`). This is **honest and acceptable** (the spec
says so), but the AC6 prose ("never flagged") reads stronger than the mock oracle
delivers. Optional: add half a sentence to AC6 noting that absent a specced
pre-scan, AC6's deterministic portion verifies the *loop approves on an approve
verdict*, and the breadth-rule judgment itself is covered by the
design-reference real-model check. The `and/or` fallback already keeps AC6
testable unconditionally, so this is wording, not a gap.

---

## What is solid (for the record — these were checked, not assumed)

- **Faithful to intent, no goal substitution.** Overview + R1–R3 keep the stated
  goal (general guidance, blatant leakage detected before the edit is accepted).
  Not silently upgraded to a generalization guarantee.
- **Hard constraint 1 — judge stays skill-blind.** C1 explicit; verified the judge
  prompt still forbids consulting skill docs (`judge-agent.ts:111`); the fix lives
  in the new validator, not the judge.
- **Hard constraint 2 — no held-out gate / small-corpus.** C2 explicit; R3's
  breadth test ("fingerprint of exactly one scenario?") is the mechanism that makes
  small corpora work without a split. Internally consistent with C2.
- **Honest scope preserved and prominent.** Overview "Honest scope (load-bearing
  framing)," C6, R3a (precision bias), D2 honest caveat, and Out-of-Scope all hold
  the legible-not-subtle line and the advisory-in-loop / authoritative-at-PR
  framing. No over-claiming.
- **Backward-compat is forced and provable.** C4 + AC4 anchor on the existing
  untouched loop test; verified that test asserts no-git (`!skills.diff`) and uses
  the MOCK_GATE/MARKER sentinels the new LEAK_TOKEN mirrors.
- **No implementation leakage into the spec.** Requirements state *behavior*
  (catch forms a–c reliably, attempt d; in-process/ephemeral/no-git capture; role
  reuse) and correctly defer the pre-scan-vs-pure-LLM and loop-helper mechanics to
  design (D5, Out-of-Scope last bullet). Good phase hygiene.
- **Fail-open + evidence-trail distinction (R8/AC7)** and **verdict shape
  (R9/AC2)** are precise and testable as pure-function tables.

Fix B1 (and ideally N1/N2) and this spec is ready for design.
