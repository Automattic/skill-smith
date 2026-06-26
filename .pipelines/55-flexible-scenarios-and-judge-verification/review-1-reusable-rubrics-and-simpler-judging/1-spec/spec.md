# Spec: Reusable rubrics and a leaner, human-language live-judge setup

## Overview

This is review-1 of the #55 pipeline (on the unmerged PR #56 branch). The merged base work made each scenario two prose files (`TESTING-AGENT.md` + `JUDGE.md`), turned the judge into a live behavioral verifier with project-configured capabilities, and made the consuming project own its environment.

This review refines the judge side of the bundled `testing-project` — plus the one core capability that supports it — along three lines:

1. **Reusable rubrics referenced by id**, so shared grading criteria are not duplicated across judge briefs and different scenarios can select different rubrics.
2. **The WordPress environment is stood up once per run** instead of booted/torn down per (scenario, agent) pair.
3. **Human-language, judge-driven setup**: each `JUDGE.md` reads like a plain-language e2e test (activate the plugin, insert the produced block(s), open the page, check behavior), the env helper is simplified, and the fixed block name is no longer enforced.

It **refines, not reverts** the merged model: the judge brief stays freeform, the verdict stays `{ pass, notes }`, and there is no backward-compatibility burden (pre-1.0). The only Skillsmith-core change is rubric support; everything else is `testing-project`.

## Requirements

### Reusable rubrics (Skillsmith core)

1. A `JUDGE.md` may reference one or more reusable rubrics **by id**. Skillsmith resolves each id to a rubric file under a configured rubrics location and supplies that content to the judge as grading material automatically — the author does not paste it and the judge does not have to locate it. (The obvious mechanism mirrors `# Skills`: load the rubric file into the judge's prompt; the exact mechanism is the design phase's call.)
2. Referencing rubrics is **optional** — a scenario may reference none and rely on its freeform `JUDGE.md` alone.
3. An **unknown rubric id** is reported as a clear per-scenario error, consistent with how an unknown skill id is handled today (no throw; the scenario surfaces the error and runs no agents / aggregates fail).
4. Rubrics are reusable **content**, not a structured scoring grid: the judge's overall verdict remains a single `{ pass, notes }`.
5. The optional rubrics location is restored to the configuration/paths surface, required to exist only when a project uses it.

### Environment booted once (testing-project)

6. `testing-project` stands up its WordPress environment **once per run** (a run-level hook), kept warm, instead of booting/tearing it down per (scenario, agent) pair.
7. Per pair, the harness installs the pair's built plugin into that one environment and guarantees a **clean slate** (only this pair's plugin active) before the judge runs. Judges remain **serial**.
8. The env-setup helper is simplified to reflect this.

### Human-language, judge-driven setup (testing-project)

9. The judge performs the live setup from the human-language `JUDGE.md` — activate the plugin, insert the produced block(s), open the page, and verify behavior — rather than the harness pre-creating the post and handing over a URL. The harness retains the deterministic, infrastructural parts: boot, build, install, the clean-slate guarantee, and a reliable way for the judge to issue WP-CLI / reach the environment.
10. **Block naming is no longer enforced.** The testing agent may produce one or more blocks under any name; the judge discovers the produced block name(s) (e.g. from `block.json`) and inserts them. The plugin **slug** stays deterministic (used for activation).

### testing-project conversion

11. The shared best-practices rubric is restored to a `rubrics/` folder and every existing scenario references it by id; the inlined rubric text is removed from all `JUDGE.md` files, and each `JUDGE.md` is slimmed to its human-language behavioral setup + rubric id(s).

### Boundaries & posture

12. The **only** Skillsmith-core change is the rubric support (resolution, injection, validation, optional path). No core run-lifecycle change.
13. A changeset records the change (pre-1.0, minor). As this layers onto the same unmerged PR, it extends/updates the existing feature changeset rather than contradicting it.
14. **Testing posture is unchanged** from the base run: full behavioral testing is manual; pipeline agents do not run the self-improvement loop and do not depend on a full-suite green run (at most a single scenario × single agent sanity check); the deterministic gates (typecheck, lint, unit tests, `check:config`, changeset) stay green.

## Out of Scope

- Parallel judging / removing the serial constraint.
- Any Skillsmith-core run-lifecycle change (env-once is `testing-project`-only).
- Authoring new rubric content beyond restoring the existing best-practices rubric (the mechanism supports multiple; new rubrics are future content).
- Changing the verdict shape or adding per-rubric structured scoring.
- Enforcing globally-unique block names (the change is to stop enforcing the fixed name, not impose a new naming scheme).
- Swapping wp-env for a different runtime (e.g. wp-now) or other performance redesigns beyond booting once.
- A generic include mechanism for arbitrary shared snippets (scope is rubrics-by-id specifically).
- Backward compatibility (pre-1.0; refines the unmerged base).

## Acceptance Criteria

1. **Rubric resolution** — Given a `JUDGE.md` that references an existing rubric by id, When the judge runs, Then that rubric's content is part of the judge's grading material without being inlined in `JUDGE.md`.
2. **Optional** — Given a `JUDGE.md` with no rubric reference, When the scenario runs, Then it is valid and the judge grades on the freeform brief alone.
3. **Unknown id** — Given a `JUDGE.md` referencing an unknown rubric id, When Skillsmith enumerates the scenario, Then it reports a clear per-scenario error (like an unknown skill) and does not throw.
4. **Verdict unchanged** — Given any judge run, Then the recorded verdict is `{ pass, notes }` with no per-rubric structured result.
5. **One boot** — Given a run spanning multiple (scenario, agent) pairs, When it executes, Then wp-env is booted once (not per pair), each pair's plugin is installed/activated against that one env, and only the pair under evaluation is active when its judge runs.
6. **Judge-driven setup** — Given a scenario whose `JUDGE.md` describes the e2e in plain language, When the judge runs, Then it activates the plugin, inserts the produced block(s), opens the page, and verifies behavior from the brief.
7. **Free block name / multiple blocks** — Given a testing agent that produced block(s) under any name(s), When the judge sets up, Then it inserts the produced block(s) by their actual discovered name(s), with no dependency on a fixed block name.
8. **testing-project converted** — Given the finished work, When `testing-project` is inspected, Then a `rubrics/` folder holds the shared rubric, every scenario references it by id with no inlined rubric text, and the env is booted once per run.
9. **Manual behavioral verification** — The deterministic gates are green; end-to-end behavioral verification across the suite is performed manually (acceptance is not "the full suite passes in CI").
