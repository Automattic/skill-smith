# Spec: Leaner judge briefs — natural-language rubrics and an auto-supplied task

## Overview

Skillsmith is a scenario-based evaluation harness: for each scenario a **testing agent** implements something from a `TESTING-AGENT.md` brief, a **judge** verifies it against a live environment from a `JUDGE.md` brief and returns `{ pass, notes }`, and a self-improvement loop rewrites the project's *skills* until scenarios pass.

An earlier increment on this branch (review-1) made the judge's rubric grading reusable by teaching Skillsmith to parse a `# Rubrics` section out of `JUDGE.md`, validate each listed id against a rubric file at enumeration, and inject the matched rubric(s) into the judge prompt. In practice that reintroduced two frictions the two-file model was meant to avoid: a **required, id-matched structured section** inside `JUDGE.md`, and **`JUDGE.md` files that repeat the task** the testing agent was given (a `## Scenario requirements` block duplicating `TESTING-AGENT.md`).

This revision makes a scenario's `JUDGE.md` leaner to author and free of duplication, in two moves:

1. **Rubrics referenced in natural language.** `JUDGE.md` goes back to being fully opaque prose — Skillsmith parses nothing structured out of it. An author names the rubric to grade against in plain language (e.g. "grade the code against the WordPress Interactivity API best-practices rubric"), and the judge reliably grades against that rubric. There is no required `# Rubrics` section and no id-matching. The rubrics directory remains project-configurable and optional.
2. **The judge is told the task automatically.** Skillsmith supplies the testing agent's task to the judge on every judge run, so `JUDGE.md` no longer restates it. The task is supplied **without** the testing brief's `# Skills` section, keeping the judge agnostic to the skill under test.

The judge itself is unchanged: it stays the live behavioral judge returning `{ pass, notes }`, and reporting and the self-improvement loop are untouched. The work spans Skillsmith core (remove the `# Rubrics` parser/validation/selection; auto-supply the task; keep the rubrics path optional) and the bundled `testing-project` (convert all scenario `JUDGE.md` files to the new shape). The project is pre-1.0 (`0.x`); the core change is recorded with a `minor` changeset per project policy. Full behavioral verification remains manual/owner-run.

*Implementation note for later phases:* the design, plan, and code phases must consult `origin/trunk` — not only this branch — because trunk still carries the original rubric-loading machinery and rubric content this change builds on. **How** the referenced rubric content reliably reaches the judge is a design decision (one candidate direction, raised by the owner, is to make all rubrics in the configured path available to the judge and let the prose select which apply); this spec fixes the outcome, not the mechanism.

## Requirements

### `JUDGE.md` is fully opaque

1. Skillsmith parses **no** structured section out of `JUDGE.md`. The entire file is opaque prose passed through to the judge. The review-1 `# Rubrics` parser, its enumeration-time id validation, and id-matched rubric selection are removed. `JUDGE.md` has no required or reserved section names.
2. A scenario author indicates which rubric(s) the judge should grade against by referring to them in **natural-language prose** inside `JUDGE.md`.

### Rubric grading

3. When a `JUDGE.md` refers to a rubric in prose, the judge **reliably** grades the produced code against that rubric. (Reliability is a first-class quality bar; the mechanism that delivers rubric content to the judge is decided in the design phase.)
4. The rubrics directory is **optional** and configured through Skillsmith config (the existing `paths.rubrics?` surface, optional, with no start-up existence gate). When a project configures no rubrics path, or points at an empty directory, the judge runs with **no rubric context and no error**; rubrics are an opt-in feature.
5. There is no enumeration-time validation that a rubric named in `JUDGE.md` prose exists — a mistyped reference is not reported by Skillsmith (accepted trade for fewer authoring restrictions).

### Auto-supplied task

6. On **every** judge run, Skillsmith automatically supplies the testing agent's task to the judge, so the judge knows what it is evaluating without `JUDGE.md` repeating it. This is unconditional (not a config toggle).
7. The task supplied to the judge is the `TESTING-AGENT.md` content **excluding** its `# Skills` section. The judge is never told which skill(s) the testing agent used, so a flawed skill under evaluation cannot bias the verdict toward "correct".

### Judge, reporting, and loop unchanged

8. The judge remains the live behavioral judge that returns a single `{ pass, notes }` verdict. The verdict shape, `classifyVerdict` behavior, report contents, console/progress output, and the self-improvement loop are unchanged. This is **not** a revert to trunk's read-only structured `{ rubrics, acceptance }` grader.

### `testing-project` conversion

9. All 11 `testing-project` scenario `JUDGE.md` files are converted to the new shape: remove the repeated `## Scenario requirements` block and the `# Rubrics` id-list; refer to the applicable rubric in prose; keep the plain-language environment/setup and live-checks sections.
10. The rubric file content (`eval/rubrics/wp-interactivity-api-best-practices.md`) is unchanged. `testing-project` keeps opting into rubrics by configuring `paths.rubrics`.

### Process constraints

11. A changeset is recorded per project policy: the core change bumps the package (`minor`, pre-1.0); `testing-project`-only changes do not bump.
12. Testing posture is unchanged from the #55 spec (req. 16): full behavioral verification across the suite is manual/owner-run; pipeline agents run at most one scenario × one agent as a sanity check; deterministic parts (parser removal, config, discovery, judge-prompt assembly, task supply) are covered by unit/integration tests; the self-improvement loop is not exercised by the pipeline.

## Out of Scope

- **Backward compatibility** with the review-1 `# Rubrics` id-section — it is removed, not supported alongside the new model.
- **Enumeration-time validation of rubric references** — mistyped rubric names in prose are not detected.
- **Changing rubric file content** — the existing rubric file is untouched.
- **Reverting the judge** to trunk's read-only structured `{ rubrics, acceptance }` grader.
- **Making auto-task-passing configurable** — it is always on.
- **Redesigning the self-improvement loop, reporting, or the `{ pass, notes }` verdict shape.**
- **WordPress/browser specifics in core** — they remain in `testing-project`.
- **Full-suite / CI-green as the acceptance bar** — full behavioral testing stays manual.

## Acceptance Criteria

1. **`JUDGE.md` is opaque — no rubric section required**
   Given a scenario whose `JUDGE.md` contains only prose (no `# Rubrics` section),
   When Skillsmith enumerates and runs the scenario,
   Then the scenario is discovered and runnable, and Skillsmith reports no error about a missing or malformed rubric section.

2. **A prose rubric reference is graded against**
   Given a `JUDGE.md` that names a rubric in natural language and a project that configures a rubrics path containing that rubric,
   When the judge runs,
   Then the judge grades the produced code against that rubric's criteria and reflects them in its `{ pass, notes }` verdict.

3. **Rubrics are optional**
   Given a project that configures no rubrics path (or an empty one),
   When a scenario runs,
   Then the judge runs with no rubric context, the run completes without error, and no rubric-related validation failure is raised.

4. **No id-validation of rubric references**
   Given a `JUDGE.md` that refers in prose to a rubric name with no matching file,
   When Skillsmith enumerates the scenario,
   Then enumeration does not fail or mark the scenario errored on account of the rubric reference (the reference is simply prose).

5. **The judge receives the task automatically**
   Given any scenario,
   When the judge runs,
   Then the judge's context includes the testing agent's task, without the scenario's `JUDGE.md` restating it.

6. **The judge is skill-agnostic**
   Given a `TESTING-AGENT.md` with a `# Skills` section,
   When the task is supplied to the judge,
   Then the `# Skills` section is not included in what the judge receives, and nothing else discloses which skill(s) were used.

7. **Verdict and downstream wiring unchanged**
   Given a completed judge run,
   When its result is recorded,
   Then the verdict is `{ pass, notes }`, stored and surfaced exactly as before, and the self-improvement context still receives the verbatim notes and failing scenarios' skill files.

8. **`testing-project` fully converted**
   Given the finished work,
   When any `testing-project` `JUDGE.md` is inspected,
   Then it contains no `## Scenario requirements` block and no `# Rubrics` id-list, refers to its rubric in prose, and retains its environment/live-check instructions; and no Skillsmith or `testing-project` code parses a `# Rubrics` section.

9. **Deterministic gates green**
   Given the change,
   When the project's guardrails run (typecheck, lint, tests, config smoke, changeset format/status),
   Then all pass, with unit/integration coverage for the removed parser, the optional rubrics path, the judge-prompt assembly, and the auto-supplied skill-agnostic task.
