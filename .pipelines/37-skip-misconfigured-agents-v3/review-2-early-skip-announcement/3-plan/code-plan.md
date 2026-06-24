# Code plan — Surface misconfigured-agent skips early in the run

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)

This plan implements the approved design (`2-design-doc/design-doc.md`) against the
**verified** current code on this branch. Line references below were re-checked on
2026-06-17 and corrected where the design had drifted (none had — all design line
references matched).

The change is **additive and incremental**: a new early at-detection announcement of
**test-role** (`EXCLUDE_LANE`) and **improver-role** (`HALT_AFTER_ITERATION`)
misconfigured-agent skips, in **both** interactive (seeded through `ProgressTracker` →
cyan `SKIPPED AGENTS` render section) and non-interactive modes (early `console.error`
gated on the tracker's **resolved** `interactive` getter, not `verbose`). The skip
mechanism, end-of-run summary, judge `STOP_RUN` early message, and exit codes are all
unchanged.

## Execution model

Tasks are ordered so each commit is independently type-checkable and (where practical)
leaves the test suite green. Ordering follows data-model-before-consumers:
`types.ts` → `tracker.ts` / `render.ts` → `pipeline.ts` wiring → tests → changeset.
Each task is executed by a fresh `code-writer` agent doing TDD in one shared working
tree, committing sequentially. Commit subjects use imperative mood, sentence case, no
trailing period, role in parentheses: `<subject> (code-writer)`.

**Guardrails (judged by exit code) the final state MUST pass:**
`npm run typecheck`, `npm run lint`, `npm test`,
`npm --prefix testing-project run check:config`, and
`npx tsx scripts/validate-changesets.ts`.

**Changeset decision:** this change is additive and non-breaking (a new early
announcement surface; no API removed, no behavior or exit code changed), so the bump is
**`patch`** (pre-1.0; `minor`/`patch`/`none` are accepted, `major` is rejected — verified
in `scripts/validate-changesets.ts:27,145`). The changeset is **Task 7** in this plan,
not deferred to docs, so it cannot fall through the cracks.

---

## Task 1 — Add `skippedAgents` to `RunSnapshot`

- **Goal** — Extend the snapshot data model with an always-present skipped-agents list.
- **Files** — `src/progress/types.ts`.
- **Changes** — In the `RunSnapshot` interface (`types.ts:42-55`), add a new required
  field after `failures: Failure[];` (line 53):
  ```ts
  skippedAgents: { id: string; reason: string }[];
  ```
  Minimal `{ id, reason }` shape — **not** `roles` (the live view never renders roles;
  carrying `AgentRole` would couple `types.ts` to `runnability`). Do **not** add any
  `runnability` import. A short doc comment is welcome, matching the file's comment style
  (cf. the `Failure` and `RunCounters` block comments), noting it is the live-dashboard
  agent-level skip list, distinct from `failures`, default `[]`.
- **Depends on** — none.
- **Traces to** — R4; AC3 (render/tracker distinctness), AC7.
- **Acceptance** —
  - `RunSnapshot` has `skippedAgents: { id: string; reason: string }[]` as a required
    field.
  - `npm run typecheck` will now FAIL until the two literal construction sites
    (`tracker.ts:234` flush, `progress-render.test.ts` `snap()` helper) supply the field —
    that is expected and is fixed in Tasks 3 and 5. This task's commit is intentionally
    not green on its own; it is the data-model foundation. (Type-check goes green at the
    end of Task 5; lint/test at end of Task 6.)

---

## Task 2 — Render the cyan `SKIPPED AGENTS` section

- **Goal** — Render a skip section in the live dashboard, visually distinct from failures.
- **Files** — `src/progress/render.ts`.
- **Changes** — In `renderSnapshot`, add a new branch **after** the failures block
  (which ends at `render.ts:67`, the closing `}` of `if (snap.failures.length > 0)`) and
  **before** `return lines.join("\n");` (line 69), gated on
  `snap.skippedAgents.length > 0`:
  ```ts
  if (snap.skippedAgents.length > 0) {
      lines.push("");
      lines.push(paint("SKIPPED AGENTS", "cyan", color));
      for (const s of snap.skippedAgents) {
          lines.push(`  ${s.id}: ${s.reason}`);
      }
  }
  ```
  - `paint` is already imported (`render.ts:1`); `"cyan"` is an accepted color (used by
    `bar()` at `render.ts:102` and `counterSummary` at `:88`).
  - Mirror `pushSkipBlock` (`summary.ts:208-211`) in label (`SKIPPED AGENTS`), color
    (cyan), and the `  ${id}: ${reason}` row format so the live and final surfaces read
    identically.
  - Do **not** touch the `failures (${snap.failures.length}):` count or the failures
    loop — the skip section is independent and below it, and must not inflate the failures
    count.
  - Optionally extend the function's doc-comment example block (`render.ts:9-21`) to show
    the new section; keep comment density consistent with the file.
- **Depends on** — Task 1 (`RunSnapshot.skippedAgents` must exist to read
  `snap.skippedAgents`).
- **Traces to** — R4; AC3 (render half: distinctness, count not inflated), AC7 (omitted
  when empty).
- **Acceptance** —
  - `renderSnapshot` emits a blank line, a cyan-painted `SKIPPED AGENTS` header, and one
    `  <id>: <reason>` line per entry, only when `snap.skippedAgents.length > 0`.
  - The `failures (K):` line and its rows are byte-for-byte unchanged for any given
    failures list; the skip section appends after them.
  - With `skippedAgents: []` the function output is identical to before this task (no
    section). (Asserted by Task 5's AC7 render case and by existing render tests staying
    green once Task 5 supplies the `snap()` default.)

---

## Task 3 — Tracker: seed `skippedAgents` at construction, carry it through `flush()`, expose resolved `interactive`

- **Goal** — Let the tracker carry a run-scoped skip list seeded at construction, emit it
  in every snapshot, survive `beginIteration`, and expose the resolved interactive mode.
- **Files** — `src/progress/tracker.ts`.
- **Changes** — Four coordinated edits:
  1. **`TrackerInit`** (`tracker.ts:10-13`): add an optional field —
     ```ts
     export interface TrackerInit {
         runId: string;
         scenarios: { name: string; agentIds: string[] }[];
         skippedAgents?: { id: string; reason: string }[];
     }
     ```
  2. **Private carrier**: add a `private readonly skippedAgents` field alongside the other
     private state (near `tracker.ts:77`, `private failures: Failure[] = [];`):
     ```ts
     private readonly skippedAgents: { id: string; reason: string }[];
     ```
     and initialize it in the constructor (after `this.runId = init.runId;` at
     `tracker.ts:93`, or anywhere in the constructor body):
     ```ts
     this.skippedAgents = init.skippedAgents ?? [];
     ```
     **`readonly` is load-bearing**: it structurally prevents `beginIteration` from
     reassigning the carrier (the single most important correctness point — see edit 4).
  3. **Include in the snapshot**: in `flush()` (`tracker.ts:232-254`), add to the
     `RunSnapshot` literal (`tracker.ts:234-242`), after `failures: this.failures.slice(),`
     (line 240):
     ```ts
     skippedAgents: this.skippedAgents.slice(),
     ```
     (`.slice()` matches the defensive copy already used for `failures`.) This makes the
     type-check pass at the flush site (resolving one of the two Task 1 errors).
  4. **Public resolved-`interactive` getter**: the resolved mode lives in
     `private readonly interactive: boolean` (`tracker.ts:70`), set from
     `opts.interactive ?? isTty(this.stream)` (`tracker.ts:89`). Expose the resolved
     value as a public read-only accessor. Recommended mechanics: rename the private
     field to `private readonly interactiveMode: boolean` (updating its two internal reads
     at `tracker.ts:113` `if (this.interactive && ...)` and `tracker.ts:244`
     `if (this.interactive)`), and add:
     ```ts
     get interactive(): boolean {
         return this.interactiveMode;
     }
     ```
     The contract is: a public read-only `interactive` getter returning the same boolean
     the tracker resolved at construction. (Pick equivalent mechanics if preferred, but do
     not change the resolution logic at `:89`.)
  - **Do NOT** add an `agentSkipped()` method — seeding at construction is sufficient and
    guarantees first-paint inclusion (detection is one-shot, before the tracker exists).
  - **Do NOT** add any erase/cursor-math special-casing: because the skip section is part
    of the block returned by `renderSnapshot`, the existing
    `this.lastPaintedLines = terminalRows(block, this.streamColumns())` (`tracker.ts:250`)
    already counts its rows.
- **Depends on** — Task 1 (snapshot field), Task 2 (render branch — so a seeded tracker
  actually paints the section; required for Task 6's first-paint/erase-count tests).
- **Traces to** — R4 (seeded, rides first + every paint; cursor math automatic), R5
  (resolved getter enables the mode-aware branch); AC3 (tracker half).
- **Acceptance** —
  - `TrackerInit` accepts an optional `skippedAgents`; omitting it defaults the carrier to
    `[]`.
  - `flush()`'s snapshot includes `skippedAgents: this.skippedAgents.slice()`; the
    type-check error at the flush site from Task 1 is resolved.
  - The carrier is `readonly` and is **not** reassigned or mutated in `beginIteration`
    (edit 4 of Task… see Task 4 — `beginIteration` is left structurally unable to clear
    it). Verified by Task 6's first-paint-after-`beginIteration` assertion.
  - `tracker.interactive` is a public getter returning the resolved mode (the value of
    `opts.interactive ?? isTty(stream)`); no behavior change to resolution.

---

## Task 4 — Confirm `beginIteration` does NOT clear `skippedAgents`

- **Goal** — Guarantee run-scoped skips survive iteration resets (they are detected once
  up front and valid for the whole run).
- **Files** — `src/progress/tracker.ts` (verification + a short comment; no functional
  change if Task 3's `readonly` is in place).
- **Changes** — Inspect `beginIteration` (`tracker.ts:129-148`). It resets
  `this.failures = []` (line 137) and per-scenario phase slots. It must **NOT** touch
  `this.skippedAgents`. Task 3 made the carrier `private readonly`, so any accidental
  `this.skippedAgents = []` would be a compile error — that is the structural guard. Add a
  one-line comment near the `this.failures = []` reset (line 137) documenting the
  deliberate exclusion, e.g.:
  ```ts
  // Config skips are run-scoped (detected once up front); deliberately
  // NOT cleared here — unlike failures, which are per-iteration.
  this.failures = [];
  ```
  No other change. (If the implementer folds this comment into Task 3, this task is a
  pure verification step — but it must be explicitly checked, because the first
  event-driven paint comes *from* `beginIteration`, so the seeded list must survive that
  exact call for the FIRST paint to include the section.)
- **Depends on** — Task 3 (the `readonly` carrier and constructor seed).
- **Traces to** — R4; AC3 (first-paint inclusion — the seeded section must be present on
  the first paint, which is triggered by `beginIteration`).
- **Acceptance** —
  - `beginIteration` contains no assignment to or mutation of `this.skippedAgents`.
  - A comment documents that the skip carrier is deliberately excluded from the
    per-iteration reset.
  - (Behaviorally proven by Task 6's "first emitted block already contains the skip
    section" test, where the first paint is the `beginIteration`-driven one.)

---

## Task 5 — Pipeline wiring: compute early-skip list, seed the tracker, mode-aware early `console.error`

- **Goal** — At detection time, seed the tracker with the test/improver skips and, when
  the dashboard will not repaint mid-run, emit an early `console.error` per skip.
- **Files** — `src/pipeline/pipeline.ts`.
- **Changes** — Three steps, all between the judge `STOP_RUN` block
  (`pipeline.ts:100-107`) and/or at the tracker construction site
  (`pipeline.ts:127-136`). `decide` and `SkippedAgent` are already imported
  (`pipeline.ts:36`).
  1. **Compute the early-announce list.** After the judge block (after `pipeline.ts:107`),
     near where `runnableTestAgentIds` is read (`pipeline.ts:109`):
     ```ts
     const earlySkips = runnability.skipped
         .filter((s) => decide(s.roles) !== "STOP_RUN")
         .map((s) => ({ id: s.id, reason: s.reason }));
     ```
     Drops `roles` (R2 scope: test/improver only). Any `STOP_RUN` id already printed and
     `return 2`'d above; the filter is the explicit, future-proof expression of R2.
  2. **Seed the tracker.** In the existing `new ProgressTracker(...)` call
     (`pipeline.ts:127-136`), add `skippedAgents: earlySkips` to the `TrackerInit` object
     (alongside `runId` and `scenarios`, inside the first argument object at
     `:128-134`). Construction is already after detection — **no reordering**.
  3. **Mode-aware early stderr line.** Immediately **after** the
     `const tracker = new ProgressTracker(...)` statement (after `pipeline.ts:136`),
     branch on the tracker's **resolved** mode:
     ```ts
     if (!tracker.interactive) {
         for (const s of earlySkips) {
             console.error(
                 `skillsmith: skipping misconfigured agent "${s.id}": ${s.reason}`,
             );
         }
     }
     ```
  - **Branch on `tracker.interactive`, NOT `verbose`** (load-bearing). The test harness
    and CI are non-TTY **and** non-verbose, so the tracker resolves non-interactive there
    yet writes only at `finish()`; a `verbose`-based branch would emit nothing early and
    fail AC1/AC2/AC4.
  - In the interactive (`else`) case emit **nothing** extra — the seeded section already
    rides in every paint (R4). Do not add a raw `process.stderr.write` during live
    repaint.
  - Do **not** touch the `agentIdFilter` / runnable allowlist, `runnability.skipped`
    threading, `RunContext.skipped`, `report.json`'s `skipped`, exit code 2, the
    end-of-run block, or the judge message (R6/R7).
- **Depends on** — Task 3 (needs `TrackerInit.skippedAgents` and the public
  `tracker.interactive` getter). This task makes `npm run typecheck` **green again** for
  `src/` (the snapshot literal in `flush()` was fixed in Task 3; the only remaining Task 1
  type error — the `snap()` test helper — is fixed in Task 6).
- **Traces to** — R1 (emit at detection, reuse `RunnabilityResult`), R2 (test/improver
  scope via `decide(...) !== "STOP_RUN"`), R3 (id + reason), R4 (seed → first paint), R5
  (early non-interactive `console.error`), R6/R7 (mechanism + end block untouched);
  AC1, AC2, AC4.
- **Acceptance** —
  - `earlySkips` excludes any `STOP_RUN` (judge) id and carries `{ id, reason }` for
    test/improver skips.
  - The `ProgressTracker` is constructed with `skippedAgents: earlySkips`.
  - When `tracker.interactive === false`, exactly one `console.error` line per
    `earlySkips` entry is emitted, naming the id and reason; when `true`, no extra stderr
    write is emitted.
  - `npm run typecheck` passes for `src/` after this task (the only remaining failure is
    the test-helper `snap()` literal, resolved in Task 6).
  - No change to `agentIdFilter`, `runnability.skipped`, `RunContext.skipped`,
    `report.json`, exit codes, the end-of-run summary, or the judge message.

---

## Task 6 — Tests for AC1–AC4, AC7 (and confirm AC5/AC6 unchanged)

- **Goal** — Add the additive test cases proving the early announcement and live-output
  safety, fix the `snap()` helper default, and confirm existing assertions stay green.
- **Files** — `src/__tests__/progress-render.test.ts`,
  `src/__tests__/progress-tracker.test.ts`, `src/__tests__/skip-misconfigured.test.ts`.
- **Changes** —
  - **`progress-render.test.ts`:**
    1. Add `skippedAgents: []` to the `snap()` helper default object
       (`progress-render.test.ts:6-33`), after `failures: [],` (line 29). The helper
       already merges `Partial<RunSnapshot>` overrides, so this one line keeps every
       existing render test green and resolves the last Task 1 type error.
    2. **AC3 render half:** a test that `renderSnapshot(snap({ skippedAgents: [{ id:
       "gpt", reason: "OPENAI_API_KEY is not set" }] }), { color: false })` contains a
       `SKIPPED AGENTS` line and a `  gpt: OPENAI_API_KEY is not set` line.
    3. **AC3 count-not-inflated:** a test that a snapshot with N failures **and** a skip
       entry still renders `failures (N):` (the skip does not change the failures count),
       and that the skip entry does not appear inside the failures rows (it is a separate
       section).
    4. **AC7 render:** a test that `renderSnapshot(snap({ skippedAgents: [] }))` produces
       **no** `SKIPPED AGENTS` text.
  - **`progress-tracker.test.ts`** (reuse the existing `captureStream` /`FakeClock`
    helpers at `:6-30`; mirror the first-paint test `:32-51` and the wrapped-rows
    erase-count test `:114-149`):
    5. **AC3 first-paint inclusion:** construct a tracker with
       `{ runId, scenarios: [...], skippedAgents: [{ id: "gpt", reason: "OPENAI_API_KEY is
       not set" }] }` and `{ stream, color: false, interactive: true, tickMs: 0 }`. Drive
       the first event-driven paint the way the run does — call
       `tracker.beginIteration(1, 1)` (or a `phaseStarted` if simpler; `beginIteration` is
       the truest reproduction since the real first paint comes from it) — and assert the
       **first** captured chunk already contains `SKIPPED AGENTS` and the `gpt: ...` line.
       This also proves Task 4 (the seeded list survived `beginIteration`).
    6. **AC3 repaint safety / erase count:** after a subsequent event, assert the next
       paint's chunk starts with `/^\x1b\[(\d+)A\x1b\[0J/` and that the captured erase row
       count covers the block including the skip rows — asserted on the **observable**
       erase count / block line count in the captured chunks (the pattern at
       `progress-tracker.test.ts:141-148`), **not** on the private `lastPaintedLines`.
    7. **AC7 tracker:** a tracker seeded with `skippedAgents: []` (or omitted) paints **no**
       `SKIPPED AGENTS` section on its first or subsequent paints.
  - **`skip-misconfigured.test.ts`** (reuse `runWithoutOpenAIKey` `:28-54`,
    `latestRunDir`, `readRunReport`; mirror the judge-stop substring assertions
    `:169-174`):
    8. **AC1 (early, test-role; non-TTY capture):** new case using the `skip-test-project`
       fixture (misconfigured `gpt` + runnable `mock-ok`). Run via `runWithoutOpenAIKey`;
       assert the captured **stderr** matches `/gpt/` AND `/OPENAI_API_KEY is not set/`
       (the early `console.error`). Optionally assert the announcement is present in
       captured stderr **before** the end-of-run summary text the harness captures on
       stdout (it is emitted at detection); do not assert against a scenario/phase line
       (none is captured in non-TTY mode). Keep the existing report-level assertions
       intact (additive only — do not modify the existing `skip-test-project` test).
    9. **AC2 (early, improver-role; non-TTY capture):** new case using the
       `skip-improver-project` fixture; assert captured stderr matches `/gpt/` AND
       `/OPENAI_API_KEY is not set/`. The iteration still completes then halts (existing v3
       behavior) — leave the existing improver test unchanged.
    10. **AC4 (early in verbose/non-TTY):** assert the same captured-stderr substrings hold
        in non-interactive mode at detection time. The harness is already non-TTY
        (non-interactive resolved), so AC1's case already exercises the `console.error`
        path; add an explicit assertion or a focused case making the "resolved interactive
        is false ⇒ early `console.error` fires" intent legible. (A separate verbose run is
        not required, since `tracker.interactive` is false for the non-TTY harness too;
        document this in the test name/comment.)
    11. **AC7 (no false signal, harness):** prove a no-test/improver-skip run emits no
        early skip `console.error`. Note: `runWithoutOpenAIKey` deletes the key, so to get
        a genuinely skip-free run pick a path with **no** misconfigured test/improver
        agent — either (a) a fully-runnable fixture using only mock providers (no
        `requiredEnv`), asserting captured stderr does **not** match
        `/skipping misconfigured agent/`, or (b) if no such fixture exists, assert the
        **absence** of the early skip line in a context where none should fire. The
        load-bearing, always-observable half of AC7 is already covered by the render
        (case 4) and tracker (case 7) layer tests; this harness case is the
        full-pipeline confirmation. If adding a new fixture, keep it minimal and run
        `npm --prefix testing-project run check:config` to ensure config validity is not
        affected (the testing-project config is separate, but verify the guardrail still
        passes).
  - **AC5/AC6 (no changes):** do **not** edit existing assertions in `summary.test.ts` or
    the existing `skip-misconfigured.test.ts` cases. Confirm they remain green.
- **Depends on** — Task 2 (render branch), Task 3 (tracker seed + getter), Task 5
  (pipeline early `console.error`). After this task `npm run typecheck`, `npm run lint`,
  and `npm test` all pass.
- **Traces to** — AC1, AC2, AC3, AC4, AC7 (new cases); AC5, AC6 (confirmed unchanged).
- **Acceptance** —
  - All five guardrail commands pass: `npm run typecheck`, `npm run lint`, `npm test`,
    `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`
    (the last passes once Task 7 lands; it does not regress here).
  - New render cases assert the cyan `SKIPPED AGENTS` section, the un-inflated
    `failures (N):` count, and the empty-list no-section behavior.
  - New tracker cases assert first-paint inclusion (via `beginIteration`), observable
    erase-count repaint safety, and empty-list no-section behavior.
  - New harness cases assert captured-stderr id+reason substrings for a misconfigured test
    agent (AC1) and improver (AC2/AC4), and no early skip line for a skip-free run (AC7).
  - Every pre-existing assertion in `summary.test.ts` and the original
    `skip-misconfigured.test.ts` cases remains untouched and green (AC5/AC6).

---

## Task 7 — Add the changeset

- **Goal** — Record the release-relevant change with a committed changeset.
- **Files** — `.changeset/early-skip-announcement.md` (new).
- **Changes** — Create a changeset with `patch` bump (additive, non-breaking; pre-1.0
  policy accepts `patch`). Front-matter + body, matching the shape of the existing
  `.changeset/skip-misconfigured-agents.md`:
  ```markdown
  ---
  "@automattic/skillsmith": patch
  ---

  Announce misconfigured test- and improver-role agent skips early, at detection,
  instead of only in the end-of-run summary. In interactive runs the skip rides the
  live dashboard as a cyan `SKIPPED AGENTS` section; in non-interactive/verbose runs
  it prints an early stderr line naming the agent id and reason. The skip mechanism,
  exit codes, end-of-run summary, and the judge stop message are unchanged.
  ```
  Keep the body concise and API/behavior-focused; verify the wording against the shipped
  code (no `major`, no `BREAKING:` prefix — this is not breaking).
- **Depends on** — Tasks 1–6 (the change it describes must exist; landing it last keeps
  the description accurate).
- **Traces to** — Repo release policy (AGENTS.md / CONTRIBUTING.md); not an AC, but a
  hard guardrail (`npx tsx scripts/validate-changesets.ts`).
- **Acceptance** —
  - A new `.changeset/*.md` exists with `"@automattic/skillsmith": patch` and a body
    describing the early announcement.
  - `npx tsx scripts/validate-changesets.ts` exits 0.
  - All five guardrail commands pass in the final state.
