# More flexible scenario definition and judge-verified behavior

> Source: GitHub issue #55 — https://github.com/Automattic/skillsmith/issues/55 (mirrored as Linear BILLOW-106).
> This file is self-contained; agents do not need to open the source issue.

## Goal

A project using Skillsmith can describe what an implementation should *do* in plain language and have the judge (an AI agent) verify that behavior on a live site, instead of relying on hand-written e2e tests that assert specific selectors. The outcome is threefold:

1. **Verification reflects real behavior, not selector matching.** Today's e2e tests fail even when the testing agent's code is correct, because it's hard to always match the selectors the tests expect — a false failure that reflects test brittleness rather than wrong behavior. Asking the judge to check the intended behavior directly is also more flexible.
2. **Defining a scenario gets simpler.** Projects interact with Skillsmith through fewer, more self-contained files instead of today's web of linked rubrics, prompts, and spec files.
3. **Verification is no longer prescribed by Skillsmith.** Instead of baking in a fixed structure (rubrics + acceptance + e2e specs), a project expresses in prose whatever it wants the judge to check — so different projects can verify different things.

## Context

- **Our instance:** in the bundled `testing-project` we want the judge to check acceptance criteria, compare against rubrics, and verify UX behavior on a live site — but that is one project's choice, and the mechanism should stay general so other projects can ask for different things.
- **Scope spans two parts:** (a) a change to how projects interact with Skillsmith — the tool's surface for defining a scenario and its verification; and (b) updating the bundled `testing-project` to adopt the new approach and prove it works end-to-end.

## Assumptions / directions to explore

*(Open — later phases may confirm or revise the exact file split and naming.)*

- Replace the current per-scenario setup (`scenario.yaml` + linked rubrics + linked prompts + `e2e.spec.mjs`) with two self-contained prose files:
  - **`TESTING-AGENT.md`** — which skills to use, the human prompt, and links to shared prompt files (e.g. the testing-agent prompt).
  - **`JUDGE.md`** — what the judge analyzes: the acceptance criteria for evaluating the code, comparison against the rubrics, and an "e2e" section describing in plain language what to do on a live site (go to localhost, activate the plugin, check this behavior) — what the e2e tests cover today, but in human language.
- Folding rubrics and prompts into these files would remove the need to link them separately.
