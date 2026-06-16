# Spec research — Surface misconfigured-agent skips early in the run

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)

## Scope (from intent)

This is an **incremental** review. The "skip misconfigured agents" feature already
shipped (v3); PR #45 is open on this branch. This change alters only **when and how**
the skip is announced:

- **When**: surface the skip **early, at detection time** (when the misconfiguration
  is known), not at command exit — consistent with how other errors are surfaced.
- **How**: the announcement must **respect the existing live-output update logic** so
  it does not get pushed down / corrupt the dynamically-updating terminal output.
- **Unchanged**: the skip behavior itself (misconfigured agents excluded from all
  phases) must NOT change.

## Open questions (intent)

- Where is misconfiguration detected, and where is the announcement currently emitted?
- What is the existing early-error-surfacing pattern to follow/reuse?
- What is the live-output update mechanism, and how must the message integrate with it?

## Codebase findings (analyst's own read, to be cross-checked with researcher)

**Detection** — `classifyRunnability(config, process.env)` in `src/runnability.ts:59`,
called once up front at `src/pipeline/pipeline.ts:94`. Pure/synchronous; returns
`RunnabilityResult { runnableTestAgentIds, skipped: SkippedAgent[], judgeRunnable,
improverRunnable }`. Each `SkippedAgent` carries `{ id, roles, reason }` (reason e.g.
`"ANTHROPIC_API_KEY is not set"`). Detection happens **before** the `ProgressTracker`
is constructed (`pipeline.ts:127`).

**Where the skip is announced today:**
- Judge skip (consequence `STOP_RUN`): already printed **early** via `console.error`
  at `pipeline.ts:103-105`, then `return 2`. This happens before the tracker exists,
  and the run bails immediately — no live-output conflict.
- Test / improver skips (`EXCLUDE_LANE` / `HALT_AFTER_ITERATION`): carried in
  `runCtx.skipped` / `runnability.skipped` and written into `report.json`
  (`writeRunReport`, `pipeline.ts:202-207`). The **user-facing announcement** for
  these appears only at the very end: `prepareSummary` → `pushSkipBlock`
  (`src/reports/summary.ts:201-212`, the `SKIPPED AGENTS` block), printed by
  `emitSummary` at `pipeline.ts:310`. **This is the "appears at the end" the owner
  reported.**

**Existing early-error-surfacing pattern ("similar to other errors"):**
- `runner.ts:41` — `PreconditionError` / `UserFacingError` → `console.error(message)`,
  return 1 (printed immediately, before any tracker).
- `pipeline.ts:103-105` — judge-skip → `console.error(...)`, return 2.
  Both write a one-shot line to stderr before/instead of the live dashboard.

**Live-output update mechanism** — `ProgressTracker` (`src/progress/tracker.ts`):
- Repaints a compact dashboard **block** to `stream` (default `process.stderr`) on
  each event, throttled. In **interactive** mode (TTY) it overwrites the prior block
  in place using ANSI cursor escapes: `flush()` writes
  `\x1b[${lastPaintedLines}A\x1b[0J` to walk up and erase, then the new block
  (`tracker.ts:244-250`). It tracks `lastPaintedLines = terminalRows(block, columns)`.
- **The corruption risk:** any raw `console.error`/stderr write *after* the tracker
  starts painting is not counted in `lastPaintedLines`, so the next repaint's
  `\x1b[NA` walks up the wrong number of rows — clobbering or pushing the message
  down. This is exactly the owner's "respect the logic that updates the printed
  output so the text is not pushed down."
- The live dashboard (`src/progress/render.ts:renderSnapshot`) currently renders:
  header, iteration, scenarios bar, phases bar, elapsed, and a `failures` section.
  **There is no "skipped agents" notice in the live dashboard.**
- `interactive` is false in verbose mode (`pipeline.ts:135`: `verbose ? {interactive:
  false} : {}`) and when stream is not a TTY; non-interactive `flush()` only writes on
  `finish()` (`tracker.ts:251-253`).

**Implication for the fix (to confirm via Q&A):** the early announcement for
test/improver skips must either (a) be printed once *before* the tracker begins
painting (so the tracker paints its block below a static line), and/or (b) be
rendered *through* the tracker (as a new dashboard section / one-shot notice the
tracker accounts for in its cursor math). Option (a) fits the existing
`console.error`-before-tracker pattern; option (b) is needed only if the message must
appear while the dashboard is live.

## Q&A log

### Q1 — where is misconfiguration detected? (sent; awaiting researcher)

(analyst's pre-read above; cross-check with researcher's answer)

**Timeline of the run (analyst-verified):**
1. `pipeline.ts:94` — detection (`classifyRunnability`).
2. `pipeline.ts:103-105` — judge skip (`STOP_RUN`) prints early via `console.error`,
   returns 2. (Before the tracker exists; run bails — no conflict.)
3. `pipeline.ts:127` — tracker constructed. No paint yet (`tickTimer` set, but
   `onTick` no-ops until `lastPaintAt !== 0`).
4. `pipeline.ts:351` — `beginIteration()` → `requestPaint()` → **first `flush()`/paint**
   (inside `runOneIteration`). This is the first time the dashboard hits stderr.

**Safe window for an early static announcement:** between step 1/3 and step 4 the
stream is untouched by the tracker. A one-time line printed to stderr there sits
**above** the dashboard; the tracker then paints its block below it, and its repaint
cursor math (`\x1b[${lastPaintedLines}A`) only ever walks up its own block height —
never up to the static announcement. So a line printed *before the first paint* is not
pushed down or clobbered. This is the cleanest way to "respect the live-output update
logic" and it matches the existing `console.error`-before-tracker pattern
(`runner.ts:41`, `pipeline.ts:103`). *(To confirm with researcher: is "before first
paint" sufficient, or must the message also survive being re-emitted while the
dashboard is live, e.g. if the announcement should persist across iteration repaints?)*

## Established requirements

_(populated as answers firm up)_
