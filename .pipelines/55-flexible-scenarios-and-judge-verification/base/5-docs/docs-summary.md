# Docs Summary

## What

Five documentation surfaces were brought in line with the shipped "flexible scenarios + judge-verified behavior" change — a clean break from the old structured-scenario model to two opaque prose briefs per scenario and a live behavioral judge:

- **DocT1 — `README.md`** (substantial rewrite): a scenario is now two prose files (`TESTING-AGENT.md` + `JUDGE.md`), the only parsed structure is a required `# Skills` section, the judge verifies behavior live against a project-owned environment with project-configured capabilities and returns `{ pass, notes }`, environment ownership flows through the per-pair `beforeJudgeAgent`/`afterJudgeAgent` hooks gated by `roles.judge.concurrency`, the report JSON uses the `{ pass, notes }` `review` shape, and a Breaking-change callout plus a "Migrating from the old model" section flag the clean break. A new inline Mermaid lifecycle diagram replaces the stale `assets/skill-tester-workflow.png` embed.
- **DocT2 — `docs/index.html`**: landing-page copy reframed off rubrics/acceptance/Playwright onto prose scenarios, a freeform live judge, and project-owned environments, preserving the value story and case-study metrics.
- **DocT3 — `examples/skillsmith.config.ts`**: reference config drops `paths.rubrics`, demonstrates the judge-capability surface (`tools`/`mcpServers`/`allowWrite`/`network`) and `roles.judge.concurrency`, and replaces the `afterAllScenarios` e2e example with the per-pair env-ownership pattern in the judge hooks.
- **DocT4 — `CONTRIBUTING.md`** (no-op audit): confirmed it carries no old-model assumption as a current contract; no edit was required.
- **DocT5 — `testing-project/eval/prompts/improver.md`**: improver-prompt prose reframed off "e2e results" and "scenarios and rubrics" onto the judge's behavioral verdict/notes and the two-file model, preserving the Interactivity-API intent and docs link.

## Why

The README, landing page, reference config, and the improver-prompt narrative all described the removed model (`scenario.yaml`, separately-linked rubrics, `acceptance`/`prompt`/`description` fields, `paths.rubrics`, the read-only rubric-grading judge, the `{ rubrics, acceptance }` verdict, and the Playwright `e2e.spec.mjs`/`afterAllScenarios` verification gate). Left stale, these surfaces would document a model that no longer ships (design Risk R10, README/docs drift). The docs phase runs after the code lands and documents the actually-shipped behavior so the code and its documentation stay in sync.

## How

Each docs-writer read the merged implementation (the shipped `Scenario`/`Paths` types, the `# Skills` parser rules, the `JudgeCapabilities` keys and per-provider translation, the `{ pass, notes }` verdict and `classifyVerdict` fix, the `roles.judge.concurrency` knob, the workspace-copy no-modify guarantee, and the `beforeJudgeAgent`/`afterJudgeAgent` env-hook timing) and rewrote each surface to match, scoped strictly to its own file. Every concrete claim was verified against the worktree source. The batch was reviewed once after all writers committed; iteration 1 rejected DocT1 for the stale `skill-tester-workflow.png` embed (which still rendered `scenario.prompt`, "the rubrics it references", and a `judge-review.yaml` output); DocT1 was revised to swap the PNG for an accurate inline Mermaid lifecycle diagram, and iteration 2 confirmed the fix and ran all four guardrail gates green (changeset format, changeset present, typecheck, lint).

## Key decisions

- **README diagram as inline Mermaid, not a regenerated PNG.** No diagram source ships and image-asset authoring is not a docs-task file, so the fix stayed inside DocT1's file scope (`README.md`) by replacing the embed with an accurate inline Mermaid `flowchart TD` of the new lifecycle rather than re-rendering art.
- **DocT4 left untouched.** `CONTRIBUTING.md` was audited and found already consistent with the new public surface (its single `Scenario`-type mention remains accurate), so the correct disposition was a no-op rather than an edit-for-edit's-sake change.

## Known limitations

- The stale `assets/skill-tester-workflow.png` (~2 MB) remains on disk but is referenced nowhere in the repo after the README swap — an orphaned asset, harmless and removable in a later cleanup, not a docs-content defect.
- `src/improvement/improver.ts:31` (`DEFAULT_PROMPT`) still contains stale "end-to-end" wording. This is shipped source code, classified as a code-phase observation, and was out of scope for the docs phase.
