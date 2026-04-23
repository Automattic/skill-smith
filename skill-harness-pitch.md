# Skill Tester & Self-Improvement Harness

## TL;DR

Skills are how we teach LLMs our domains — and today we ship them based on subjective review. This project is a harness with two parts: it **tests** a skill by sending prompts to an LLM and checking whether the resulting answer actually works, end-to-end in a real runtime, across models. When a test fails, a **self-improvement loop** kicks in: an agent edits the skill, re-runs the tests, and iterates until it passes — then opens a PR for human review. For anyone who builds, improves, or maintains a skill.

---

## The problem

Skills are now how we teach LLMs our domains. Every skill we ship determines the quality of the code and answers our teammates and users get. As skills proliferate, their defects compound.

Today, skills are written as prose and reviewed subjectively. We cannot systematically answer the questions that actually matter:

- Does this skill produce working output, end-to-end, when a real LLM consumes it?
- Did my latest edit to a reference file break anything?
- Does the skill hold up across models and across vendors?

A skill should work by default — produce correct output the first time. When it doesn't, users have to iterate, and iteration is a skill of its own. An experienced developer spots a flawed response, corrects the prompt, and moves on. Users who lean more heavily on the model can't: they can't tell confident-wrong from confident-right. And when the caller is an autonomous agent rather than a person, nobody iterates at all — the flawed output just becomes the next step's input.

Prose review cannot catch this. We need a test loop.

---

## The proposal

One system with two tightly coupled parts:

**Skill Tester.** Each test case is a **prompt** — the kind of request a user or agent would send. The pipeline sends the prompt to an LLM loaded with the skill, captures the answer, and validates it by executing it in a **real runtime**. The output is a pass/fail matrix per **(skill × model × test case)**.

**Self-Improvement Harness.** When tests fail, an agent reads the failure trace, proposes edits to the skill files, re-runs the tests, and iterates (capped) until the suite passes or it gives up. It produces a branch + PR with the diff and the full evidence trail.

---

## What this unlocks

- **One loop for the full skill lifecycle.** Write a new skill test-first — define the behavior you want, then iterate until the skill delivers it. Improve existing skills against real evidence instead of intuition. Keep them from silently regressing as models, dependencies, and requirements change.
- **Skills become infrastructure we can trust.** Feature work, bug fixes, refactors — the daily work of shipping — gets faster and more reliable because teammates and agents don't have to second-guess what the model produces.
- **Failures escape less over time.** When a bug slips past the tests in the wild, the fix is a pattern: capture the failing case as a new test, let the harness propose a skill improvement, review, merge. Every escape strengthens the skill rather than just patching a single bug report.

---

## Why now

- **Skills are proliferating.** Without evals we are building on sand — every new skill increases the surface area of silent failure.
- **LLM-assisted workflows are becoming how teammates ship.** Skill defects compound as adoption grows.
- **Autonomous AI raises the stakes.** As we lean more on agents and loops that run without a human reviewing every step, a flawed skill no longer just slows down a developer — it compounds silently across every step the agent takes. The more autonomy we grant, the bigger the blast radius.
- **Cheap in CI, expensive in the wild.** Catching a skill regression in a scheduled run costs pennies; catching it in a user report costs credibility.

---

## Success metrics

- **The pilot skill (iAPI) works.** iAPI passes 100% of the test cases we define. Think of it as TDD for skills — write the tests first, then iterate on the skill until it passes them.
- **The suite catches regressions.** A deliberately introduced bad change to the skill is caught by the harness. Proves the tests do real work, not just describe what's already there.
- **Adoption.** Number of skills using this workflow. A leading indicator that the harness is becoming useful beyond the pilot, not stuck on a single skill.

---

## Rollout milestones

1. **M1 — iAPI skill tester (pilot).** One skill, a library of test cases, one model — the full tester pipeline works end-to-end, with stable verdicts (repeated runs of the same test produce the same result). iAPI is deliberately the pilot: we have the expertise and a clearly testable runtime. M5 is where we prove the contract holds on a skill we don't own.
2. **M2 — Multi-model testing.** Run the same cases across multiple LLMs, producing a per-model pass/fail matrix.
3. **M3 — Self-Improvement Harness (manual).** A teammate can ask the harness to iterate on a failing skill until the tests pass, and get back a PR with the diff and trace.
4. **M4 — Self-Improvement Harness (autonomous loop).** The harness runs the improvement loop on its own and opens PRs for human review.
5. **M5 — Reusable for other skills.** A second skill plugs in via the harness's contract, with documentation that explains how to onboard a new skill.
