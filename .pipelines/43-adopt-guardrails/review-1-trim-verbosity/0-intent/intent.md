# Trim over-explanation from the guardrails adoption

## Origin

This review was requested by the owner after reviewing the base run's shipped changes for issue #43 ([Automattic/skillsmith#43](https://github.com/Automattic/skillsmith/issues/43)). The owner found the base run's output too verbose and slightly over-engineered and asked to slim it down. In the owner's words:

> I feel most of the changes are too verbose. For example, I believe guardrails should not need to be explained, just listed in the corresponding table. An agent should be able to infer the intent of each of these commands if necessary. Most of the cases, it just simply have to run these commands with no questions.
>
> Also, in the Worktree bootstrap section, it mentions to run a custom script, followed by a long explanation about what the script does. Why not simply tell to run `npm ci` and `npm ci --prefix testing-project`? [...] I would simply mention the script we want to run, and just that.
>
> The guardrails mention may not be necessary in the CONTRIBUTING.md file, right? The rest of the changes are fine for me.

In follow-up the owner confirmed: in `CONTRIBUTING.md`, keep the `check:config` check but tighten it to match the surrounding terse bullets, and drop the guardrails cross-reference paragraph entirely.

This file is self-contained; agents do not need to open the source issue.

## Goal

The guardrails-adoption changes from the base run convey the same information far more leanly: the guardrails are communicated by the table alone, the worktree-bootstrap step is stated directly instead of behind a wrapper script, and human-facing contributor docs carry no pipeline-internal guardrails detail.

## Constraints

- Behaviour-preserving for the gates: the set of guardrails, their commands, and their phase assignments do not change — this review is about how they are *presented*, not what they do.
- Leave the base run's other changes intact: the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, and the lockfile.
- No changes to the Radical Pipelines plugin itself.

## Assumptions / directions to explore

These reflect the owner's proposed approach; phase 1 may confirm or refine them.

- `.rp.md` "Guardrails" section: reduce to just the table, dropping the per-gate explanatory prose (the lead defining what a guardrail is, and the paragraphs on `changeset-format`, `changeset-status`, the "two properties", and `--since=origin/trunk`). The skill's own convention loader already defines what a guardrail is and that it is judged by exit code.
- `.rp.md` "Worktree bootstrap" section + `scripts/bootstrap-worktree.sh`: delete the wrapper script and replace the section with a one-line instruction that names the two commands directly — `npm ci` and `npm ci --prefix testing-project`.
- `CONTRIBUTING.md`: drop the paragraph cross-referencing the `.rp.md` Guardrails (pipeline-internal detail a contributor doesn't need), and keep the `check:config` bullet but tighten it to match the terse one-clause style of the surrounding bullets.
