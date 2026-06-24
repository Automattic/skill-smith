# Design doc review — APPROVED

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)
Reviewer role: `design-doc-reviewer`
Verdict: **APPROVED**
Verified against the code on branch `worktree-43-adopt-guardrails` on 2026-06-16.

---

## Summary

`design-doc.md` is a complete, sound, internally consistent design for an early,
at-detection announcement of misconfigured-agent (test/improver) skips, additive
on top of the shipped v3 skip feature. It covers all seven requirements (R1–R7),
makes all seven acceptance criteria (AC1–AC7) testable in named harnesses, and
every load-bearing technical claim checks out against the current code. It is
standalone, scoped correctly (no scope creep, no v3 regression), and feasible.

I verified each claim the review brief flagged as load-bearing rather than taking
the doc's line references on trust. All passed.

---

## Spec coverage (R1–R7)

- **R1 (detection point is the trigger).** §4.4 emits at detection, immediately
  after the judge `STOP_RUN` block and before the tracker is constructed, reusing
  `runnability.skipped` with no new detection logic. Matches `pipeline.ts:94`
  (`classifyRunnability`) and the existing `RunnabilityResult` shape. ✓
- **R2 (scope: test/improver, not judge).** §4.4 Step 1 filters
  `runnability.skipped` to `decide(s.roles) !== "STOP_RUN"`. `decide` and
  `SkippedAgent` are in fact already imported at `pipeline.ts:36`. The doc
  correctly notes any `STOP_RUN` id has already `return 2`'d at `pipeline.ts:102-107`,
  so the filter is a robust, explicit guard rather than dead code. ✓
- **R3 (id AND reason).** Both surfaces carry `{ id, reason }`: the cyan section
  (`  <id>: <reason>`) and the non-interactive `console.error`
  (`...agent "<id>": <reason>`). ✓
- **R4 (respect live-output logic, interactive).** §3/§4.2/§4.3: a `skippedAgents`
  field on `RunSnapshot`, seeded at construction, rendered as a distinct cyan
  section *after* failures, riding inside the first and every repaint. Cursor math
  is automatic because the section is part of the block measured by
  `terminalRows(block, …)` at `tracker.ts:250`. Not a raw stderr write; not added
  to `failures`; does not inflate the `failures (K):` count. ✓
- **R5 (early in non-interactive/verbose too).** §4.4 Step 3 emits an early
  `console.error` gated on `!tracker.interactive`, mirroring the judge-stop
  precedent. The §4.4 "load-bearing" subsection correctly argues why this must
  gate on the *resolved* `interactive`, not `verbose`. ✓
- **R6 (skip behavior unchanged).** §4.4 closing note and §9 list everything left
  untouched: `agentIdFilter`/allowlist, `runnability.skipped` threading,
  `report.json` `skipped`, exit code 2. The wiring only reads `runnability.skipped`
  and seeds/branches; it mutates none of the skip mechanism. ✓
- **R7 (end-of-run summary unchanged; independent additive paths).** §3, §8, §9:
  the end block (`pushSkipBlock`, `summary.ts:201-212`) and judge message are
  untouched; the two surfaces are deliberately independent data paths (in-memory
  `runnability.skipped` vs. `report.json`'s `skipped`). The doc explicitly keeps
  `summary.ts`'s `SkippedEntry` separate from the new `RunSnapshot.skippedAgents`,
  so the additive duplication is by design. ✓

## Acceptance-criteria testability (AC1–AC7)

The §6 table maps each AC to a real harness with an observable assertion:

- **AC1/AC2/AC4** — `skip-misconfigured.test.ts` overrides `console.error`
  (verified at `:39-41`) and runs non-TTY/non-verbose, so the tracker is
  non-interactive and the early `console.error` path fires at detection. The
  substring style (`/gpt/`, `/OPENAI_API_KEY is not set/`) matches the existing
  judge-stop assertions at `:169-174`. The ordering claim ("precedes later
  captured `console.*`") is honest: there is no captured scenario/phase line to
  order against in this mode, and the doc says so rather than over-asserting. ✓
- **AC3** — split correctly. Render half via direct `renderSnapshot` in
  `progress-render.test.ts`; tracker half via injected `Writable` in
  `progress-tracker.test.ts`. The first-paint assertion mirrors the existing
  `progress-tracker.test.ts:32-51` test; the observable erase-count assertion
  mirrors `progress-tracker.test.ts:114-149` (matches `/^\x1b\[(\d+)A\x1b\[0J/`,
  asserts the row count, not the private `lastPaintedLines`). The count-not-inflated
  assertion is directly checkable. ✓
- **AC5** — `summary.test.ts` unchanged; the design touches neither `summary.ts`
  nor its assertions. ✓
- **AC6** — `skip-misconfigured.test.ts` existing assertions are untouched; new
  cases are purely additive. ✓
- **AC7** — empty-`skippedAgents` produces no section (length-gated branch) and a
  no-skip harness run captures no early `console.error`. Checkable at both layers. ✓

---

## Load-bearing claims verified against code

1. **Gate on resolved `interactive`, not `verbose`.** `tracker.ts:89`:
   `this.interactive = opts.interactive ?? isTty(this.stream)`. Pipeline passes
   `{ interactive: false }` only when verbose (`pipeline.ts:135`); otherwise the
   tracker resolves from `isTty`. Non-interactive `flush()` writes only when
   `finished` (`tracker.ts:251-253`). A `verbose`-based branch would miss the
   non-TTY-but-non-verbose harness/CI, re-introducing the defect. The design's
   central decision is correct, and the new public `interactive` getter is what
   makes the resolved value readable from the pipeline. ✓

2. **Seeding + not clearing in `beginIteration` makes the FIRST paint include the
   section.** Confirmed the full chain: `onTick` no-ops until `lastPaintAt !== 0`
   (`tracker.ts:150-155`); the first event-driven paint is
   `beginIteration → requestPaint → flush` because `lastPaintAt === 0` triggers an
   immediate flush (`tracker.ts:214-221`); `beginIteration` is the only tracker
   call before the agent loop, and no tracker event fires between construction
   (`pipeline.ts:127`) and `beginIteration` (`pipeline.ts:351`) — verified by
   enumerating every `tracker.*` call site. `flush()` builds the snapshot from
   `this.skippedAgents` (proposed). A `readonly` carrier structurally survives the
   `this.failures = []` reset at `tracker.ts:137`, so the seeded list is present in
   that first flush. ✓

3. **Cyan render branch does not inflate the `failures` count.** The count is
   `failures (${snap.failures.length})` at `render.ts:62`, fed only by
   `snap.failures`. A separate `skippedAgents` array never enters `failures`. The
   new branch is appended after the failures block (`render.ts:67`) and gated on
   `snap.skippedAgents.length > 0`. ✓

4. **`RunSnapshot` construction sites.** Exactly two, as claimed: the `flush()`
   literal at `tracker.ts:234` and the `snap()` test helper at
   `progress-render.test.ts:6-33`. Confirmed by grep — no other `: RunSnapshot`
   literal exists. The `snap()` helper merges `Partial<RunSnapshot>` overrides,
   so adding a required `skippedAgents: []` default keeps the existing render tests
   green. ✓

5. **Test-plan assertions are observable in the named harnesses.**
   `skip-misconfigured.test.ts` captures `console.error`; the judge-stop substring
   pattern exists and is the cited precedent; `progress-tracker.test.ts` has both
   the first-paint and the observable erase-count patterns the AC3 tracker half
   reuses; `progress-render.test.ts` calls `renderSnapshot` directly. ✓

Additional spot-checks: `pushSkipBlock` format and color (`summary.ts:208-210`)
match the proposed render branch exactly (`paint("SKIPPED AGENTS", "cyan", color)`,
`  ${id}: ${reason}`); `AnsiColor` includes `"cyan"` and `paint` is already
imported into `render.ts:1`, so the proposed render call type-checks; `decide`'s
severity ordering (`runnability.ts:100-129`) confirms a multi-role judge id resolves
to `STOP_RUN` and is filtered out, consistent with the doc's note.

---

## Scope, consistency, and standalone-ness

- **No scope creep / no v3 regression.** §9 and the "Unchanged by this wiring"
  note enumerate the untouched mechanism; the design adds only an early surface
  and a read-only getter. The skip mechanism, exit codes, report shape, end block,
  and judge path are all left intact.
- **Internally consistent.** The data-model table (§5), files-touched table (§7),
  and trade-offs (§8) agree with the detailed design (§4). The `{ id, reason }`
  minimal shape, the `readonly` carrier, and the construction-time seeding are
  stated consistently throughout.
- **Standalone.** Reads coherently alongside `1-spec/spec.md` alone; all code
  references are concrete and accurate, and the baseline table (§2) is a faithful
  description of the current code.

---

## Non-blocking observations (for the implementer, not defects)

These do not affect approval; the design already leaves the mechanics to the
implementer where appropriate.

- **Getter vs. field name collision.** §4.2 proposes `get interactive()` while the
  resolved value currently lives in `private readonly interactive` (`tracker.ts:70`).
  A getter and a field cannot share the name, so the implementer must rename the
  field (e.g. `private readonly interactiveMode`) and have the getter return it, or
  pick another field name. The doc anticipates this ("rename the private field and
  add a getter") — just flagging that the rename is mandatory, not optional, and
  touches the three internal reads at `tracker.ts:113`, `:244`. The brief's
  files-touched table already scopes this to `tracker.ts`. No spec impact.
- **Changeset.** Per `AGENTS.md`, this release-relevant change needs a committed
  `.changeset/*.md` (pre-1.0: `minor`). That is a contribution-process obligation
  for the code/docs phases, not a design-doc deliverable, so it is correctly absent
  here — noted only so it is not forgotten downstream.

None of the above changes the design's correctness or its R/AC coverage.

---

## Conclusion

The design fully satisfies R1–R7, makes AC1–AC7 testable in real harnesses, and
every load-bearing technical claim is accurate against the code on this branch. It
is feasible, additive, correctly scoped, internally consistent, and standalone.
**Approved.**
