# Spec: Restore full trunk judging coverage in the JUDGE.md briefs, without task repetition

## Overview

Skillsmith evaluates coding agents by running each scenario's testing agent against a task and then having a judge agent grade the produced work. On this pipeline's branch (issue #55 / PR #56), scenarios use the two-file model: `TESTING-AGENT.md` (the testing agent's brief; its only parsed structure is a `# Skills` section) and `JUDGE.md` (the judge's brief). At judge time, Skillsmith automatically injects into the judge's system prompt the testing task (the `TESTING-AGENT.md` body with `# Skills` removed) and the content of every rubric in the project's rubrics directory.

On `origin/trunk`, each of the bundled `testing-project`'s 11 scenarios still defines its judging coverage in the pre-conversion model: a `scenario.yaml` with `acceptance:` bullets (source-level requirements) and a `rubrics:` reference to `wp-interactivity-api-best-practices`, plus an `e2e.spec.mjs` with live behavioral tests. A prior conversion pass rewrote the briefs and dropped real coverage — for example, `counter/JUDGE.md` lost all four of its trunk acceptance checks — and left each brief opening with a narrative that restates the task the judge already receives automatically.

This revision redoes the 11 `JUDGE.md` briefs so each carries **exactly the judging coverage its trunk scenario defined** — nothing dropped, nothing added — in the two-file format, with no task repetition. It also has the design phase evaluate (and, if judged correct, this revision implement) a shared **workspace** for the judge and testing agent to hold repeated information such as rubrics or environment specifics.

## Requirements

### R1 — Trunk acceptance criteria as code checks

Every `acceptance:` bullet in a scenario's `origin/trunk` `testing-project/eval/scenarios/<id>/scenario.yaml` appears in that scenario's `JUDGE.md` as an explicit check the judge performs **against the generated code** (the produced source files). No bullet may be omitted on the grounds that it duplicates the task, the rubric, or a live check. This applies to all 11 scenarios: `async-fetch`, `config-fetch`, `counter`, `derived-double`, `focus-trap-menu`, `fruit-list-each`, `independent-counters`, `minimal-scaffold`, `paginated-list`, `shared-state`, `toggle-visibility`.

### R2 — Rubric check instruction

Each `JUDGE.md` instructs the judge to check the produced code against the `wp-interactivity-api-best-practices` rubric. The rubric's content is not copied into the brief; Skillsmith supplies it to the judge automatically.

### R3 — Trunk e2e coverage as behavior checks

Each `JUDGE.md` has a section covering what that scenario's `origin/trunk` `e2e.spec.mjs` verified, expressed as **behavior tests** the judge performs against the live, running site. The coverage is the spec's observable assertions (what it proved about the block's behavior), not its harness mechanics (fixture setup/teardown boilerplate).

### R4 — Overlaps appear in both modes

A behavior that trunk covered both as an `acceptance:` bullet and in `e2e.spec.mjs` appears in both sections of the new brief, each in that section's mode. Example (`counter`): the initial value appears as a code check (the server-rendered output includes the initial value 5) and as a behavior check (the live page displays 5).

### R5 — No task repetition

No `JUDGE.md` restates the testing task: no "You are grading a … that …" opening, and no task-narrative lead-in naming what the testing agent was asked to build. The judge already receives the task automatically; the brief holds only judging material (checks, environment notes, rubric instruction).

### R6 — Auto-supplied judge inputs

At judge time, Skillsmith automatically supplies: the testing-agent prompt **without** its `# Skills` section, and the rubric content (plus workspace content, if R7 adopts workspaces). The mechanism on the branch (`src/pipeline/judge-agent.ts`) already injects the skill-stripped task and the loaded rubrics; it is verified against this requirement end-to-end and changed only where it falls short.

### R7 — Workspace direction, decided in design

The design phase evaluates giving the judge and the testing agent a **workspace**: a shared home for information repeated across scenarios (rubrics, environment specifics, other scenario-common material) that the harness hands each role automatically instead of duplicating it per brief. If the design phase concludes a workspace is the correct path, this revision implements it; if not, the design doc records the rationale and the briefs stay on the existing rubric-supply mechanism.

### R8 — Coverage parity is reviewer-verified, not code-encoded

"Exact same coverage as trunk" is verified by the pipeline's reviewers, comparing the redone briefs against the trunk sources. No coverage-mapping artifact and no coverage-assertion test is added to the codebase.

### R9 — Conformance test follows the new contract

The existing scenario conformance test (`src/__tests__/testing-project-scenarios.test.ts`), which currently asserts the rejected contract (briefs dropping their requirement checks), is updated so the suite passes with the new briefs. Per R8 it must not become a coverage checker.

### R10 — Verify against trunk, not prior artifacts

Prior review artifacts of this pipeline contain some incorrect directions alongside correct ones. Work in later phases may consult them but must not assume they are correct: any load-bearing claim is verified against current `origin/trunk` and the current branch code. Coverage in particular is always derived from trunk.

## Out of Scope

- **`TESTING-AGENT.md` files** — all 11 match their trunk `scenario.yaml` prompts verbatim today and are not modified.
- **Coverage-verification artifacts in the repo** — no mapping tables, no coverage-assertion tests (R8).
- **Unconditional core changes** — Skillsmith core changes only as required by R6 (mechanism falls short) or R7 (workspaces adopted in design).
- **The self-improvement loop and the improver prompt.**
- **Reducing or increasing judging coverage** relative to trunk.
- **The judge/testing-agent role prompts and `testing-project/skillsmith.config.ts`** — unchanged except as a consequence of the R7 workspace decision.

## Acceptance Criteria

1. **Given** any of the 11 scenarios, **when** its `JUDGE.md` on this branch is compared with its `origin/trunk` `scenario.yaml`, **then** every `acceptance:` bullet is present as an explicit check against the generated code.
2. **Given** any of the 11 scenarios, **when** its `JUDGE.md` is compared with its `origin/trunk` `e2e.spec.mjs`, **then** every behavior that spec asserted is present as a live behavior check, and no live check asserts a behavior trunk did not cover.
3. **Given** any of the 11 `JUDGE.md` briefs, **when** it is read, **then** it instructs the judge to check the produced code against the `wp-interactivity-api-best-practices` rubric and does not inline the rubric's content.
4. **Given** any of the 11 `JUDGE.md` briefs, **when** it is read, **then** it contains no restatement of the testing task and no task-narrative opening.
5. **Given** a judge invocation for any scenario, **when** its system prompt is assembled, **then** it contains the scenario's testing-agent prompt with the `# Skills` section removed and the rubric content, both supplied automatically without the brief restating them.
6. **Given** the design phase's workspace decision, **when** the design doc is approved, **then** it records either an implemented workspace design for judge and testing agent (adopted) or the rationale for staying on the current mechanism (not adopted) — and the code shipped by this revision matches that decision.
7. **Given** the repository after the revision, **when** it is searched, **then** no coverage-mapping artifact and no test asserting per-scenario coverage parity exists.
8. **Given** the project guardrails (`npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, changeset validation), **when** they run after the changes, **then** all pass — including the updated conformance test running against the new briefs.
