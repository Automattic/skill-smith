# Docs review — APPROVED

Review: `review-2-early-skip-announcement` (issue #37, PR #45 incremental review), phase 5 (docs).
Batch: D1 (README `### Exit codes` "When an agent can't run" note), D2 (README
`## How the Self-Improvement works` improver-skip sentence).
Diff base: `883fd46`. Doc commits under review: `b8751b2` (D1), `3f73481` (D2).

## Verdict

Both edits are accurate against the shipped code, additive, boundary-respecting, and
consistent. Both phase-5 guardrails exit 0. **Approved.**

## What was verified

### 1. Accuracy vs shipped code

- **D1** now reads: the skip "is announced **early — as soon as the misconfiguration is
  detected, before the run does its work — and again in the end-of-run summary**, each time
  in the console with its **id and reason**, under its own `SKIPPED AGENTS` heading that is
  visually distinct from a failing agent, and it is recorded in `report.json`." Every clause
  matches the shipped behavior:
  - Early at detection: `earlySkips` computed immediately after `classifyRunnability`
    (`src/pipeline/pipeline.ts:114-116`), before the iteration loop.
  - Non-interactive/verbose early stderr line: `if (!tracker.interactive)` →
    `console.error('skillsmith: skipping misconfigured agent "<id>": <reason>')`
    (`pipeline.ts:149-155`).
  - Interactive live cyan `SKIPPED AGENTS` section: seeded via `skippedAgents` at tracker
    construction (`pipeline.ts:141`), rendered by `renderSnapshot` after the failures block,
    gated on length, cyan label (`src/progress/render.ts:72-78`).
  - "visually distinct from a failing agent": red failures vs. cyan `SKIPPED AGENTS` —
    confirmed (`render.ts:74` cyan; failures use red `✗` at `render.ts:160`).
  - End-of-run summary unchanged: `pushSkipBlock` still paints cyan `SKIPPED AGENTS`
    (`src/reports/summary.ts:208`).
  - `report.json` recording unchanged.

- **D2** now reads: "The skipped improver is surfaced **early — as soon as the
  misconfiguration is detected, before the run does its work — and again in the end-of-run
  summary**, each time with its id and reason, and the run exits `2`." Matches:
  - Improver skip is in the early-announce scope (`decide(s.roles) !== "STOP_RUN"` filter,
    `pipeline.ts:114-116`; `HALT_AFTER_ITERATION` is not `STOP_RUN`).
  - Run still exits `2`; the preceding "current iteration still runs to completion / loop
    halts / no improver call, no skill edits, no further iterations (not even `finalPass`)"
    text is preserved verbatim (diff touches only the final sentence).

### 2. Additive framing (R7)

Both passages use "**and again in the end-of-run summary**" — they describe BOTH surfaces
and never imply the early notice replaces the end-of-run one. The end-of-run block in code
is untouched. Satisfied.

### 3. Boundary respected (R6 + plan boundary notes)

- No internals named: `grep` of both edited paragraphs shows no `ProgressTracker`,
  `RunSnapshot`, `interactive` getter, `flush`, or cursor/`lastPaintedLines` math. The
  `SKIPPED AGENTS` label, cyan/visually-distinct framing, and id+reason content are the only
  surfaced concepts — all observable, drift-resistant.
- The full `883fd46..HEAD` README diff is **exactly** the two target paragraphs (line 62
  and line 140). Untouched: judge `STOP_RUN` note (line 100), exit-code semantics
  (lines 53-61), the `report.json` `skipped` description (line 198), and the
  `RunContext.skipped` / hook-context `skipped` text (line 259).
- No new section added. D1 and D2 use identical "early — as soon as the misconfiguration is
  detected, before the run does its work — and again in the end-of-run summary, each time
  with its id and reason" phrasing — consistent.

### 4. No missed surface

- `grep -rn "once" README.md` returns only two unrelated hits (`afterAllScenarios` "fires
  once per iteration", `beforeIteration` "once per iteration") — neither is about skip
  announcement timing. No stale "announced/surfaced once" remains in the README.
- `.changeset/skip-misconfigured-agents.md:5` still says "announced once" — this is the
  consciously-preserved historical record of what the v3 PR shipped (announce only at
  end-of-run), correctly left unchanged. The Task-7 changeset
  `.changeset/early-skip-announcement.md` (`patch`) documents this refinement, so the
  regenerated CHANGELOG reads as coherent history. Not a regression.
- README is the only edited surface, as the doc plan's survey concluded.

### 5. Phase-5 guardrails (run independently)

- `npx tsx scripts/validate-changesets.ts` → **EXIT 0** (changeset-format passes).
- `npx changeset status --since=origin/trunk` → **EXIT 0** (the package is bumped at
  `minor` overall — the v3 `minor` changeset plus the Task-7 `patch` refinement — and the
  command exits 0).

## Result

APPROVED. D1 and D2 accurately document the shipped early-and-end-of-run announcement,
preserve the additive framing and all boundary-protected passages, and both guardrails
exit 0.
