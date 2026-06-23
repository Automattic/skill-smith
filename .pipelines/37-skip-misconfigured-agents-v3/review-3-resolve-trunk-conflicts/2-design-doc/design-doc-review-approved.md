# Design Doc Review

## Verdict: approved

## Summary

This is an unusually rigorous reconciliation design, and — most importantly for a
review run — it is **factually accurate**. I re-ran the trial merge of `trunk`
(`95c86bd`) into the current branch HEAD (`7dbc9f5`) in a throwaway worktree and
independently verified every load-bearing claim: exactly 19 `UU` content conflicts
(zero add/delete); the toolchain files (`package.json`/`biome.json`/`package-lock.json`)
auto-merge to Biome 2.5.0 with zero `2.4.12` references and are outside the conflict
set; `src/progress/types.ts` auto-merges with `skippedAgents`; both `pipeline.ts`
meeting points resolve as described (the `runScenario` call carries
`agentFilter`/`scenarios`/`skipped` together on HEAD, and both `writeRunReport`
calls keep their 4-arg skip-bearing form); `summary.ts`, `tracker.ts`,
`agent-loop.ts`, `improver.ts`, `iteration-report.ts`, and `providers/types.ts` are
genuinely pure-reformat on trunk's side (token-multiset diff base→trunk shows zero
new semantic tokens, only trailing-comma deletions); the `tracker.ts` private-field-
plus-getter clash is real, making the `interactiveMode` rename mandatory to compile;
and — the High-risk item — trunk's nested `scenarioDirOf` body **auto-merges** (lines
291–301, outside all three conflict regions) while the branch's `projectArgs`/4-arg
side lands on HEAD with no config back-edge. The README overlap (2 regions), the
27-file post-merge test set with all nine skip tests, the local 2.4.12 binary, and
the changeset-gate-only / `release.yml`-dispatch-only CI nuance all checked out.
Coverage of R1–R10 is complete with per-decision traceability, credible alternatives
are weighed (merge vs rebase vs squash; auto-adopt vs hand-edit toolchain), the
failure-mode → guardrail table is accurate, and the single unguarded mode is
surfaced prominently with a concrete reviewer-inspection mitigation. The design
stays at architecture/decision altitude and defers line-placement and exact prose to
the code phase. I found only two minor characterization imprecisions (noted below for
the code phase); neither changes a resolution outcome or warrants rejection.

## Notes for the code phase (non-blocking — recorded for accuracy, not rejection)

These do not change any resolution the design prescribes; the design's stated
resolution principles already produce the correct file in both cases. They are
recorded so the plan/code phases do not over-trust the two "no overlap" labels.

1. **`examples/skillsmith.config.ts` is not strictly "different blocks, no overlap."**
   Decision 3.3 describes this file as keeping trunk's `cc-haiku` subscription-auth
   comment and the branch's api-provider skip comments as "different blocks, no
   overlap." The `cc-haiku` comment does auto-merge cleanly outside the conflict
   (verified, lines 41–43). But the two actual conflict regions sit **inside** the
   api-provider comment blocks themselves (`anthropic-sonnet`/`openai-nano` at 55–79,
   `gemini-flash` at 94–105), and the gemini block carries a genuine content
   divergence: HEAD's comment says `GOOGLE_GENERATIVE_AI_API_KEY` while trunk's says
   `GEMINI_API_KEY`. The design's instruction — keep the branch's skip comments —
   yields the correct result, because HEAD's `GOOGLE_GENERATIVE_AI_API_KEY` matches
   the real `requiredEnv` in `gemini-api.ts` (verified) whereas trunk's name would be
   wrong. So "keep HEAD" is right, but the code phase should treat this as a small
   two-sided pick (resolve the env-name in HEAD's favor), not a pure auto-merge.

2. **The README overlapping paragraphs are slightly mislabeled.** Decision 3.2 names
   "the `afterAllScenarios` bullet and the self-improvement-summary sentence" as the
   two overlaps. In the merged file the duplicated paragraphs are actually the
   hooks-narrative `afterAllScenarios` paragraph (the branch's `ctx.skipped`/runnable-
   exclusion + `(scenario, agent)` version vs trunk's `(scenario.name, agent)` version)
   and the verification-gate paragraph (same kind of overlap). The merge principle the
   design states — combine the branch's skip/runnable prose with trunk's `scenario.name`
   precision — is correct and applies to whichever paragraphs overlap; the code phase
   should merge **both** duplicated paragraphs it finds, not assume there is exactly
   one bullet plus one summary sentence.
