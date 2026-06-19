# Stop the self-improvement loop from overfitting skills to eval scenarios

> Source: GitHub issue [#48](https://github.com/Automattic/skillsmith/issues/48).
> This file is self-contained; agents do not need to open the source issue.

## Goal

When the self-improvement loop edits a skill to fix failing scenarios, the resulting edit should encode *general* guidance, not memorized answers to the specific evaluation scenarios. Blatant train/test leakage — naming a scenario, copying acceptance/rubric wording, hard-coding an expected value, or writing a single-case answer — is detected and kept out of the skill before the edit is accepted.

## Constraints

- The scenario judge must remain skill-blind; the fix must not live in the judge.
- The approach must not depend on a held-out-scenario gate. Scenarios are supplied by the consuming project, not the tool, and that set can be small — so the mechanism has to work for small corpora rather than assuming enough scenarios to split into train/holdout. (This repo's `testing-project` currently has 11 scenarios; another project using Skillsmith would have a different count.)

## Context

- Observed failure mode: the improver incorporated parts of the evaluation scenarios into the skill — memorizing the checked answers instead of writing general guidance. It's the expected outcome of the current loop: the improver is handed the answer key (verbatim judge reviews + full skill text), nothing scores or gates the edit, and the judge is deliberately skill-blind.
- The repo already uses a reviewer/writer loop pattern elsewhere (radical-pipelines: spec-reviewer/spec-writer, code-reviewer/code-writer).

## Assumptions / directions to explore

*(open — later phases may confirm or overturn these)*

- Proposed direction: add a read-only "validator" agent that reviews the improver's edit for generality / anti-leakage and returns `approve` or `revise`-with-changes, looping until approval or a small round cap; the improver stays the only writer.
- The validator judges *edit quality* (is it general? did it leak?), not *correctness* (does the scenario pass?) — correctness stays with the scenario judge on the next sweep.
- Honest scope: such a critic catches only legible/blatant overfitting, not subtle overfitting; treat it as a cheap floor-raiser, not a guarantee of generalization.
