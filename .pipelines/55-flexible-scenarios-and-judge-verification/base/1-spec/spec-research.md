# Spec Research: More flexible scenario definition and judge-verified behavior

> Source: GitHub issue #55 — https://github.com/Automattic/skillsmith/issues/55 (mirrored as Linear BILLOW-106).
> This file is self-contained; agents do not need to open the source issue.

## Goal

A project using Skillsmith can describe what an implementation should *do* in plain language and have the judge (an AI agent) verify that behavior on a live site, instead of relying on hand-written e2e tests that assert specific selectors. The outcome is threefold:

1. **Verification reflects real behavior, not selector matching.** Today's e2e tests fail even when the testing agent's code is correct, because it's hard to always match the selectors the tests expect — a false failure that reflects test brittleness rather than wrong behavior. Asking the judge to check the intended behavior directly is also more flexible.
2. **Defining a scenario gets simpler.** Projects interact with Skillsmith through fewer, more self-contained files instead of today's web of linked rubrics, prompts, and spec files.
3. **Verification is no longer prescribed by Skillsmith.** Instead of baking in a fixed structure (rubrics + acceptance + e2e specs), a project expresses in prose whatever it wants the judge to check — so different projects can verify different things.

## Context

- **Our instance:** in the bundled `testing-project` we want the judge to check acceptance criteria, compare against rubrics, and verify UX behavior on a live site — but that is one project's choice, and the mechanism should stay general so other projects can ask for different things.
- **Scope spans two parts:** (a) a change to how projects interact with Skillsmith — the tool's surface for defining a scenario and its verification; and (b) updating the bundled `testing-project` to adopt the new approach and prove it works end-to-end.

## Assumptions / directions to explore

*(Open — later phases may confirm or revise the exact file split and naming.)*

- Replace the current per-scenario setup (`scenario.yaml` + linked rubrics + linked prompts + `e2e.spec.mjs`) with two self-contained prose files:
  - **`TESTING-AGENT.md`** — which skills to use, the human prompt, and links to shared prompt files (e.g. the testing-agent prompt).
  - **`JUDGE.md`** — what the judge analyzes: the acceptance criteria for evaluating the code, comparison against the rubrics, and an "e2e" section describing in plain language what to do on a live site (go to localhost, activate the plugin, check this behavior) — what the e2e tests cover today, but in human language.
- Folding rubrics and prompts into these files would remove the need to link them separately.

## Q&A

**Q1 (Scope — migration / backward compatibility):** Should the new two-file approach *replace* the current model outright — i.e. it becomes the only way to define a scenario, and `scenario.yaml` + `e2e.spec.mjs` (and the separately-linked rubrics/prompts) are removed from Skillsmith — or must Skillsmith keep supporting the existing YAML + e2e scenarios alongside the new format during a transition?

**A1:** Clean replacement. It is a new model that replaces the old one. The project is still in testing, so backward-compatibility is not a concern — `scenario.yaml`, `e2e.spec.mjs`, and the separately-linked rubrics/prompts can be removed.

**Q2 (Scope — judge's expanded role / live-site verification):** Today the judge is read-only — it only reads the files the testing agent produced and grades them against rubrics/acceptance; it never runs or observes anything. The new `JUDGE.md` includes an "e2e" section asking it to go to localhost, activate the plugin, and check behavior on a live site. Is giving the judge the ability to actually interact with and observe a live running site (load pages, exercise the UI, read what is rendered) — and produce its verdict from that — a required capability of this work, rather than just instructions written in a file?

**A2:** Yes — the judge must be able to do whatever it needs to test the scenario: load pages, run commands, exercise the UI, etc. The one hard constraint is that the judge must **not** write or modify the files the testing agent generated (the implementation under evaluation). Because each project will be totally different, the judge's capabilities/toolset must not be a fixed, WordPress/browser-specific set — they should be whatever is needed to match the project, i.e. configurable per project.

**Q3 (Scope — who owns the live environment):** To check behavior, the judge needs something actually running to point at (the "localhost" in "go to localhost"). Today, standing up that environment — building the plugins, booting `wp-env` — is done by the *project* in a hook (`afterAllScenarios`), not by Skillsmith core. In the new model, whose responsibility is it to start and tear down the live environment the judge tests against: the **project** provides/configures it (and Skillsmith just runs the judge against whatever is running), or must **Skillsmith itself** take on managing that environment?

**A3:** The **project** consuming Skillsmith owns setting up a live environment if its scenarios need one. Checking behavior is project-specific — our `testing-project` uses a WordPress live environment, but other projects will check console logs or whatever they need, and will need something different. Skillsmith stays generic and does not manage environments. In our case we adapt the `testing-project` to set up its WordPress environment.

**Q4 (Output contract — what Skillsmith needs back from the judge):** Skillsmith still has to know whether a scenario passed or failed, to build its pass/fail report across (scenario, agent) pairs and to drive the iteration/self-improvement loop. Today the judge returns a structured JSON verdict (per-rubric and per-acceptance `pass` booleans + notes) that Skillsmith parses. In the new freeform model, what must the judge still hand back to Skillsmith — a machine-readable verdict (at minimum an overall pass/fail, and notes) that Skillsmith records and reports — and does Skillsmith need any structured breakdown of *what* failed, or just the overall pass/fail plus the judge's prose?

**A4:** Overall **pass/fail + notes per scenario** — no structured per-check breakdown required. The judge's summary notes are the carrier for anything relevant to the self-improvement loop. (Confirmed feasible: the improver already receives the judge's verbatim review, so freeform notes reach it — see Research.)

**Q5 (Skills as a first-class concept / self-improvement loop):** The proposed `TESTING-AGENT.md` says "which skills to use," and Skillsmith's self-improvement loop is skill-centric: for each failing scenario it loads that scenario's referenced *skill files* and the improver rewrites them. In the new model, does "skills" stay a first-class concept Skillsmith understands — a directory of skill files that scenarios reference by id and that the improver reads and rewrites — or should skills also become freeform content/links inside `TESTING-AGENT.md` with no special handling? (If skills stop being first-class, the improver needs a different notion of what it edits.)

**A5:** Skills stay **first-class** — Skillsmith exists to test skills, so the skills directory, the loading of skill files into the testing agent, and the improver rewriting those skill files all remain. To keep the link explicit in the freeform file, `TESTING-AGENT.md` must include a `# Skills` section naming the skills to use; Skillsmith should validate that the section is present and use it to resolve which skills to load and which the improver edits. (The `# Skills` section is the owner's proposed mechanism; exact section format is for the design phase to finalize.)

**Q6 (How much structure Skillsmith parses vs. treats as opaque):** Given the `# Skills` section is required in `TESTING-AGENT.md`, should Skillsmith treat the *rest* of each file as opaque prompt text it passes straight through to the relevant agent — i.e. the files essentially **are** the prompts (the testing brief drives the testing agent, the judge brief drives the judge), with Skillsmith parsing only the minimal structure it needs (the skills list)? Or must Skillsmith also recognize other specific sections — e.g. a designated "human prompt" block in `TESTING-AGENT.md`, or separate "acceptance" / "rubric" / "e2e" sections in `JUDGE.md`?

**A6:** Start **minimal**. Only the `# Skills` section is special; the rest of each file is opaque prompt text passed straight through to the agent (the files *are* the prompts). This is deliberately extensible — more structured requirements can be added later if a need emerges, but they are not in scope now.

**Q7 (Success criteria — definition of done):** How will we know this work is complete and successful, for each of the two scope parts? For the Skillsmith-core part, is "done" that a project can define a scenario with the two files and run it through testing → judge-driven verification → pass/fail report + self-improvement? For the `testing-project` part, does "prove it works" mean **all** existing scenarios are converted to the new two-file model and pass under judge-driven verification, or a representative subset — and given AI-driven verdicts are non-deterministic, is "scenarios pass" the bar, or something softer?

**A7:** Done =
- Skillsmith **core** is changed with everything needed for the new model.
- **All** scenarios in `testing-project` are adapted to the new two-file model.
- By the end of the pipeline the new system is **ready to use for all parts** and the **old one is obsolete** (removed — consistent with A1's clean break).
- **Testing is manual.** The owner will run the full/expensive testing by hand. The pipeline's automated agents must **not** run the self-improvement loop and must **not** rely on a full-suite green run; an agent **may** run a single scenario × single agent if a sanity check is needed. Acceptance therefore can't be "the whole suite passes in CI."

## Research

- **`src/improvement/context.ts` — the improver's inputs.** `buildImprovementContext()` hands the improver (a) the iteration report with **each judge's verbatim `review`** for every scenario that ran (passing and failing; only the per-agent `testing`/token block is stripped as noise), and (b) `skillsBlob` — the concatenated text of every **skill** referenced by a *failing* scenario, gathered via `collectSkillIds()` from each failing scenario's `scenario.skills`. Implication for A4: the judge's freeform notes do reach the improver verbatim. Implication for Q5: the improver is currently **skill-centric** — it locates what to improve by the skill ids a failing scenario declares, and edits those skill files under `config.paths.skills`.

## Out of Scope

Confirmed with the owner:

1. **Backward compatibility** — the old model (`scenario.yaml`, `e2e.spec.mjs`, separately-linked rubrics/prompts) is removed, not supported alongside the new one.
2. **Skillsmith managing live environments** — standing up / tearing down any runtime (wp-env, servers) stays the project's responsibility.
3. **WordPress/browser specifics in core** — Skillsmith core stays generic; no baked-in WP/browser assumptions (they live in `testing-project`).
4. **Structured per-check verdict breakdown** — only overall pass/fail + notes; no per-criterion machine-readable results.
5. **Extra required file structure beyond `# Skills`** — minimal parsing now; more structured sections may come later but are not built now.
6. **Testing the self-improvement loop** — not exercised in the pipeline at all.
7. **Full-suite / CI-green as the acceptance bar** — automated agents run at most one scenario × one agent; the owner runs the full, costly testing manually.
8. **Redesigning the self-improvement loop** — it keeps working as today (consumes judge notes, edits skills); only adapted to the new model, not reworked.

## Consolidated Requirements

1. A scenario is defined by two self-contained prose files in its folder: a testing-agent brief (`TESTING-AGENT.md`) and a judge brief (`JUDGE.md`). Exact filenames/section format are for design to finalize; the two-file structure and the `# Skills` section (req. 3) are fixed.
2. The old inputs are removed entirely: `scenario.yaml`, `e2e.spec.mjs`, and the separately-linked rubrics and prompt files no longer exist as Skillsmith inputs.
3. `TESTING-AGENT.md` must contain a `# Skills` section naming the skills to use. Skillsmith validates the section is present and resolves the listed skill ids (an unknown id is a clear error, as today).
4. Skills remain first-class: Skillsmith loads each referenced skill's file into the testing agent, and the self-improvement loop reads and rewrites those skill files for failing scenarios.
5. Apart from `# Skills`, Skillsmith treats the file contents as opaque prompt text passed through to the relevant agent — the files *are* the prompts (testing brief → testing agent, judge brief → judge).
6. The judge performs behavioral verification against a live environment described in `JUDGE.md` — it may load pages, run commands, exercise the UI, etc., to reach its verdict.
7. The judge's capabilities/toolset are configurable by the consuming project, not a fixed WordPress/browser set, because projects differ.
8. The judge must not write or modify the files the testing agent produced (the implementation under evaluation).
9. The consuming project owns setting up and tearing down any live environment its scenarios need; Skillsmith does not manage environments. Skillsmith's lifecycle must allow the project to have its environment available when the judge runs.
10. The judge returns an overall pass/fail plus notes per scenario; Skillsmith records and reports this across (scenario, agent) pairs.
11. The self-improvement loop continues to receive the judge's verbatim notes and the failing scenarios' skill files; its behavior is otherwise unchanged.
12. `testing-project` is fully adapted: every existing scenario is converted to the new two-file model, and `testing-project` provides the WordPress live-environment setup the judge needs.
13. At the end of the work the new system is usable across all parts and the old model is fully removed/obsolete.
14. Testing posture: pipeline agents must not run the self-improvement loop and must not depend on a full-suite green run; an agent may run at most a single scenario × single agent as a sanity check. Full testing is manual.
