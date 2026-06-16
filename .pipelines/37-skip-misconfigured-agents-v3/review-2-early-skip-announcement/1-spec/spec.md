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

Verification is split by mode, matching what each harness can actually observe. The
non-TTY full-pipeline harness (`skip-misconfigured.test.ts`, under `src/__tests__/`)
captures **only `console.log` / `console.error`** — it does not intercept
`process.stderr.write`, and in non-interactive mode the `ProgressTracker` paints nothing
mid-run (it writes only at `finish()`), so there is no captured "scenario/phase line" to
order against. The early-in-non-TTY ACs (AC1, AC2, AC4) therefore assert on the
**captured `console.error`** channel that R5 routes the early announcement through. The
interactive live-output safety and first-paint earliness (AC3) are asserted at the
tracker/render layer, which DOES observe the painted block by injecting a `Writable` into
`TrackerOptions.stream` (as `progress-tracker.test.ts` already does).

- **AC1 (early, test-role; non-TTY capture).** A run with a misconfigured test agent (and
  at least one runnable test agent), run through the existing non-TTY harness
  (`skip-misconfigured.test.ts`, under `src/__tests__/`), emits the early announcement on
  the **captured `console.error`** channel. Asserted by substring match on captured
  stderr: it names the skipped agent **id** (e.g. `gpt`) AND the **reason** (e.g.
  `OPENAI_API_KEY is not set`) — matching how the existing judge-stop test asserts
  (`/gpt/`, `/OPENAI_API_KEY is not set/`), not an exact format string. For ordering, the
  announcement is emitted at detection time (immediately after `classifyRunnability`,
  before any agent loop runs), so it **precedes any later captured `console.*` text the
  harness DOES capture** (e.g. the end-of-run summary lines on stdout); there is no
  captured scenario/phase line to order against, so no such clause is asserted. The
  runnable agent is still graded; the `report.json` `skipped` array is unchanged.

- **AC2 (early, improver-role; non-TTY capture).** A run with a misconfigured improver,
  through the same non-TTY harness, emits the early announcement on **captured
  `console.error`** naming the improver id and reason (substring match, as in AC1). The
  iteration still completes and then halts (existing v3 behavior), unchanged.

- **AC3 (live-output safety + first-paint earliness, interactive).** Asserted at the
  tracker/render layer by injecting a `Writable` into `TrackerOptions.stream`
  (`progress-tracker.test.ts` pattern) and, for the render half, by calling
  `renderSnapshot` directly (`progress-render.test.ts` pattern). It checks all of:
  - **Distinctness (render).** A `RunSnapshot` carrying a skip entry renders a skip
    section visually distinct from failures (cyan agent-level `SKIPPED AGENTS`, per the
    three-way color convention), the entry is **not** in the `failures` list, and it does
    **not** inflate the `failures (K):` count.
  - **First-paint inclusion (tracker).** The **first** emitted interactive block already
    contains the skip section (skip list populated at/just after tracker construction, per
    R4) — mirroring the existing first-paint assertion in `progress-tracker.test.ts`.
  - **Repaint safety (tracker, observable).** After a subsequent event, the next paint's
    in-place erase prefix matches `/^\x1b\[(\d+)A\x1b\[0J/` and its cursor-up row count
    accounts for the skip section's height — asserted on the **observable erase-count /
    block height** in the captured `Writable` chunks (as `progress-tracker.test.ts`
    already does), not on the tracker's private `lastPaintedLines` field.

- **AC4 (early in verbose/non-TTY; captured channel).** With `interactive:false` (verbose
  / non-TTY) the early announcement still appears at detection time — not only at
  `finish()`. Asserted the same way as AC1/AC2: the announcement is present on the
  **captured `console.error`** channel (substring match on id + reason), emitted at
  detection before the agent loop runs. (No captured scenario/phase line exists in this
  mode either; the ordering claim is carried by AC3's first-paint assertion for the
  interactive path.)

- **AC5 (end block unchanged).** All existing `summary.test.ts` (under `src/__tests__/`)
  assertions covering the end-of-run skip block, exit code 2, and `summary.txt` remain
  green with no changes.

- **AC6 (behavior unchanged).** Existing `skip-misconfigured.test.ts` (under
  `src/__tests__/`) assertions on the report-level `skipped` array, exit code 2, the judge
  `STOP_RUN` early stderr message, and exit-code precedence remain green with no changes.

- **AC7 (no false signal).** A run with NO skips produces no early announcement on the
  captured `console.error` channel and no skip section in a rendered `RunSnapshot` /
  tracker paint (regression guard, checkable at both the non-TTY harness and the
  render/tracker layer).
