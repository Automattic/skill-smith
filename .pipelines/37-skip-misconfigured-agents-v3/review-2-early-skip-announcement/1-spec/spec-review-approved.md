# Spec review — APPROVED

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)
Reviewer: spec-reviewer
Verdict: **Approve** — the single blocking defect is fixed and all three non-blocking
notes were handled. The spec is testable, code-grounded, standalone, internally
consistent, and free of scope creep.

## Blocking defect from review 1 — RESOLVED

Review 1 rejected on one issue: AC1/AC2/AC4 prescribed an ordering assertion against a
captured "scenario/phase line" that the named non-TTY harness does not produce, so they
could not pass as written. The revision adopts option (c) and resolves it cleanly:

- **AC1/AC2/AC4 now assert on the captured `console.error` channel.** That channel is
  genuinely intercepted by the harness (`runWithoutOpenAIKey` overrides `console.error`,
  `skip-misconfigured.test.ts:39-41`), and R5 routes the early announcement through it.
  Substring match on id + reason (`/gpt/`, `/OPENAI_API_KEY is not set/`) mirrors the
  existing judge-stop assertions (`skip-misconfigured.test.ts:169-174`).
- **The unobservable clause is gone.** AC1 explicitly drops "before the first
  scenario/phase line" and states "there is no captured scenario/phase line to order
  against, so no such clause is asserted" (spec.md:158-159); AC4 repeats this
  (spec.md:188-189). This is exactly the defect, removed.
- **The residual ordering claim is satisfiable.** AC1's "precedes any later captured
  `console.*` text … e.g. the end-of-run summary lines on stdout" has two real,
  captured operands: the early `console.error` fires at detection (after the judge-stop
  guard at `pipeline.ts:102-107`, before the agent loop), and the summary prints at the
  end via `emitSummary`. Both are captured by the harness.
- **The interactive ordering / earliness moves to where it is observable (AC3).** The
  first-paint and repaint-safety properties are asserted at the tracker/render layer that
  injects a `Writable` — the correct seam for those properties.

## Non-blocking notes from review 1 — all handled

- **N1 (cursor-math asserted via a private field).** AC3's "Repaint safety" now asserts
  on the observable erase prefix `/^\x1b\[(\d+)A\x1b\[0J/` and the cursor-up row count in
  the captured `Writable` chunks (spec.md:178-181), explicitly **not** the private
  `lastPaintedLines`. This is the exact pattern `progress-tracker.test.ts:114-149`
  already uses (regex at `:142`, `eraseRows` check at `:144-148`).
- **N2 (first-paint inclusion).** AC3 adds a dedicated "First-paint inclusion (tracker)"
  clause: the first emitted interactive block already contains the skip section
  (spec.md:174-176), mirroring `progress-tracker.test.ts:32-51`.
- **N3 (reason-string brittleness).** Folded into AC1's substring approach (id + reason
  substrings, not an exact format string).

## Re-verified against the code (claims that still hold)

- Harness captures `console.log`/`console.error` only, not `process.stderr.write`
  (`skip-misconfigured.test.ts:32-41`). (AC1/AC2/AC4 channel)
- Judge-stop precedent: `console.error` then `return 2` at `pipeline.ts:102-107`, before
  the tracker is built (`:127`); tracker uses `verbose ? { interactive:false } : {}`
  (`:135`). Detection at `:94` precedes the agent loop. (R1, R5, ordering)
- Tracker flush writes the erase prefix `\x1b[${lastPaintedLines}A\x1b[0J`
  (`tracker.ts:245-249`), matching AC3's regex; non-interactive writes only on `finish()`
  (`:251-253`). `progress-tracker.test.ts` injects a `Writable` (`:6-15`), asserts the
  first event paints immediately (`:32-51`), and asserts the erase-row count on captured
  chunks (`:84-112`, `:114-149`). (AC3 first-paint + repaint safety)
- `renderSnapshot` is pure and called directly in `progress-render.test.ts`; the failures
  section is `failures (${snap.failures.length}):` (`render.ts:60-62`). Color convention:
  red `✗` (`render.ts:149`), yellow skip (`render.ts:86`), cyan agent-level SKIPPED
  AGENTS (`summary.ts`). A whole-agent skip does not fit `Failure` and would inflate the
  `failures (K):` count if reused — the spec correctly forbids that. (AC3 distinctness)
- `RunSnapshot` (`types.ts`) has no skip field, `renderSnapshot` has no skip branch, and
  the tracker has no agent-level skip method — the implementation adds all three, as the
  spec states. (R4)

## Integrity checks

- **Requirements R1–R7** unchanged from review 1, where I verified each load-bearing
  code claim; they remain sound and grounded.
- **Scope intact.** Additive only: end-of-run `SKIPPED AGENTS` block, `summary.txt`
  mirror, exit code 2, the skip mechanism, and the judge `STOP_RUN` message are all
  out of scope and untouched (AC5/AC6 pin them green with no changes).
- **Standalone and consistent.** The AC preamble (spec.md:137-146) correctly explains
  the mode split — why the non-TTY ACs assert on `console.error` and why interactive
  earliness/safety is asserted at the tracker/render layer. AC7 guards the no-skip case
  at both layers.

## Minor residual nit (not blocking, no action required)

AC3's "Repaint safety" says the cursor-up count "accounts for the skip section's
height." The established, satisfiable form of that check in
`progress-tracker.test.ts:114-149` is a relative assertion (erase rows grow with the
rendered block). That is the right target and the AC names the observable, so this is
fine as written.
