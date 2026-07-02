# Spec: Unified cleanup, judge workspace, and centralized decision rule

## Overview

Skillsmith (this repository, published as `@automattic/skillsmith`) evaluates coding agents: per scenario, a testing agent builds against a task brief (`TESTING-AGENT.md`) and a judge agent grades the result against a judge brief (`JUDGE.md`). On this branch (issue #55 / PR #56), the judge's system prompt is assembled from five sources: the verbatim brief, the auto-injected skill-stripped testing task, a `{ pass, notes }` output instruction, every rubric loaded from `paths.rubrics` (behind a selection lead-in telling the judge to apply only brief-named rubrics), and `roles.judge.prompt` (an environment manual). All 11 bundled briefs open with an identical all-must-pass decision-rule sentence, enforced per brief by a conformance test.

The branch reached this state through four pipeline runs that changed approach several times, and an owner-commissioned three-reviewer audit of the result (reports preserved beside this run's intent) found: (a) substantial churn residue — dead code and modules kept alive by tombstone tests that pin repository *history* rather than behavior, one of which will break CI on unrelated future work; (b) a config surface for judge material split across two awkward channels (`roles.judge.prompt` + `paths.rubrics`); (c) twelve ranked improvement proposals.

This revision does three mandated things — remove the residue, replace the two judge-material channels with a single judge-scoped workspace directory, and state the decision rule once instead of eleven times — and gives the design phase a free hand to evaluate the remaining proposals, shipping those it adopts and recording a disposition for the rest.

## Requirements

### R1 — Churn cleanup, verified and behavior-neutral

Every churn-pollution finding itemized in `../0-intent/reviewer-pollution.md` and every pure-deletion simplification in `../0-intent/reviewer-simplification.md` (its findings 1–5 and 8) is resolved. Headline items: the dead `setUpJudgeEnv`/`tearDownJudgeEnv` pair and dead `testing-project/eval/utils/wp-cli.mjs`; the tombstone tests that pin them (`testing-project-judge-config.test.ts` legacy-export block, `wp-env-judge-lifecycle.test.ts` sentinel and retired-symbol scans); `feature-changeset.test.ts` (pins changeset filenames/prose and will fail CI on the next release or next added changeset); `testing-project-e2e-removal.test.ts` (migration scan); `selection-duplicate-name-guard-removed.test.ts` (relocate its one live behavior test); the negative-assertion cohort and stale pivot-era wording; the orphaned `assets/skill-tester-workflow.png`. Each finding is re-verified against the code before acting (the reports are inventories, not gospel); a finding judged load-bearing after verification is kept, with the reason recorded. Cleanup changes no runtime behavior.

### R2 — Safe core simplifications

The core simplifications in `reviewer-simplification.md` findings 6, 7, 9, 10, and 13 are applied where verification confirms them safe: the duplicated skills-section scanner in `src/scenarios/enumerate.ts` unified; the `loadAllRubrics` self-reparse in `src/scenarios/rubric-loader.ts` fixed by returning the file set (the one permitted behavior change — a latent-bug fix — and moot if the workspace mechanism retires the loader); the dead `agentWorkspace` param and unused `buildUserMessage` param removed from the judge surface; overlapping enumeration tests merged with shared helpers; the small duplications (sort comparator, file-inlining helper) unified. Finding 12 (`dirName` removal, breaking) is dispositioned by the design phase like the improvement proposals (R5).

### R3 — The judge workspace

The judge is configured through a **single judge-scoped directory** that users can fill with anything — environment manual, rubrics, reference docs, helper scripts — whose contents Skillsmith supplies to every judge. It **replaces** `roles.judge.prompt` and `paths.rubrics`, which are removed from the config surface. Briefs opt into specific material by naming the exact rubric/file they want applied. Fixed by this spec:

- Grading material reaches **judges only**; the testing agent never receives any of it.
- A judge whose capabilities include no file-reading tool still receives the material (supply degrades to inlining).
- A brief's reference to a missing item must fail observably (in the verdict notes or earlier), never silently.
- The bundled testing-project is migrated: manual and rubric relocated into the workspace, config updated, and the 11 briefs' rubric references re-pointed — with the check set preserved verbatim (R6).

Open for the design phase: the config key's name (the owner's word is "workspace"; the reviewer flags a collision with the existing `judgeWorkspace` artifact copy — design decides), the directory's conventions (e.g. an always-read entry file), the supply mechanism (inline vs mount vs two-tier; the improvements reviewer's recommendation is on record), and the fate of the rubric selection lead-in.

### R4 — One decision rule, stated once

The all-must-pass verdict rule ("pass only if every check, including the rubric check, is satisfied") is stated once in a shared home the design phase chooses (e.g. the harness output instruction or the workspace's entry file) instead of being repeated at the top of all 11 briefs. A brief that states a different decision rule in its own prose wins over the default. The 11 briefs drop the repeated opener; their check content is otherwise untouched. The scenario conformance test follows the new contract (per-brief opener invariant removed or relocated) and remains a format contract — never a coverage checker.

### R5 — A disposition for every proposal

The design phase evaluates each of the twelve proposals in `../0-intent/reviewer-improvements.md`, plus `reviewer-simplification.md` finding 12, with a free hand (owner set no hard bounds), and the design doc records a disposition for every one: **ship now** (implemented in this revision), **future issue** (recorded in the artifacts list only — no tracker issues are created), or **rejected** (with reason). None is silently dropped. Prior art inside this repository is not a valid rejection reason for the workspace direction or its variants.

### R6 — Coverage parity is untouchable

The judging coverage restored by review-3 survives verbatim through every change this revision makes: each brief's code checks (all trunk `acceptance:` bullets), its behavior checks (all trunk e2e observables, including the two conditional-fallback bullets and three setup bullets), and the rubric check remain the same check set, verified by the pipeline's reviewers against `origin/trunk` — never encoded in tests or mapping artifacts.

### R7 — Changesets

Release-relevant changes carry changesets per `CONTRIBUTING.md`; breaking changes (removing `roles.judge.prompt`/`paths.rubrics`, and any adopted breaking proposals) are `minor` with a `BREAKING:` summary prefix, per the pre-1.0 policy. Unlike review-3, this revision's core-surface changes make at least one changeset mandatory.

### R8 — Documentation reflects the shipped state

Phase 5 realigns all consumer-facing docs to what actually ships: README (config reference, judge-material sections, example brief), `examples/skillsmith.config.ts`, and migration notes for the removed config keys.

## Out of Scope

- Creating GitHub/Linear issues for future-issue dispositions — the disposition list lives in the run's artifacts only.
- Any change to judging coverage; any coverage-encoding test or mapping artifact.
- Supplying grading material to the testing agent in any form.
- Changes to `TESTING-AGENT.md` briefs or the testing-agent prompt, except where a design-adopted proposal explicitly requires them.
- Re-litigating surfaces the pollution report verified clean, absent new evidence.
- Merging the PR.

## Acceptance Criteria

1. **Given** the two cleanup reports' itemized findings, **when** the branch is inspected after the revision, **then** each finding is resolved or carries a recorded keep-reason; in particular `setUpJudgeEnv`/`tearDownJudgeEnv`, `wp-cli.mjs`, `feature-changeset.test.ts`'s repo-state assertions, and `testing-project-e2e-removal.test.ts` no longer exist, and no test asserts that removed code stays removed or that legacy exports remain.
2. **Given** the cleanup commits alone, **when** behavior is compared before/after, **then** nothing observable changed except the `loadAllRubrics` self-reparse fix.
3. **Given** a consuming project's config, **when** a judge runs, **then** its manual/rubrics/reference material is supplied from the single judge-scoped directory; `roles.judge.prompt` and `paths.rubrics` no longer exist as config surface; and the testing agent receives none of that material.
4. **Given** a brief naming a specific rubric/file from the workspace, **when** the judge grades, **then** it applies exactly that item; **given** the named item is missing, **then** the failure is observable, not silent; **given** a judge with no file tools, **then** it still receives the material.
5. **Given** the 11 bundled briefs, **when** read after the revision, **then** none repeats the decision-rule opener, the rule is stated once in the design-chosen home, and a brief stating its own rule overrides the default.
6. **Given** the 11 bundled briefs, **when** their checks are compared against `origin/trunk` sources by the reviewers, **then** the check set is identical to review-3's (nothing dropped, nothing added).
7. **Given** the approved design doc, **when** read, **then** every proposal from `reviewer-improvements.md` plus the `dirName` question has exactly one disposition (ship now / future issue / rejected with reason), and every ship-now disposition is implemented in this revision.
8. **Given** the guardrails (`npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, changeset validation and status), **when** run after the changes, **then** all pass, with at least one changeset present and every breaking change recorded as `minor` + `BREAKING:`.
