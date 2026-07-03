# Spec Research: Leaner judge briefs — natural-language rubrics and an auto-supplied task

> Verbatim copy of `review-2-natural-language-rubrics-and-judge-task/0-intent/intent.md`:

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

## Constraints (from intent)

- Every phase of this revision must assess the current `trunk` state, not only this branch's current state. The branch has diverged substantially from `trunk`: the base run removed the original rubric machinery and review-1 reworked it into rubric-by-id, whereas `trunk` still carries the original `eval/rubrics/` content and rubric-loading code.

## Assumptions / directions to explore (from intent)

- Skillsmith could pass **all** rubrics from `eval/rubrics/` — or a path configured in the skillsmith config — to the judge, so the judge always has them and `JUDGE.md` only names the relevant one(s) in prose.
- The mandatory-when-used, id-matched `# Rubrics` section (from review-1) would be dropped in favor of that natural-language reference.
- The testing agent's task (the `TESTING-AGENT.md` brief) would be passed into the judge's context automatically by Skillsmith.
- With those two changes, each `testing-project` `JUDGE.md` drops its repeated "scenario requirements" and its id-list, keeping only the checks.

## Q&A

### Q1 — Rubric-passing model: all-to-every-judge vs. scenario-selected

When a scenario's `JUDGE.md` refers to a rubric in prose, what should Skillsmith actually hand the judge: **every** rubric found in the configured rubrics path (leaving the prose to say which apply), or **only** the specific rubric(s) that scenario is meant to check? You lean toward "pass all `eval/rubrics`," and in review-1 you noted there will eventually be multiple rubrics with each scenario checking one or another — so I want to pin down whether "all rubrics to every judge" stays the intended model as the rubric set grows.

**Answer:** Model (A). The judge should have **access to all rubrics** (from the configured path), but only actually apply the one(s) **referenced in natural language** in that scenario's `JUDGE.md`. The owner explicitly leaves the *mechanism* to the design phase ("I would let the pipeline decide"). The load-bearing requirement is: an author can refer to a rubric in plain prose in `JUDGE.md` and have the judge **reliably** grade against exactly that rubric. "Reliably" is a first-class quality bar, but how it's achieved is deferred to design.

**Clarification (owner, follow-up):** "Handing **all** rubrics to the judge" is a **direction to explore, not a requirement.** The firm requirements are: (1) drop the mandatory id-matched section, (2) reference rubric(s) in natural language in `JUDGE.md`, (3) the judge reliably grades against the referenced rubric. *How* the rubric content reaches the judge (pass-all-from-path, or another mechanism) is for the design phase to decide. So the spec must not lock in "all rubrics are passed"; it records that as an explored direction.

### Q2 — What the judge receives as "the task"

When Skillsmith passes the testing-agent's task to the judge automatically, should it pass the **entire `TESTING-AGENT.md` brief verbatim** (which today also contains the `# Skills` list), or **only the task/prompt portion** (excluding `# Skills`)?

**Answer:** (B) — **only the task portion; the judge must stay skill-agnostic.** The judge should not know which skill(s) the testing agent was told to use. Rationale (owner): if the skill under test contains an error, a judge that knows the skill might treat that erroneous convention as correct and fail to flag it. The judge's independence — grading the produced code against the task and the (independent) rubric, not against the skill being tested/improved — is the point. So the auto-supplied task is the `TESTING-AGENT.md` content **excluding** the `# Skills` section.

### Q3 — Does `JUDGE.md` go back to fully opaque?

With the `# Rubrics` id-parsing removed, should Skillsmith parse **nothing** structured out of `JUDGE.md` — treating the whole file as opaque prose handed to the judge (as the base run did), with no required or reserved sections at all? (A rubric reference would then be ordinary prose the judge acts on, not a section Skillsmith reads.)

**Answer:** Yes — `JUDGE.md` is **fully opaque again, zero parsed/required sections**. The owner wants "as few restrictions as possible"; a required section runs against that. Skillsmith reads nothing structured from `JUDGE.md`; the rubric reference is ordinary prose. (This removes the review-1 `# Rubrics` parser and its enumeration-time id validation.)

### Q4 — Is configuring rubrics optional?

Since the judge is handed all rubrics from a configured path, what happens when a project configures **no** rubrics path (or points at an empty folder)? Should that be perfectly fine — the judge simply runs with no rubric context, no error — making rubrics an **optional** feature? Or should Skillsmith require a rubrics path / at least one rubric?

**Answer (revised by owner):** **Optional.** A project may configure no rubrics path (or point at an empty folder), and that is perfectly fine — the judge simply runs with **no rubric context, no error**. Rubrics are an opt-in feature. (The owner first said "whatever trunk does," then reconsidered — so we do **not** adopt trunk's *required* `paths.rubrics` + `checkPaths` existence gate. This matches the branch's current shape: `paths.rubrics?` optional, no `DEFAULT_PATHS` entry, no existence gate. `testing-project` opts in by setting `paths.rubrics: './eval/rubrics'`.) This settles the *path/config* handling only; how the judge is given/uses rubric content when a path **is** configured remains the design exploration from Q1.

**Consequence to confirm at out-of-scope:** with the `# Rubrics` parser gone and rubrics referenced only in prose, there is **no enumeration-time validation** that a rubric named in `JUDGE.md` actually exists — a mistyped reference is not caught by Skillsmith (it just isn't available to the judge). This is an accepted trade of the "fewer restrictions" direction.

### Q5 — Confirm we keep the current live judge + `{ pass, notes }` (not trunk's older grader)

The "look at trunk" guidance is about recovering trunk's rubric machinery/config, not reverting the judge. To be unambiguous: the judge stays the **current live behavioral judge** returning **`{ pass, notes }`**; we are **not** reverting to trunk's older read-only grader with its structured `{ rubrics: { <id>: {pass,notes} }, acceptance }` verdict. Correct?

**Answer:** Confirmed. Keep the current live behavioral judge and the `{ pass, notes }` verdict; only change how the judge is fed rubrics (natural-language reference) and add the auto-supplied task. No revert to trunk's grader/verdict.

### Q6 — Scope boundary confirmation

Confirming the edges of this revision (one check):

- **Core (Skillsmith):** remove the `# Rubrics` parser/validation and the id-matched selection; make `JUDGE.md` fully opaque; keep `paths.rubrics?` optional; auto-supply the testing task (minus `# Skills`) to the judge on **every** judge run (unconditional core behavior, since the judge should always know what it's judging); design decides how rubric content reaches the judge.
- **testing-project:** convert **all 11** scenario `JUDGE.md` files to the new shape (drop `## Scenario requirements` and the `# Rubrics` id-list; reference the rubric in prose; keep the plain-language environment/live-checks). The rubric **file content** (`eval/rubrics/wp-interactivity-api-best-practices.md`) is unchanged.
- **Testing posture (unchanged from #55 spec req. 16):** full behavioral verification remains **manual/owner-run**; pipeline agents run at most one scenario × one agent; deterministic parts (parsing removal, config, prompt assembly, discovery) covered by unit/integration tests; the self-improvement loop is not exercised.
- **Changeset:** a core change → a `minor` changeset (pre-1.0). Not a `BREAKING:` revert; it refines review-1.

**Answer:** Confirmed ("Right"). Both inferred points confirmed: (1) auto-supplying the task is always-on, not a toggle; (2) a mistyped rubric name in prose is not caught by Skillsmith — accepted trade.

## Research

Findings from the current branch tip (`review-1`, commit `3b7b872`) and `origin/trunk`, to ground the questions. Sources cited.

- **Judge prompt assembly today** (`src/pipeline/judge-agent.ts`): the judge **system prompt** = verbatim `scenario.judgeBrief` + a `# Output format` `{ pass, notes }` instruction + (optional) `# Grading rubrics` + (optional) `# Role instructions`. The judge **user message** (`buildUserMessage`) = only the produced files, inlined from the judge-copy workspace. Its `scenario` parameter is named `_scenario` and is **explicitly unused** — so the testing-agent task/brief is **not** sent to the judge today.
- **Rubric resolution today** (`resolveRubricBlob` in `judge-agent.ts`): loads **only** the ids in `scenario.rubrics`, from `config.paths.rubrics`, joined with blank lines. Returns `undefined` (no `# Grading rubrics` section) when `paths.rubrics` is unset or the scenario lists no rubric ids.
- **Rubric ids source today** (`src/scenarios/enumerate.ts`): `parseRubricsSection` parses a `# Rubrics` section of `JUDGE.md` (heading text exactly `Rubrics`, case-insensitive, any depth), and ids are validated at enumeration against `<paths.rubrics>/<id>.md` via the per-scenario error channel; `src/scenarios/rubric-loader.ts` (`loadRubric`) mirrors `loadSkill`.
- **Config surface today (branch):** `paths.rubrics?: string` is optional with no default (`src/config/types.ts:154`); `Scenario.rubrics?: string[]` optional (`types.ts:202`). `testing-project/skillsmith.config.ts` sets `paths.rubrics: './eval/rubrics'`.
- **Config surface on trunk:** `paths.rubrics` is **required** with default `./eval/rubrics` (`src/config/defaults.ts`), and the original rubric-loading code + `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` are present. The branch's `eval/rubrics/` currently holds the same restored rubric file.
- **Testing-project JUDGE.md today** (e.g. `counter/JUDGE.md`): has `## Environment`, `## Scenario requirements` (which **repeats** the task), `## Live checks`, and a `# Rubrics` section listing `wp-interactivity-api-best-practices` by id. Both the repeated requirements and the id-list are what this revision aims to remove.
- **Trunk config surface (Q4 basis):** `Paths.rubrics: string` is **required** (`origin/trunk:src/config/types.ts:91`), default `./eval/rubrics` (`DEFAULT_PATHS`), and existence-validated by `checkPaths` over `['skills','scenarios','rubrics']` (`origin/trunk:src/pipeline/pipeline.ts:551`).
- **Trunk judge (for contrast, Q5):** trunk's `judge-agent.ts` is the *older* model — a read-only grader that loads **per-scenario** rubric ids (`scenario.rubrics.map((id)=>…)`), instructs "grading against the rubrics above. Do not consult any skill documentation" (already **skill-agnostic**, corroborating Q2), and returns a **structured** `{ rubrics: { <id>: {pass,notes} }, acceptance }` verdict — which the #55 base run deliberately replaced with the live judge's `{ pass, notes }`. This revision borrows trunk's rubric **config/path** handling, not its verdict shape or read-only grading.

## Out of Scope

Confirmed with the owner:

1. **Backward compatibility** — the review-1 `# Rubrics` id-section and its validation are removed, not kept alongside (pre-1.0 clean break).
2. **Enumeration-time validation of rubric references** — a mistyped rubric name in `JUDGE.md` prose is not caught by Skillsmith.
3. **Changing rubric file content** — `eval/rubrics/wp-interactivity-api-best-practices.md` stays as-is.
4. **Reverting the judge** to trunk's read-only structured `{ rubrics, acceptance }` grader — the live `{ pass, notes }` judge stays.
5. **Making auto-task-passing configurable** — it is unconditional.
6. **Redesigning the self-improvement loop, reporting, or verdict shape** — untouched.
7. **WordPress/browser specifics in core** — those stay in `testing-project` (carried from #55).
8. **Full-suite / CI-green as the acceptance bar** — full behavioral testing stays manual/owner-run.

Not out of scope, but **deferred to design**: the exact mechanism for reliably delivering rubric content to the judge (e.g. pass-all-from-path vs. another approach).

## Consolidated Requirements

1. Skillsmith stops parsing any structured section from `JUDGE.md`; the entire file is opaque prose passed to the judge. This removes the review-1 `# Rubrics` parser, its enumeration-time id validation, and id-matched rubric selection.
2. A `JUDGE.md` author references the rubric(s) to grade against in **natural language** (prose) — no required section, no matched id.
3. The judge **reliably** grades the produced code against the rubric referenced in prose. Reliability is a first-class quality bar; the delivery mechanism is a design decision.
4. Skillsmith automatically supplies the testing agent's task to the judge on **every** judge run, so the judge knows what it is judging without `JUDGE.md` repeating it.
5. The task supplied to the judge **excludes** the `# Skills` section, keeping the judge skill-agnostic so a flawed skill under test is not rubber-stamped.
6. The judge stays the current **live behavioral judge** returning **`{ pass, notes }`**; verdict shape, reporting, and the self-improvement loop are unchanged.
7. The rubrics directory is **optional**, configured via Skillsmith config (`paths.rubrics?`, no existence gate); when unset/empty the judge runs with no rubric context and no error.
8. `testing-project`: all 11 scenario `JUDGE.md` files are converted — remove the repeated `## Scenario requirements` and the `# Rubrics` id-list, reference the rubric in prose, keep the plain-language environment/live-checks. Rubric file content unchanged.
9. The design/plan/code phases must consult `origin/trunk` (not only the branch), which retains the original rubric machinery and content relevant to this change.
10. A changeset is recorded per project policy (core change → `minor`, pre-1.0).
11. Testing posture unchanged from #55 req. 16: full behavioral verification is manual/owner-run; agents run at most one scenario × one agent; deterministic parts covered by unit/integration tests; the self-improvement loop is not exercised by the pipeline.
