# Spec Research: Reusable rubrics and a leaner, human-language live-judge setup

> Review-1 of the #55 pipeline. Origin and goals copied from `0-intent/intent.md`.

## Origin

Follow-up requested by the owner while reviewing the merged base work, captured as goals only ("add just the intent, no solutions so they discuss that during the design phase"). The owner's asks:

- **Rubrics:** "keep the rubrics folder and have a section in the JUDGE for rubrics to check by id … there will be multiple and each scenario will need to check one or the other."
- **Environment:** "let's try to do wp-env just once."
- **Judge setup:** "simplify the code from judge setup … everything should be managed in a human-friendly language: activate the plugin, go to X page, add this block… Like we do in the e2e tests."

## Goal

Building on the merged two-file scenario + live-judge model, make the judge side of `testing-project` more reusable, cheaper to run, and simpler to author:

1. Reusable, per-scenario rubric criteria (shared, selected by each scenario, not duplicated).
2. Stand the live environment up once per run (not per pair).
3. Human-friendly judge setup (the brief reads like a plain-language e2e test; minimal hand-written setup code).

## Context

- Follows merged base work (#55 / PR #56): two prose files per scenario; judge verifies behavior live with project-configured capabilities; project owns its environment.
- Pain points: the shared rubric is inlined identically across all 11 `JUDGE.md`; `testing-project` boots/tears wp-env per pair; `eval/utils/wp-env-judge.ts` is complex.
- Scope: primarily `testing-project`, plus core support for reusable rubrics. Refines (not reverts) the merged model; pre-1.0, no back-compat burden.

## Q&A

**Q1 (Goal 3 — how far does "human-language setup" go):** Pushing setup steps (activate the plugin, create/visit a page with the block) into the judge, driven by the plain-language brief, makes the *setup itself* non-deterministic — a fumbled setup command could fail a scenario for a non-behavioral reason (a different flavor of the brittleness the base work removed). At the requirement level, how far should this go?
  - (a) Judge drives the **full** e2e including setup (activate, create/visit page) from the human-language brief — accept the added setup variance.
  - (b) The harness still does the **deterministic setup** (env up, plugin built + active, a page with the block ready at a URL); the judge's brief is the human-language behavioral test against that ready page.
  - (c) A split — e.g., harness guarantees the plugin is installed/active and hands over a base URL; the judge does page/post creation + navigation + checks.

**A1:** **(a) — judge-driven setup.** The judge runs the full e2e from the human-language brief: activate, insert the produced block(s), navigate, check. These are deterministic wp-cli/navigation steps (clear pass/fail), not brittle selectors — and `trunk`'s existing e2e harness already boots one env and does deactivate-all + activate-one per test, so the pattern is proven. The one deterministic guarantee kept on the harness side: a **clean slate before each pair's judge** (only this pair's plugin active). The flake concern was overstated for these specific operations and is withdrawn.

**A1b (block naming — no longer enforced):** The scaffold's fixed `skillsmith/testing-block` name was a crutch for deterministic e2e specs. With a smart judge driving setup, the judge **reads the produced `block.json`(s) to discover the actual block name(s) and inserts whatever the testing agent created** — so a scenario may produce **one or more blocks under any name**. The plugin **slug** stays deterministic (used to activate); only the block **name** becomes free. (Requirement, not mechanism.)

**Q2 (Goal 1 — rubric shape):** Confirm the requirement shape for reusable rubrics: a scenario references reusable rubric criteria **by id**; the referenced rubric content is injected into the judge's grading context (it is reusable prose the judge weighs, **not** a return to per-rubric structured pass/fail grading — the overall verdict stays a single `{ pass, notes }`); referencing is **optional** (a scenario may reference none and just write a freeform judge brief); and an unknown rubric id is a **clear error**, the same way an unknown skill id is today. Is that the shape you want?

**A2:** Confirmed (after clarifying "injected into grading context" = Skillsmith auto-supplies the referenced rubric's text to the judge as grading material, so the author doesn't paste it and the judge doesn't hunt for it — the skills-symmetric "load the rubric file into the judge's prompt" path is the obvious mechanism, but the mechanism is design's call). Rubrics are reusable **content** referenced by id, optional, unknown-id → clear error; overall verdict stays `{ pass, notes }` (not a structured scoring grid).

**Q3 (Goal 2 — scope/boundary):** Booting wp-env once is a `testing-project`-level change (boot in a run-level hook, keep warm, install/clean-slate/activate the pair's plugin per judge); judges stay **serial**; the only Skillsmith-core change in this review is the rubric support. Agree that's the boundary?

**A3:** Agreed. `testing-project`-level env-once + serial judges; core change limited to rubric support (resolution/injection + validation + the optional rubrics path). No core lifecycle change.

**Q4 (testing posture + definition of done):** Posture carries over from the base run (manual full testing; pipeline agents don't run the self-improvement loop or depend on a full-suite green run; at most one scenario × one agent; deterministic gates green). "Done" = core rubric support; testing-project rubric restored + referenced by id + slimmed `JUDGE.md`; wp-env once + per-pair install/clean-slate/activate; block name not enforced (judge discovers/inserts produced blocks); a changeset. Correct?

**A4:** Confirmed ("Go ahead"). Posture and the five-point done-list stand.

## Research

- **Ref clarification:** `trunk` (origin/trunk) still has the OLD e2e harness (`e2e.spec.mjs` doing `deactivateAllPlugins()` + `activatePlugin()` per test, booted by `verify-e2e.ts` with one env + all plugins) because PR #56 is unmerged. The per-pair fresh-env approach is on the review branch (PR #56), not yet on trunk. The owner's linked example is trunk's old harness — which validates that boot-once + per-test activate/deactivate works.

- **Current plugin activation (merged `testing-project/eval/utils/wp-env-judge.ts`):** plugins are NOT activated/deactivated per test in a shared env. Each (scenario, agent) pair boots a *fresh single-plugin* wp-env — `setUpJudgeEnv` writes a `.wp-env.json` listing only that pair's plugin, `env:start` (which activates it) + an explicit `wp plugin activate <slug>`, creates a post; `tearDownJudgeEnv` runs `env:stop`. So the env is ephemeral per pair. The old activate/deactivate-per-spec cycling lived in the now-deleted `verify-e2e.ts` (which booted one env with all plugins).
- **Implication for "boot once":** a single shared env can hold only one active plugin at a time, because every produced plugin registers the **same block name** `skillsmith/testing-block`. So a deterministic clean-slate step (deactivate the previous / ensure only this pair's plugin is active) is needed before each pair's judge runs — and that part is best kept deterministic regardless of how much else is judge-driven.
- **Feasibility of judge-driven setup:** `wp plugin activate <slug>`, `wp post create --post_content='<!-- wp:skillsmith/testing-block /-->' --porcelain`, and navigating to a URL are unambiguous, deterministic commands with clear pass/fail (unlike brittle CSS selectors, which fail on legitimate variation). An LLM judge with exact command templates can run them reliably; the residual risks are a weaker model skipping a step and the judge needing a clean wp-cli bridge from its workspace cwd — both modest and mitigable.

## Out of Scope

- Parallel judging / removing the serial constraint.
- Any Skillsmith-core run-lifecycle change (env-once is testing-project-only).
- Authoring new rubric content beyond restoring the existing best-practices rubric.
- Changing the verdict shape or adding per-rubric structured scoring.
- Enforcing globally-unique block names (the change is to stop enforcing the fixed name, not impose a new scheme).
- Swapping wp-env for a different runtime (e.g. wp-now) or other perf redesigns beyond booting once.
- A generic include mechanism for arbitrary shared snippets (scope is rubrics-by-id specifically).
- Backward compatibility (pre-1.0; refines the unmerged base).

## Consolidated Requirements

1. A `JUDGE.md` may reference one or more reusable rubrics **by id**; Skillsmith resolves each to a rubric file under a configured location and auto-supplies its content to the judge as grading material.
2. Referencing rubrics is **optional**; an **unknown rubric id** is a clear per-scenario error (like an unknown skill; no throw).
3. Rubrics are reusable **content**; the overall verdict stays `{ pass, notes }` (no structured per-rubric scoring).
4. The optional rubrics path/dir is restored to the config/paths surface (required to exist only when used).
5. `testing-project` boots wp-env **once per run** (run-level hook, kept warm); per pair it installs the built plugin + guarantees a clean slate (only this pair's plugin active) + activates; judges stay **serial**. The env helper is simplified.
6. The judge performs the live setup from the human-language `JUDGE.md` (activate, insert produced block(s), open page, check). The harness keeps boot/build/install/clean-slate and exposes a reliable WP-CLI/env bridge.
7. Block naming is **not enforced**: the testing agent may produce one or more blocks under any name; the judge discovers and inserts the produced block(s). The plugin **slug** stays deterministic (for activation).
8. `testing-project` conversion: the shared best-practices rubric is restored to a `rubrics/` folder; every scenario references it by id (no inlined rubric text); each `JUDGE.md` is slimmed to human-language behavioral setup + rubric id(s).
9. Only Skillsmith-core change = rubric support; no core run-lifecycle change.
10. A changeset records the change (pre-1.0, minor), extending the existing unmerged feature changeset rather than contradicting it.
11. Testing posture unchanged: manual full testing; agents don't run the self-improvement loop or depend on full-suite green (≤ one scenario × one agent); deterministic gates green.
