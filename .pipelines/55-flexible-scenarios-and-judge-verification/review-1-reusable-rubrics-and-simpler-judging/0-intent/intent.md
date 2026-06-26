# Reusable rubrics and a leaner, human-language live-judge setup

## Origin

Follow-up requested by the owner while reviewing the merged base work, captured **as goals only** at the owner's explicit request ("add just the intent, no solutions so they discuss that during the design phase"). The owner's asks, faithfully:

- **Rubrics:** *"would it make sense to keep the rubrics folder and have a section in the JUDGE for rubrics to check by id? Now we only have one that is used for all the scenarios, but the idea is there will be multiple and each scenario will need to check one or the other."*
- **Environment:** *"let's try to do wp-env just once."*
- **Judge setup:** *"I want to simplify the code from judge setup. Ideally, everything should be managed in a human-friendly language: activate the plugin, go to X page, add this block… Like we do in the e2e tests."*

The owner's specific suggestions above (a rubrics-by-id section, booting once, human-language setup) are recorded as their leanings — the design phase decides the actual mechanism. Convenience links: issue https://github.com/Automattic/skillsmith/issues/55, PR https://github.com/Automattic/skillsmith/pull/56.

## Goal

Building on the merged two-file scenario + live-judge model, make the judge side of the bundled `testing-project` more reusable, cheaper to run, and simpler to author:

1. **Reusable, per-scenario rubric criteria** — shared judge grading criteria can be defined once and reused across scenarios, with each scenario selecting which apply, instead of every judge brief duplicating the same rubric text.
2. **Stand the live environment up once per run** — the WordPress environment is brought up a single time for a run, rather than booted and torn down for every (scenario, agent) pair.
3. **Human-friendly judge setup** — the per-scenario judge instructions (activate the plugin, put the block on a page, open it, check the behavior) read like a plain-language e2e test, with hand-written harness/setup code minimized.

## Context

- Follows the merged base work (#55 / PR #56): scenarios are two prose files (`TESTING-AGENT.md` + `JUDGE.md`), the judge verifies behavior live with project-configured capabilities, and the consuming project owns its environment.
- Pain points this targets: the shared best-practices rubric is currently inlined identically across all 11 `JUDGE.md` files; the `testing-project` boots/tears down wp-env per (scenario, agent) pair; and the env-setup helper (`eval/utils/wp-env-judge.ts`) is fairly complex.
- Scope is primarily the bundled `testing-project`, plus whatever Skillsmith-core support the reusable-rubric goal needs. This refines the merged model — it does not revert it; still pre-1.0, so no backward-compatibility burden.
