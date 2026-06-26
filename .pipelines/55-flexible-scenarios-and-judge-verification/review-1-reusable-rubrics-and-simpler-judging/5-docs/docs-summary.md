# Docs Summary: Reusable rubrics and a leaner, human-language live-judge setup

## What

Updated the consumer-facing narrative docs to reflect the review-1 increment: `README.md` and `examples/skillsmith.config.ts` were revised; `CONTRIBUTING.md` and `docs/index.html` were audited and left unchanged (no drift found). The docs now describe four shipped behaviors that the base docs previously contradicted:

1. **Reusable rubrics referenced by id** — a `JUDGE.md` may name shared grading criteria under a `# Rubrics` section (same list grammar as `# Skills`), resolved from an optional `paths.rubrics` location and injected into the judge's system prompt under a `# Grading rubrics` heading. The verdict stays `{ pass, notes }`.
2. **Environment booted once per run** — the reference WordPress example boots `wp-env` once in `beforeAllScenarios` and stops it in `afterAllScenarios`, instead of per (scenario, agent) pair.
3. **Judge-driven live setup** — the judge discovers/inserts the produced block(s), opens the page, and verifies from a plain-language brief; the harness no longer pre-creates a post or hands over a fixed URL.
4. **Block name un-enforced** — documented implicitly through the judge-discovers-block-names narrative.

## Why

The base docs (post the merged rewrite) asserted the *opposite* of the shipped review-1 model — e.g. "there is no `paths.rubrics`," "inline the rubric into `JUDGE.md`," per-pair env boot, and a harness that pre-creates the post and hands the judge a URL. Leaving those statements would actively mislead a consumer copying the README or the reference config. The docs phase corrected every such statement so the consumer-facing narrative matches what shipped, while preserving the project-agnostic core contract (Skillsmith owns no environment; the hook set is unchanged — only the reference project's *use* of it changed).

## How

- **README** (`DR1`, `DR3`): rewrote the breaking-change callout, "The judge brief" section, the `paths` paragraph, and the "Migrating from the old model" guidance to describe optional rubrics-by-id; added a new "Reusable rubrics" section; updated the "Hook examples" and "Environment ownership and judge concurrency" prose to describe env-once + judge-driven setup for the reference project, with cross-links to the new section. The generic config example and generic hook-lifecycle tables were deliberately left intact (the core contract is unchanged).
- **Example config** (`DR2`, `DR4`): added an optional `paths.rubrics` entry with an explanatory comment; documented the `roles.judge.prompt` "environment manual" pattern generically (no WordPress command strings); added `beforeAllScenarios`/`afterAllScenarios` hooks and rewrote the per-pair hook comments to describe install/clean-slate-on-a-warm-env rather than per-pair boot/teardown.
- **CONTRIBUTING audit** (`DR5`): swept for any statement pinning the absence of `Scenario.rubrics`/`paths.rubrics` or the old contract shape. Found none — the file documents the changeset *process*, not this feature's contract. Left unchanged.
- **Landing-page audit** (`DR6`): confirmed the "judge checks behavior" note-card ("stands up `wp-env` and drives a real browser ... that runtime belongs to the example") still reads true under the env-once, judge-driven model, and that no card claims rubrics were removed. Left unchanged.

## Key decisions

- The env-once / judge-driven changes are presented as the **reference project's** usage of an **unchanged** core hook set — the README and example explicitly preserve "Skillsmith owns no environment" and keep the generic hook tables accurate. This avoids overstating the increment as a core run-lifecycle change (it is not).
- Rubrics are documented as reusable **content**, not a structured scoring grid — the docs repeatedly reaffirm the single `{ pass, notes }` verdict with no per-rubric breakdown, matching the design's explicit scope boundary.

## Known limitations

- `examples/skillsmith.config.ts` references `prompts/judge.md` (alongside the pre-existing `prompts/testing-agent.md` and `prompts/improver.md`) from a `prompts/` directory that does not ship in `examples/`. This is consistent with the file's long-standing illustrative pattern and its "copy the parts you need" header; it does not affect any gate (typecheck does not execute `readFileSync`). A consumer copying the config supplies their own prompt files.
