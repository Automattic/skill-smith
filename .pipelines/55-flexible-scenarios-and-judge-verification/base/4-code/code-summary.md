# Code Summary

## What

The code phase delivered the full "flexible scenario definition + judge-verified behavior" feature
across 19 tasks (T1–T19) and both halves of the codebase (Skillsmith core and the bundled
`testing-project`), recorded behind one consolidated `BREAKING:` `minor` changeset.

A scenario is now a folder with two opaque prose files — `TESTING-AGENT.md` (the testing agent's
prompt) and `JUDGE.md` (the judge's prompt) — where the only parsed structure is a `# Skills`
section in the testing brief. The judge stopped being a read-only rubric grader and became a live
behavioral verifier: it runs against an isolated copy of the produced workspace, with a
project-configured capability set (tools / MCP servers / sandbox / network), and returns a single
`{ pass, notes }` verdict. The old model (`scenario.yaml`, colocated `e2e.spec.mjs`, linked rubrics,
`paths.rubrics`, `nameSource`, the duplicate-name guard, the Playwright harness) is removed.

## Why

The previous model was brittle (Playwright selector specs produced false failures when generated
markup differed) and over-prescriptive (every project had to express verification as
rubrics + acceptance + e2e). This change lets each project describe in plain language exactly what it
wants checked and have the judge verify it on a real environment, while keeping skills first-class.

## How

- **Types & exports (T1, T2):** `Scenario` becomes `{ name, skills, testingBrief, judgeBrief }`;
  `Paths` drops `rubrics`; `InvokeParams` gains an optional `capabilities: JudgeCapabilities`;
  `JudgeCapabilities` and `McpServerConfig` are defined and exported from the package entry point;
  `AgentDefinitionInput` gains typed-optional `tools`/`mcpServers`/`allowWrite`/`network` over the
  open passthrough. `DEFAULT_PATHS.rubrics` and the `rubrics` entry in `checkPaths` are removed.
- **Discovery & parsing (T3, T4, T5):** a hand-rolled `parseSkillsSection` (first `# Skills` heading
  at any depth; collect to the next same-or-shallower heading; list items only; strip
  backticks/links; empty section valid; absent vs. empty distinguished). `enumerateScenarios`
  discovers on "both briefs present", reads both verbatim, validates skill ids against
  `<skills>/<id>/SKILL.md`, sets `name === id`, and reports every problem as a per-scenario `error`
  string (never throws). `validateConfiguredScenarioNamesAreUnique` and its call site are deleted.
- **Agents (T6, T13):** the testing agent's user message is the verbatim `testingBrief`; the judge's
  system prompt is the verbatim `judgeBrief` + a minimal JSON-only `{ pass, notes }` instruction +
  `roles.judge.prompt`, with `cwd` = the judge copy, capabilities assembled from the judge agent def,
  the produced files inlined from the copy, and a lenient last-balanced-`{...}` JSON fallback.
- **Capability translation (T7, T8):** claude-code maps capabilities to SDK
  `tools`/`disallowedTools`/`mcpServers` (read-only `['Read']` default; `Write`/`Edit` disallowed
  unless `allowWrite`); codex maps to `sandboxMode`/`networkAccessEnabled`/`mcp_servers` config TOML
  (read-only default; `workspace-write` when live execution is needed; R1 caveat documented).
- **Isolation & concurrency (T9, T10, T11):** `snapshotWorkspace`/`diffSnapshots` extracted to a
  shared `workspace-snapshot.ts` alongside a new `copyWorkspaceForJudge`. The agent loop copies
  `workspace/` → `judge-workspace/`, snapshots/diff-guards the canonical workspace around the judge
  phase (failing the pair on mutation), and serializes the whole judge bracket under a `SerialMutex`
  instantiated once per iteration in `pipeline.ts` and threaded through
  `ScenarioRunArgs → RunAgentsParams → RunAgentPairParams`. `AgentContext` exposes `judgeWorkspace`.
- **Verdict & mock (T12, T14):** `classifyVerdict` surfaces `notes` on FAIL; the mock provider emits
  `{ pass, notes }` while keeping the `GATE_PASS`/`GATE_FAIL` seam.
- **Tests & fixtures (T15):** all fixtures and unit tests converted to the two-file model; new tests
  cover the parser, two-file enumeration, capability translation, the mutex, isolation/diff-guard,
  the verdict shape, and the testing-project conversion.
- **`testing-project` (T16, T17, T18):** all 11 scenarios converted to two-file pairs (rubric +
  acceptance + e2e intent inlined into each `JUDGE.md`); the Playwright harness, `verify-e2e.ts`,
  `global-setup.mjs`, `playwright.config.ts`, and `eval/rubrics/` deleted; `skillsmith.config.ts`
  rewritten with a serial Bash + Playwright-MCP judge and per-pair wp-env hooks built from the judge
  copy that export `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID`/`SKILLSMITH_PLUGIN_SLUG`.
- **Changeset (T19):** one `@automattic/skillsmith: minor` changeset with a `BREAKING:` summary and a
  `Migration:` line.

## Key decisions

- `name === id` (normalized folder path) makes scenario names unique by construction, which is why
  the duplicate-name guard is deleted rather than adapted.
- The no-modify guarantee rests structurally on the copied workspace (not the tool surface or
  sandbox), with the snapshot diff-guard as a tripwire — uniform across claude-code and codex.
- The serial knob locks the entire `beforeJudgeAgent → judge → afterJudgeAgent` bracket (env up /
  verify / env down), spanning both fan-outs, because the env lifecycle lives in the bracketing
  hooks, not in the judge call.
- The judge user message still inlines the produced files (from the judge copy) so the deterministic
  mock judge's `GATE_PASS`/`GATE_FAIL` seam keeps working.

## Known limitations

- Live judge behavior (the wp-env boot, browser-driven checks, and the self-improvement loop) is
  verified manually per spec req. 16; automated tests cover only the deterministic parts
  (parsing, discovery, capability translation, verdict wiring, isolation).
- The legacy `{ rubrics, acceptance }` branch in `classifyVerdict` is retained as harmless dead code
  per the design.
- README and `docs/index.html` still describe the old model; their rewrite is scoped to the docs
  phase (R10), not the code phase.
