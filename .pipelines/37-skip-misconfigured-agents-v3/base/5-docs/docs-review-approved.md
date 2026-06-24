# Docs review — APPROVED

Batch: D1–D6 (README.md, CONTRIBUTING.md, examples/skillsmith.config.ts, .changeset).
Diff reviewed: `89d7c26..HEAD` (commits 3adac21, c078da2, fefe85d, 86c1919, b87265f, f5ccd76).
Verdict: **APPROVED.** Every documented fact matches the shipped code; the batch is
complete, shipped-behavior-only, internally consistent, and clean.

## Accuracy — verified against shipped code

- **Exit codes (`0`/`1`/`2`, precedence to `2`).** README §"Exit codes" (lines 52–62)
  states `0` clean / `1` evaluation failure / `2` config error with `2` over `1`, and
  "a skipped agent never lets the run exit `0`". Matches `src/reports/summary.ts:78`
  (`skipped.length > 0 ? 2 : allPass ? 0 : 1`). Stated identically in the changeset
  (`.changeset/skip-misconfigured-agents.md:7`).
- **`report.json` shape + snippet.** README §"Skipped agents in `report.json`" (lines
  183–198) documents the merged report as `{ runId, pass, scenarios, skipped }` with a
  `skipped: [{ id, roles, reason }]` sibling of `scenarios`. Matches
  `src/reports/iteration-report.ts:165` (`{ runId, pass, scenarios, skipped }`) and the
  `SkippedAgent` shape `{ id, roles, reason }` at `src/runnability.ts:13-17`. The
  "no row in the matrix" / distinct-from-the-per-cell-`SKIPPED`-marker claim is correct
  (the per-cell `SKIPPED` is a real `Cell` kind in `summary.ts`).
- **Judge stops the run.** README line 100 ("If the judge can't run, the run stops" —
  single message, exit `2`, no graded matrix / no `report.json`). Matches
  `src/pipeline/pipeline.ts:100-107`, which returns `2` before any hook, tracker, or
  report when the judge's most-severe consequence is `STOP_RUN`.
- **Improver halts after the iteration.** README line 140 (current iteration completes
  with a valid matrix that stands; loop halts; no improver call, no skill edits, no
  further iterations "not even the `finalPass` sweep"; exit `2`). Matches the
  `runnability.improverRunnable` guards at `pipeline.ts:214-219`, the `break` at
  `pipeline.ts:245-250`, and the `finalPass` guard at `pipeline.ts:258`.
- **Multi-role most-severe.** README line 100 ("most-severe consequence applies … judge
  stops the run regardless of its other roles"). Matches `decide()` /`SEVERITY`
  (`STOP_RUN` > `HALT_AFTER_ITERATION` > `EXCLUDE_LANE`) at `src/runnability.ts:100-129`.
- **`RunContext.skipped`.** README line 259 documents a readonly `skipped` field,
  `ReadonlyArray<{ id, roles, reason }>`, present from `beforeAll` onward, optional to
  consume, same data as the report. Matches `src/config/types.ts:156`
  (`readonly skipped: ReadonlyArray<SkippedAgent>`) and `pipeline.ts:118-125`, where
  `runCtx.skipped` is populated before the first hook fires.
- **`Provider.requiredEnv` + the three values.** CONTRIBUTING.md:27 documents the
  optional readonly `requiredEnv?: string` and the shipped values `openai-api →
  OPENAI_API_KEY`, `anthropic-api → ANTHROPIC_API_KEY`, `gemini-api →
  GOOGLE_GENERATIVE_AI_API_KEY`, and that `claude-code`/`mock`/`codex` omit it. Matches
  `src/providers/{openai-api,anthropic-api,gemini-api}.ts` and the absence of
  `requiredEnv` on the other three; field is declared at `src/providers/types.ts:53`.
- **Example config fix.** `examples/skillsmith.config.ts:77` now names
  `GOOGLE_GENERATIVE_AI_API_KEY`; `GEMINI_API_KEY` appears nowhere in the repo docs.
- **e2e exclusion.** README lines 92 and 149 describe `afterAllScenarios` reading
  `ctx.skipped`, deriving runnable test-agent ids, and running Playwright only against
  those (no project / plugin / spec for a skipped agent). Matches
  `testing-project/skillsmith.config.ts:60-77` (filters `skipped` by the `test` role,
  derives `runnableAgentIds`) and the `--project` forwarding in
  `testing-project/eval/utils/project-args.ts`.
- **Changeset.** `"@automattic/skillsmith": minor` matches `package.json` name; body is
  imperative present, additive, no conventional-commits prefix, no PR/author ref, no
  `BREAKING:`.

## Completeness

All six doc surfaces the plan calls for are covered: exit-code contract + skip surfacing
(D1), `report.json` `skipped` array + snippet (D2), judge/improver/multi-role behavior
(D3), `RunContext.skipped` + e2e exclusion (D4), `Provider.requiredEnv` + example fix
(D5), and the `minor` changeset (D6). Cross-references resolve: `#exit-codes`,
`#hooks`, `#skipped-agents-in-reportjson`, `#afterallscenarios--the-verification-gate`,
and `#how-the-self-improvement-works` all map to existing headings.

## Shipped-behavior-only

No mention of an unbuilt "fail"/"skip" policy, no skip-named-agents CLI flag, no runtime
error classifier. Grep of the added doc lines for `policy`/`classifier`/`skip-named`
returns nothing. (The internal `decide()` "policy" seam and the `Consequence` enum stay
in code comments — they do not leak into the docs.)

## No internal-process vocabulary

Grep of the added doc lines for phase / spec / plan / acceptance / criteria / `R\d` /
`D\d` / task-id / design-doc returns only legitimate domain uses of "spec" (Playwright
test *spec* files, "no spec for a skipped agent") in prose that already used that term.
No process vocabulary.

## Consistency

Exit codes and precedence stated identically across README, the changeset, and
CONTRIBUTING-adjacent prose. Env-var names identical across README, CONTRIBUTING,
example config, and changeset; `GEMINI_API_KEY` fully removed. Additions match the
register/density of surrounding prose; no unrelated prose rewritten (the two
`afterAllScenarios` paragraphs gained one in-place sentence each; nothing restructured).

## Hygiene

- `npm run lint` — clean (biome, 109 files, no fixes).
- `node --import tsx scripts/validate-changesets.ts` — exit 0 (the new changeset passes
  content validation: valid `minor` bump, no forbidden `major`, no `BREAKING:` needed).
- The `validate-changesets.test.ts` `B8 CLI smoke` failures are the pre-existing
  `ERR_MODULE_NOT_FOUND` in the test harness, unrelated to the changeset content and not
  introduced by this batch.

## Non-blocking notes (no action required)

- README line 100 reuses the `#exit-codes` anchor for the bold label "When an agent
  can't run" (that label is bold text inside the Exit-codes section, not its own
  heading). The link still resolves to the correct section; deliberate and fine.
- README line 100 packs the judge behavior and the multi-role rule into one paragraph.
  Accurate and within the "keep additions tight" instruction; no change needed.
