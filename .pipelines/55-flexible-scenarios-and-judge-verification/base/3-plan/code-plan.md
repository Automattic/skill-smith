# Code Plan: More flexible scenario definition and judge-verified behavior

## Overview

This plan replaces Skillsmith's structured scenario model (`scenario.yaml` + linked rubrics + per-scenario `acceptance`/`prompt`/`description`, plus Playwright `e2e.spec.mjs` runtime checks) with **two opaque prose files per scenario** — `TESTING-AGENT.md` (drives the testing agent) and `JUDGE.md` (drives the judge) — where the only parsed structure is a `# Skills` section in the testing-agent brief. The judge stops being a read-only grader and becomes a **live behavioral verifier**: it runs against an **isolated copy** of the produced workspace with a **project-configured capability set** (tools / MCP servers / sandbox), returns a single `{ pass, notes }` verdict, and cannot mutate the canonical artifact. The consuming project owns its live environment via the existing `beforeJudgeAgent`/`afterJudgeAgent` hooks, with a new **judge-concurrency knob** that serializes the whole env-up → judge → env-down bracket. The bundled `testing-project` is fully converted: 11 scenarios become two-file pairs, the Playwright harness and rubrics are deleted, and a WordPress env is brought up per-pair in hooks with a Bash + Playwright-MCP judge.

The work is ordered so the deterministic core lands first (types → enumeration/parsing → capabilities plumbing → provider translation → workspace isolation → verdict/judge rewrite), then the removal of obsolete machinery, then the test/fixture migration, then the `testing-project` conversion, and finally the changeset. Per the spec's testing posture (req. 16), there are **no automated e2e tasks**; every task is `tdd` (or plain implementation verified by unit/integration tests + the deterministic guardrails). Behavioral verification of `testing-project` is manual and out of scope for the code phase.

## Guardrail scopes

There are no scoped gates for this work. The code phase enforces these fixed gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, and `npx tsx scripts/validate-changesets.ts`.

| Gate | Scope |
| ---- | ----- |
| None | None |

## E2E test plan

Per the spec's testing posture (req. 16) and the orchestrator's instruction, the Playwright e2e harness is **removed** and behavioral verification of `testing-project` is **manual**. There are therefore **no automated end-to-end flows to implement** in this plan. The flows below are recorded only as the **manual** verification the owner runs after the code phase; they are not tasks and are not automated. Each maps a spec acceptance criterion to a manual check; the deterministic acceptance criteria are covered by the per-task unit/integration tests under `## Tasks`.

### Flow 1: Discover and run a converted scenario (manual)

- **Steps:** Pick one converted `testing-project` scenario (e.g. `counter`) and run a single scenario × single agent (`npm run skillsmith -- counter` with one testing agent). The harness brings up wp-env in `beforeJudgeAgent`, the judge exercises the live site, and a verdict is recorded.
- **Expected:** The scenario is discovered from `TESTING-AGENT.md` + `JUDGE.md` (no `scenario.yaml`), the testing agent implements the block, the judge loads the page / clicks buttons and returns `{ pass, notes }`, and the run report shows the verdict.
- **Traces to:** Acceptance criteria 1, 5, 8, 11.

### Flow 2: Judge cannot alter the implementation (manual)

- **Steps:** During the run above, after the judge completes, compare the canonical `workspace/` against its pre-judge state.
- **Expected:** The canonical `workspace/` is byte-for-byte unchanged; the judge operated on `judge-workspace/`. No diff-guard warning fired.
- **Traces to:** Acceptance criterion 6.

### Flow 3: Judge capabilities are project-configured (manual)

- **Steps:** Inspect `testing-project/skillsmith.config.ts`; confirm the judge agent carries Bash + a Playwright MCP server and that Skillsmith core has no WordPress/browser tool names.
- **Expected:** With the project config, the judge has exactly Bash + Playwright MCP; with core defaults (no config), the judge is read-only.
- **Traces to:** Acceptance criterion 7.

## Tasks

### Task 1: Reshape core types for the two-file model and judge capabilities

- **Goal:** Change the public/internal type surface so the rest of the refactor compiles against the new model: `Scenario`, `Paths`, `InvokeParams`, and the `JudgeCapabilities` descriptor.
- **Type:** tdd
- **Files to change:**
  - `src/config/types.ts`
  - `src/providers/types.ts`
- **Changes:**
  - In `src/config/types.ts`, change `Scenario` to `{ name: string; skills: string[]; testingBrief: string; judgeBrief: string; [key: string]: unknown }`. Remove the `description`, `prompt`, `acceptance`, and `rubrics` fields. Update the doc comment that mentions `scenario.yaml` (line ~176 on `RunScenario.scenario`) to describe the two-file model.
  - In `src/config/types.ts`, remove `rubrics: string` from the `Paths` interface (leave `base`, `skills`, `scenarios`).
  - In `src/config/types.ts`, add the optional typed DX fields to `AgentDefinitionInput` (additive, non-breaking, permissive): `tools?: string[]`, `mcpServers?: Record<string, McpServerConfig>`, `allowWrite?: boolean`, `network?: boolean`. Keep the open `[key: string]: unknown` index signature. (`network` already flows through the open seam today; adding it as a typed optional must not change behavior.)
  - Define and export a `McpServerConfig` type mirroring the Claude SDK stdio/http shape, e.g. `{ command: string; args?: string[]; env?: Record<string, string> }` (stdio form; keep it minimal). Place it in `src/config/types.ts` or `src/providers/types.ts` — choose one and import consistently. (It is referenced by both `AgentDefinitionInput` and `JudgeCapabilities`.)
  - In `src/providers/types.ts`, define and export `interface JudgeCapabilities { tools?: string[]; mcpServers?: Record<string, McpServerConfig>; allowWrite?: boolean; network?: boolean }`.
  - In `src/providers/types.ts`, add `capabilities?: JudgeCapabilities` to `InvokeParams` (optional; set only for the judge call). Update the `Role`/`InvokeParams` doc comment that currently says the judge "is read-only" to note capabilities are project-configurable.
  - Export the new types (`JudgeCapabilities`, `McpServerConfig`) from `src/index.ts` alongside the existing `Provider`/`ProviderId` exports so consuming projects can type their config. Keep `Paths`, `Scenario`, `RunScenario`, `VerificationResult` exported.
- **Depends on:** none
- **Traces to:** Spec requirements 1, 3, 7; Design "Interfaces and Data Flow → Scenario record", "Judge capability descriptor"; Design decision "Project-configurable judge capabilities via a typed descriptor".
- **Acceptance:**
  - `Scenario` has exactly `name`, `skills`, `testingBrief`, `judgeBrief` (plus the open index signature) and no `description`/`prompt`/`acceptance`/`rubrics`.
  - `Paths` has no `rubrics` field.
  - `InvokeParams` has an optional `capabilities` field of type `JudgeCapabilities`.
  - `JudgeCapabilities` and `McpServerConfig` are defined and exported from the package entry point.
  - `AgentDefinitionInput` accepts `tools`/`mcpServers`/`allowWrite`/`network` without TypeScript errors and still accepts arbitrary extra keys.

### Task 2: Drop `rubrics` from path defaults and the path precondition

- **Goal:** Remove the `rubrics` path from defaults and stop requiring a `rubrics/` directory to exist, so a project with no rubrics runs cleanly.
- **Type:** tdd
- **Files to change:**
  - `src/config/defaults.ts`
  - `src/pipeline/pipeline.ts`
- **Changes:**
  - In `src/config/defaults.ts`, remove the `rubrics: './eval/rubrics'` entry from `DEFAULT_PATHS` (leave `base`, `skills`, `scenarios`).
  - In `src/pipeline/pipeline.ts`, change the `checkPaths` loop (currently `for (const key of ['skills', 'scenarios', 'rubrics'] as const)`, ~line 551) to iterate `['skills', 'scenarios']`.
- **Depends on:** Task 1
- **Traces to:** Spec requirements 2, 15; Acceptance 10; Design "Removed (core)"; Design decision "Remove `Paths.rubrics`, `nameSource`, and the duplicate-name guard".
- **Acceptance:**
  - `DEFAULT_PATHS` no longer contains a `rubrics` key.
  - A config whose project directory has `skills/` and `scenarios/` but no `rubrics/` passes `checkPaths` without throwing.
  - `checkPaths` still throws a clear error when `skills/` or `scenarios/` is missing.

### Task 3: Add a `# Skills` parser

- **Goal:** Provide a hand-rolled, dependency-free parser that extracts skill ids from a `# Skills` section in a brief, with the exact rules the design fixes.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/enumerate.ts` (add the parser function here; it may be a standalone exported helper in this file)
- **Changes:**
  - Add a function (e.g. `parseSkillsSection(testingBrief: string): string[]` plus a way to signal "no `# Skills` section at all", e.g. returning `undefined` for absent vs. `[]` for empty) implementing:
    - Find the **first** heading line matching `^#{1,6}\s+Skills\s*$` (case-insensitive on the word "Skills"; accept any heading depth `d` = the `#` count). If none, signal absent (caller turns this into the missing-section error).
    - Collect lines until the next heading whose `#` count is **≤ d** (same-or-shallower depth), or end of file. A deeper sub-heading (`#` count `> d`) does **not** terminate the section.
    - From the collected block, take list items matching `^\s*[-*]\s+(.+?)\s*$`. For each item, strip surrounding backticks and unwrap a Markdown link `[id](...)` to its link text, then trim → a bare skill id. Ignore non-list (prose) lines.
    - An empty section (zero list items) is **valid** → return `[]`.
    - Multiple `# Skills` headings: first wins; extras ignored.
    - Handle CRLF line endings (normalize `\r\n`/`\r` before matching).
  - House style: small regexes (cf. the `MD_LINK_RE` pattern in `src/scenarios/skill-loader.ts`).
- **Depends on:** Task 1
- **Traces to:** Spec requirements 3, 4; Acceptance 2, 3, 4; Design "Interfaces → `# Skills` parsing rules"; Design decision "Hand-rolled `# Skills` parser, no new dependency".
- **Acceptance:**
  - A brief with `# Skills` followed by `- wp-interactivity-api` returns `['wp-interactivity-api']`.
  - List items wrapped in backticks (`` - `id` ``) and Markdown links (`- [id](./skills/id)`) resolve to the bare id.
  - A `# Skills` section containing a deeper sub-heading (e.g. `## Notes`) before the next same-or-shallower heading keeps collecting through the sub-heading; a sibling/parent heading (depth ≤ d) terminates the section.
  - A `# Skills` heading at depth `##` or `###` is accepted (any depth).
  - An empty `# Skills` section returns an empty list (valid).
  - A brief with no `# Skills` heading is reported as absent (distinct from empty), and only the first `# Skills` heading is used when several appear.
  - Prose lines and blank lines inside the section are ignored; CRLF input parses the same as LF.

### Task 4: Rewrite scenario enumeration for the two-file model

- **Goal:** Discover scenarios by "both briefs present", read both briefs verbatim, parse and validate `# Skills`, and emit the new `EnumeratedScenario`/`Scenario` shape with per-scenario `error` strings (never throws) matching today's reference-validation semantics.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/enumerate.ts`
- **Changes:**
  - Add named constants for the filenames, e.g. `const TESTING_BRIEF_FILE = 'TESTING-AGENT.md'` and `const JUDGE_BRIEF_FILE = 'JUDGE.md'`, so a future rename is one edit.
  - Remove the `yaml` import and all `scenario.yaml` parsing, `isScenarioShape`, `stubScenario`'s old fields, and the `rubricsRoot`/rubric-reference validation.
  - Remove the `EnumeratedScenarioNameSource` type and the `nameSource` field from `EnumeratedScenario`. `EnumeratedScenario` becomes `{ scenario, id, dirName, error? }`.
  - Update `enumerateScenarios(paths, projectRoot)` signature unchanged, but internally drop `paths.rubrics` usage (it no longer exists). Keep the recursive `visit`/`visitChildren` walk (nested scenarios + parent-folder filtering must keep working).
  - In `visit`, a directory is a scenario **iff both** `TESTING-AGENT.md` and `JUDGE.md` exist (use the constants). Folders with neither are not scenarios (continue walking children). A folder with exactly one of the two files emits an **errored** scenario whose `error` names the missing file.
  - For a scenario dir with both files: read both verbatim (`readFileSync(..., 'utf8')`) into `testingBrief`/`judgeBrief`. Parse `# Skills` from `testingBrief` (Task 3).
  - `name` = `id` (the normalized `segments.join('/')`); set `scenario = { name: id, skills, testingBrief, judgeBrief }`.
  - Validation → per-scenario `error` string (never throw), concatenating multiple problems into one string as today:
    - Missing `# Skills` section → `"missing required # Skills section in TESTING-AGENT.md"`.
    - Unknown skill id(s) → validate each id via `existsSync(join(skillsRoot, id, 'SKILL.md'))`; for the unresolved ones, build `"unresolved reference: " + missing.map(id => \`skill "${id}"\`).join(', ')` (preserve today's exact prefix, `skill "<id>"` form, and comma-join).
    - One brief file missing → `error` naming the missing file (e.g. `"missing required file: JUDGE.md"`).
  - An errored scenario still pushes an `EnumeratedScenario` (so it survives selection, runs no agents, aggregates `pass:false`, shows skipped) with a minimal stub `scenario` carrying whatever briefs were readable (or empty strings) plus `name=id`, `skills=[]`.
  - Keep the final `out.sort` by `id`.
- **Depends on:** Task 1, Task 3
- **Traces to:** Spec requirements 1, 2, 3, 4, 5; Acceptance 1, 2, 3, 10; Design "Approach §1", "Interfaces → Enumeration error strings", Design decision "Discover on 'both briefs present'; errors are per-scenario".
- **Acceptance:**
  - A directory containing both `TESTING-AGENT.md` and `JUDGE.md` (and no `scenario.yaml`) is discovered as a runnable scenario with `name === id === dirName`, `skills` parsed from `# Skills`, and `testingBrief`/`judgeBrief` set to the raw file contents.
  - A nested scenario directory (e.g. `blocks/counter`) is discovered with `id`/`name` = the slash-joined path.
  - A directory with neither brief file is not enumerated as a scenario; its children are still walked.
  - A directory with only `TESTING-AGENT.md` (or only `JUDGE.md`) produces an errored scenario whose `error` names the missing file; the scenario still appears in the output.
  - A testing brief with no `# Skills` section produces `error: "missing required # Skills section in TESTING-AGENT.md"`.
  - A testing brief whose `# Skills` lists an unknown id produces `error` beginning `"unresolved reference: "` and containing `skill "<id>"`; multiple unknown ids are comma-joined in one string.
  - No code path in enumeration throws for a malformed scenario; results stay sorted by `id`.
  - `EnumeratedScenario` no longer carries `nameSource`, and `EnumeratedScenarioNameSource` no longer exists.

### Task 5: Remove the duplicate-name guard

- **Goal:** Delete `validateConfiguredScenarioNamesAreUnique` (now unreachable because `name === id` is unique by construction) and its call site, plus the `nameSource` read inside it.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/selection.ts`
  - `src/pipeline/pipeline.ts`
- **Changes:**
  - In `src/scenarios/selection.ts`, remove the `validateConfiguredScenarioNamesAreUnique` function entirely (it reads `scenario.nameSource`, which no longer exists). Keep all other exports (`normalizeScenarioFilter(s)`, `selectScenariosByNormalizedFilters`, `matchesScenarioFilter`, `selectScenariosByFilters`) unchanged.
  - In `src/pipeline/pipeline.ts`, remove the `validateConfiguredScenarioNamesAreUnique` import (from the `../scenarios/selection` import block, ~line 43) and its call (~line 93).
- **Depends on:** Task 4
- **Traces to:** Spec requirements 2, 15; Acceptance 10; Design "Removed (core)"; Design decision "Decision: `name === id`; no parsed name/title", "Remove ... the duplicate-name guard".
- **Acceptance:**
  - `validateConfiguredScenarioNamesAreUnique` is no longer defined or exported from `src/scenarios/selection.ts`.
  - `src/pipeline/pipeline.ts` no longer imports or calls it, and the pipeline still selects scenarios via the existing filter helpers.
  - Two scenarios in sibling directories with distinct ids both select normally (no duplicate-name error path remains).

### Task 6: Feed the testing brief to the testing agent

- **Goal:** Make the testing agent's user message the verbatim `testingBrief` instead of the removed `scenario.prompt`; keep the skill-blob system prompt assembly unchanged.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/testing-agent.ts`
- **Changes:**
  - In `runTestingAgent`, change the `provider.invoke({ ... prompt: scenario.prompt ... })` call to `prompt: scenario.testingBrief`.
  - Update the function/JSDoc comment that says "The user message is `scenario.prompt` verbatim" to reference `testingBrief`.
  - Leave the skill-blob assembly (`scenario.skills.map(loadSkill)`), workspace constraint, workspace contents, recursion guard, and `roles.test.prompt` append unchanged.
- **Depends on:** Task 1, Task 4
- **Traces to:** Spec requirement 5; Acceptance 4; Design "Approach §2", "End-to-end data flow §3".
- **Acceptance:**
  - The testing agent invoke receives `scenario.testingBrief` as its `prompt`.
  - The system prompt still includes the loaded skill blob for each id in `scenario.skills`, the workspace constraint, and (when set) `roles.test.prompt`.

### Task 7: Translate judge capabilities in the claude-code provider

- **Goal:** Make the claude-code provider derive the judge's SDK tool surface from `InvokeParams.capabilities` (project-configured), with a read-only default when absent, replacing `TOOLS_BY_ROLE` as the sole source of truth.
- **Type:** tdd
- **Files to change:**
  - `src/providers/claude-code.ts`
- **Changes:**
  - Add a translation step that, given `params.role` and `params.capabilities`, computes the SDK options `tools`, `disallowedTools`, and `mcpServers`:
    - `testing` role: unchanged — `tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']` (keep today's behavior; testing ignores `capabilities`).
    - `judge` role with `capabilities` present: `tools` = `capabilities.tools ?? ['Read']`; `mcpServers` = `capabilities.mcpServers` when present; when `capabilities.allowWrite !== true`, set `disallowedTools: ['Write', 'Edit']` and ensure `Write`/`Edit` are not in `tools`.
    - `judge` role with `capabilities` absent (default): `tools: ['Read']`, no MCP servers, `disallowedTools: ['Write', 'Edit']` — today's read-only behavior.
  - Pass the computed `tools`/`disallowedTools`/`mcpServers` into the SDK `query` options. Keep `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true`, and the scrubbed `env`.
  - `TOOLS_BY_ROLE` may be retained for the testing default or inlined; it must no longer be the only thing that determines the judge tool surface.
- **Depends on:** Task 1
- **Traces to:** Spec requirements 6, 7; Acceptance 5, 7; Design "Components → `src/providers/claude-code.ts`", "Per-provider translation → claude-code"; Design decision "Project-configurable judge capabilities".
- **Acceptance:**
  - A judge invoke with no `capabilities` produces SDK `tools: ['Read']` and `disallowedTools` containing `Write` and `Edit`.
  - A judge invoke with `capabilities.tools: ['Read','Bash']` produces those tools and (since `allowWrite` is not true) still disallows `Write`/`Edit`.
  - A judge invoke with `capabilities.mcpServers: { playwright: {...} }` passes those MCP servers to the SDK.
  - A judge invoke with `capabilities.allowWrite: true` does not force `Write`/`Edit` into `disallowedTools`.
  - A testing invoke is unaffected (full testing tool set, ignores `capabilities`).

### Task 8: Translate judge capabilities in the codex provider

- **Goal:** Make the codex provider derive the judge's sandbox/network/MCP surface from `InvokeParams.capabilities`, with a read-only default when absent, replacing `SANDBOX_BY_ROLE` as the sole source of truth.
- **Type:** tdd
- **Files to change:**
  - `src/providers/codex.ts`
- **Changes:**
  - Add a translation step for the judge role:
    - `testing` role: unchanged — `sandboxMode: 'workspace-write'`.
    - `judge` role with `capabilities`: `sandboxMode` = `'workspace-write'` when live execution is needed (i.e. when `capabilities.allowWrite === true` **or** `capabilities.tools` includes a command-running tool such as `Bash`, or `capabilities.mcpServers` is non-empty — i.e. the judge needs to run commands), else `'read-only'`; `networkAccessEnabled` = `capabilities.network` when set; MCP servers (if any) wired via `CodexOptions.config` TOML overrides (no typed `mcpServers` in Codex). Document the R1 caveat in a code comment: with `approvalPolicy: 'never'`, `read-only` blocks command execution, so a live Codex judge needs `workspace-write`, and the no-modify guarantee then rests on the copied workspace (Task 9/11), not the sandbox.
    - `judge` role with `capabilities` absent (default): `sandboxMode: 'read-only'` — today's behavior.
  - Keep `extraThreadOptions` handling of `effort`/`network`/`webSearch` intact (note `network` may now also arrive via `capabilities`; precedence is a small detail — prefer `capabilities.network` for the judge call when present, falling back to the agent key).
  - `SANDBOX_BY_ROLE` may be retained for the testing default or inlined; it must no longer be the only thing that determines the judge sandbox.
- **Depends on:** Task 1
- **Traces to:** Spec requirements 6, 7; Acceptance 5, 7; Design "Components → `src/providers/codex.ts`", "Per-provider translation → codex"; Risk R1.
- **Acceptance:**
  - A judge invoke with no `capabilities` produces `sandboxMode: 'read-only'`.
  - A judge invoke whose `capabilities` indicate live execution (e.g. `allowWrite: true` or a Bash/MCP capability) produces `sandboxMode: 'workspace-write'`.
  - A judge invoke with `capabilities.network: true` sets `networkAccessEnabled: true`.
  - A testing invoke is unaffected (`sandboxMode: 'workspace-write'`).

### Task 9: Extract `snapshotWorkspace`/`diffSnapshots` into a shared module

- **Goal:** Lift the metadata-only snapshot helpers out of their private home in `testing-agent.ts` into a shared module so the judge diff-guard in `agent-loop.ts` can reuse them, with behavior unchanged.
- **Type:** tdd
- **Files to change:**
  - New: `src/pipeline/workspace-snapshot.ts` (or similar shared location under `src/pipeline/` or `src/util/`)
  - `src/pipeline/testing-agent.ts`
- **Changes:**
  - Create `src/pipeline/workspace-snapshot.ts` exporting `FileEntry`, `snapshotWorkspace(root): Map<string, FileEntry>`, and `diffSnapshots(before, after): string[]` — moved verbatim from `testing-agent.ts` (the `walk` helper moves with them). Behavior must be identical (`{ mtimeMs, size }` metadata, recursive walk, sorted diff).
  - In `src/pipeline/testing-agent.ts`, remove the now-moved definitions and import `snapshotWorkspace`/`diffSnapshots`/`FileEntry` from the new module. `buildWorkspaceContents` stays in `testing-agent.ts` (it uses `FileEntry` from the new module).
- **Depends on:** none
- **Traces to:** Spec requirement 8; Acceptance 6; Design "New (core) → An extraction of `snapshotWorkspace`/`diffSnapshots`", Dependencies → Internal.
- **Acceptance:**
  - `snapshotWorkspace` and `diffSnapshots` are exported from the new shared module and importable from both `testing-agent.ts` and `agent-loop.ts`.
  - `snapshotWorkspace` returns the same `{ mtimeMs, size }`-keyed map and `diffSnapshots` returns the same sorted list of changed relative paths as before the move (testing agent's `filesWritten` is unchanged for the same inputs).

### Task 10: Add a workspace-copy helper

- **Goal:** Provide an `fs.cpSync`-based helper that copies the canonical `workspace/` to a sibling `judge-workspace/` so the judge runs against an isolated copy.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/workspace-snapshot.ts` (or a small dedicated helper module; co-locating with the snapshot helpers is fine)
- **Changes:**
  - Export a function, e.g. `copyWorkspaceForJudge(canonicalWorkspace: string, judgeWorkspace: string): void`, that recursively copies `canonicalWorkspace` → `judgeWorkspace` via `fs.cpSync(src, dest, { recursive: true })`. Ensure the destination parent exists (mkdir recursive). It should be safe to call when the source is empty.
- **Depends on:** Task 9
- **Traces to:** Spec requirement 8; Acceptance 6; Design "New (core) → A workspace-copy helper"; Design decision "No-modify guarantee via a copied workspace".
- **Acceptance:**
  - Copying a populated workspace reproduces its files (including nested directories) at the destination path.
  - Copying an empty (but existing) workspace produces an empty destination directory without error.
  - The source workspace is unmodified by the copy.

### Task 11: Wire workspace isolation, diff-guard, and the judge-concurrency knob into the agent loop

- **Goal:** Before the judge runs, copy `workspace/` → `judge-workspace/` and run the judge against the copy; snapshot/diff-guard the canonical `workspace/` around the judge phase; and serialize the whole `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket under a run-wide mutex when judge concurrency is `serial`.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/agent-loop.ts`
  - `src/pipeline/judge-agent.ts` (signature: accept the judge cwd / copy path — see Task 13; this task only passes it)
  - `src/config/types.ts` (add the optional concurrency field on the judge role — see Changes)
  - `src/config/normalize.ts` and/or `src/config/validate.ts` (carry the optional concurrency field through normalization without rejecting it)
- **Changes:**
  - **Concurrency config:** add an optional `concurrency?: 'serial' | 'parallel'` to the judge role. Concretely, extend `SingleRoleInput`'s object form and `NormalizedRoles['judge']` (in `src/config/types.ts`) so `roles.judge` may carry `concurrency`; default `'parallel'`. Thread it through `normalize.ts` (where `roles.judge` is normalized) so `config.roles.judge.concurrency` is available; keep `validate.ts` permissive (do not reject the new key, and do not reject when it is absent). If the cleanest seam is a different placement, keep the **observable contract** fixed: a config value read once and defaulting to `'parallel'`.
  - **Judge workspace path:** in `runAgentPair`, compute `judgeWorkspace = join(agentDirectory, 'judge-workspace')`. Before the judge runs (after `beforeTestAgent`/testing succeed), this is where the copy lands.
  - **Run-wide mutex:** create a single shared async mutex (a chained promise or size-1 semaphore) scoped to the whole run/iteration, shared across **both** the scenario-level `Promise.all` (in `pipeline.ts` / `runScenario`) and the agent-level `Promise.all` (in `agent-loop.ts`). Thread it through `RunAgentsParams` → `RunAgentPairParams` (or via the run context) so every pair acquires the same lock. When `config.roles.judge.concurrency === 'serial'`, acquire the mutex **immediately before** `beforeJudgeAgent` and release it in a `finally` **after** `afterJudgeAgent`. When `'parallel'`, take no lock (today's behavior). The testing phase (`beforeTestAgent` → testing → `afterTestAgent`) must remain fully parallel and outside the lock.
  - **Bracket ordering inside `runAgentPair`** (the non-skipped branch): acquire lock (if serial) → `copyWorkspaceForJudge(agentWorkspace, judgeWorkspace)` → `snapshotWorkspace(agentWorkspace)` (before) → `beforeJudgeAgent` hook → `runJudgeAgent(... judgeWorkspace ...)` → `snapshotWorkspace(agentWorkspace)` (after) + `diffSnapshots`; if the canonical workspace changed, log a loud warning and mark the pair failed (e.g. fold a failure into the cell / verdict so the pair is FAIL) → `writeAgentReport` → `afterJudgeAgent` hook → release lock in `finally`.
  - **Diff-guard semantics:** the diff-guard compares the canonical `agentWorkspace` snapshot before vs. after the judge phase. A non-empty diff means the judge (or a hook) mutated the canonical artifact — that is a guarantee violation; log it prominently and ensure the pair's verdict becomes FAIL (do not silently pass).
  - Update the `AgentContext` passed to `beforeJudgeAgent`/`afterJudgeAgent` so the project can build/teardown its env from the **judge copy**: expose the judge-copy path. Add `judgeWorkspace` to `AgentContext` (in `src/config/types.ts`) and set it in `runAgentPair`. (`agentWorkspace` stays the canonical path; `judgeWorkspace` is the copy the judge uses.)
  - Keep the existing "testing failed → judge skipped" branch and its symmetric hook skipping unchanged.
- **Depends on:** Task 9, Task 10, Task 1
- **Traces to:** Spec requirements 6, 8, 10; Acceptance 5, 6; Design "Approach §3, §5, §6", "Components → `src/pipeline/agent-loop.ts`", "Judge concurrency knob", Design decision "No-modify guarantee via a copied workspace", "serialize the whole judge bracket".
- **Acceptance:**
  - Before the judge runs, the canonical `workspace/` is copied to a sibling `judge-workspace/`, and the judge is invoked with `cwd` = the copy (verified via Task 13's wiring).
  - After a judge run that does not touch the canonical workspace, the diff-guard reports no change and the verdict is whatever the judge returned.
  - If the canonical `workspace/` is modified during the judge phase, the diff-guard logs a warning and the pair is marked FAIL.
  - With `roles.judge.concurrency` defaulting to `'parallel'`, no mutex gates the judge bracket (existing parallel behavior preserved).
  - With `roles.judge.concurrency: 'serial'`, no two pairs' `beforeJudgeAgent` → judge → `afterJudgeAgent` brackets overlap; the lock is acquired before `beforeJudgeAgent` and released after `afterJudgeAgent` even when the judge throws.
  - The testing phase runs in parallel regardless of the concurrency setting.
  - `AgentContext` exposes the judge-copy workspace path to `beforeJudgeAgent`/`afterJudgeAgent`.
  - A config that omits `concurrency` is accepted and behaves as `'parallel'`.

### Task 12: Surface judge notes on FAIL in `classifyVerdict`

- **Goal:** Make the judge's `notes` reach the dashboard/summary on a failing `{ pass: false, notes }` verdict, instead of the generic `'verdict failed without detail'`.
- **Type:** tdd
- **Files to change:**
  - `src/reports/verdict.ts`
- **Changes:**
  - In `classifyVerdict`, inside the `v.pass === false` branch, after the existing `v.error` and `v.failures[]` handling and **before** the empty-detail fallback: if `typeof v.notes === 'string' && v.notes.length > 0`, push `v.notes` into `failures`.
  - Leave `v.pass === true` → PASS unchanged. Leave the existing `v.error`/`v.failures[]` handling and the legacy `{ rubrics, acceptance }` fallback branch in place (harmless dead code per the design; do not remove it in this task).
- **Depends on:** Task 1
- **Traces to:** Spec requirements 9, 11, 12; Acceptance 8, 9; Design "Interfaces → `classifyVerdict` fix"; Design decision "`{ pass, notes }` verdict mapped onto the existing classifier with a one-line fix".
- **Acceptance:**
  - `classifyVerdict({ pass: false, notes: 'reason' })` returns a FAIL cell whose `failures` includes `'reason'` (not the generic fallback).
  - `classifyVerdict({ pass: false })` (no notes, no error, no failures) still returns FAIL with the `'verdict failed without detail'` fallback.
  - `classifyVerdict({ pass: true, notes: 'ok' })` returns PASS.
  - The existing `{ pass: false, error }` and `{ pass: false, failures: [...] }` behaviors are unchanged.

### Task 13: Rewrite the judge agent for the freeform brief, `{ pass, notes }` verdict, capabilities, and copy cwd

- **Goal:** Make the judge's system prompt the verbatim `judgeBrief` + a minimal `{ pass, notes }` instruction + `roles.judge.prompt`; pass the project-configured `capabilities` and the judge-copy `cwd` into `invoke`; drop all rubric/acceptance/description assembly; and harden `parseJudgeJson` with a lenient fallback.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/judge-agent.ts`
- **Changes:**
  - Change `RunJudgeAgentParams` to receive the judge-copy workspace path (e.g. add `judgeWorkspace: string`) in addition to (or instead of) `agentWorkspace`; the judge `invoke` must use the copy as `cwd`. Keep `agentDirectory`/`projectRoot` for logging.
  - Rewrite `buildJudgeSystemPrompt(scenario, config)`:
    - Body = the verbatim `scenario.judgeBrief`.
    - Append a minimal output instruction asking for **exactly** `{ "pass": <bool>, "notes": "<string>" }` as a single JSON object: keep the JSON-escaping guidance (escape `\n`, `\"`, `\\`), state "output only the JSON object, no prose or Markdown fences" firmly (R8), and keep the recursion guard ("do not invoke `skillsmith` or any wrapper that re-enters the harness").
    - Append `config.roles.judge.prompt` as `# Role instructions` when present (unchanged mechanism).
    - Remove all rubric-blob loading, the `acceptanceBlock`, the `rubricIdList`, and the strict `{ rubrics, acceptance }` instruction. Remove the `existsSync`/`readFileSync`/`rubricsRoot` usage and the unused imports.
  - Rewrite `buildUserMessage`: drop the `scenario.description` push (the field is gone). Since the judge now reads files and the live env via its own tools, file inlining is optional; keep at most a lightweight pointer line to the judge workspace path (or omit inlining entirely). Do not reference removed `scenario` fields.
  - Update `runJudgeAgent` to assemble `capabilities` for the judge `invoke` call. The capabilities are read off the judge `AgentDefinition`'s passthrough keys (`tools`, `mcpServers`, `allowWrite`, `network`) — assemble them into a `JudgeCapabilities` object and pass `capabilities` on `InvokeParams`. (Assembling from the agent def may live here or be passed in from `pipeline.ts`/`agent-loop.ts`; keep it in one clear place. Only set `capabilities` for the judge call.) Pass `cwd: judgeWorkspace`, `role: 'judge'`.
  - Harden `parseJudgeJson`: keep the strict parse (with the existing fenced-block handling) first; on failure, fall back to extracting the **last balanced `{...}` object** in the text and parsing that; if that also fails, return `undefined` (caller already degrades to `{ error: 'unparseable', raw }`).
  - Update the file/JSDoc comments that describe the judge as grading "rubrics + acceptance" / "read-only".
- **Depends on:** Task 1, Task 7, Task 8, Task 11, Task 12
- **Traces to:** Spec requirements 3, 6, 7, 9; Acceptance 4, 5, 7, 8; Design "Approach §4", "Interfaces → Verdict shape and judge prompt", "Components → `src/pipeline/judge-agent.ts`"; Risk R8.
- **Acceptance:**
  - `buildJudgeSystemPrompt` output contains the verbatim `judgeBrief`, the `{ "pass", "notes" }` output instruction (with JSON-only guidance and recursion guard), and `roles.judge.prompt` when set — and contains no rubric/acceptance scaffolding.
  - The judge `invoke` is called with `cwd` = the judge-copy workspace and with `capabilities` assembled from the judge agent definition.
  - `parseJudgeJson('{"pass":true,"notes":"x"}')` parses; `parseJudgeJson('Here is my verdict: {"pass":false,"notes":"y"}')` parses via the lenient fallback to `{ pass: false, notes: 'y' }`; fully unparseable text returns `undefined`.
  - `buildUserMessage` no longer reads `scenario.description` and does not throw on a `Scenario` lacking the removed fields.

### Task 14: Update the mock provider verdict JSON to `{ pass, notes }`

- **Goal:** Make the mock provider's judge output match the real `{ pass, notes }` contract so unit/integration tests and dry runs stay representative.
- **Type:** tdd
- **Files to change:**
  - `src/providers/mock.ts`
- **Changes:**
  - Change `PASS_JSON` to `JSON.stringify({ pass: true, notes: 'mock' })`.
  - Change `FAIL_JSON` to `JSON.stringify({ pass: false, notes: 'skill is missing the marker' })`.
  - Leave the gated `GATE_PASS`/`GATE_FAIL` selection logic and the testing/improver branches unchanged (they only choose between the two JSON constants).
- **Depends on:** Task 1, Task 12
- **Traces to:** Spec requirements 9, 11; Acceptance 8; Design "Components → `src/providers/mock.ts`", Design decision "mock provider".
- **Acceptance:**
  - The mock judge returns `{ pass: true, notes: ... }` for the pass path and `{ pass: false, notes: ... }` for the fail path.
  - `classifyVerdict` on the mock pass output yields PASS; on the mock fail output yields FAIL with the notes surfaced (per Task 12).
  - The gated self-improvement-loop behavior (GATE_PASS/GATE_FAIL) still drives a pass after the marker propagates.

### Task 15: Migrate core unit-test fixtures and tests to the two-file model

- **Goal:** Convert every test fixture and unit test that still assumes `scenario.yaml`, rubrics, `nameSource`, the duplicate-name guard, or the `{ rubrics, acceptance }` verdict so the suite is green under the new model.
- **Type:** tdd
- **Files to change** (drive by `npm test` failures; the known surface):
  - Fixtures under `src/__tests__/fixtures/`: `proj1`, `smoke-project`, `judge-skip-project`, `loop-project`, `target-project`, `verify-project` — for each, replace every `eval/scenarios/<id>/scenario.yaml` with a `TESTING-AGENT.md` (containing a `# Skills` section + a short prose prompt) and a `JUDGE.md` (short prose judge brief); delete each `eval/rubrics/` directory; update each fixture `skillsmith.config.ts` that sets `paths.rubrics` to drop it.
  - `src/__tests__/fixtures/smoke-project/skillsmith.config.ts`: the hook asserting `'nameSource' in scenario` must throw — update it to assert `RunScenario` does **not** expose `nameSource` and does **not** carry the removed `Scenario` fields (keep its intent: guard the public hook surface).
  - `src/__tests__/scenarios.test.ts`: rewrite to exercise two-file discovery, `# Skills` parsing, missing-section error, unknown-skill error, both-files-required, nested discovery; drop `nameSource`/`malformed scenario.yaml` assertions.
  - `src/__tests__/scenario-filter-selection.test.ts`, `src/__tests__/select-scenarios.test.ts`, `src/__tests__/scenario-selection.test.ts`: remove `validateConfiguredScenarioNamesAreUnique` and `nameSource` usages; build fixtures from the new `EnumeratedScenario` shape (no `nameSource`, no rubrics/acceptance).
  - `src/__tests__/scenario-report.test.ts`: replace the `'scenario.yaml malformed'` error expectation with a new-model error (e.g. missing `# Skills` or missing brief file).
  - `src/__tests__/verdict.test.ts`: rewrite for the `{ pass, notes }` shape — PASS on `{ pass: true }`, FAIL surfacing `notes` on `{ pass: false, notes }`, and the empty-detail fallback. (Keep a case or two for the retained legacy/error branches if desired, but the primary shape is `{ pass, notes }`.)
  - `src/__tests__/summary.test.ts`: replace `{ rubrics, acceptance }` review fixtures with `{ pass, notes }` and update the asserted failing-line text accordingly.
  - `src/__tests__/smoke.test.ts`: replace the `'rubrics' in review` assertion with a check that the verbatim `{ pass, notes }` review is persisted under `review`.
  - `src/__tests__/agent-loop.test.ts`: update the comment/assertions about the "complete review (every rubric/acceptance item)" to the `{ pass, notes }` review; if it relies on workspace copy / diff-guard, assert the canonical workspace is unchanged after the judge.
  - `src/__tests__/config-validate.test.ts`, `src/__tests__/self-improvement.test.ts`: drop `rubrics: './eval/rubrics'` from `Paths` fixtures.
  - Update any doc-comment string in `src/pipeline/select-scenarios.ts` (~line 30) and `src/config/types.ts` (~line 176) that mentions `scenario.yaml` to the new model (non-behavioral comment cleanup, part of acceptance #10's "no remaining references").
- **Changes:** Mechanically convert as above. New-model fixtures: a minimal `TESTING-AGENT.md` is e.g. a one-line prose prompt plus `# Skills\n- <id>`; a minimal `JUDGE.md` is one line of prose. Keep skill ids resolvable to the fixture's `skills/<id>/SKILL.md`. Remove the now-unused `rubrics/` dirs and any `paths.rubrics` config.
- **Depends on:** Task 4, Task 5, Task 12, Task 13, Task 14
- **Traces to:** Spec requirements 2, 15, 16; Acceptance 1, 2, 3, 8, 10; Design "Components → tests", Design "Approach §7", Risk R5.
- **Acceptance:**
  - No fixture under `src/__tests__/fixtures/` contains a `scenario.yaml` or a `rubrics/` directory; each scenario fixture has `TESTING-AGENT.md` + `JUDGE.md`.
  - No test references `nameSource`, `validateConfiguredScenarioNamesAreUnique`, or the `{ rubrics, acceptance }` verdict shape.
  - `npm test` passes against the new model.
  - The smoke fixture's hook asserts `RunScenario` does not expose `nameSource`.
  - No doc-comment or string literal in `src/` (outside the changeset) references `scenario.yaml`, `e2e.spec.mjs`, or linked rubric inputs.

### Task 16: Convert the 11 `testing-project` scenarios to the two-file model

- **Goal:** Replace each scenario's `scenario.yaml` + `e2e.spec.mjs` with a `TESTING-AGENT.md` (per-scenario prompt + `# Skills`) and a `JUDGE.md` (acceptance items + inlined shared rubric + e2e intent as plain-language live checks).
- **Type:** tdd
- **Files to change** (under `testing-project/eval/scenarios/<id>/` for all 11: `async-fetch`, `config-fetch`, `counter`, `derived-double`, `focus-trap-menu`, `fruit-list-each`, `independent-counters`, `minimal-scaffold`, `paginated-list`, `shared-state`, `toggle-visibility`):
  - New `TESTING-AGENT.md` per scenario; new `JUDGE.md` per scenario; delete each `scenario.yaml` and each `e2e.spec.mjs`.
  - Update `testing-project/eval/scenarios/_candidates.yaml` header comment that references the old `scenario.yaml` shape / `rubrics:` key (or leave the backlog file but scrub the old-model wording so acceptance #10 holds).
- **Changes:**
  - **TESTING-AGENT.md** for each scenario = the scenario's existing `prompt` text (from its `scenario.yaml`) followed by a `# Skills` section listing the scenario's skill id(s) — all 11 use `- wp-interactivity-api`. The shared workspace/scaffold instructions stay in `roles.test.prompt` (see Task 18); do **not** duplicate them into each brief.
  - **JUDGE.md** for each scenario = the per-scenario `acceptance` items (from `scenario.yaml`) rewritten as judge instructions + the **inlined** shared rubric text from `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` (stamp the full rubric into each file; do not reference it) + the deleted `e2e.spec.mjs` intent re-expressed as plain-language live checks (e.g. for `counter`: "Load the post at `$SKILLSMITH_JUDGE_URL`. Confirm the rendered counter shows 5. Click the Increment button; the number must become 6. Click Decrement twice; it must become 4."). State the env-var convention near the top of each `JUDGE.md`: the site is at `$SKILLSMITH_JUDGE_URL`, the test post is `$SKILLSMITH_POST_ID`, the plugin slug is `$SKILLSMITH_PLUGIN_SLUG`. End each `JUDGE.md` with no JSON instruction (the harness appends the `{ pass, notes }` instruction).
  - `counter`: under `name === id` the folder stays `counter` (slug becomes `plugin-counter-<agent>`); accept the new slug (the e2e hardcoding of `plugin-counter-block-...` is deleted with `e2e.spec.mjs`). Do not rename the folder.
  - Keep all 11 folders flat (slug-safe; `scaffoldPlugin`'s `^[a-z0-9-]+$` guard keeps passing).
- **Depends on:** Task 4 (discovery contract), Task 13 (judge prompt contract)
- **Traces to:** Spec requirements 13, 14, 15; Acceptance 4, 5, 10, 11; Design "`testing-project`", Design decision "Keep the role-prompt mechanism; `testing-project` inlines the rubric per `JUDGE.md`", "conversion mechanics".
- **Acceptance:**
  - Each of the 11 scenario folders contains `TESTING-AGENT.md` + `JUDGE.md` and no `scenario.yaml` or `e2e.spec.mjs`.
  - Each `TESTING-AGENT.md` has a `# Skills` section listing `wp-interactivity-api`, and the per-scenario prompt text is preserved.
  - Each `JUDGE.md` contains the scenario's acceptance points, the full inlined best-practices rubric text, and plain-language live checks derived from the old e2e spec, plus the env-var convention.
  - `_candidates.yaml` no longer documents the old `scenario.yaml`/`rubrics` shape (or is updated to the new model).

### Task 17: Remove the `testing-project` Playwright harness and rubrics

- **Goal:** Delete the entire Playwright/e2e harness and the rubrics directory from `testing-project` so the old model is fully gone there.
- **Type:** tdd
- **Files to change:**
  - Delete `testing-project/playwright.config.ts`, `testing-project/global-setup.mjs`, `testing-project/eval/utils/verify-e2e.ts`, and `testing-project/eval/rubrics/` (the `wp-interactivity-api-best-practices.md` and its dir).
  - `testing-project/package.json` (drop e2e deps/scripts).
  - `testing-project/tsconfig.json` (drop any references to removed e2e files if present).
- **Changes:**
  - Remove the `test:e2e` script from `testing-project/package.json`. Remove the `@playwright/test` and `@wordpress/e2e-test-utils-playwright` devDependencies. **Keep** `@wordpress/env` and `@wordpress/scripts`. Keep `env:start`/`env:stop`/`skillsmith`/`check:config` scripts.
  - Keep `testing-project/eval/utils/scaffold-plugin.ts` and `testing-project/eval/utils/wp-cli.mjs` (used by the new env hooks). The proven boot/build logic from `verify-e2e.ts` is lifted into the new hooks in Task 18 before/while deleting it — sequence the deletion after Task 18 has captured what it needs, or capture it within this task and hand off; either way `verify-e2e.ts` must be gone by the end of the conversion.
  - Run `npm --prefix testing-project install` is **not** required by the code phase; just ensure `package.json` is consistent and `check:config` passes (it imports `skillsmith.config.ts`, which must no longer import `verify-e2e`).
- **Depends on:** Task 18 (the env hooks must absorb the boot/build logic from `verify-e2e.ts` before it is deleted) — or coordinate so `skillsmith.config.ts` no longer imports `verify-e2e` before deletion.
- **Traces to:** Spec requirements 2, 14, 15; Acceptance 10, 11; Design "`testing-project`", "Removed from testing-project".
- **Acceptance:**
  - `testing-project/playwright.config.ts`, `testing-project/global-setup.mjs`, `testing-project/eval/utils/verify-e2e.ts`, and `testing-project/eval/rubrics/` no longer exist.
  - `testing-project/package.json` has no Playwright/e2e deps or `test:e2e` script and retains `@wordpress/env` + `@wordpress/scripts` and the env/skillsmith scripts.
  - No remaining file in `testing-project` references `e2e.spec.mjs`, `playwright`, or `verify-e2e`.

### Task 18: Rewrite `testing-project/skillsmith.config.ts` for the new judge + WP env hooks

- **Goal:** Configure the judge with Bash + a Playwright MCP server, stand the WP env up/down per pair in `beforeJudgeAgent`/`afterJudgeAgent` (built from the judge copy), set per-pair runtime facts via env vars, set judge concurrency to `serial`, and remove the old `afterAllScenarios` e2e gate.
- **Type:** tdd
- **Files to change:**
  - `testing-project/skillsmith.config.ts`
  - New: a small env-hook helper module under `testing-project/eval/utils/` (e.g. `wp-env-judge.ts`) lifting the build/boot/teardown logic from the (removed) `verify-e2e.ts`.
- **Changes:**
  - **Judge capabilities:** set the judge agent (currently `judge: 'opus'`) to an object form that carries capability keys, e.g. `agents.opus` (or a dedicated judge agent) gets `tools: ['Read', 'Bash']` and `mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }`. These ride the agent passthrough (Task 1's typed fields). Keep `allowWrite` unset/false (read-only file tools; Bash present; no-modify guarantee rests on the judge copy).
  - **Judge concurrency:** set `roles.judge` to the object form with `concurrency: 'serial'` (e.g. `judge: { agent: 'opus', concurrency: 'serial' }`), per Task 11's config seam.
  - **`beforeJudgeAgent` hook** (per pair): using the new helper, build the produced plugin in the **judge copy** (`ctx.judgeWorkspace`) with `wp-scripts build` (set `WP_EXPERIMENTAL_MODULES: '1'`), write a `.wp-env.json` pointing at that plugin on port 8987, boot wp-env (`env:start`), activate the plugin, and create a test post (via `wp-cli`/`wpCli`). Set per-pair env vars on `process.env` for the judge child: `SKILLSMITH_JUDGE_URL=http://localhost:8987/?p=<postId>`, `SKILLSMITH_POST_ID=<postId>`, `SKILLSMITH_PLUGIN_SLUG=<slug>`. (claude-code passes `process.env` through to the judge.)
  - **`afterJudgeAgent` hook** (per pair): stop wp-env (`env:stop`), remove the temporary `.wp-env.json`, and clear the per-pair env vars.
  - Build the env from `ctx.judgeWorkspace` (the copy the judge uses) so "what the judge sees == what it verifies" (design Q6 wiring).
  - Remove the `afterAllScenarios` e2e gate and the `runE2eVerification` import. Keep `beforeTestAgent` scaffolding (`scaffoldPlugin`) and the `roles.test.prompt` testing-agent prompt and `roles.improver.prompt` (unchanged mechanism).
  - Keep `roles.test.prompt = testingAgentPrompt` (shared workspace instructions) so each `TESTING-AGENT.md` need not duplicate them (Task 16).
  - Ensure `npm --prefix testing-project run check:config` passes (the config must import cleanly with no references to removed files).
- **Depends on:** Task 11 (concurrency knob + `judgeWorkspace` on `AgentContext`), Task 1 (capability fields), Task 16 (briefs exist)
- **Traces to:** Spec requirements 5, 7, 10, 13, 14; Acceptance 5, 7, 11; Design "`testing-project`", Design decision "`testing-project` — per-pair WP env in `beforeJudgeAgent`, serial judges, Bash + Playwright MCP, env-var facts"; Risks R6, R7.
- **Acceptance:**
  - The judge agent in `testing-project/skillsmith.config.ts` carries `tools: ['Read','Bash']` and a `playwright` MCP server, and these are project-local (no WordPress/browser tool names appear in Skillsmith core).
  - `roles.judge` sets `concurrency: 'serial'`.
  - `beforeJudgeAgent` builds the plugin from the judge copy, boots wp-env on port 8987, activates the plugin, creates a test post, and exports `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID`/`SKILLSMITH_PLUGIN_SLUG`; `afterJudgeAgent` tears wp-env down and cleans up.
  - The `afterAllScenarios` e2e gate and `runE2eVerification` import are gone.
  - `npm --prefix testing-project run check:config` passes.

### Task 19: Add the breaking-change changeset

- **Goal:** Record this pre-1.0 breaking change as a `minor` changeset with a `BREAKING:` summary prefix, per project policy.
- **Type:** tdd
- **Files to change:**
  - New: `.changeset/<short-name>.md` (e.g. `.changeset/flexible-scenarios-judge-verification.md`)
- **Changes:**
  - Front matter: `"@automattic/skillsmith": minor`.
  - Summary begins with `BREAKING:` and describes the consumer-facing break: scenarios are now defined by `TESTING-AGENT.md` + `JUDGE.md` (no `scenario.yaml`); the `Scenario` type and `Paths` type changed shape (`description`/`prompt`/`acceptance`/`rubrics` and `paths.rubrics` removed); the judge verdict is `{ pass, notes }`; the judge runs live with project-configured capabilities and a new `roles.judge.concurrency` knob. A `Migration:` line is encouraged. Keep lines ~120 chars; multi-line body is allowed.
  - Do not hand-write PR/author references.
- **Depends on:** none (content reflects the whole change; can be written last)
- **Traces to:** Spec "Overview" (pre-1.0 breaking change), AGENTS.md / CONTRIBUTING.md pre-1.0 policy; Design "Overview".
- **Acceptance:**
  - `.changeset/` contains a new `*.md` with `"@automattic/skillsmith": minor` front matter and a summary starting with `BREAKING:`.
  - `npx tsx scripts/validate-changesets.ts` passes (valid format, no `major` bump).
