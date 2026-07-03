# Spec Research: Restore full acceptance-criteria coverage and drop the task-restating intro from JUDGE.md

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

## Q&A

**Q1.** The intent lists "workspaces for the judge and the testing agent" as a direction to explore. What should this revision actually ship for it: should the pipeline design and implement a real workspace mechanism (likely touching Skillsmith core, since today only rubrics are auto-supplied via `paths.rubrics`), or should the spec/design phases only explore the idea and record a recommendation for a future issue, while the shipped change keeps the briefs on the existing rubric mechanism?

**A1.** Conditional implementation, decided in design: "If the direction to explore is considered the correct path, implement it. But I'd leave it as a decision for the design phase." The spec must frame workspaces as an option the design phase evaluates; if design concludes it is the correct path, this revision implements it.

**Q2.** How should "exact same coverage as trunk" be verified when the work is done — an automated conformance test asserting each `JUDGE.md` carries its trunk-derived checks, a reviewed per-scenario mapping artifact, or owner/reviewer eyeballing only?

**A2.** Reviewer responsibility, not code: "Just make sure it is reviewed by the reviewers. It shouldn't be reflected in the code itself." Coverage verification happens at review time (the pipeline's reviewers check the redone briefs against trunk); no mapping artifact and no coverage-assertion test is added to the codebase. Note: the existing `src/__tests__/testing-project-scenarios.test.ts` encodes the review-2 contract (including dropping `## Scenario requirements`) and will contradict the new briefs; how it changes is a later-phase decision, but per the owner it must not become a coverage checker.

**Q3.** Trunk acceptance bullets and trunk e2e tests sometimes verify the same behavior (counter: "Server-rendered HTML includes the initial counter value (5)" is an acceptance bullet, and the e2e spec has "renders the initial counter value of 5"). In the new briefs, should such a behavior appear in **both** sections (fully faithful per-source mapping: every acceptance bullet in the checks section, every e2e behavior in the live-checks section), or **once** in the most fitting section (deduplicated, with coverage still preserved overall)?

**A3.** The sections differ by nature, not by dedup rule: "The acceptance criteria should cover checks in the code. The other one should be more 'behavior' test." Trunk acceptance bullets map to a section of **code checks** (verified against the generated source), and the e2e-derived section holds **behavior tests** (verified against the live, running site). Where the same underlying behavior appears in both trunk sources, it appears in both sections, each in its section's mode (e.g. counter's initial value: code check that the server render includes 5; behavior check that the live page shows 5).

**Q4.** (Out-of-scope confirmation.) Proposed exclusions: (1) `TESTING-AGENT.md` files — untouched, all match trunk verbatim; (2) coverage-verification artifacts in the repo — none added, per A2; (3) unconditional core changes — core changes happen only if the design phase adopts workspaces or the auto-supply mechanism is found short of the owner's expectation; (4) the self-improvement loop and improver prompt; (5) reducing or increasing judging coverage relative to trunk; (6) the judge/testing-agent role prompts and project config — unchanged except as a consequence of the workspace decision. Anything missing or wrong?

**A4.** Confirmed as proposed ("Go ahead").

## Research

- **Core already auto-supplies the judge inputs.** `src/pipeline/judge-agent.ts` builds the judge system prompt as: verbatim `judgeBrief` + `# Testing task` (the scenario's `testingBrief` with its `# Skills` section stripped, injected on every run) + a `{ pass, notes }` output instruction + `# Grading rubrics` (all rubrics loaded from `paths.rubrics`, with a lead-in to apply only brief-named rubrics) + `# Role instructions` (`roles.judge.prompt`). The owner's "it should receive it automatically" is already the shipped mechanism; the defect is briefs restating the task on top of it.
- **Trunk coverage sources are intact.** On `origin/trunk`, each of the 11 scenarios has `scenario.yaml` (prompt, `acceptance:` bullets, `rubrics: [wp-interactivity-api-best-practices]`) and `e2e.spec.mjs`. Verified for `counter`: 4 acceptance bullets; e2e asserts initial value 5 and increment/decrement behavior.
- **Review-2's dropped coverage confirmed.** Current `counter/JUDGE.md` has no `## What to check` — none of the 4 trunk acceptance bullets appear; it opens with a task-restating narrative ("You are grading a WordPress interactive counter block…").
- **No TESTING-AGENT.md drift.** All 11 `TESTING-AGENT.md` bodies (minus `# Skills`) match their trunk `scenario.yaml` prompts verbatim (whitespace-normalized diff, checked per scenario).
- **The conformance test encodes the rejected contract.** `src/__tests__/testing-project-scenarios.test.ts` asserts the review-2 shape, including that briefs drop `## Scenario requirements`; it must change with the new briefs but must not become a coverage checker (A2).
- **Judge environment.** `testing-project/skillsmith.config.ts`: judge = opus with `tools: [Read, Bash]` + Playwright MCP server, `concurrency: 'serial'`, per-pair `wp-env` hooks (`installPluginForPair`/`cleanUpPair`) and a warm env booted once per sweep; `roles.judge.prompt` (`eval/prompts/judge.md`) is the reusable environment manual. Live behavior checks derived from trunk e2e are executable in this environment (Playwright MCP drives the browser, Bash drives `curl`/`wp-env run cli`).

## Out of Scope

## Consolidated Requirements

1. Each of the 11 `testing-project` scenarios' `JUDGE.md` briefs carries exactly the judging coverage its `origin/trunk` scenario defined — nothing dropped, nothing added — restructured into the two-file model's format.
2. Code checks: every `acceptance:` bullet from the scenario's trunk `scenario.yaml` appears in its `JUDGE.md` as an explicit check the judge verifies against the generated code.
3. Rubric check: each `JUDGE.md` instructs the judge to check the produced code against the `wp-interactivity-api-best-practices` rubric; the rubric content itself is supplied to the judge automatically by Skillsmith.
4. Behavior checks: each `JUDGE.md` has a section covering what the scenario's trunk `e2e.spec.mjs` verified, expressed as behavior tests against the live, running site.
5. A behavior covered by both trunk sources appears in both sections, each in its section's mode (code check vs live behavior).
6. No task repetition: no `JUDGE.md` restates the testing task or opens with a task narrative; the judge receives the task automatically.
7. The judge automatically receives the testing-agent prompt with the `# Skills` section removed, plus the rubrics (and workspace content, if workspaces are adopted). The existing core mechanism already does the task+rubrics part; it is verified against this expectation and adjusted only where it falls short.
8. Workspaces for the judge and testing agent (a shared home for repeated information such as rubrics or environment specifics) are evaluated in the design phase; if design concludes they are the correct path, this revision implements them.
9. Coverage parity with trunk is verified by the pipeline's reviewers at review time; it is not encoded in the codebase.
10. The existing conformance test (`src/__tests__/testing-project-scenarios.test.ts`) is updated so it does not contradict the new briefs, and it does not become a coverage checker.
11. Prior review artifacts (review-1/review-2 specs, designs, plans) may inform the work but are not assumed correct; load-bearing claims are verified against current `origin/trunk` and the current branch code.
