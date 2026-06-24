# Design research — Surface misconfigured-agent skips early in the run

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)

This records the concrete design decisions for the early at-detection skip
announcement, decided by the design-doc-analyst on grounding in the current code
(spec §R1–R7 / §AC1–AC7; D1–D4 already resolved in `1-spec/spec-research.md`).
The `design-doc-writer` consumes this to produce `design-doc.md`.

## Scope recap (from the approved spec)

Additive, incremental change on top of shipped v3 skip (PR #45). Add an EARLY,
at-detection announcement of **test- and improver-role** skips (consequences
`EXCLUDE_LANE` / `HALT_AFTER_ITERATION`). Two emission paths by mode:

- **Interactive (TTY):** rendered THROUGH the `ProgressTracker` as a distinct
  cyan "skipped agents" section so it rides inside the in-place repaint and never
  corrupts the cursor math (R4).
- **Non-interactive (non-TTY, and verbose where `interactive:false`):** an early
  plain `console.error` at detection time, mirroring the judge-stop precedent (R5).

Unchanged: skip mechanism, end-of-run `SKIPPED AGENTS` block + `summary.txt`,
exit code 2, and the judge `STOP_RUN` early message (R6, R7).

All line refs below were verified against the current branch on 2026-06-16.

## Verified code baseline

- **Detection:** `classifyRunnability(config, process.env)` at `pipeline.ts:94`.
  Returns `RunnabilityResult { runnableTestAgentIds, skipped: SkippedAgent[],
  judgeRunnable, improverRunnable }`. `SkippedAgent = { id, roles: AgentRole[],
  reason }` (`runnability.ts:13-17`); reason literal is `` `${requiredEnv} is not
  set` `` (`runnability.ts:47`).
- **Judge STOP_RUN early print + bail:** `pipeline.ts:100-107` — `console.error`
  then `return 2`, BEFORE the tracker is constructed. Conformant, untouched (D3).
- **Tracker construction:** `pipeline.ts:127-136`, AFTER detection. Receives
  `{ interactive: false }` only when `verbose`; otherwise interactive is resolved
  internally from `isTty(stream)` (`tracker.ts:89`, `isTty` at `:349-351`).
- **First paint:** NOT at construction. `onTick` no-ops until `lastPaintAt !== 0`
  (`tracker.ts:150-156`). The first event-driven paint is `beginIteration` →
  `requestPaint` → `flush`, called inside `runOneIteration` (`pipeline.ts:351`).
- **`flush()`** builds a `RunSnapshot` from instance state and calls
  `renderSnapshot` (`tracker.ts:232-254`). Interactive erase prefix is
  `` `\x1b[${this.lastPaintedLines}A\x1b[0J` ``; after writing,
  `lastPaintedLines = terminalRows(block, columns)` (`tracker.ts:244-250`).
  Non-interactive `flush()` writes ONLY when `finished` (`tracker.ts:251-253`).
- **`beginIteration`** clears `this.failures = []` and resets phase slots
  (`tracker.ts:129-148`).
- **Render:** `renderSnapshot` (`render.ts:23-70`); the failures section is gated
  on `snap.failures.length > 0` (`render.ts:60-67`).
- **`RunSnapshot`** has no skip field (`types.ts:42-55`). The ONLY two literal
  construction sites are `tracker.ts:234` (flush) and the `snap()` helper in
  `progress-render.test.ts:6-33` (verified via `grep -rn RunSnapshot src/`).
- **End block:** `pushSkipBlock` (`summary.ts:201-212`): blank line,
  `paint("SKIPPED AGENTS", "cyan", color)`, then `  ${id}: ${reason}` per agent.
- **Three-way color convention (verified):** red fail (`render.ts:149`), yellow
  per-cell `SKIPPED` (`summary.ts:298`), cyan agent-level `SKIPPED AGENTS`
  (`summary.ts:208`).
- **Test harness:** `skip-misconfigured.test.ts` overrides BOTH `console.log` and
  `console.error` and runs non-TTY, non-verbose (`run({ cwd })`, no verbose). The
  judge-stop test asserts captured `console.error` substrings `/gpt/` and
  `/OPENAI_API_KEY is not set/` (`:169-174`). `progress-tracker.test.ts` injects a
  `Writable` into `TrackerOptions.stream`; `progress-render.test.ts` calls
  `renderSnapshot` directly.
- **No public getter** for the tracker's resolved `interactive` exists today
  (verified). The design adds one.

## Decisions

### D-A — Data model: `RunSnapshot.skippedAgents` (minimal, distinct from `failures`)

Add to `RunSnapshot` (`types.ts`):

```ts
skippedAgents: { id: string; reason: string }[];
```

- Always present, default `[]`. The two construction sites add it: `flush()`
  emits `this.skippedAgents.slice()`; the render test `snap()` helper defaults it
  to `[]` (it already lists explicit defaults and merges `Partial` overrides, so
  adding one required field keeps all existing render tests green).
- **Minimal `{ id, reason }`** — NOT `roles`. The live view needs only id +
  reason (AC1/AC2 id+reason; AC3 distinctness). Carrying `roles` would couple
  `types.ts` to `AgentRole` for no rendering benefit.
- **Distinct from `failures`** — do NOT reuse the `Failure` shape and do NOT push
  into the `failures` list. A whole-agent config skip has no scenario and no
  phase, does not fit `Failure { scenario, agentId, phase, detail }`, and must not
  inflate the `failures (K):` count (R4). It is a soft info signal, not a failure.
- **Source mapping at the wiring point only:** map runnability `SkippedAgent` →
  `{ id, reason }` (drop `roles`) when seeding the tracker. `types.ts`/`render.ts`
  stay free of any `runnability` import. (Note: `summary.ts` has a local
  report-shaped `SkippedEntry`; it is not reused across the module boundary — the
  two surfaces are intentionally independent data paths per R7.)

Add a matching `skippedAgents: { id: string; reason: string }[]` to the
`snap()` test helper default in `progress-render.test.ts`.

### D-B — Tracker API: seed at construction; survive `beginIteration`; first-paint inclusion

- Extend `TrackerInit` with `skippedAgents?: { id: string; reason: string }[]`.
  The constructor stores it into a `private skippedAgents: { id; reason }[] = []`
  carrier (defaulting to `[]` when absent).
- `flush()` includes `skippedAgents: this.skippedAgents.slice()` in every
  `RunSnapshot` it builds.
- **`beginIteration` must NOT clear `skippedAgents`.** Config skips are
  run-scoped — detected once up front, valid for the whole run, never re-detected
  per iteration. The existing `this.failures = []` reset stays; the skip carrier
  is deliberately excluded from the reset. This is the single most important
  correctness point: because the first event-driven paint comes FROM
  `beginIteration` (not construction), the seeded list must already be present and
  must survive that very call for the FIRST paint to include the section (R4 /
  AC3 first-paint).
- **No new `agentSkipped()` method is needed.** Seeding at construction is
  sufficient and is strictly better than a post-construction setter: it guarantees
  first-paint inclusion without forcing an extra paint, and there is no scenario
  in which agent-level config skips arrive mid-run (detection is one-shot, before
  the tracker exists). (A method would only be warranted if skips could be
  discovered after painting began — they cannot.)
- **Cursor-math safety is automatic, not special-cased.** Because the skip
  section is part of the block returned by `renderSnapshot`, the existing
  `lastPaintedLines = terminalRows(block, columns)` already counts its rows, and
  the next repaint's `` `\x1b[${lastPaintedLines}A\x1b[0J` `` walks up the correct
  number of rows. No change to the erase logic is required — this is exactly why
  routing through the tracker (rather than a raw stderr write) "respects the
  live-output update logic."
- Add a public getter `get interactive(): boolean { return this.interactive; }`
  exposing the resolved mode (rename the private field or return it via the
  getter; the implementer picks the mechanics). Needed by the wiring in D-D.

### D-C — Render: distinct cyan `SKIPPED AGENTS` section in `renderSnapshot`

Add a branch in `renderSnapshot`, AFTER the failures block (`render.ts:67`),
gated on `snap.skippedAgents.length > 0`:

```
(blank line)
SKIPPED AGENTS                       ← paint(..., "cyan", color)
  <id>: <reason>                     ← one line per agent
```

- Mirrors `pushSkipBlock` (`summary.ts:208-211`) byte-for-byte in label, color,
  and `  ${id}: ${reason}` row format, so the live and final surfaces read
  identically.
- Independent of and below the failures section; does not touch the
  `failures (${snap.failures.length}):` count (R4 — no count inflation).
- Continues the verified three-way convention (red fail / yellow per-cell SKIPPED
  / cyan agent-level SKIPPED AGENTS).
- When `skippedAgents` is empty, the section is omitted entirely (AC7).

### D-D — Wiring + mode-aware emission in `pipeline.ts`

At detection time, immediately AFTER the judge `STOP_RUN` block
(`pipeline.ts:107`, before the tracker is constructed at `:127`):

1. **Compute the early-announce list.** Filter `runnability.skipped` to the
   test/improver consequences: keep entries where
   `decide(s.roles) !== "STOP_RUN"`. (Any `STOP_RUN` id — judge, or a multi-role
   id where judge wins — has already printed and `return 2`'d above, so in
   practice nothing reaches here as STOP_RUN; the filter is the explicit,
   robust expression of R2 and guards against future role/consequence changes.)
   Map to `{ id, reason }`.
2. **Seed the tracker.** Pass the mapped list to `TrackerInit.skippedAgents` in
   the existing `new ProgressTracker(...)` at `:127`. (Construction is already
   after detection — no reordering needed.)
3. **Mode-aware early stderr line.** After construction, branch on the tracker's
   resolved mode, NOT on `verbose`:
   - `if (!tracker.interactive)` → emit the early announcement on
     **`console.error`** (one line per skipped agent, or one consolidated line),
     each naming `id` + `reason`. This fires exactly when the live dashboard will
     NOT repaint mid-run — covering both verbose (`interactive:false`) AND the
     plain non-TTY case (incl. the test harness and CI). No live-output conflict
     in this mode (R5).
   - `else` (interactive) → emit NOTHING extra; the seeded section already rides
     in the first (and every) paint (R4). This avoids double-announcing and keeps
     the interactive path "through the tracker, not a raw stderr write."

**Why branch on resolved `interactive`, not `verbose` (load-bearing).** The
pipeline only has the `verbose` boolean; it passes `{ interactive: false }` only
when verbose and otherwise lets the tracker resolve `interactive` from
`isTty(stream)`. The test harness — and any non-TTY CI run — is non-TTY AND
non-verbose, so the tracker is non-interactive there and writes only at
`finish()`. A `verbose`-based branch would emit no early `console.error` in that
mode and the seeded section would surface only at `finish()` — silently
re-introducing the exact "appears at the end" defect and failing AC1/AC2/AC4 (the
harness captures nothing early). Exposing and branching on the tracker's
*resolved* `interactive` is what makes the early announcement correct and
testable in every mode. (Net effect: judge-stop is early in all modes via its
unconditional pre-tracker `console.error`; the test/improver announcement is
early in all modes via this split.)

No change to: the runnable allowlist / `agentIdFilter`, `runnability.skipped`
threading, `report.json` `skipped`, exit code 2, the end block, or the judge
message (R6, R7).

### D-E — Test plan mapped to AC1–AC7

Verification is split by what each harness can observe (per the spec's AC
preamble): the non-TTY full-pipeline harness captures only `console.*`; the
interactive first-paint / repaint safety is asserted at the tracker/render layer
with an injected `Writable`.

- **AC1 (early, test-role; non-TTY).** New case in `skip-misconfigured.test.ts`
  (a misconfigured test agent + a runnable one): assert captured `console.error`
  substring-matches the skipped id (`/gpt/`) AND reason
  (`/OPENAI_API_KEY is not set/`), mirroring the judge-stop assertions
  (`:169-174`). Ordering: emitted at detection, so it precedes any later captured
  `console.*` (e.g. the end-of-run summary on stdout). Runnable agent still
  graded; `report.json` `skipped` unchanged.
- **AC2 (early, improver-role; non-TTY).** Same harness/assertion for a
  misconfigured improver. Iteration still completes then halts (existing v3
  behavior, unchanged).
- **AC3 (live-output safety + first-paint earliness; interactive).** Two layers:
  - **Render half (`progress-render.test.ts`):** a `RunSnapshot` carrying a
    `skippedAgents` entry renders a cyan `SKIPPED AGENTS` section; the entry is
    NOT in `failures`; the `failures (K):` count is not inflated (e.g. a snapshot
    with N failures and a skip still shows `failures (N):`).
  - **Tracker half (`progress-tracker.test.ts`):** construct with
    `TrackerInit.skippedAgents` + an injected `Writable`, `interactive:true`. The
    FIRST emitted block already contains the skip section (mirrors the existing
    first-paint test). After a subsequent event, the next paint's erase prefix
    matches `/^\x1b\[(\d+)A\x1b\[0J/` and the cursor-up row count covers the
    skip section's height — asserted on the OBSERVABLE erase count / block height
    in the captured chunks (as the existing wrapped-rows test does), not on the
    private `lastPaintedLines`. A regression-style assertion: the erase count
    equals/exceeds the block's logical line count including the skip rows.
- **AC4 (early in verbose/non-TTY).** Same captured-`console.error` assertion as
  AC1/AC2; with `interactive:false` the getter resolves false so the
  `console.error` path fires at detection.
- **AC5 (end block unchanged).** Zero changes to `summary.test.ts`.
- **AC6 (behavior unchanged).** Zero changes to existing
  `skip-misconfigured.test.ts` assertions (report `skipped` array, exit 2, judge
  `STOP_RUN` message, exit-code precedence). New cases are purely additive.
- **AC7 (no false signal).** A no-skip run emits no early `console.error`
  (checkable in the non-TTY harness), and `renderSnapshot` with
  `skippedAgents: []` produces no `SKIPPED AGENTS` section / a seeded-empty
  tracker paints no section.

## Files touched (for the design-doc-writer / code-plan)

- `src/progress/types.ts` — add `skippedAgents` to `RunSnapshot`.
- `src/progress/render.ts` — add the cyan skip-section branch.
- `src/progress/tracker.ts` — `TrackerInit.skippedAgents`, private carrier,
  include in `flush()` snapshot, exclude from `beginIteration` reset, public
  `interactive` getter.
- `src/pipeline/pipeline.ts` — filter `runnability.skipped` (non-STOP_RUN), seed
  `TrackerInit.skippedAgents`, mode-aware early `console.error` branch on
  `tracker.interactive`.
- Tests: `src/__tests__/progress-render.test.ts` (snap helper default + skip
  section + count-not-inflated), `src/__tests__/progress-tracker.test.ts`
  (seed + first-paint + erase-count), `src/__tests__/skip-misconfigured.test.ts`
  (AC1/AC2/AC4/AC7 captured-`console.error`).

## Open / unverified

- Whether the non-interactive early announcement is one `console.error` per
  skipped agent or a single consolidated multi-line string is left to the
  implementer; both satisfy the substring-based ACs and the judge-stop precedent
  (which is a single line). Recommendation: one line per agent (`<id>: <reason>`),
  with a short leading context (e.g. `skillsmith: skipping misconfigured agent
  "<id>": <reason>`) so the captured channel reads clearly, matching the
  judge-stop phrasing style.
- Dependent on the `design-doc-researcher`'s confirmation of the consolidated
  message sent this turn; no contradicting evidence had been returned at
  recording time. If the researcher surfaces a hidden `RunSnapshot` constructor
  or a line-ref drift, amend D-A/D-D accordingly — none is expected
  (`grep -rn RunSnapshot src/` shows only the two sites named in D-A).
