# Spec: More flexible scenario definition and judge-verified behavior

## Overview

Skillsmith is a scenario-based evaluation harness for coding agents: for each scenario a testing agent implements something, a judge grades it, and a self-improvement loop iterates on the project's *skills* until scenarios pass.

Today a scenario is defined by a structured `scenario.yaml` (name, description, prompt, `skills`, `acceptance`, `rubrics`) plus separately-linked rubric and prompt files, and runtime behavior is verified by hand-written Playwright `e2e.spec.mjs` specs. That setup has two problems: the e2e specs fail when generated markup doesn't match the selectors they assert — a false failure that reflects test brittleness, not wrong behavior — and the fixed structure forces every project to express verification Skillsmith's way (rubrics + acceptance + e2e) rather than describing what it actually wants checked.

This change replaces that model. A scenario is defined by two self-contained prose files — a testing-agent brief and a judge brief — and the judge verifies behavior directly on a live environment by following plain-language instructions, instead of selector-based specs. Skillsmith stops prescribing *what* gets verified: the judge brief is freeform, so each project asks for whatever it needs (code review, acceptance criteria, rubric comparison, live UX checks, console logs — anything). The only structure Skillsmith still imposes is a `# Skills` section in the testing-agent brief, because skills remain the first-class thing Skillsmith exists to test and improve.

This is a clean break with no backward compatibility: the old inputs are removed. The work spans two parts — (a) the Skillsmith core change, and (b) converting the bundled `testing-project` to the new model and giving it the WordPress environment setup the judge needs. By the end, the new system is usable across all parts and the old model is obsolete.

The project is pre-1.0 (`0.x`); this is a breaking change, recorded as a `minor` changeset with a `BREAKING:` summary prefix per the project's policy.

## Requirements

### Scenario definition

1. A scenario is defined by two self-contained prose files in its folder: a **testing-agent brief** (working name `TESTING-AGENT.md`) and a **judge brief** (working name `JUDGE.md`). Scenario discovery keys off these files instead of `scenario.yaml`. Exact filenames and any finer section conventions are for the design phase to finalize; the two-file structure and the `# Skills` section (req. 4) are fixed.
2. The previous inputs are removed entirely from Skillsmith: `scenario.yaml`, the colocated `e2e.spec.mjs`, and the separately-linked rubric and prompt files no longer exist as Skillsmith inputs or concepts.
3. Apart from the `# Skills` section, Skillsmith treats each file's contents as **opaque prompt text** passed through to the relevant agent — the files *are* the prompts (testing brief drives the testing agent; judge brief drives the judge). Skillsmith does not parse other named sections.

### Skills (remain first-class)

4. The testing-agent brief must contain a `# Skills` section that names the skills the scenario uses. Skillsmith validates the section is present and resolves the listed skill ids; an unknown skill id is reported as a clear error (preserving today's reference-validation behavior).
5. Skills remain a first-class concept: Skillsmith loads each referenced skill's file into the testing agent's context, and the self-improvement loop reads and rewrites those skill files for failing scenarios. The skills directory and the improver's skill-editing behavior are unchanged except for sourcing skill ids from the new file.

### Judge (behavioral verification)

6. The judge verifies behavior against a live environment by following the plain-language instructions in the judge brief — it may load pages, run commands, exercise the UI, inspect output, etc., to reach its verdict. This replaces the read-only-grading + separate Playwright e2e gate with a single judge pass.
7. The judge's capabilities/toolset are **configurable by the consuming project** and are not a fixed WordPress/browser-specific set, because projects differ in what "checking behavior" means.
8. The judge must **not** write or modify the files the testing agent produced (the implementation under evaluation).
9. The judge returns an **overall pass/fail plus notes** per scenario. There is no required per-check machine-readable breakdown; the notes are the carrier for any detail (including everything the self-improvement loop needs).

### Environment ownership

10. The consuming project owns setting up and tearing down any live environment its scenarios need; Skillsmith does not manage environments. Skillsmith's run lifecycle must let the project make its environment available at the point the judge runs (and clean it up afterward).

### Reporting and self-improvement

11. Skillsmith records and reports the judge's overall pass/fail + notes across every (scenario, agent) pair, as the run's pass/fail signal.
12. The self-improvement loop continues to receive each judge's verbatim notes (for passing and failing scenarios) and the failing scenarios' skill files, and edits those skills. Its behavior is otherwise unchanged.

### `testing-project` adaptation

13. Every existing `testing-project` scenario is converted to the new two-file model.
14. `testing-project` provides the WordPress live-environment setup the judge needs to verify behavior, and configures the judge's capabilities accordingly. WordPress/browser specifics live in `testing-project`, never in Skillsmith core.

### End state

15. By the end of the work the new system is usable across all parts (core + `testing-project`) and the old model is fully removed/obsolete.

### Testing posture (constraint on how this work is verified)

16. Full testing is performed manually by the owner because runs are costly. Pipeline agents must **not** run the self-improvement loop and must **not** depend on a full-suite green run; an agent may run at most a **single scenario × single agent** as a sanity check. Acceptance for the deterministic parts (parsing, validation, discovery, reporting wiring) is via unit/integration tests; end-to-end behavioral verification across the suite is manual.

## Out of Scope

- **Backward compatibility** — the old model (`scenario.yaml`, `e2e.spec.mjs`, linked rubrics/prompts) is removed, not supported alongside the new one.
- **Skillsmith managing live environments** — standing up/tearing down any runtime (wp-env, servers, browsers) stays the project's responsibility.
- **WordPress/browser specifics in core** — Skillsmith core stays generic; such specifics live only in `testing-project`.
- **Structured per-check verdict breakdown** — only overall pass/fail + notes; no per-criterion machine-readable results.
- **Extra required file structure beyond `# Skills`** — minimal parsing now; more structured sections may be added later but are not built now.
- **Testing the self-improvement loop** — not exercised in the pipeline.
- **Full-suite / CI-green as the acceptance bar** — automated agents do at most one scenario × one agent; full testing is manual.
- **Redesigning the self-improvement loop** — it keeps working as today; only adapted to the new model, not reworked.

## Acceptance Criteria

1. **Scenario discovery from the new files**
   Given a scenario folder containing the testing-agent brief and the judge brief (and no `scenario.yaml`),
   When Skillsmith enumerates scenarios,
   Then the scenario is discovered and runnable.

2. **`# Skills` is required**
   Given a testing-agent brief with no `# Skills` section,
   When Skillsmith loads the scenario,
   Then it fails with a clear validation error naming the missing section.

3. **Skills resolve and load**
   Given a testing-agent brief whose `# Skills` section lists valid skill ids,
   When the testing agent runs,
   Then each listed skill's file is loaded into the testing agent's context;
   And given an unknown skill id, Skillsmith reports a clear error instead of running.

4. **Files are passed through as prompts**
   Given a testing-agent brief and a judge brief with arbitrary prose beyond `# Skills`,
   When the respective agents run,
   Then Skillsmith passes the file contents through as the agent's prompt without requiring or interpreting any other named section.

5. **Judge verifies behavior on the live environment**
   Given a scenario whose judge brief describes live-site checks and a project that has its environment available,
   When the judge runs,
   Then the judge can exercise the environment (load pages, run commands, interact with the UI) per the brief and reach a verdict from what it observes.

6. **Judge cannot alter the implementation**
   Given the judge runs,
   When it produces its verdict,
   Then the files the testing agent produced are unchanged.

7. **Judge capabilities are project-configurable**
   Given a project configures the judge's capabilities,
   When the judge runs,
   Then it has exactly those capabilities, with no WordPress/browser-specific toolset assumed by Skillsmith core.

8. **Verdict recorded and reported**
   Given the judge returns an overall pass/fail + notes,
   When the run completes,
   Then Skillsmith records that verdict for the (scenario, agent) pair and includes pass/fail + notes in the run report.

9. **Self-improvement receives notes and skills**
   Given failing scenarios in an iteration,
   When the self-improvement context is built,
   Then it contains each judge's verbatim notes and the failing scenarios' skill files (mechanism unchanged).

10. **Old model is gone**
    Given the finished work,
    When the Skillsmith codebase and `testing-project` are inspected,
    Then there are no remaining references to `scenario.yaml`, `e2e.spec.mjs`, or separately-linked rubric/prompt inputs.

11. **`testing-project` fully converted**
    Given the finished work,
    When `testing-project` is inspected,
    Then every scenario is defined with the two-file model and the project supplies the WordPress environment setup and judge-capability configuration the judge needs.
