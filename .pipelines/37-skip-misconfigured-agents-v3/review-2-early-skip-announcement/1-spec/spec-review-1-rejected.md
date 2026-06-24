# Spec review 1 — REJECTED

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)
Reviewer: spec-reviewer
Verdict: **Reject** — one blocking defect (acceptance criteria not testable as written).

## Summary

The requirements (R1–R7), scoping, and rationale are strong and well-grounded — I
verified every load-bearing code claim against the branch and they hold (see
"Verified" below). The spec is standalone, internally consistent, aligned with the
intent (early-at-detection, respect live output, additive), and free of scope creep.

It is rejected on a single but blocking issue: **AC1, AC2, and AC4 prescribe an
ordering assertion against output the named test harness does not capture, so they
cannot pass as specified.** A spec's acceptance criteria must be verifiable; these
three are not. The fix is small and local to the Acceptance Criteria section — the
requirements themselves are sound and need no change.

---

## BLOCKING — AC1 / AC2 / AC4 are unsatisfiable as written

### What the ACs require

- **AC1:** "asserted on captured stderr **ordering** in the existing non-TTY test
  harness (`skip-misconfigured.test.ts` style): the announcement must appear before
  the first scenario/phase line, not merely appear somewhere."
- **AC2:** "prints the early announcement naming it and its reason before scenario
  work" (same harness, same ordering premise).
- **AC4:** "Asserted by stderr **ordering** in a non-TTY capture (announcement before
  any scenario/phase output)."

All three depend on a captured stderr stream that contains BOTH (a) the early
announcement AND (b) a "scenario/phase line" to order it against.

### Why that capture does not exist

1. **The harness captures only `console.log` / `console.error`.** In
   `skip-misconfigured.test.ts:36-41`, `runWithoutOpenAIKey` overrides `console.log`
   and `console.error`. It does **not** override `process.stderr.write`.

2. **All mid-run scenario/phase output is painted by the `ProgressTracker` via
   `this.stream.write`, not `console.error`.** The tracker's stream defaults to
   `process.stderr` (`tracker.ts:87`) and it emits with `this.stream.write(...)`
   (`tracker.ts:249, 252`) — i.e. `process.stderr.write`, which the harness does not
   intercept. Scenario/phase progress is driven exclusively through the tracker
   (`agent-loop.ts:174, 197, 223, 239, 265` → `phaseStarted` / `phaseFinished`). A
   grep confirms the ONLY `console.error` of run-phase text is the judge-stop at
   `pipeline.ts:103` — there is no `console.*` "scenario/phase line" anywhere in the
   run path.

3. **The harness is non-TTY, so the tracker is non-interactive and writes nothing
   mid-run.** `flush()` only writes when `interactive` (mid-run) or, in
   non-interactive mode, when `finished` (`tracker.ts:244-253`). The non-interactive
   single-final-paint behavior is pinned by `progress-tracker.test.ts:151-167`. So in
   this harness no dashboard text reaches the stream during the run at all; even the
   final block at `finish()` goes via `process.stderr.write` and is uncaptured.

4. **The pipeline gives no seam to inject a capturable stream.** `PipelineParams`
   (`pipeline.ts:47-53`) and `run()` (`runner.ts:29-46`) expose no `stream`/tracker
   override; the tracker is constructed with the default `process.stderr`
   (`pipeline.ts:127-136`). By contrast, the unit tests that DO observe tracker output
   inject a custom `Writable` into `TrackerOptions.stream`
   (`progress-tracker.test.ts:6-14, 35-40`) — a path the full-pipeline harness cannot
   use.

### Net effect

In `skip-misconfigured.test.ts`, the captured stderr will contain the early
announcement (if it is routed through `console.error`, per R5) and **nothing else** —
no scenario/phase line to be "before." The assertion "appears before the first
scenario/phase line, not merely appear somewhere" therefore has no second operand and
cannot be written against this harness. AC1/AC2/AC4 are unsatisfiable exactly as
specified.

This is the testability risk the spec-research already flagged
(`spec-research.md:170-190`, "Testability concern"): it warned that a purely
through-the-tracker notice is untestable by capture in non-TTY mode and that an
acceptance test "must assert the announcement appears **before** any scenario/phase
output (ordering)." The ACs restate that ordering requirement but do not supply a
mechanism by which the harness can observe both sides of the ordering. The gap between
the research's warning and the ACs' verification mechanism is the defect.

### Required fix (pick one and state it concretely in the AC)

The requirements can stay as-is. Make AC1/AC2/AC4 assert something the harness can
actually observe. Acceptable approaches — the spec should commit to one so the
implementer and the code-reviewer share a single, checkable target:

- **(a) Assert on what IS captured.** In non-interactive/non-TTY mode (R5 path) the
  early announcement is the only stderr the harness captures and it is emitted at
  detection, before `runScenario`/`runAgents` ever execute. Reframe the AC as: the
  announcement appears in captured stderr (`console.error`) AND no graded artifact for
  any scenario yet exists at the moment it is emitted — e.g. assert the announcement
  is present in captured `stderr` and that it names id + reason, and (for ordering)
  that it precedes any judge-stop / summary text the harness DOES capture. Drop the
  unobservable "before the first scenario/phase line" clause, since no scenario/phase
  line is captured here.

- **(b) Give the pipeline/runner a stream-injection seam** (e.g. an optional
  `stderr`/`progressStream` on `RunOptions`/`PipelineParams` threaded to
  `TrackerOptions.stream`) so a new full-pipeline test can capture the tracker's
  writes alongside the announcement and assert true ordering on one combined stream.
  If chosen, note this adds a small production seam (call it out so it isn't flagged as
  scope creep), and that the announcement must share that same stream to be ordered
  against the dashboard.

- **(c) Split the verification by mode and move the ordering claim to where it lives.**
  Assert "early in non-TTY/verbose" via captured `console.error` presence at detection
  (option a's observable), and assert the interactive ordering / live-output safety
  via a tracker/render unit test that injects a `Writable` and checks the skip section
  is present in the FIRST paint and inside the in-place repaint (this is already
  AC3's mechanism — extend AC3 to also cover "the skip section is in the first paint").

Whichever is chosen, AC1/AC2/AC4 must name the observable channel and the concrete
assertion, and must not depend on a captured "scenario/phase line" that the harness
does not produce.

---

## Non-blocking notes (address if convenient; not grounds for rejection)

- **N1 — AC3 "in-place repaint math accounts for it" is under-specified as a unit
  test.** `lastPaintedLines`/`terminalRows` are private to the tracker
  (`tracker.ts:82, 250, 371-378`) and are exercised only through observable stream
  writes. The render-level half (snapshot skip section renders distinctly, not in
  `failures`, not inflating the `failures (K):` count) is cleanly unit-testable via
  `renderSnapshot` (`progress-render.test.ts`). The cursor-math half is best asserted
  the way `progress-tracker.test.ts:115-150` already does it — inject a `Writable`,
  drive events, and check the next paint's `\x1b[NA` walks up the right number of rows
  with the skip section present. Consider naming that observable (the erase-count /
  block-height check) in AC3 rather than the private field, so the AC is checkable
  without reaching into internals.

- **N2 — AC3 should also assert the skip section appears in the FIRST paint.** R4 says
  the skip list is "populated at/just after tracker construction so the tracker's
  **first** paint already includes it." That "first-paint inclusion" is the property
  that makes interactive mode actually early; AC3 currently only asserts distinctness +
  repaint safety. Add a clause asserting the first emitted interactive block already
  contains the skip section (mirrors `progress-tracker.test.ts:32-50`).

- **N3 — Reason-string exactness.** R3/AC1 show `"<id>: <REQUIRED_ENV> is not set"`.
  The reason is built as `` `${requiredEnv} is not set` `` (`runnability.ts:46-48`),
  and the fixture yields `"OPENAI_API_KEY is not set"`
  (`skip-misconfigured.test.ts:118`). The `"<id>: "` prefix is a presentation choice
  the early announcement introduces; the end block already uses `  ${id}: ${reason}`
  (`summary.ts:209-210`). Fine as-is, but the AC could assert the substring
  (`gpt`, `OPENAI_API_KEY is not set`) rather than an exact format, matching how the
  existing tests assert (`skip-misconfigured.test.ts:169-174`, `summary.test.ts:326`),
  to avoid brittleness.

---

## Verified against the code (claims that hold)

These confirm the requirements are well-grounded; none are defects.

- Detection `classifyRunnability(config, process.env)` at `pipeline.ts:94`; pure,
  returns `{ runnableTestAgentIds, skipped, judgeRunnable, improverRunnable }`
  (`runnability.ts:28-33, 59-98`). `SkippedAgent = { id, roles, reason }`
  (`runnability.ts:13-17`); reason `` `${requiredEnv} is not set` `` (`:46-48`). (R1, R3)
- Judge `STOP_RUN` already announced early via `console.error` then `return 2` at
  `pipeline.ts:102-107`, before the tracker is built (`:127`). Mirrors the
  precondition/user-facing pattern at `runner.ts:40-43`. (R2 carve-out, R7, D3)
- Test/improver skips surfaced today only at exit via `pushSkipBlock` (cyan
  `SKIPPED AGENTS`, `summary.ts:201-212`) reading `report.json`'s `skipped`
  (`loadSkipped`, `:139-154`), printed by `emitSummary` at `pipeline.ts:310`. (R2, R7)
- Exit code 2 on any skip at `summary.ts:78`; top-level `skipped` written by
  `writeRunReport` (`pipeline.ts:202-207, 283-288`). Mechanism untouched. (R6)
- Tracker in-place repaint `\x1b[${lastPaintedLines}A\x1b[0J` + `terminalRows`
  tracking (`tracker.ts:244-250, 371-378`); non-interactive only writes on `finish()`
  (`:251-253`); `interactive:false` set when verbose (`pipeline.ts:135`). (R4, R5)
- `RunLog` defaults `mirrorStderr:false` — "the progress tracker owns the live stderr
  view" (`run-log.ts:10-13, 21, 26`). (R4 anti-pattern)
- `RunSnapshot` (`types.ts:42-55`) has no skip field; `renderSnapshot`
  (`render.ts:23-70`) has no skip branch; tracker has no agent-level skip method —
  the implementation must add all three. `scenarioSkipped` abuses
  `agentId:"—", phase:undefined` into `failures` (`tracker.ts:158-170`), which is
  exactly why a whole-agent config skip must NOT reuse `Failure` (`types.ts:10-15`).
  (R4)
- Three-way color convention: red failures (`render.ts:149`), yellow per-cell SKIPPED
  (`summary.ts:296-299`), cyan agent-level SKIPPED AGENTS (`summary.ts:208`). (R4)
- `summary.test.ts` skip/exit-2/`summary.txt` coverage is intact at the cited lines
  (311, 329, 369, 381, 406, 421, 439) — AC5's "no changes" is satisfiable. (AC5)
- `skip-misconfigured.test.ts` covers report `skipped`, exit 2, judge-stop early
  stderr, improver halt, exit-code precedence (`:75-303`) — AC6's "no changes" is
  satisfiable. (AC6)

(One harmless path nit: the spec/research refer to `skip-misconfigured.test.ts` /
`summary.test.ts` by basename; they live under `src/__tests__/`, not `test/`. The
basename references are unambiguous, so this is not a defect.)
