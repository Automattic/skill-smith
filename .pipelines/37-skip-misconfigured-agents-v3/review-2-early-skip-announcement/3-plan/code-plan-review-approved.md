# Code plan review — APPROVED

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review)
Reviewer: `code-plan-reviewer`
Date: 2026-06-17

## Verdict

**APPROVED.** The plan faithfully and completely implements the approved design
(`2-design-doc/design-doc.md`) and satisfies the spec (`1-spec/spec.md`, R1–R7 /
AC1–AC7). It is additive, correctly ordered for independent type-checkability,
preserves every load-bearing decision, and does not let the changeset or any
guardrail fall through. Every load-bearing claim in the plan was re-verified
against the actual code on this branch — all line references are accurate and
none had drifted.

## Verification against the current branch

All of the plan's anchoring references were checked against the live code:

| Plan claim | Verified location | Status |
| --- | --- | --- |
| `RunSnapshot` interface, `failures` at line 53 | `src/progress/types.ts:42-55`, `failures: Failure[];` at :53 | ✓ |
| Only two `RunSnapshot` literal sites | `tracker.ts:234` (flush) + `snap()` in `progress-render.test.ts:6` — grep confirms no others | ✓ |
| `renderSnapshot` failures block ends at `:67`, `return` at `:69` | `render.ts:60-67` failures branch, `return lines.join("\n")` at :69 | ✓ |
| `paint` imported; `"cyan"` accepted color | `render.ts:1`; cyan used by `bar()` :102 and `counterSummary` :88 | ✓ |
| `pushSkipBlock` label/color/row format | `summary.ts:201-212`, cyan `SKIPPED AGENTS` :208, `  ${id}: ${reason}` :209-211 | ✓ |
| `TrackerInit` shape at `:10-13` | `tracker.ts:10-13` (`{ runId, scenarios }`) | ✓ |
| `private failures` at `:77`; flush literal `:234-242`, `failures` at :240 | `tracker.ts:77`, :234-242, `failures: this.failures.slice()` at :240 | ✓ |
| `private readonly interactive` at `:70`, resolved at `:89` | `tracker.ts:70`, `this.interactive = opts.interactive ?? isTty(this.stream)` at :89 | ✓ |
| Internal reads of `interactive` at `:113` and `:244` | `tracker.ts:113` (`this.interactive && this.tickMs`), :244 (`if (this.interactive)`) | ✓ |
| `beginIteration` at `:129-148`, `this.failures = []` at :137 | `tracker.ts:129-148`, :137 | ✓ |
| `lastPaintedLines = terminalRows(block, …)` at `:250` | `tracker.ts:250` | ✓ |
| Judge `STOP_RUN` block at `:100-107`; tracker ctor at `:127-136` | `pipeline.ts:100-107`, :127-136 | ✓ |
| `decide` + `SkippedAgent` imported at `:36`; `runnableTestAgentIds` at `:109` | `pipeline.ts:36`, :109 | ✓ |
| `SkippedAgent = { id, roles, reason }`; reason `"<ENV> is not set"` | `runnability.ts:13-17`, :46-48 | ✓ |
| `snap()` helper `:6-33`, `failures: []` at `:29` | `progress-render.test.ts:6-33`, :29 | ✓ |
| `captureStream`/`FakeClock` `:6-30`; first-paint `:32-51`; wrapped-rows erase `:114-149` | `progress-tracker.test.ts` — all present at the cited ranges | ✓ |
| `runWithoutOpenAIKey` `:28-54`; judge-stop substrings `:169-174` | `skip-misconfigured.test.ts:28-54`, :169-174 | ✓ |
| pre-1.0 forbids only `major`; `patch`/`minor`/`none` valid (`:27`, `:145`) | `scripts/validate-changesets.ts:27` (`VALID`), :145 (pre-1.0 guard) | ✓ |
| `summary.test.ts` exists (AC5 surface) | `src/__tests__/summary.test.ts` (458 lines) | ✓ |

Two additional load-bearing facts were independently confirmed:

1. **The harness resolves `interactive: false`.** `run()` defaults `verbose:
   false` (`runner.ts:35`), so the pipeline passes `{}` to the tracker, which
   then resolves `interactive` from `isTty(process.stderr)`. Under `node --test`
   stderr is not a TTY, so the resolved value is `false` — which is exactly why
   the `!tracker.interactive` early `console.error` branch (Task 5, step 3) fires
   in the harness and the captured-`console.error` ACs (AC1/AC2/AC4) are
   observable. The plan's insistence on branching on the *resolved* getter rather
   than `verbose` is correct and necessary; a `verbose`-based branch would emit
   nothing in the harness.

2. **A genuinely skip-free fixture exists for AC7 (case 11, option a).**
   `smoke-project/skillsmith.config.ts` uses only `mock` providers, and only
   `openai-api` / `anthropic-api` / `gemini-api` declare a `requiredEnv` (`mock`
   has none). So `runWithoutOpenAIKey(smoke-project)` produces zero skips, giving
   the AC7 full-pipeline "no early `console.error`" assertion a real target. The
   plan's option (a) is viable without inventing a fixture.

## Design coverage — every element accounted for

- **`RunSnapshot.skippedAgents`** (`types.ts`) → Task 1, minimal `{ id, reason }`,
  no `runnability` import, default `[]`. ✓
- **Tracker** → Task 3: `TrackerInit.skippedAgents?` (edit 1), `private readonly`
  carrier + constructor seed `init.skippedAgents ?? []` (edit 2), include
  `this.skippedAgents.slice()` in `flush()` (edit 3), public resolved-`interactive`
  getter via field rename (edit 4). EXCLUSION from `beginIteration` reset → Task 4
  (structural, enforced by `readonly`, plus a documenting comment). ✓
- **`renderSnapshot` cyan `SKIPPED AGENTS`** branch after failures, gated on
  `length > 0` → Task 2, mirrors `pushSkipBlock`. ✓
- **Pipeline** → Task 5: filter `runnability.skipped` to `decide(...) !== "STOP_RUN"`,
  map to `{ id, reason }`, seed `TrackerInit.skippedAgents`, mode-aware early
  `console.error` on `tracker.interactive`. ✓
- **Tests AC1–AC7** → Task 6 (render half, tracker half, harness cases; AC5/AC6
  confirmed unchanged). ✓
- **Changeset** → Task 7, first-class task, `patch` bump. ✓

## Load-bearing decisions preserved

- **Gate on RESOLVED `interactive`, not `verbose`** — Task 5 step 3 + its
  "load-bearing" note; rationale matches design §4.4 and is verified against the
  harness's non-TTY/non-verbose resolution. ✓
- **`beginIteration` must NOT clear `skippedAgents`** — Task 3 makes the carrier
  `readonly` (compile-time guard); Task 4 verifies and documents; Task 6 case 5
  proves first-paint-after-`beginIteration` inclusion behaviorally. ✓
- **Skips not pushed into `failures`; do not inflate `failures (K):`** — Task 2
  explicitly leaves the failures count/loop untouched; Task 6 case 3 asserts a
  snapshot with N failures + a skip still renders `failures (N):` and the skip is
  not among the failures rows. ✓
- **Interactive announcement routed through the tracker, not raw stderr** — Task 5
  `else` branch emits nothing; the seeded section rides every paint; cursor math
  is automatic via the existing `terminalRows` count (Task 3 explicitly forbids
  erase/cursor special-casing). ✓
- **End-of-run block, judge `STOP_RUN` message, skip mechanism, exit codes
  unchanged** — Task 5 and Task 6 enumerate the untouched surfaces; AC5/AC6
  guarded by "do not edit existing assertions." ✓

## Task shape, ordering, and guardrails

- **Shape:** every task carries Goal / Files / Changes / Depends on / Traces to /
  Acceptance, with acceptance tied to observable tests/assertions or guardrail
  exit codes.
- **Ordering:** data model (T1) → render (T2) / tracker (T3) → begin-iteration
  guard (T4) → pipeline wiring (T5) → tests (T6) → changeset (T7). The plan is
  candid that T1's commit is intentionally not type-clean in isolation (the
  data-model foundation), with `src/` typecheck recovering at the end of T5 and
  the full suite green at the end of T6. This is an acceptable, clearly-documented
  TDD ordering; each later commit is independently type-checkable.
- **Guardrails:** all five named (`npm run typecheck`, `npm run lint`, `npm test`,
  `npm --prefix testing-project run check:config`,
  `npx tsx scripts/validate-changesets.ts`). The changeset is Task 7, not deferred
  to docs, so it cannot fall through. Bump decision (`patch`, additive
  non-breaking) is pre-1.0-policy-compliant (verified: only `major` is rejected).

## Minor, non-blocking observations (no fix required)

1. **Task 3 acceptance has a garbled cross-reference** — "(edit 4 of Task… see
   Task 4 …)". The intent is unmistakable (the `beginIteration` exclusion is
   covered by Task 4), so this is cosmetic. The implementer can ignore or tidy it.
2. **Task 6 case 8's "before the end-of-run summary" ordering assertion is
   correctly marked optional.** The early line is on `console.error` (stderr) and
   the summary is on `console.log` (stdout); the harness joins those channels
   separately, so cross-channel ordering by index is not reliable. The plan rightly
   leans on substring presence (matching spec AC1, which itself drops the ordering
   clause). Aligned, not a defect.

Neither observation affects correctness, coverage, or guardrail pass; both are
left to implementer discretion. The plan is approved as written.
