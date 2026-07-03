# Leaner judge briefs: natural-language rubrics and an auto-supplied task

## Origin

This revision follows the `review-1-reusable-rubrics-and-simpler-judging` run of the #55 pipeline (PR #56). Review-1 introduced a **rubric-by-id** mechanism: each `JUDGE.md` carries a `# Rubrics` section whose ids must match files under `eval/rubrics/`, validated at enumeration and injected into the judge's prompt under `# Grading rubrics`. The owner wants to move away from that id-matching model toward a natural-language one, and to stop judge briefs repeating the task.

The owner's request, verbatim:

> I don't like making mandatory to have a rubrics section in the judge and having to match the id. I'd rather lean on natural language. Something like another check saying: Ensure the code produced follows the iAPI best practices from the X rubric. Maybe we can pass all eval/rubrics (or another path configured on the skillsmith config). Make sure the revisioners take a look at the current trunk and not only the current branch status.
>
> Additionally, instead of repeating the prompt in the Judge files, I would want to pass the task assigned to the TESTING-AGENT automatically to the judge to know what it is judging. And keep the judge file with just the things to check.

Convenience links: issue https://github.com/Automattic/skillsmith/issues/55, PR https://github.com/Automattic/skillsmith/pull/56.

## Goal

Building on the two-file scenario + live-judge model, make a scenario's `JUDGE.md` leaner to author and free of duplication:

1. **Rubrics referenced in natural language, not by matched id.** A judge brief can say, in prose, "check the code against the X best-practices rubric" and have the judge actually grade against that rubric — with no required, id-matched `# Rubrics` section. The rubric content reaches the judge automatically.
2. **The judge knows the task without the brief repeating it.** The judge is told what the testing agent was asked to build, so `JUDGE.md` no longer restates the scenario requirements.
3. **`JUDGE.md` holds only the things to check.** With the task supplied automatically and rubrics referenced in prose, each judge brief reduces to the specific checks/behaviors that scenario cares about.

## Constraints

- Every phase of this revision must assess the current `trunk` state, not only this branch's current state. The branch has diverged substantially from `trunk`: the base run removed the original rubric machinery and review-1 reworked it into rubric-by-id, whereas `trunk` still carries the original `eval/rubrics/` content and rubric-loading code. Getting the full picture (and recovering rubric content/behavior) requires looking at both.

## Assumptions / directions to explore

*(The owner's leanings — recorded open for the design phase to confirm, refine, or overturn.)*

- Skillsmith could pass **all** rubrics from `eval/rubrics/` — or a path configured in the skillsmith config — to the judge, so the judge always has them and `JUDGE.md` only names the relevant one(s) in prose.
- The mandatory-when-used, id-matched `# Rubrics` section (from review-1) would be dropped in favor of that natural-language reference.
- The testing agent's task (the `TESTING-AGENT.md` brief) would be passed into the judge's context automatically by Skillsmith.
- With those two changes, each `testing-project` `JUDGE.md` drops its repeated "scenario requirements" and its id-list, keeping only the checks.
