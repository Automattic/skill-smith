# Spec review — APPROVED

Reviewer: `spec-reviewer` (adversarial, single-shot). Iteration N=2.
Target: `1-spec/spec.md` (revised). Context: `0-prompt/prompt.md`,
`1-spec/spec-research.md`, prior rejection `1-spec/spec-review-1-rejected.md`.

Verdict: **Complete and correct.** All three prior blocking issues are genuinely
resolved, and a fresh adversarial pass over the whole spec finds nothing new,
contradictory, untestable, or silently dropped, and no over-reach into design/HOW
for settled requirements. I would stake the implementation on this spec.

---

## Prior blocking issues — all resolved

### B1 — Open items restored as genuine, code-grounded design decisions ✓

The gutted two-item list is replaced with six items (spec lines 253–294) that
match the research's deferred decisions and are framed as HOW, not restatements
of settled requirements ("none is settled here"):

1. Exit-code chokepoint threading mechanism — non-PASS marker/row vs. a new
   top-level "excluded agents" field; both shapes named (behind R3.3/R3.4).
2. New status/verdict kind (`excluded`/`misconfigured`) vs. reuse `SKIPPED`
   (behind R3.2).
3. Provider→credential expression (extend the `Provider` contract vs. a separate
   provider→env mapping) AND whether `codex` opts into the `OPENAI_API_KEY` check
   (behind R1.2/R1.3/R5).
4. Export `UserFacingError` (internal-only today) vs. reuse a precondition/abort
   path for the judge stop (behind R4.1).
5. The R5 public-API surface/signature.
6. The nano model id string.

The two prior fake "open items" (R4.4 restated; R1.3 restated) are gone. Items
1–4 are each recorded as a load-bearing design decision.

### B2 — `codex` accounted for explicitly ✓

Definitions (lines 52–56) now name `codex`: it "reads the same `OPENAI_API_KEY`
but does NOT pre-check it today, so its static-misconfiguration status is an
explicit decision." R1.3 (lines 79–86) lists `codex` in the
not-statically-misconfigurable set with the qualifier "unless the design opts it
into the `OPENAI_API_KEY` check" and states "Whether `codex` opts in is an Open
item." Out of Scope (lines 306–309) carries the same qualifier; Open item 3
carries the opt-in choice. Verified against `src/providers/codex.ts:65`
(`apiKey: process.env.OPENAI_API_KEY`, the file's only `OPENAI_API_KEY`
reference, with no pre-check). codex's status is now fully defined.

### B3 — "Playwright" un-genericized; concrete AC5 artifacts restored ✓

The spec uses "Playwright" where the prompt and code do (Overview lines 14/36–38,
R6.1 line 154, AC5). AC5.1 (lines 225–241) restores the concrete verifiable
artifacts:
- `${iterationDir}/tests-report.json` with results keyed by `projectName` for the
  configured (`haiku`) agent and NONE for `openai-api-nano`;
- the merged `${runDirectory}/report.json` carrying no "e2e failed" attributed to
  `openai-api-nano`, and surfacing it as misconfigured/excluded —
  machine-distinguishable from an e2e failure (mirroring AC2.4).

Verified the artifacts exist: `tests-report.json` at
`testing-project/eval/utils/verify-e2e.ts:97` (written via
`PLAYWRIGHT_JSON_OUTPUT_NAME`), `projectName` attribution at `verify-e2e.ts:199`,
merged `${runDirectory}/report.json` at `src/reports/iteration-report.ts:149`.
The prior non-blocking note (name the merged report in AC5.1) is also addressed.

---

## Fresh adversarial pass — what I verified

- **Default "warn" + NON-ZERO exit, chokepoint anti-regression.** R3.3 (lines
  113–118) and AC2.1 thread an exclusion signal to the single chokepoint and
  forbid "merely dropping the row." Matches `src/reports/summary.ts:66–67,76`
  (`allPass = rows.length > 0 && rows.every(isRowPass)`, `exitCode: allPass ? 0 :
  1`) exactly. ✓
- **Role-aware semantics.** Judge stops (R4.1/AC3.1); improver degrades to
  test-only WITHOUT forcing non-zero, exit derives from the test/judge matrix
  (R4.2/AC3.2); test agent warns (R4.3); all-test-agents-misconfigured stays a
  failure (R3.4/AC2.3). Exit-code differentiation is correct and consistent. ✓
- **Single policy seam.** Warn implemented now; fail/skip out of scope but
  addable by a localized change at the seam (R2, AC4.1, Out of Scope). The
  future-"skip" caveat re-establishing the all-excluded guard is preserved. ✓
- **Public runnability API.** Named export from the public entry point, pure +
  synchronous over config input + env, consumed at both the runtime exclusion
  point and the e2e harness (R5.1/R5.2, AC1). `src/index.ts` is the sole public
  surface and does not export this today, so a new named export is required —
  consistent with the spec. ✓
- **`npx skillsmith counter` / no-OpenAI-creds acceptance** (AC5.1) and the
  with-credentials inverse (AC5.2, exclusion conditioned on actual
  misconfiguration). ✓
- **Shipped-deliverable constraints.** Isolated component, minimal change, sparse
  comments, no internal-process vocabulary (R7, AC6). R7.4 and the Definitions
  note correctly scope the vocabulary ban to shipped deliverables, not this
  document. ✓

No new contradictions, untestable criteria, or silently-dropped requirements.
The "misconfigured" vs "failed" boundary, the emergent all-excluded guard, and
the `UserFacingError` internal-only premise all hold against the worktree.

## Summary

B1, B2, B3 fully resolved; the rest of the spec remains correct and testable. The
core anti-regression logic is unchanged and sound. Approved.
