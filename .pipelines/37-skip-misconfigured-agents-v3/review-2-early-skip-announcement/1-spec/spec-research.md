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

## Open questions (intent) — ALL RESOLVED

- ~~Where is misconfiguration detected, and where is the announcement currently
  emitted?~~ → Detection: `classifyRunnability` (`runnability.ts:59` /
  `pipeline.ts:94`), once up front. Current announcement of test/improver skips: only at
  exit via `pushSkipBlock`/`emitSummary` (`summary.ts:201-212`, `pipeline.ts:310`). See R1/R2.
- ~~What is the existing early-error-surfacing pattern to follow/reuse?~~ → Judge-stop
  `console.error` before the tracker (`pipeline.ts:103-106`, returns 2) and
  precondition/user-facing errors (`runner.ts:40-43`). One-shot stderr line before the
  live dashboard. See R5/D3.
- ~~What is the live-output update mechanism, and how must the message integrate with
  it?~~ → `ProgressTracker` in-place repaint via ANSI cursor math (`tracker.ts:232-254`).
  Integrate by rendering through the tracker (distinct skip section) in interactive mode;
  plain early stderr line in non-interactive/verbose. See R4/R5/D2/D4.

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

### Q1/Q2 — researcher's confirmed findings (cross-checked, agreed)

Researcher CONFIRMED all analyst Q1 findings with the same line refs. Key additions:

**Design provenance (important for the spec rationale):** The v3 base design
*deliberately* surfaced skips **only** in the final static summary — "a one-shot print
after the dashboard's final paint that does not interact with the cursor re-render"
(base design-doc §7.2/§8, `.pipelines/.../base/2-design-doc/design-doc.md:417-449`),
and §6.4:367 noted "An early surface is possible if preferred, but the chosen design
avoids the extra branch." **This review reverses that specific choice for test/improver
skips.**

**The live-output guard already exists in the codebase:** `RunLog` defaults
`mirrorStderr: false` with the comment "the progress tracker owns the live stderr view"
(`src/util/run-log.ts:10-13,26`); the pipeline only enables mirroring in
verbose/non-interactive mode (`pipeline.ts:135` → `{ interactive: false }`). So a naive
`console.error` / `process.stderr.write` for the skip *during the run* is precisely the
anti-pattern that corrupts the cursor math. **The fix must route the announcement
THROUGH the tracker** (not a raw stderr write while the dashboard is live).

**Reuse target inside the tracker:** the tracker already surfaces things mid-run via
its `failures: Failure[]` list (`tracker.ts:77`), rendered in the "failures (K):"
section (`render.ts:60-67`). Existing mid-run entry points that record + repaint:
`scenarioSkipped(name, reason)` (`tracker.ts:158-170`, used at `pipeline.ts:358`) and
`phaseFinished(...,{status:"failed"})` (`tracker.ts:180-199`). `Failure = { scenario,
agentId, phase: PhaseName|undefined, detail }` (`types.ts:6-13`). There is **no**
agent-level skip method yet — the implementation adds one (e.g. `agentSkipped(id,
reason)` that records into the snapshot and repaints) OR seeds the skip list into the
tracker at construction (tracker is built at `pipeline.ts:127`, after detection at 94).

**"Early" ordering nuance:** the tracker does not paint until its first event-driven
paint (`onTick` guards on `lastPaintAt===0`; non-interactive only writes on `finish()`,
`tracker.ts:251-253`). So to surface early, the announcement must either (a) be seeded
so the tracker's *first* paint already includes it, or (b) trigger a paint itself.

**Unchanged (v3 behavior preserved):** skip MECHANISM is untouched — runnable
allowlist via `agentIdFilter`, `runnability.skipped`, exit code 2
(`summary.ts:78`), top-level `skipped` array in `report.json`. Only when/how the skip
is ANNOUNCED changes.

**Tests:** `skip-misconfigured.test.ts` asserts skips land in report.json's `skipped`
array and that the judge-stop message hits stderr early (lines 160-191); there is NO
existing test asserting test/improver skips are announced DURING the run. New
acceptance criteria need a test that the announcement appears at detection time and
goes through the tracker (not a raw stderr write).

**Open spec decisions surfaced by both analyst + researcher:**
- D1: Does the early announcement REPLACE the end-of-run `SKIPPED AGENTS` block, or is
  it ADDITIVE (early + final recap)? (Intent says "rather than only at the end" →
  early is required; whether the final block stays is a spec call.)
- D2: How is it rendered in the live dashboard — a distinct "skipped agents" section in
  the snapshot, vs. reusing the `failures` list?
- D3: Does the judge STOP_RUN message need to change, or is it already conformant
  (it already prints early, before the tracker, then returns)?
- D4: Verbose / non-interactive behavior (tracker `interactive:false`, only writes on
  `finish()`) — must the early announcement still appear early there, or is the
  through-the-tracker route acceptable to defer to `finish()` in that mode?

### Testability concern (analyst, feeds acceptance criteria)

The existing test harness (`skip-misconfigured.test.ts:28-54`) runs via
`console.log`/`console.error` overrides and is **not a TTY** → the tracker runs
**non-interactive** (only writes on `finish()`, `tracker.ts:251-253`). Consequence:

- The judge-stop test (lines 160-191) works because its message is a plain
  `console.error` that fires **immediately**, independent of TTY/tracker. That is the
  precedent for an "early, like other errors" announcement that is *observable in tests*.
- If the early test/improver skip notice is routed **purely** through the tracker, in
  non-interactive mode it would only surface at `finish()` — making "early" untestable
  by capture and arguably not actually early in non-TTY/CI runs.
- **Therefore** the spec should require the early announcement to be emitted at
  detection time through a path that fires immediately in BOTH interactive and
  non-interactive mode (e.g. the tracker seeds + paints immediately on being told the
  skip list, OR a dedicated early emit that the tracker accounts for so it isn't
  clobbered) — and an acceptance test must assert the announcement appears **before**
  any scenario/phase output (ordering), not merely that it appears somewhere.

This couples D2 and D4: whatever rendering path is chosen must fire immediately and
must not corrupt the in-place repaint when the dashboard is live.

### D1 RESOLVED — additive (keep end block; add early announcement)

Researcher pulled the actual PR #45 review thread (`gh api .../pulls/45/reviews`):
exactly ONE owner comment, text identical to intent.md, no inline replies/extra signal.
The complaint is strictly about **timing** ("appears at the end" → should be "at the
moment ... known"). Nothing in the intent or thread asks to remove/relocate the final
summary block. Intent Constraints (lines 21-24) name only two: respect live-output, and
preserve skip behavior — neither touches the end block.

**Decision: ADDITIVE.** Add an early, at-detection announcement; the existing
end-of-run `SKIPPED AGENTS` summary block (`summary.ts:201-212`) and exit-2 behavior
(`summary.ts:78`) are **unchanged**.
- Removing the end block (option b) would be out of scope and a regression beyond the
  review's stated change, and would force deleting a large deliberate test surface for
  no requested reason.
- "Recap" (option c) is (a) in code; spec phrases it as (a).
- The two surfaces serve different moments: early = live up-front notice (user can
  Ctrl-C and fix env without waiting); end = consolidated final record in console +
  `summary.txt`.
- **Test impact: ZERO changes to `summary.test.ts`** (all its skip/exit-2/`summary.txt`
  coverage at lines 311, 329, 369, 381, 406, 421, 439 stays green). New test surface is
  purely additive (assert early announcement during the run).
- **Spec must state explicitly:** the two surfaces both name the skipped agents
  (intentional duplication across two moments), and they are **independent data paths**
  — early reads in-memory `runnability.skipped`; end reads `report.json`'s `skipped`
  array (`summary.ts:139-154`). State this so a reviewer doesn't flag double-reporting.

### Q1 line-precision tweaks (researcher)

- Reason string literal is ``${requiredEnv} is not set`` (`runnability.ts:47`); exact
  env var depends on the provider descriptor. Fixtures use `openai-api` →
  `"OPENAI_API_KEY is not set"` (`skip-misconfigured.test.ts:118`). Same template.
- Judge early print is `pipeline.ts:103-106` then `return 2`. All other cites confirmed.

### D2 RESOLVED — distinct net-new "skipped agents" section (not the failures list)

Owner calls it an "info/warning message" — semantically NOT a failure (soft signal).
Strong grounding in code conventions:
- Established three-way color convention: red fail (`render.ts:149`), yellow per-cell
  SKIPPED (`summary.ts:296-299`), cyan agent-level `SKIPPED AGENTS`
  (`summary.ts:208`, base design §7.2:421-422 "visually distinct"). A distinct live
  section continues this convention.
- A whole-AGENT skip does not fit the `Failure` shape (`{scenario, agentId, phase,
  detail}`, `types.ts:9-13`) — no scenario, no phase. Reusing the failures list would
  conflate config skips with scenario-enumeration errors (which already abuse
  `agentId:"—", phase:undefined` at `tracker.ts:163-168`) and inflate the "failures
  (K):" count (`render.ts:62`), contradicting base design §8.
- **Net-new confirmed** (analyst + researcher): `RunSnapshot` (`types.ts:42-55`) has no
  skip field; `renderSnapshot` (`render.ts:23-70`) has no skip branch. Implementation =
  add a field to `RunSnapshot` (e.g. `skippedAgents: {id, reason}[]`), a render branch
  in `renderSnapshot`, and a tracker carrier/seed.

### D3 RESOLVED — leave judge STOP_RUN message unchanged (already conformant)

Judge-stop already prints at detection (`pipeline.ts:103-106`) then `return 2` BEFORE
the tracker is constructed (line 127) — it is already "early, at the moment known" with
zero live-output concern (no dashboard exists yet). It is the de-facto "similar to
other errors" precedent the intent points to (cf. `runner.ts:40-43`). The owner's
"appears at the end" complaint can only be about the test/improver skips. **Out of
scope; spec should state judge-stop is already conformant** so a reviewer doesn't think
it was overlooked. (Touching it risks regressing tests at
`skip-misconfigured.test.ts:160-191` and `:193-215`.)

### D4 RESOLVED — early in BOTH modes; cannot be routed PURELY through the tracker

Empirically verified: in non-interactive mode `flush()` writes ONLY when `finished`
(`tracker.ts:251`); during the run it writes nothing. Verbose sets `interactive:false`
(`pipeline.ts:135`). So a snapshot-field-only solution would, in verbose/non-TTY mode,
surface the skip ONLY in the single end-of-run block — re-introducing the exact defect,
in verbose mode. Judge-stop, by contrast, is early in ALL modes because its
`console.error` is unconditional and runs before the tracker.

**Decision (requirement, not implementation):** the early announcement MUST appear
early in BOTH interactive and non-interactive/verbose modes, consistent with judge-stop.
The mode split:
- **Interactive/TTY:** rendered through the tracker (distinct skip section, seeded so the
  FIRST paint includes it / or a method that triggers a paint). The tracker owns the
  cursor math, so the message rides inside the repaint and never pushes the dashboard
  down — satisfies "respect the live-output update logic."
- **Non-interactive/verbose:** there is NO live in-place dashboard to corrupt (tracker
  prints once at finish). A plain early stderr line at detection is SAFE and is the
  correct way to be early here (mirrors judge-stop). Detection is at `pipeline.ts:94`,
  before the tracker.

This is the one place "route everything through the tracker" is too simple; the
implementation needs a small mode-aware split, and an acceptance test must assert the
early appearance in a non-TTY capture (ordering: announcement before any scenario/phase
output), since the test harness is non-TTY.

## Established requirements

All grounded in intent + the single PR #45 review comment (identical to intent.md;
researcher pulled it via `gh api`) + the v3 base design and current code on this branch.

**R1 — Detection point is the announcement trigger.** The early announcement is emitted
at the moment misconfiguration is known: immediately after `classifyRunnability`
(`src/pipeline/pipeline.ts:94`), using the in-memory `runnability.skipped` list
(`SkippedAgent = {id, roles, reason}`), before scenario work runs. No new detection
logic; reuse the existing `RunnabilityResult`.

**R2 — Scope of the early announcement: test- and improver-role skips** (consequences
`EXCLUDE_LANE` / `HALT_AFTER_ITERATION`). These are the skips currently surfaced only at
command exit. The judge `STOP_RUN` skip is already announced early and is unchanged (R7).

**R3 — Each announced skip names the agent id AND the reason** (e.g.
`"<id>: <REQUIRED_ENV> is not set"`), so the user learns WHICH agent/model is
unavailable and WHY, early enough to fix the env and re-run.

**R4 — Respect the live-output update logic (interactive/TTY).** When the live
dashboard is active, the announcement is rendered through the `ProgressTracker` so it is
part of the in-place repaint and does NOT get pushed down, overwritten, or corrupt the
cursor math. Concretely: a distinct skip section in `RunSnapshot`/`renderSnapshot`
(visually distinct from failures, per the cyan convention), populated at/just after
tracker construction so the first paint includes it. It is NOT a raw stderr write while
the dashboard repaints.

**R5 — Early in non-interactive/verbose mode too.** Where the tracker does not repaint
during the run, the announcement is emitted as an early line on stderr at detection time
(no live-output conflict), consistent with the judge-stop precedent. Net effect: the
announcement appears early in BOTH modes.

**R6 — Skip BEHAVIOR is unchanged (v3 preserved).** Misconfigured agents remain
excluded from all phases. Untouched: runnable allowlist / `agentIdFilter`,
`runnability.skipped` threading, top-level `skipped` array in `report.json`, and exit
code 2 when any agent is skipped (`summary.ts:78`). This review changes only WHEN/HOW the
skip is announced.

**R7 — End-of-run summary is unchanged (additive change).** The final `SKIPPED AGENTS`
block (`summary.ts:201-212`) and its `summary.txt` mirror remain exactly as-is. The
early announcement is ADDITIVE. The two surfaces are independent data paths (early =
in-memory `runnability.skipped`; end = `report.json`'s `skipped` array) and intentionally
both name the skipped agents (live notice vs persisted record) — not accidental
double-reporting. Judge-stop message also unchanged (already conformant).

### Acceptance criteria

- **AC1 (early, test-role):** A run with a misconfigured test agent (and a runnable one)
  prints an announcement naming the skipped agent id and reason at detection time —
  BEFORE any scenario/phase output. Asserted on captured stderr ordering in the existing
  non-TTY test harness (`skip-misconfigured.test.ts` style). The runnable agent is still
  graded; report.json `skipped` array unchanged.
- **AC2 (early, improver-role):** A run with a misconfigured improver prints the early
  announcement naming it + reason before scenario work; the iteration still completes then
  halts (existing v3 behavior, `skip-misconfigured.test.ts:217-272`), unchanged.
- **AC3 (live-output safety, interactive):** In interactive/TTY mode the announcement is
  emitted through the tracker (part of the repaint) and does not corrupt the dashboard /
  push it down. Verifiable via a tracker/render unit test that the snapshot's skip section
  renders distinctly and the in-place repaint math (`lastPaintedLines`/`terminalRows`)
  accounts for it.
- **AC4 (early in verbose/non-TTY):** With `interactive:false` (verbose), the
  announcement still appears early (not only at finish). Asserted by ordering in a
  non-TTY capture.
- **AC5 (end block unchanged):** All existing `summary.test.ts` skip/exit-2/`summary.txt`
  assertions remain green with no changes (lines 311, 329, 369, 381, 406, 421, 439).
- **AC6 (behavior unchanged):** Existing `skip-misconfigured.test.ts` assertions on the
  report-level `skipped` array, exit code 2, judge STOP_RUN early stderr message, and
  exit-code precedence (`:274`) remain green unchanged.
- **AC7 (no false signal):** A run with NO skips produces no early announcement and no
  skip section in the live dashboard (regression guard).

### Out of scope

- Removing or relocating the end-of-run `SKIPPED AGENTS` summary block (R7).
- Changing the judge `STOP_RUN` early message (D3 — already conformant).
- Any change to the skip MECHANISM / which agents are skipped / exit codes (R6).
- New detection logic — reuse existing `classifyRunnability` / `RunnabilityResult`.
