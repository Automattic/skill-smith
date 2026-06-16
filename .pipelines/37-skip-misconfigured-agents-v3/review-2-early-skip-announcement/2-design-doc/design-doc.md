# Design doc — Surface misconfigured-agent skips early in the run

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)

This document is standalone: it can be read alongside `1-spec/spec.md` alone. It
specifies the design for an **early, at-detection** announcement of
misconfigured-agent skips, additive on top of the shipped v3 skip feature
(PR #45). Requirement tags (R1–R7) and acceptance criteria (AC1–AC7) refer to
`1-spec/spec.md`. All code line references were verified against the current
branch on 2026-06-16.

---

## 1. Problem and goal

When `skillsmith` runs and a configured agent/model is unavailable (e.g. its
required API key is unset), that agent is detected as misconfigured and skipped.
This already ships. Today, though, the user learns **which** agent was skipped
and **why** only at the very end of the run, in the end-of-run `SKIPPED AGENTS`
summary block. The PR owner, testing v3 locally, asked for the skip to be
surfaced **early** — at the moment the misconfiguration is detected — so they can
abort, fix the environment, and re-run instead of waiting for a full run to
finish before learning an agent never ran.

The judge skip (`STOP_RUN`) is already announced early: it `console.error`s at
detection and returns exit code 2, before the live dashboard exists. The gap is
the **test-role** (`EXCLUDE_LANE`) and **improver-role** (`HALT_AFTER_ITERATION`)
skips, which are surfaced only at command exit.

**Goal:** add an early at-detection announcement for the test/improver skips,
in **both** interactive and non-interactive modes, without disturbing the skip
mechanism, the end-of-run summary, exit codes, or the live dashboard's cursor
math.

This is **additive and incremental**. It changes only *when and how* the
test/improver skips are announced. The new early surface is added; the existing
end-of-run surface remains. Nothing about *which* agents are skipped or what the
process exits with changes.

---

## 2. Where the relevant behavior lives today (verified baseline)

| Concern | Location | Behavior |
| --- | --- | --- |
| Detection | `classifyRunnability(config, process.env)` at `src/pipeline/pipeline.ts:94` | Pure, synchronous, runs once up front, **before** the tracker is constructed. Returns `RunnabilityResult { runnableTestAgentIds, skipped: SkippedAgent[], judgeRunnable, improverRunnable }`. |
| Skip entry shape | `src/runnability.ts:13-17` | `SkippedAgent = { id, roles: AgentRole[], reason }`. The reason literal is `` `${requiredEnv} is not set` `` (`runnability.ts:47`), e.g. `"OPENAI_API_KEY is not set"`. |
| Consequence mapping | `decide(roles)` in `src/runnability.ts` (imported into `pipeline.ts:36`) | Maps a skipped agent's roles to one of `STOP_RUN` (judge), `EXCLUDE_LANE` (test), `HALT_AFTER_ITERATION` (improver). |
| Judge early print + bail | `src/pipeline/pipeline.ts:100-107` | `console.error(...)` then `return 2`, **before** the tracker is constructed (line 127). Conformant — left untouched. |
| Tracker construction | `src/pipeline/pipeline.ts:127-136` | `new ProgressTracker({ runId, scenarios }, verbose ? { interactive: false } : {})`. Construction is already after detection. |
| Resolved interactive mode | `src/progress/tracker.ts:89` | `this.interactive = opts.interactive ?? isTty(this.stream)`. The field is `private readonly` (`tracker.ts:70`). Forced to `false` only when verbose; otherwise resolved from `isTty`. |
| First paint | `src/progress/tracker.ts:150-156` | NOT at construction. `onTick` no-ops until `lastPaintAt !== 0`. The first event-driven paint is `beginIteration` → `requestPaint` → `flush`, called inside `runOneIteration` (`pipeline.ts:351`). |
| Snapshot build + paint | `src/progress/tracker.ts:232-254` | `flush()` builds a `RunSnapshot` literal (lines 234-242) and calls `renderSnapshot`. Interactive erase prefix is `` `\x1b[${this.lastPaintedLines}A\x1b[0J` ``; after writing, `lastPaintedLines = terminalRows(block, columns)`. Non-interactive `flush()` writes **only when `finished`** (lines 251-253). |
| Iteration reset | `src/progress/tracker.ts:129-148` | `beginIteration` sets `this.failures = []` and resets phase slots. |
| Render | `src/progress/render.ts:23-70` | Builds header, iteration, scenarios bar, phases bar, elapsed, then a `failures` section gated on `snap.failures.length > 0` (lines 60-67). No skip section today. |
| `RunSnapshot` type | `src/progress/types.ts:42-55` | No skip field. The only two literal construction sites are `tracker.ts:234` (flush) and the `snap()` helper in `progress-render.test.ts:6-33`. |
| End-of-run skip block | `pushSkipBlock` at `src/reports/summary.ts:201-212` | Blank line, `paint("SKIPPED AGENTS", "cyan", color)`, then `  ${id}: ${reason}` per agent. Reads `report.json`'s `skipped` array. |
| Three-way color convention | verified | red failures (`render.ts:149`), yellow per-cell `SKIPPED` (`summary.ts:298`), cyan agent-level `SKIPPED AGENTS` (`summary.ts:208`). |

**Why a naive stderr write is the wrong tool.** In interactive mode the tracker
overwrites its prior block in place: it walks the cursor up `lastPaintedLines`
rows, erases (`\x1b[0J`), and repaints. Any raw `console.error` /
`process.stderr.write` issued *after* painting begins is not counted in
`lastPaintedLines`, so the next repaint walks up the wrong number of rows and
clobbers or pushes the message down. The codebase already encodes this guard:
`RunLog` defaults `mirrorStderr: false` with the note "the progress tracker owns
the live stderr view," and the pipeline enables mirroring only in
verbose/non-interactive mode. So the early announcement must route **through the
tracker** when the live dashboard is active.

**Why "through the tracker" alone is insufficient.** In non-interactive mode the
tracker paints **nothing** mid-run — it writes its block only at `finish()`. The
existing test harness runs non-TTY (and CI is non-TTY), so a notice routed purely
through the tracker would surface only at `finish()` there, silently
re-introducing the exact "appears at the end" defect and making "early"
unobservable by output capture. Hence two emission paths, split by the resolved
interactive mode (§5).

---

## 3. Approach overview

Two emission paths, chosen by the tracker's **resolved** `interactive` mode:

- **Interactive (TTY):** the early announcement is data the tracker already owns.
  A new `skippedAgents` field on `RunSnapshot` is **seeded at tracker
  construction** (from the detection result) and rendered by `renderSnapshot` as
  a distinct **cyan `SKIPPED AGENTS`** section. Because it is part of the rendered
  block, it rides inside the first paint and every in-place repaint, and the
  existing `lastPaintedLines = terminalRows(block, …)` already counts its rows —
  the cursor math stays correct with no special-casing (R4).

- **Non-interactive (non-TTY, and verbose where `interactive:false`):** the
  tracker won't repaint mid-run, so there is no live view to corrupt. The
  announcement is emitted as an early plain `console.error` at detection time,
  mirroring the judge-stop precedent (R5).

The split is gated on the tracker's **resolved** `interactive` getter, not on the
pipeline's `verbose` flag — see §5 for why this is load-bearing.

The end-of-run path and the judge-stop path are untouched. The early and
end-of-run surfaces are **independent data paths** that intentionally both name
the skipped agents (a live up-front notice vs. a consolidated persisted record);
this duplication is deliberate, not accidental double-reporting (R7).

### Data flow

```
classifyRunnability  →  runnability.skipped: SkippedAgent[]   (id, roles, reason)
        │
        ├── judge STOP_RUN?  → console.error + return 2   (UNCHANGED, pipeline.ts:100-107)
        │
        ▼  (filter: keep non-STOP_RUN; map to { id, reason })
   earlySkips: { id, reason }[]
        │
        ├── seed → new ProgressTracker({ …, skippedAgents: earlySkips })
        │            └─ flush() → RunSnapshot.skippedAgents → renderSnapshot
        │                  → cyan "SKIPPED AGENTS" section in EVERY interactive paint
        │
        └── if (!tracker.interactive) → console.error one line per skip   (EARLY, non-interactive)
```

---

## 4. Detailed design

### 4.1 Data model — `RunSnapshot.skippedAgents`

Add to `RunSnapshot` (`src/progress/types.ts`):

```ts
skippedAgents: { id: string; reason: string }[];
```

- **Always present, default `[]`.** Both literal construction sites supply it:
  `flush()` emits `this.skippedAgents.slice()`; the `snap()` test helper in
  `progress-render.test.ts` defaults it to `[]` (the helper already lists explicit
  defaults and merges `Partial` overrides, so adding one required field keeps the
  existing render tests green).
- **Minimal `{ id, reason }` — not `roles`.** The live view needs only id +
  reason: AC1/AC2 assert id + reason, AC3 asserts distinctness. Carrying `roles`
  would couple `types.ts` to `AgentRole` for no rendering benefit.
- **Distinct from `failures` — do not reuse `Failure`, do not push into the
  failures list.** A whole-agent config skip has no scenario and no phase, does
  not fit `Failure { scenario, agentId, phase, detail }`, and must **not** inflate
  the `failures (K):` count (R4). It is a soft info signal, not a failure.
- **Source mapping happens only at the wiring point.** The runnability
  `SkippedAgent` → `{ id, reason }` mapping (dropping `roles`) is done in
  `pipeline.ts` when seeding the tracker. `types.ts` and `render.ts` stay free of
  any `runnability` import. (`summary.ts` has its own report-shaped `SkippedEntry`;
  it is not reused across the module boundary — the two surfaces are intentionally
  independent per R7.)

### 4.2 Tracker API — `src/progress/tracker.ts`

**Seed at construction.** Extend `TrackerInit` (currently `{ runId, scenarios }`,
`tracker.ts:10-13`):

```ts
export interface TrackerInit {
  runId: string;
  scenarios: { name: string; agentIds: string[] }[];
  skippedAgents?: { id: string; reason: string }[];
}
```

The constructor stores it into a private carrier, defaulting to `[]`:

```ts
private readonly skippedAgents: { id: string; reason: string }[];
// in constructor:
this.skippedAgents = init.skippedAgents ?? [];
```

**Include in every snapshot.** `flush()` (`tracker.ts:232-254`) adds the field to
the `RunSnapshot` literal it builds:

```ts
skippedAgents: this.skippedAgents.slice(),
```

**`beginIteration` must NOT clear `skippedAgents`** (the single most important
correctness point). Config skips are **run-scoped**: detected once up front, valid
for the whole run, never re-detected per iteration. The existing
`this.failures = []` reset (`tracker.ts:137`) stays; the skip carrier is
deliberately excluded from it. Crucially, the first event-driven paint comes
**from** `beginIteration` (not from construction — `onTick` no-ops until the first
event), so the seeded list must already be present **and survive that very call**
for the FIRST paint to include the section (R4 / AC3 first-paint). Making the
carrier `readonly` (above) enforces this structurally — `beginIteration` cannot
reassign it.

**No `agentSkipped()` method is needed.** Seeding at construction is sufficient
and strictly better than a post-construction setter: it guarantees first-paint
inclusion without forcing an extra paint, and there is no scenario in which
agent-level config skips arrive mid-run — detection is one-shot and happens
before the tracker exists. A method would be warranted only if skips could be
discovered after painting began; they cannot.

**Cursor-math safety is automatic, not special-cased.** Because the skip section
is part of the block returned by `renderSnapshot`, the existing
`lastPaintedLines = terminalRows(block, columns)` (`tracker.ts:250`) already
counts its rows, and the next repaint's `` `\x1b[${lastPaintedLines}A\x1b[0J` ``
walks up the correct number of rows. No change to the erase logic is required —
this is precisely why routing through the tracker (rather than a raw stderr
write) "respects the live-output update logic" (R4).

**Add a public `interactive` getter.** The resolved mode currently lives in a
`private readonly interactive: boolean` field (`tracker.ts:70`), set from
`opts.interactive ?? isTty(this.stream)` (`tracker.ts:89`). The pipeline needs to
read the resolved value to choose its emission path (§4.4), so expose it:

```ts
get interactive(): boolean { return this.<field>; }
```

The implementer picks the mechanics (rename the private field and add a getter
returning it, or otherwise surface the resolved value); the contract is a public
read-only accessor that returns the same boolean the tracker resolved at
construction.

### 4.3 Render — cyan `SKIPPED AGENTS` section — `src/progress/render.ts`

Add a branch in `renderSnapshot`, **after** the failures block (`render.ts:67`),
gated on `snap.skippedAgents.length > 0`:

```
(blank line)
SKIPPED AGENTS              ← paint("SKIPPED AGENTS", "cyan", color)
  <id>: <reason>            ← one line per agent
```

- **Mirrors `pushSkipBlock`** (`summary.ts:208-211`) in label, color, and the
  `  ${id}: ${reason}` row format, so the live and final surfaces read
  identically.
- **Independent of and below the failures section.** It does not touch the
  `failures (${snap.failures.length}):` count — no count inflation (R4).
- **Continues the verified three-way color convention** — red failures, yellow
  per-cell `SKIPPED`, cyan agent-level `SKIPPED AGENTS`.
- **Omitted entirely when `skippedAgents` is empty** (AC7).

### 4.4 Pipeline wiring + mode-aware emission — `src/pipeline/pipeline.ts`

At detection time, immediately **after** the judge `STOP_RUN` block
(`pipeline.ts:107`, before the tracker is constructed at `:127`):

**Step 1 — compute the early-announce list.** Filter `runnability.skipped` to the
test/improver consequences and map to `{ id, reason }`:

```ts
const earlySkips = runnability.skipped
  .filter((s) => decide(s.roles) !== "STOP_RUN")
  .map((s) => ({ id: s.id, reason: s.reason }));
```

`decide` and `SkippedAgent` are already imported (`pipeline.ts:36`). Any
`STOP_RUN` id (judge, or a multi-role id where judge wins) has already printed and
`return 2`'d above, so in practice nothing reaches here as `STOP_RUN`; the filter
is the explicit, robust expression of R2 and guards against future
role/consequence changes.

**Step 2 — seed the tracker.** Pass the mapped list to the existing
`new ProgressTracker(...)` at `:127`:

```ts
const tracker = new ProgressTracker(
  {
    runId,
    scenarios: allScenarios.map((s) => ({
      name: s.scenario.name,
      agentIds: runnableTestAgentIds,
    })),
    skippedAgents: earlySkips,
  },
  verbose ? { interactive: false } : {},
);
```

Construction is already after detection — no reordering needed.

**Step 3 — mode-aware early stderr line.** After construction, branch on the
tracker's **resolved** mode, not on `verbose`:

```ts
if (!tracker.interactive) {
  for (const s of earlySkips) {
    console.error(
      `skillsmith: skipping misconfigured agent "${s.id}": ${s.reason}`,
    );
  }
}
```

- `!tracker.interactive` fires exactly when the live dashboard will **not** repaint
  mid-run — covering both verbose (`interactive:false`) **and** the plain non-TTY
  case (incl. the test harness and CI). No live-output conflict in this mode (R5).
- In the `else` (interactive) branch, emit **nothing** extra: the seeded section
  already rides in the first and every paint (R4). This avoids double-announcing
  and keeps the interactive path "through the tracker, not a raw stderr write."

The message format (one `console.error` per skipped agent, leading
`skillsmith: skipping misconfigured agent "<id>": <reason>`) mirrors the
judge-stop phrasing style and satisfies the substring-based ACs (id + reason). A
single consolidated multi-line string would also satisfy the ACs; one line per
agent is the recommendation for a clear captured channel.

**Why branch on resolved `interactive`, not `verbose` (load-bearing).** The
pipeline only has the `verbose` boolean. It passes `{ interactive: false }` only
when verbose, and otherwise lets the tracker resolve `interactive` from
`isTty(stream)` (`tracker.ts:89`). The test harness — and any non-TTY CI run — is
non-TTY **and** non-verbose, so the tracker is non-interactive there yet writes
only at `finish()`. A `verbose`-based branch would emit no early `console.error`
in that mode, and the seeded section would surface only at `finish()` — silently
re-introducing the exact "appears at the end" defect and failing AC1/AC2/AC4 (the
harness captures nothing early). Exposing and branching on the tracker's
*resolved* `interactive` (§4.2) is what makes the early announcement correct and
testable in every mode.

Net effect across R4 + R5: the test/improver early announcement is early in
**both** modes — interactive via the seeded first paint, non-interactive via the
early `console.error` — paralleling how the judge-stop message is already early in
all modes via its unconditional pre-tracker `console.error`.

**Unchanged by this wiring:** the runnable allowlist / `agentIdFilter`, the
`runnability.skipped` threading, `report.json`'s `skipped` array, exit code 2, the
end-of-run block, and the judge message (R6, R7).

---

## 5. Data-model change summary

| Element | Before | After |
| --- | --- | --- |
| `RunSnapshot` (`types.ts`) | `{ runId, startedAt, now, iteration?, counters, failures, finished }` | + `skippedAgents: { id; reason }[]` (always present, default `[]`) |
| `TrackerInit` (`tracker.ts`) | `{ runId, scenarios }` | + `skippedAgents?: { id; reason }[]` |
| `ProgressTracker` private state | `failures`, etc. | + `private readonly skippedAgents: { id; reason }[]` |
| `ProgressTracker` public surface | (no resolved-mode accessor) | + `get interactive(): boolean` |
| `renderSnapshot` (`render.ts`) | header / iter / scenarios / phases / elapsed / failures | + cyan `SKIPPED AGENTS` section after failures, gated on length |

`skippedAgents` is deliberately a **separate** array from `failures`: distinct
shape (`{ id, reason }` vs. `{ scenario, agentId, phase, detail }`), distinct
render section (cyan vs. red), and it does not contribute to the
`failures (K):` count.

---

## 6. Test plan (mapped to AC1–AC7)

Verification is split by what each harness can observe (per the spec's AC
preamble). The non-TTY full-pipeline harness (`skip-misconfigured.test.ts`)
overrides both `console.log` and `console.error` and runs non-TTY, non-verbose;
it does **not** intercept `process.stderr.write`, and in non-interactive mode the
tracker paints nothing mid-run — so there is no captured scenario/phase line to
order against, and the early-in-non-TTY ACs assert on the **captured
`console.error`** channel. The interactive first-paint / repaint safety is
asserted at the tracker/render layer with an injected `Writable`
(`progress-tracker.test.ts` pattern) and by calling `renderSnapshot` directly
(`progress-render.test.ts` pattern).

| AC | What it asserts | Where | How |
| --- | --- | --- | --- |
| **AC1** (early, test-role; non-TTY) | Early announcement names the skipped test agent **id** and **reason** on captured `console.error`; precedes any later captured `console.*` (e.g. end-of-run summary on stdout); runnable agent still graded; `report.json` `skipped` unchanged. | New case in `skip-misconfigured.test.ts` (misconfigured test agent + a runnable one) | Substring match `/gpt/` AND `/OPENAI_API_KEY is not set/`, mirroring the judge-stop assertions (`:169-174`). Emitted at detection, so it precedes later captured `console.*`; no captured scenario/phase line to order against. |
| **AC2** (early, improver-role; non-TTY) | Early announcement names the improver id + reason; iteration still completes then halts (existing v3 behavior). | Same harness | Same substring assertion for a misconfigured improver. |
| **AC3** (live-output safety + first-paint earliness; interactive) | (a) **Render half:** a `RunSnapshot` carrying a `skippedAgents` entry renders a cyan `SKIPPED AGENTS` section; the entry is NOT in `failures`; the `failures (K):` count is not inflated (a snapshot with N failures + a skip still shows `failures (N):`). (b) **Tracker half:** seed via `TrackerInit.skippedAgents` with an injected `Writable`, `interactive:true`; the FIRST emitted block already contains the skip section; after a subsequent event, the next paint's erase prefix matches `/^\x1b\[(\d+)A\x1b\[0J/` and the cursor-up row count covers the skip section's height. | `progress-render.test.ts` (render half) + `progress-tracker.test.ts` (tracker half) | Render half via direct `renderSnapshot` call. Tracker half asserts on the **observable** erase count / block height in the captured chunks (as the existing wrapped-rows test does), not on the private `lastPaintedLines`: the erase count equals/exceeds the block's logical line count including the skip rows. Mirrors the existing first-paint test. |
| **AC4** (early in verbose/non-TTY) | With `interactive:false` the announcement still appears at detection, not only at `finish()`. | Same harness as AC1/AC2 | Captured-`console.error` substring (id + reason); the resolved `interactive` getter is false, so the `console.error` path fires at detection. |
| **AC5** (end block unchanged) | End-of-run skip block, exit code 2, `summary.txt` all remain green. | `summary.test.ts` | Zero changes to existing assertions. |
| **AC6** (behavior unchanged) | Report-level `skipped` array, exit 2, judge `STOP_RUN` message, exit-code precedence all remain green. | `skip-misconfigured.test.ts` | Zero changes to existing assertions; new cases are purely additive. |
| **AC7** (no false signal) | A no-skip run emits no early `console.error` and no skip section in a rendered `RunSnapshot` / tracker paint. | Non-TTY harness + render/tracker layer | `renderSnapshot` with `skippedAgents: []` produces no section; a seeded-empty tracker paints no section; no-skip harness run captures no early `console.error`. |

---

## 7. Files touched

| File | Change |
| --- | --- |
| `src/progress/types.ts` | Add `skippedAgents: { id; reason }[]` to `RunSnapshot`. |
| `src/progress/render.ts` | Add the cyan `SKIPPED AGENTS` branch after the failures block, gated on length. |
| `src/progress/tracker.ts` | Add `TrackerInit.skippedAgents`; private `readonly` carrier; include `skippedAgents` in the `flush()` snapshot; exclude it from the `beginIteration` reset; add the public `interactive` getter. |
| `src/pipeline/pipeline.ts` | Filter `runnability.skipped` to non-`STOP_RUN`, map to `{ id, reason }`, seed `TrackerInit.skippedAgents`, add the mode-aware early `console.error` branch on `tracker.interactive`. |
| `src/__tests__/progress-render.test.ts` | Add `skippedAgents: []` to the `snap()` helper default; add skip-section + count-not-inflated cases (AC3 render half, AC7). |
| `src/__tests__/progress-tracker.test.ts` | Add seed + first-paint + erase-count cases (AC3 tracker half). |
| `src/__tests__/skip-misconfigured.test.ts` | Add AC1/AC2/AC4/AC7 captured-`console.error` cases (additive; existing assertions unchanged). |

---

## 8. Trade-offs and alternatives considered

- **Seed at construction vs. a `agentSkipped()` setter method.** Chosen: seed via
  `TrackerInit`. A setter would need to be called after construction but before the
  first paint, and would risk forcing or missing a paint. Seeding guarantees
  first-paint inclusion with no extra paint, and matches reality: config skips are
  one-shot and known before the tracker exists. A method would only be justified if
  skips could be discovered mid-run — they cannot.

- **Branch on resolved `interactive` vs. on `verbose`.** Chosen: resolved
  `interactive` (requires the new getter). Branching on `verbose` would miss the
  non-TTY-but-non-verbose case (the test harness and CI), re-introducing the
  "appears at the end" defect and failing AC1/AC2/AC4. This is the load-bearing
  decision of the design (§4.4).

- **Reuse `Failure` / push into the failures list vs. a separate `skippedAgents`
  array.** Chosen: separate array. A config skip has no scenario or phase and is a
  soft info signal, not a failure; reusing `Failure` would force meaningless
  fields and inflate the `failures (K):` count, violating R4.

- **Route the interactive announcement through a raw `process.stderr.write` vs.
  through the tracker.** Chosen: through the tracker. A raw write during live
  repaint is not counted in `lastPaintedLines` and corrupts the cursor math — the
  exact anti-pattern the codebase guards against with `RunLog`'s
  `mirrorStderr: false` default. Rendering it as part of the snapshot makes the
  cursor math correct automatically.

- **Carry `roles` in `skippedAgents` vs. minimal `{ id, reason }`.** Chosen:
  minimal. The live view never renders roles; carrying them would couple
  `types.ts` to `AgentRole` for no benefit. The wiring point drops `roles` when
  mapping.

- **Remove the end-of-run block now that there is an early notice vs. keep both.**
  Chosen: keep both. They are independent data paths (early reads the in-memory
  `runnability.skipped`; the end block reads `report.json`'s `skipped`) serving
  different purposes — a live up-front notice vs. a consolidated persisted record.
  Removing the end block is explicitly out of scope (R7).

---

## 9. Out of scope

- Removing or relocating the end-of-run `SKIPPED AGENTS` summary block or its
  `summary.txt` mirror (R7 — additive only).
- Changing the judge `STOP_RUN` early message (already conformant — prints at
  detection, before the tracker, then returns 2).
- Any change to the skip **mechanism**: which agents are skipped, the
  `agentIdFilter` / runnable allowlist, the `runnability.skipped` threading, the
  `report.json` `skipped` array, or exit codes (R6).
- New detection logic — reuse the existing `classifyRunnability` /
  `RunnabilityResult` (R1).
