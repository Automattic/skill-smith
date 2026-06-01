# Docs Review

## Verdict

**APPROVED.** The full doc batch (D1–D8) is accurate against the shipped Phase 4
code, covers every Acceptance, stays within doc-plan scope, and introduces no
stale claim. Phase 5 is complete — the pipeline is done.

## Batch scope

- **D1** — README: misconfigured-agent skipping in the run lifecycle.
- **D2** — README: judge fail-fast and improver graceful degrade.
- **D3** — README: the INCONCLUSIVE outcome, verdict, and exit code.
- **D4** — README: one-time misconfigured-agent CLI announcement and its
  distinctness from a real failure.
- **D5** — README: the hooks-visible misconfigured set on the run context.
- **D6** — examples config: credential/provider-skip behavior and the
  unknown-provider change (incl. the corrected Gemini env var).
- **D7** — In-code contract comment on `RunContext.misconfigured` (intentional
  no-op — verify existing comment).
- **D8** — Landing page: verify no stale verdict/behavior claim (intentional
  no-op — verify clean).

## Summary

The diff `ada1883..HEAD` touches exactly the two files the plan scopes:
`README.md` (D1–D5) and `examples/skillsmith.config.ts` (D6). D7 and D8 are
no-ops, both correctly so. Every concrete claim I checked maps to the shipped
code: the three verdicts and their exit codes (PASS 0 / FAIL 1 / INCONCLUSIVE
1), the once-per-run SKIPPED-AGENTS announcement in yellow distinct from the red
FAIL block, the judge `PreconditionError` fail-fast before any tester, the
improver degrade-to-test-only via forced `maxIterations: 1`, the live
keyed-by-id passive `misconfigured` field with pre-flight-at-`beforeAll` /
runtime-by-`afterAll` semantics, true-absence of pre-flight-skipped testers
(no `beforeTestAgent`, no grid slot), and the corrected Gemini env var
`GOOGLE_GENERATIVE_AI_API_KEY`. Rationale is faithful (no invented or
contradicted "why"). All cross-link anchors resolve. The clean-run-unchanged
guarantee (R9/AC14) is stated wherever a new state is introduced. No drift: no
surface in the plan is left stale, and no shipped public surface is undocumented.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Per-task Acceptance coverage (D1–D8) | PASS | Each task's Acceptance met; see spot-check below |
| Accuracy vs shipped code (every concrete claim) | PASS | Verdicts/exit codes, env vars, fail-fast, degrade, hook timing all match |
| Audience fit | PASS | D1/D3/D4 user-facing; D2/D5/D7 role/hook authors; D6 config copiers |
| Faithful rationale (no invented why) | PASS | Judge-vs-improver asymmetry, forward-only PASS, no-silent-pass all match design KD6/KD7/KD3 |
| Drift sweep (plan surfaces; shipped public surfaces) | PASS | README + example config covered; `docs/index.html` + types.ts comment verified clean |
| Doc-plan adherence / no scope creep | PASS | Only README + example config edited; no executable shape change; no new fields |
| Convention compliance (voice, anchors) | PASS | Matches README voice/heading depth; all 5 cross-link anchors resolve |
| D6 typecheck/lint (`.ts` edit) | Comment-only | Edit touches only inline comments; no code/shape change, no new finding |

## Accuracy spot-check (evidence per task)

- **D1** — README:88 routes the agent loop through "each testing agent that is
  not skipped as misconfigured" and the Misconfigured-agents section states a
  pre-flight-skipped tester gets "no workspace, no `beforeTestAgent`…no row — as
  if it were never configured." Verified against `src/pipeline/agent-loop.ts:118`
  (`selected.filter((a) => !ledger.has(a.id))` runs before the dispatch loop and
  before `beforeTestAgent` at `:199`). True absence matches KD4. ✔
- **D2** — README "A misconfigured judge stops the run … terminates before
  dispatching any testing agent, naming the judge agent and the reason." Matches
  `src/pipeline/pipeline.ts:105-111` — `PreconditionError(['Judge agent "${id}"
  is misconfigured: ${judgeEntry.reason}'])` thrown from the pre-flight snapshot,
  before iteration. The improver "degrades … to a single test-only sweep … no
  skill edits … no further iterations" matches `:113-168` (`improverMisconfigured`
  forces `maxIterations` to 1; the improve branch at `:252` is gated on
  `!improverMisconfigured`). ✔
- **D3** — README's three outcomes PASS (exit 0) / FAIL (non-zero) /
  INCONCLUSIVE (non-zero, non-PASS, real-failure-dominates) match
  `src/reports/summary.ts:142-160` (`computeVerdict`: empty→FAIL/1, anyFail→FAIL/1,
  anyInconclusive→INCONCLUSIVE/1, else PASS/0) and the banner
  `RUN RESULT: INCONCLUSIVE (N scenarios: all testers misconfigured)` at
  `:284-287`. Per-scenario vs whole-run granularity matches `isRowInconclusive`
  (`:565-577`) rolling up to the run verdict. The README correctly does not
  hard-code the integer beyond "non-zero" where it matters. ✔
- **D4** — README "exactly one line for the whole run … yellow styling … visually
  separate from the red FAIL block … renders under every verdict … omitted on a
  clean run." Matches `pushMisconfiguredAnnouncement` (`summary.ts:348-369`):
  one line per roster entry with id + roles + reason, painted yellow, called from
  the PASS (`:272`), INCONCLUSIVE (`:289`), and FAIL (`:314`) paths, and a no-op
  when the roster is empty (`:356`). Genuine failures still in the red block and
  still counted: `failureLines` excludes only misconfigured cells (`:588-604`),
  `isRowPass` counts surviving non-excluded cells (`:541-555`). ✔
- **D5** — README "passive read-only data, not a callback … keyed by agent id …
  each entry carries the reason and the list of role(s) … `beforeAll` sees
  pre-flight skips … `afterAll` sees the full set … empty object on a clean run."
  Matches `src/config/types.ts:151-169` (`MisconfiguredEntry { reason; roles[] }`,
  `RunContext.misconfigured: Readonly<Record<string, MisconfiguredEntry>>`, "live
  view … pre-flight present from `beforeAll`; runtime accumulate by `afterAll` …
  clean run carries `{}`") and the live snapshot threading in
  `pipeline.ts:142` / `agent-loop.ts:190`. ✔
- **D6** — `examples/skillsmith.config.ts:86-87` now reads "Reads
  GOOGLE_GENERATIVE_AI_API_KEY" — matches `src/config/misconfig.ts:35`
  (`CREDENTIAL_ENV_VAR["gemini-api"] = "GOOGLE_GENERATIVE_AI_API_KEY"`) and the
  provider literal at `src/providers/gemini-api.ts:12`. The corrected comment
  replaces the stale `GEMINI_API_KEY`. The unknown-provider note ("no longer
  fails config-load … caught here and skips just that agent") matches
  `src/config/validate.ts:79-81` (the `isProviderId` branch is removed; the
  comment records the pre-flight-skip path) and `misconfig.ts:53-54`. The 401/403
  invalid-credential note matches `classifyRuntimeError` (`misconfig.ts:111-113`).
  `claude-code`/`codex` correctly described as "no API-key env var, never skipped
  for a missing credential" — both absent from `CREDENTIAL_ENV_VAR`. ✔
- **D7** — No commit, as intended. The existing comment on
  `RunContext.misconfigured` (`src/config/types.ts:162-168`) is coherent and
  accurate: it conveys passive ("a live view, keyed by agent id"),
  keyed-by-id-with-roles (via `MisconfiguredEntry` at `:151-154`), and
  progressive ("Pre-flight entries are present from `beforeAll`; runtime entries
  accumulate so the full set is present by `afterAll`"), plus the clean-run `{}`
  guarantee. D7's Acceptance is genuinely met by the existing comment — NO CHANGE
  was correct. ✔
- **D8** — No commit, as intended. `docs/index.html` shows an illustrative
  `RUN RESULT: PASS` (`:96`) and a sample pass/fail matrix at marketing altitude
  (`:92-93`, `:318` "Pass/fail matrices"). It enumerates no verdict states,
  makes no "only PASS/FAIL outcomes" claim, no "unknown provider aborts the run"
  claim, and describes no credential handling. Adding the INCONCLUSIVE state does
  not falsify an example PASS. Confirmed-clean, no edit — correct. ✔
