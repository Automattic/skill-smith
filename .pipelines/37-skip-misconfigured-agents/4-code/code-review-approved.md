# Code Review

## Verdict

APPROVED — the sole blocking issue from review #1 (KD5/Task 3 hook-context gap)
is genuinely and completely resolved. All four `RunContext.misconfigured`-bearing
hook surfaces now carry the live/threaded misconfigured view; `{}` survives only
on a clean run with no ledger. The fixes introduced no new defect, the rest of the
batch (confirmed solid in review #1) still holds, and every gate is green. Phase 4
is complete.

## Batch scope

Tasks 1–12, the entire code plan. This is RE-REVIEW #2; the two re-dispatched
fixes were Task 9 (`agent-loop.ts` AgentContext) and Task 10 (`improver.ts`
RunContext + `pipeline.ts` threading).

- Task 1 — Pure misconfiguration classifier + credential env-var map (`src/config/misconfig.ts`).
- Task 2 — Run-scoped misconfiguration ledger (`src/config/misconfig-ledger.ts`).
- Task 3 — `RunContext.misconfigured` passive hook field (`src/config/types.ts`).
- Task 4 — Surface HTTP status into provider error strings (`src/providers/lib/vercel-runner.ts`).
- Task 5 — Demote unknown-provider from load-time abort to a skip (`src/config/validate.ts`).
- Task 6 — Scenario pass math excludes misconfigured skips; `inconclusive` field (`src/reports/scenario-report.ts`).
- Task 7 — Run-level verdict excludes misconfigured skips, rolls up inconclusive (`src/reports/iteration-report.ts`).
- Task 8 — Re-selection drops ledger ids (`src/pipeline/select-scenarios.ts`).
- Task 9 — Tester exclusion, runtime detection, sentinel write, **AgentContext misconfigured** (`src/pipeline/agent-loop.ts`).
- Task 10 — Pipeline wiring: ledger build/seed, judge fail-fast, improver degrade, RunContext, roster persistence, **improver-context threading** (`src/pipeline/pipeline.ts`, `src/improvement/improver.ts`).
- Task 11 — `summary.ts` fourth-surface verdict, exit code, inconclusive rendering, one-time announcement (`src/reports/summary.ts`).
- Task 12 — Live dashboard true-absence + runtime sentinel (`src/pipeline/pipeline.ts` tracker init).

## Summary

Review #1 found the batch correct, well-tested, and end-to-end-verified except for
one design-alignment defect: the KD5/Task 3 requirement that
`RunContext.misconfigured` reach **every** hook context via inheritance was left
half-done — `AgentContext` (built in `agent-loop.ts` for `beforeTestAgent`/
`afterTestAgent`) and the improver's `RunContext` (built in `improver.ts`) were
hardcoded `{}`, with two inline comments falsely claiming Task 10 had threaded
them. That gap is now closed:

- **Task 9 (commit 9873e99)** — `agent-loop.ts:190` sets
  `misconfigured: ledger?.snapshot() ?? {}` inside `runAgentPair`, using the
  `ledger` already destructured at :173. The old "Empty until Task 10…" comment is
  replaced by an accurate KD5/Task 3 doc comment. A surviving tester's hook context
  now sees the pre-flight roster; the no-ledger path stays `{}` for AC14.
- **Task 10 (commit 2e7d383)** — `RunImprovementParams` gains an optional
  `misconfigured?: Record<string, MisconfiguredEntry>` (improver.ts:62, documented),
  the improver's `IterationCompleteHookContext` is populated from it
  (`misconfigured: misconfigured ?? {}`, improver.ts:109), and the pipeline's
  `runImprovement(...)` call threads `misconfigured: ledger.snapshot()`
  (pipeline.ts:272). The old "Empty until Task 10…" comment is replaced by an
  accurate one.

Hook-family completeness (R7/AC9) is now genuine across all four surfaces:
`RunContext` (live getter, pipeline.ts:142), `ScenarioContext`
(`args.ledger.snapshot()`, pipeline.ts:587), `AgentContext`
(`ledger?.snapshot() ?? {}`, agent-loop.ts:190), and the improver's RunContext
(threaded snapshot, improver.ts:109 ← pipeline.ts:272). `grep "Empty until Task 10"`
over `src/` returns nothing — both stale comments are gone.

The fixes are well-targeted: 5 files, +216/−4, with two new dedicated tests added
alongside the one-line production changes. No production logic outside the two sites
changed; the rest of review #1's findings (KD1–KD8, AC coverage, the AC14
byte-for-byte clean-run assertion, the "ordinary SKIPPED still fails the row" guard)
are untouched and still hold. I do not re-litigate the settled points: the dashboard
scenario-counter cosmetic remains acceptable (the authoritative `summary.ts`/`report.json`
verdict is correct), and KD8's four verdict surfaces still agree on the single shared
`isMisconfiguredSkipReason` predicate.

## Checks

| Check | Command | Result |
| --- | --- | --- |
| Tests | `npm test` | PASS — 212 tests, 210 pass, 0 fail, 2 skip (the 2 expected pre-existing skips). +4 over review #1's 208: the two new fix tests on each side (AgentContext + improver). |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | PASS — no errors. |
| Lint | `npm run lint` (biome) | KNOWN BASELINE only — 3 errors / 6 warnings, confined to `src/progress/tracker.ts`, `src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts` (control-char/ANSI regexes). `git diff 39559d7..HEAD` shows none of those three files were touched by this batch → **no new lint finding**. Not a rejection cause. |

## Behavior verification

Evidence focuses on the two re-dispatched fixes (the AC11b/AC12/AC14 end-to-end
runs were captured in review #1 and the underlying assertions remain green in the
full suite above).

**Fix verification (KD5/Task 3) — both hook contexts now carry the live roster**,
run in isolation over the mock provider:

```
node --import tsx --test src/__tests__/agent-loop.test.ts src/__tests__/improver-misconfigured.test.ts
ok 5 - a surviving tester's before/afterTestAgent hooks see the misconfigured roster (KD5/Task 3)
ok 6 - with no ledger, a tester's hook context carries an empty misconfigured map (AC14)
ok 8 - the improver's RunContext.misconfigured reflects the threaded roster (KD5/Task 3)
ok 9 - the improver's RunContext.misconfigured is `{}` when no roster is threaded (AC14)
# tests 9 / # pass 9 / # fail 0
```

- `agent-loop.test.ts:350` records `beforeTestAgent`/`afterTestAgent` `ctx.misconfigured`
  for a surviving tester `ok` while a ledgered `bad-judge` (a *different* role, so
  `ok` is not dropped) is present, and asserts both hooks see
  `{ "bad-judge": { reason: 'unknown-provider "nope"', roles: ["judge"] } }`.
  The companion test (:400) asserts `{}` byte-identical when no ledger is supplied
  (AC14-preserving).
- `improver-misconfigured.test.ts:84` drives `runImprovement` directly with a
  `beforeImprove` hook that captures `ctx.misconfigured`, and asserts it equals the
  threaded `ledger.snapshot()`; the companion test (:105) asserts `{}` when no
  roster is threaded (AC14-preserving).

**Source confirmation** of the two fixes and absent stale comments:

```
agent-loop.ts:190   misconfigured: ledger?.snapshot() ?? {},
improver.ts:62      misconfigured?: Record<string, MisconfiguredEntry>;   (RunImprovementParams)
improver.ts:109     misconfigured: misconfigured ?? {},
pipeline.ts:272     misconfigured: ledger.snapshot(),                     (runImprovement call)
grep "Empty until Task 10" src/   → (none)
```

**Regression — full suite** (the AC11b INCONCLUSIVE/exit-1 + one-time announcement,
AC12 judge fail-fast, AC14 clean-run byte-identical assertions all live here and
remain green): `npm test` → 212 tests, 210 pass / 0 fail / 2 skip. Working tree
clean after (`git status --porcelain` empty; `.skillsmith` output dirs gitignored).
