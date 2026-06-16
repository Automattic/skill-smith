# Spec — Surface misconfigured-agent skips early in the run

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)

## Overview

When a user runs `skillsmith` and a configured agent/model is unavailable (for example
its required API key is not set), that agent is detected as misconfigured and skipped.
This already ships (the v3 "skip misconfigured agents" feature, PR #45 open on this
branch). Today, however, the user is told **which** agent was skipped and **why** only at
the very end of the run, when the command exits.

The PR owner, testing v3 locally, flagged this: a user would want to know early in
execution that a configured model is unavailable and why — at the moment the
misconfiguration is detected — consistent with how other errors are already surfaced.
That way they can stop the run, fix their environment, and re-run instead of waiting for
a full run to finish before learning the agent never ran.

This is an **incremental** change. It alters only **when and how** the test- and
improver-role skips are announced. It does **not** change the skip behavior, the
end-of-run summary, the report format, or exit codes — all of that stays exactly as the
v3 feature shipped. The change is **additive**: a new early announcement is added; the
existing end-of-run announcement remains.

### Background: where the relevant behavior lives today

- **Detection** happens once, up front, in `classifyRunnability(config, process.env)`
  (`src/runnability.ts`), called from `src/pipeline/pipeline.ts`. It is pure and
  synchronous and returns a `RunnabilityResult` containing a `skipped: SkippedAgent[]`
  list, where each `SkippedAgent` is `{ id, roles, reason }` and `reason` reads like
  `"<REQUIRED_ENV> is not set"` (e.g. `"OPENAI_API_KEY is not set"`). Detection happens
  **before** the live `ProgressTracker` is constructed.
- **Three kinds of skip**, by the role that is unavailable:
  - **Judge skip** (`STOP_RUN`): already announced **early** via a one-shot
    `console.error(...)` immediately after detection, then the run returns exit code 2.
    This is the de-facto "similar to other errors" precedent (cf. precondition /
    user-facing errors elsewhere, which also `console.error` and return before any live
    dashboard). It already fires before the tracker exists, so it has no live-output
    conflict.
  - **Test-role skip** (`EXCLUDE_LANE`) and **improver-role skip**
    (`HALT_AFTER_ITERATION`): these are the skips currently surfaced **only at command
    exit**, via the end-of-run `SKIPPED AGENTS` summary block
    (`prepareSummary` → `pushSkipBlock` in `src/reports/summary.ts`, printed by
    `emitSummary`). **This is the "appears at the end" the owner reported.**
- **The live-output update mechanism** is the `ProgressTracker`
  (`src/progress/tracker.ts`). It repaints a compact dashboard block to its stream
  (default `process.stderr`) on each event. In **interactive** mode (TTY) it overwrites
  the prior block in place using ANSI cursor escapes — it walks the cursor up
  `lastPaintedLines` rows, erases, and repaints. It tracks `lastPaintedLines` from the
  rendered block height. **Any raw stderr write made *after* the tracker starts painting
  is not counted in `lastPaintedLines`**, so the next repaint walks up the wrong number of
  rows and clobbers or pushes the message down. This is exactly the corruption the owner
  warns against ("respect the logic that updates the printed output so the text is not
  pushed down"). A guard already encodes this in the codebase: `RunLog` defaults
  `mirrorStderr: false` with the note that "the progress tracker owns the live stderr
  view," and the pipeline only enables mirroring in verbose/non-interactive mode. So a
  naive `console.error` / `process.stderr.write` during the live run is precisely the
  anti-pattern.
- **Interactive vs. non-interactive.** The tracker is non-interactive when the stream is
  not a TTY and in verbose mode (the pipeline passes `{ interactive: false }` when
  verbose). In **non-interactive** mode the tracker writes its block **only at
  `finish()`** — it paints nothing during the run. The existing test harness runs
  non-TTY, so a notice routed *purely* through the tracker would only surface at
  `finish()` in tests and in CI/verbose runs — re-introducing the exact "appears at the
  end" defect in those modes, and making "early" untestable by output capture.
- The live dashboard (`renderSnapshot` in `src/progress/render.ts`) currently renders a
  header, iteration, scenarios bar, phases bar, elapsed, and a `failures` section. There
  is **no** "skipped agents" notice in the live dashboard, and `RunSnapshot`
  (`src/progress/types.ts`) has no skip field. The tracker has no agent-level skip method.

## Requirements

**R1 — Detection point is the announcement trigger.** The early announcement is emitted
at the moment the misconfiguration is known: immediately after `classifyRunnability`
(`src/pipeline/pipeline.ts`), using the in-memory `runnability.skipped` list
(`SkippedAgent = { id, roles, reason }`), before any scenario work runs. No new detection
logic is added — reuse the existing `RunnabilityResult`.

**R2 — Scope of the early announcement: test- and improver-role skips** (consequences
`EXCLUDE_LANE` / `HALT_AFTER_ITERATION`). These are exactly the skips currently surfaced
only at command exit. The judge `STOP_RUN` skip is already announced early and is left
unchanged (see R7).

**R3 — Each announced skip names the agent id AND the reason** (for example
`"<id>: <REQUIRED_ENV> is not set"`), so the user learns **which** agent/model is
unavailable and **why**, early enough to fix the environment and re-run.

**R4 — Respect the live-output update logic (interactive/TTY).** When the live dashboard
is active, the announcement is rendered **through the `ProgressTracker`** so it is part of
the in-place repaint and does **not** get pushed down, overwritten, or corrupt the cursor
math. Concretely: a distinct "skipped agents" section is added to `RunSnapshot` /
`renderSnapshot` — visually distinct from the failures section (continuing the
established three-way color convention: red failures, yellow per-cell SKIPPED, cyan
agent-level `SKIPPED AGENTS`) — and is populated at/just after tracker construction so the
tracker's **first** paint already includes it. It is **NOT** a raw stderr write while the
dashboard repaints, and it must **not** be added to the `failures` list (a whole-agent
config skip has no scenario and no phase, does not fit the `Failure` shape, and must not
inflate the `failures (K):` count).

**R5 — Early in non-interactive/verbose mode too.** Where the tracker does not repaint
during the run (non-TTY, and verbose mode where `interactive:false`), the announcement is
emitted as an early plain line on stderr at detection time — there is no live in-place
dashboard to corrupt in that mode, so this is safe and is the correct way to be early,
mirroring the judge-stop precedent. Net effect across R4 + R5: the early announcement
appears **early in BOTH modes**. A purely-through-the-tracker solution is explicitly
insufficient because in non-interactive mode the tracker only writes at `finish()`.

**R6 — Skip BEHAVIOR is unchanged (v3 preserved).** Misconfigured agents remain excluded
from all phases of the run. Untouched: the runnable allowlist / `agentIdFilter`, the
`runnability.skipped` threading, the top-level `skipped` array in `report.json`, and exit
code 2 when any agent is skipped (`summary.ts`). This review changes only **when and how**
the skip is announced — never which agents are skipped or what the process exits with.

**R7 — End-of-run summary is unchanged (additive change).** The final `SKIPPED AGENTS`
block (`src/reports/summary.ts`) and its `summary.txt` mirror remain exactly as-is, and
the judge `STOP_RUN` early message remains exactly as-is (already conformant — it prints
at detection, before the tracker exists, then returns 2). The new early announcement is
**ADDITIVE**. The early and end-of-run surfaces are **independent data paths** — the early
announcement reads the in-memory `runnability.skipped` list; the end-of-run block reads
`report.json`'s `skipped` array — and they **intentionally both name the skipped agents**
(a live up-front notice vs. a consolidated persisted record). This duplication is
deliberate and is not accidental double-reporting.

## Out of Scope

- Removing or relocating the end-of-run `SKIPPED AGENTS` summary block or its `summary.txt`
  mirror (R7 — additive only).
- Changing the judge `STOP_RUN` early message (already conformant — prints at detection,
  before the tracker, then returns 2).
- Any change to the skip MECHANISM: which agents are skipped, the `agentIdFilter` /
  runnable allowlist, the `runnability.skipped` threading, the `report.json` `skipped`
  array, or exit codes (R6).
- New detection logic — reuse the existing `classifyRunnability` / `RunnabilityResult`.

## Acceptance Criteria

- **AC1 (early, test-role).** A run with a misconfigured test agent (and at least one
  runnable test agent) prints an announcement naming the skipped agent id and reason at
  detection time — **before any scenario/phase output**. This is asserted on captured
  stderr **ordering** in the existing non-TTY test harness (`skip-misconfigured.test.ts`
  style): the announcement must appear before the first scenario/phase line, not merely
  appear somewhere. The runnable agent is still graded; the `report.json` `skipped` array
  is unchanged.

- **AC2 (early, improver-role).** A run with a misconfigured improver prints the early
  announcement naming it and its reason before scenario work; the iteration still
  completes and then halts (existing v3 behavior), unchanged.

- **AC3 (live-output safety, interactive).** In interactive/TTY mode the announcement is
  emitted through the tracker (part of the repaint) and does not corrupt the dashboard or
  push it down. Verifiable via a tracker/render unit test: the snapshot's skip section
  renders distinctly (not in the failures list, not inflating the failures count) and the
  in-place repaint math (`lastPaintedLines` / rendered block height) accounts for it.

- **AC4 (early in verbose/non-TTY).** With `interactive:false` (verbose / non-TTY), the
  announcement still appears early — not only at finish. Asserted by stderr **ordering** in
  a non-TTY capture (announcement before any scenario/phase output).

- **AC5 (end block unchanged).** All existing `summary.test.ts` assertions covering the
  end-of-run skip block, exit code 2, and `summary.txt` remain green with no changes.

- **AC6 (behavior unchanged).** Existing `skip-misconfigured.test.ts` assertions on the
  report-level `skipped` array, exit code 2, the judge `STOP_RUN` early stderr message, and
  exit-code precedence remain green with no changes.

- **AC7 (no false signal).** A run with NO skips produces no early announcement and no
  skip section in the live dashboard (regression guard).
