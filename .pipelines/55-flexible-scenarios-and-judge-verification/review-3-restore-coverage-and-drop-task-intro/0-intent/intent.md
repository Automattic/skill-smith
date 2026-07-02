# Restore full acceptance-criteria coverage and drop the task-restating intro from JUDGE.md

## Origin

This revision follows `review-2-natural-language-rubrics-and-judge-task` (of the #55 pipeline / PR #56), which converted the `testing-project` `JUDGE.md` files to the opaque, natural-language-rubric model. On review, the owner found the conversion **dropped real judging coverage** and **left task-repetition** in the briefs. A first intent was drafted from that feedback; the owner then clarified the goals, and this intent supersedes the earlier draft.

Owner's initial request, verbatim:

> I want to do a new version of this revision. So do a v2 or a new revision from the previous one. I don't like what was produced. Now, in some scenarios like the counter, I don't see the original acceptance criteria in the judge.md files. I want the exact same coverage as before, but just in a new format.
>
> Apart from that, I still see that at the begininng of each JUDGE.md, we are repeating what was already passed to the testing agent.

Owner's clarification, verbatim:

> * I want the JUDGE.md files to cover all the acceptance criteria from the scenarios in trunk, say to it to check the iapi-best-practices agaisnt the generated code, and they will have a new section to cover what is currently covered in the e2e tests. I don't want to reduce or increase coverage. Just the same but in a different format.
> * I want to add as a direction to explore having workspaces for the judge and testing agent for repeated information like rubrics or specific information.
> * The JUDGE should receive the testing-agent assigned prompt, without the skill, and the rubrics/workspace needed. Right now, we are repeating the prompt in the JUDGE as well. It should receive it automatically.
> * Do the review taking into account the current `trunk` because there are some incorrect directions in the current reviews.

Owner's follow-up clarification, verbatim:

> There are some things in the pipeline that are correct and I like some things. Just don't assume everything is correct there and take a look at trunk to ensure we have the same coverage.

Convenience links: issue https://github.com/Automattic/skillsmith/issues/55, PR https://github.com/Automattic/skillsmith/pull/56.

## Verify against current `trunk`

The prior review artifacts of this pipeline (the review-1 and review-2 specs, designs, and plans) are **partly right**: the owner likes parts of what they produced, and they may inform this revision — but they also contain some incorrect directions, so no claim inherited from them is assumed correct. Anything load-bearing is verified against the current `origin/trunk` and the current code on the pipeline branch; **coverage in particular is checked against trunk** to ensure the new briefs carry the same coverage.

On `origin/trunk`, each of the 11 scenarios still has the original model: a `scenario.yaml` carrying the testing prompt, the `acceptance:` bullets, and a `rubrics:` reference to `wp-interactivity-api-best-practices`, plus an `e2e.spec.mjs` with the live behavioral checks. **That is the coverage of record** this revision must preserve. (The superseded draft claimed review-1's briefs at `3b7b872` were the faithful "before" source and that trunk was unusable for this — the owner overrode that direction.)

## Goal

Redo the `testing-project` `JUDGE.md` briefs so each of the 11 scenarios carries **exactly the judging coverage its trunk scenario defined — nothing dropped, nothing added — in the new two-file format**, and stops repeating what the testing agent was already given:

1. **All trunk acceptance criteria.** Every `acceptance:` bullet in the scenario's trunk `scenario.yaml` appears as an explicit check in its `JUDGE.md` (e.g. counter: named increment/decrement actions; `data-wp-on--click` on both buttons; reactive `data-wp-text`; server-rendered initial value 5). Nothing is dropped as "task-duplication" or "covered by the rubric".
2. **Rubric check.** Each brief tells the judge to check the produced code against the `iapi-best-practices` rubric (`wp-interactivity-api-best-practices`), whose content Skillsmith supplies automatically.
3. **E2E-equivalent section.** Each brief gains a section covering what that scenario's trunk `e2e.spec.mjs` verified, expressed as live checks against the running site.
4. **No task repetition.** The judge already receives the testing-agent prompt automatically — with the `# Skills` section stripped — under `# Testing task` (see `src/pipeline/judge-agent.ts`). The briefs must not restate the task: no "You are grading a … block that …" opening or any task-narrative lead-in.

## Auto-supplied judge inputs

The judge must receive automatically: the testing-agent assigned prompt **without the skill**, plus the rubrics/workspace it needs. The current core mechanism already injects the skill-stripped task and the loaded rubrics into the judge's system prompt; the spec phase verifies this end-to-end against the owner's expectation and this revision adjusts it only where it falls short. Core changes are otherwise out of scope.

## Directions to explore

*(Owner leanings, open for spec/design.)*

- **Workspaces for the judge and the testing agent** — a shared place for repeated information (rubrics, environment specifics, other scenario-common material) that the harness hands each role, instead of duplicating that information across per-scenario briefs. How a workspace relates to the existing `paths.rubrics` directory and the role prompts is for the spec/design phases to work out.
- The conversion rule to encode: the **task** (what to build) is auto-supplied and must not appear in `JUDGE.md`; the **acceptance criteria, rubric check, and e2e-equivalent live checks** (how to judge) are all explicit in the brief.

## Constraints

- **Same coverage, new format — literal.** The mapping is per-scenario and complete: trunk `acceptance:` bullets + trunk `e2e.spec.mjs` behaviors + the trunk-referenced rubric check, and nothing else. Coverage is neither reduced nor increased.
- **Keep what review-2 got right where it aligns with the above**: the two-file model, opaque `JUDGE.md`, `{ pass, notes }` verdict, load-all rubrics, and the auto-supplied skill-stripped task.
