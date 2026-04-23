# Skill Smith

Skills are how we teach LLMs our domains — and today we ship them based on subjective review. Skill Smith is a harness with two parts: it **tests** a skill by sending prompts to an LLM and checking whether the resulting answer actually works, end-to-end in a real runtime, across models. When a test fails, a **self-improvement loop** kicks in: an agent edits the skill, re-runs the tests, and iterates until it passes — then opens a PR for human review. For anyone who builds, improves, or maintains a skill.

## The problem

Skills are now how we teach LLMs our domains. Every skill we ship determines the quality of the code and answers our teammates and users get. As skills proliferate, their defects compound.

Today, skills are written as prose and reviewed subjectively. We cannot systematically answer the questions that actually matter:

- Does this skill produce working output, end-to-end, when a real LLM consumes it?
- Did my latest edit to a reference file break anything?
- Does the skill hold up across models and across vendors?

Prose review cannot catch this. We need a test loop.

## Two parts

**Skill Tester.** Each test case is a **prompt** — the kind of request a user or agent would send. The pipeline sends the prompt to an LLM loaded with the skill, captures the answer, and validates it by executing it in a **real runtime**. The output is a pass/fail matrix per **(skill × model × test case)**.

**Self-Improvement Harness.** When tests fail, an agent reads the failure trace, proposes edits to the skill files, re-runs the tests, and iterates (capped) until the suite passes or it gives up. It produces a branch + PR with the diff and the full evidence trail.

## How the Skill Tester works

The harness runs every scenario against every configured model and reports pass/fail. A **scenario** is a prompt plus the skill(s) the agent should use to fulfil it. A run has a one-time setup, a per-pair loop, and a one-time teardown. The setup, reset, verify, and teardown stages are **project-specific** — each fork implements them against the harness's runtime contract.

1. **Testing environment setup** (once). The project's `environment.setup` boots whatever the runtime needs — e.g. `npx wp-env start`.

2. **For each `(scenario, model)` pair:**
   1. **Environment reset.** The project's `environment.reset` restores the agent's write target to a clean state — e.g. wipe the generated plugin code.
   2. **Testing agent.** Receives the scenario prompt plus the skill files, receives the project's `instructions.md`, writes code into the target directory, and returns its output.
   3. **Judge agent.** Receives the testing agent's output plus the scenario prompt, receives the scenario's acceptance criteria and referenced rubrics, reviews the implementation, and returns a review.
   4. **E2E verification.** The project's `environment.verify` runs a project-defined spec against the live environment — e.g. `npx playwright test`.
   5. **Store verdict.** The judge review and e2e result are written to disk.

3. **Environment teardown** (once). The project's `environment.teardown` tears the runtime down — e.g. `npx wp-env stop`.

4. **Print results.** A scenario × model pass/fail matrix is printed to the console.

![Skill Tester workflow diagram](assets/skill-tester-workflow.png)

### Rubrics and the judge

A **rubric** is prose reference material the judge LLM consults — describing standards or best-practices — reusable across scenarios. Each scenario references one or more rubrics plus an inline `acceptance` list of per-scenario expectations.

**The judge does not read the skill.** The agent learns from the skill; the judge grades from the rubrics. Keeping them epistemically separate is what lets the harness catch a regression in the skill itself — if the judge consulted the same skill the agent did, a bad skill edit would simultaneously redefine "correct" and the regression would slip through.

## How the Self-Improvement works

TBD
