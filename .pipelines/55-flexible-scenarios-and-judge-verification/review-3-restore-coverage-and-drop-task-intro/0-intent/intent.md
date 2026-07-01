# Restore full acceptance-criteria coverage and drop the task-restating intro from JUDGE.md

## Origin

This revision follows `review-2-natural-language-rubrics-and-judge-task` (of the #55 pipeline / PR #56), which converted the `testing-project` `JUDGE.md` files to the opaque, natural-language-rubric model. On review, the owner found the conversion **dropped real judging coverage** and **left task-repetition** in the briefs.

Owner's request, verbatim:

> I want to do a new version of this revision. So do a v2 or a new revision from the previous one. I don't like what was produced. Now, in some scenarios like the counter, I don't see the original acceptance criteria in the judge.md files. I want the exact same coverage as before, but just in a new format.
>
> Apart from that, I still see that at the begininng of each JUDGE.md, we are repeating what was already passed to the testing agent.

Convenience links: issue https://github.com/Automattic/skillsmith/issues/55, PR https://github.com/Automattic/skillsmith/pull/56.

Concretely (from inspecting the review-2 output): `counter/JUDGE.md` lost all four original acceptance checks (named increment/decrement store actions; buttons wired with `data-wp-on--click`; reactive `data-wp-text`; server-rendered initial value 5) — it has no `## What to check` at all — because review-2's rule discarded bullets it judged "task-duplication" or "rubric-covered." And every `JUDGE.md` still opens with a line restating the task (e.g. "You are grading a WordPress interactive counter block … decide whether it satisfies the task it was given").

## Goal

Redo the `testing-project` `JUDGE.md` conversion so each brief keeps the **exact same judging coverage as before review-2**, in the new opaque/natural-language format, and no longer repeats the task:

1. **Preserve every original acceptance criterion.** Every check present in the pre-review-2 briefs (the `## Scenario requirements` bullets) is retained as an explicit check in the new format (e.g. under `## What to check`), for **all** scenarios — including `counter`. Nothing is dropped as "task-duplication" or "covered by the rubric." Same coverage, new format.
2. **Stop repeating the task.** Remove the task-restating opening of each `JUDGE.md` (the "You are grading a … block that …" narrative, and any task-narrative lead-in). The judge is auto-supplied the task, so the brief must not restate it.
3. Keep everything review-2 got right: the prose rubric reference, `## Environment` and `## Live checks`, and the Skillsmith **core** mechanism (opaque `JUDGE.md`, load-all rubrics, auto-supplied skill-agnostic task, `{ pass, notes }`).

## Constraints

- **Core is correct and off-limits.** This revision is scoped to the `testing-project` `JUDGE.md` briefs (plus their conformance test and any doc wording). Enumeration, judge-prompt assembly, rubric loading, and task injection do **not** change.
- **"Exact same coverage" is literal and recoverable.** The pre-review-2 briefs, with their full `## Scenario requirements`, are in git history at the review-2 base ref **`3b7b872`** (the review-1 tip). Agents must diff each current (review-2) brief against its original there and restore every dropped acceptance criterion — re-derive all 11, not just `counter`. (`trunk` predates the two-file model, so review-1's `JUDGE.md` is the faithful "before" source; the standing "consult trunk too" directive still applies generally.)

## Assumptions / directions to explore

*(Owner leanings, open for spec/design.)*

- Conversion rule to encode: the **task** (what to build) is auto-supplied and must not appear in `JUDGE.md`; the **acceptance criteria** (how to judge) are all preserved as explicit checks.
- `## What to check` becomes present for every scenario (no "clean floor" exception).
- The intro reduces to a generic, task-agnostic framing (or just the prose rubric reference); it must name no scenario-specific task detail.
