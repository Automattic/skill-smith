# Design Doc: More flexible scenario definition and judge-verified behavior

## Overview

Skillsmith is a scenario-based evaluation harness for coding agents: for each scenario a **testing agent** implements something, a **judge** grades it, and a **self-improvement loop** rewrites the project's *skills* until scenarios pass. Today a scenario is a structured `scenario.yaml` (`name`, `description`, `prompt`, `skills`, `acceptance`, `rubrics`) plus separately-linked rubric files, and runtime behavior is checked by hand-written Playwright `e2e.spec.mjs` specs run once per iteration. That model is brittle (e2e selectors fail when generated markup differs, a false failure) and over-prescriptive (every project must express verification as rubrics + acceptance + e2e).

This design replaces that model with a **clean break, no backward compatibility**. A scenario becomes **two self-contained prose files** in its folder — `TESTING-AGENT.md` (drives the testing agent) and `JUDGE.md` (drives the judge). Both are passed through verbatim as agent prompts; the **only** structure Skillsmith still parses is a `# Skills` section in `TESTING-AGENT.md`, because skills remain the first-class thing Skillsmith tests and improves. The judge stops being a read-only grader and instead **verifies behavior on a live environment** by following plain-language instructions, using a **project-configured** toolset (no WordPress/browser specifics in core). The judge returns a single `{ pass, notes }` verdict. The consuming project owns its live environment via existing lifecycle hooks. The work spans Skillsmith core and converting the bundled `testing-project` to the new model with its WordPress environment setup.

The project is pre-1.0 (`0.x`); this is a breaking change, recorded as a `minor` changeset with a `BREAKING:` summary prefix. Per the spec's testing posture, this change is verified manually (and by unit/integration tests for the deterministic parts); the self-improvement loop is not exercised by the pipeline.

## Approach

The mental model the implementer works from, end to end:

1. **Discovery & parsing (deterministic, unit-testable).** `enumerateScenarios` walks the scenarios tree and treats a directory as a scenario **iff both** `TESTING-AGENT.md` and `JUDGE.md` are present. For each, it reads both files verbatim, parses the `# Skills` section out of `TESTING-AGENT.md`, and validates each listed skill id resolves to `<skills>/<id>/SKILL.md`. The scenario's `name` is set equal to its `id` (the normalized folder path). Any problem (missing file, missing `# Skills`, unknown skill id) is recorded as a per-scenario `error` string — never a throw — so the run continues and the bad scenario surfaces in the report exactly as today's reference-validation errors do.

2. **Testing agent (unchanged mechanics, new source).** The testing agent's system prompt is unchanged in structure (skill blobs + workspace constraints + recursion guard + `roles.test.prompt`); its **user message** is now the verbatim `TESTING-AGENT.md` brief (`testingBrief`) instead of `scenario.prompt`. It writes into the per-pair `workspace/`.

3. **Workspace isolation for the judge.** Before the judge runs, the harness copies the testing agent's `workspace/` to a sibling judge-scoped directory (`judge-workspace/`). The judge runs with `cwd` set to that copy, so it **structurally cannot** modify the produced files regardless of what tools it has. A snapshot diff-guard around the judge phase detects any mutation of the canonical workspace as a backstop.

4. **Judge live verification (new).** The judge's system prompt is the verbatim `JUDGE.md` brief + a minimal "return exactly `{ pass, notes }`" instruction + the optional `roles.judge.prompt`. Its capabilities (built-in tools + MCP servers + sandbox/write/network) come from a **project-supplied, role-scoped capability descriptor** that each provider translates to its native surface. Core's default is read-only (today's behavior); WordPress/browser tooling lives only in the project's config. The judge follows `JUDGE.md` against the live environment the project stood up and emits `{ pass, notes }`.

5. **Environment ownership (project, via hooks).** Skillsmith never runs `env:start`/`env:stop`. The project stands its environment up and tears it down in the per-pair `beforeJudgeAgent` / `afterJudgeAgent` hooks (the first lifecycle point where the produced artifact exists and the env can be up before the judge runs). A new **judge-concurrency knob** lets a project serialize the whole judge bracket — `beforeJudgeAgent` (env up) + judge + `afterJudgeAgent` (env down) — when it uses a single shared environment that cannot run concurrently, so the env up/verify/down for one pair never interleaves with another's.

6. **Verdict, reporting, improver (mostly existing wiring).** The `{ pass, notes }` verdict is stored verbatim under `review` in the per-agent `report.json`. `classifyVerdict` derives PASS/FAIL and is fixed to surface `notes` as the FAIL detail. The scenario report, console summary, and self-improvement context already carry the `review` block verbatim, so notes reach reports and the improver with no further change.

7. **Removal.** `scenario.yaml`, `e2e.spec.mjs`, linked rubric files, the `Paths.rubrics` config, the `nameSource`/duplicate-name machinery, and the rubric/acceptance/description/prompt fields are all deleted from core; the entire Playwright harness and rubrics are deleted from `testing-project`; the README and `docs/index.html` are rewritten to describe the new model.

## Components

### Modified (core)

- **`src/scenarios/enumerate.ts`** — Rewritten. Discover on "both briefs present"; read `TESTING-AGENT.md`/`JUDGE.md` verbatim; parse `# Skills`; validate skill ids against `<skills>/<id>/SKILL.md`; emit `testingBrief`/`judgeBrief`. Drops `scenario.yaml` parsing, rubric validation, the `isScenarioShape` guard, and `nameSource`. Houses (or imports) the new `# Skills` parser. Filenames are named constants so a future rename is one edit.
- **`src/config/types.ts`** — `Scenario` becomes `{ name, skills, testingBrief, judgeBrief }`. `Paths` drops `rubrics`. `EnumeratedScenario` drops `nameSource`. Optional typed judge-capability fields added to `AgentDefinitionInput` for authoring DX (additive, non-breaking). `InvokeParams` (in `src/providers/types.ts`) gains an optional `capabilities` field.
- **`src/config/defaults.ts`** — Drop `rubrics` from `DEFAULT_PATHS`.
- **`src/pipeline/pipeline.ts`** — `checkPaths` validates `['skills', 'scenarios']` (was `['skills', 'scenarios', 'rubrics']`). Remove the `validateConfiguredScenarioNamesAreUnique` import and call. Assemble the judge `capabilities` from the judge agent definition and the judge-concurrency knob from config.
- **`src/scenarios/selection.ts`** — Remove the duplicate-name guard (`validateConfiguredScenarioNamesAreUnique`); unreachable once `name === id`.
- **`src/pipeline/testing-agent.ts`** — User message becomes `scenario.testingBrief` (was `scenario.prompt`). Skill-blob assembly unchanged.
- **`src/pipeline/judge-agent.ts`** — Rewrite `buildJudgeSystemPrompt` to verbatim `judgeBrief` + minimal `{ pass, notes }` instruction + `roles.judge.prompt`; remove all rubric/acceptance assembly. `buildUserMessage` drops the `scenario.description` push. Pass the judge `capabilities` and the copied-workspace `cwd` into `invoke`. Add a lenient JSON fallback to `parseJudgeJson`.
- **`src/pipeline/agent-loop.ts`** — Copy `workspace/` → `judge-workspace/` before the judge; snapshot/diff-guard the canonical workspace around the judge phase; honor the judge-concurrency knob by acquiring a shared run-wide mutex around the **whole** `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket when `serial` (releasing it in a `finally` after `afterJudgeAgent`), so the env up/verify/down for one pair runs uninterleaved with any other pair's across both the scenario- and agent-level `Promise.all` fan-outs.
- **`src/reports/verdict.ts`** — One behavioral fix in `classifyVerdict`: in the `pass === false` branch, push `notes` into `failures` when present, before the empty-detail fallback.
- **`src/providers/types.ts`** — `InvokeParams` gains `capabilities?: JudgeCapabilities` (set only for the judge call).
- **`src/providers/claude-code.ts`** — Translate `capabilities` to SDK `tools`/`disallowedTools`/`mcpServers`/permissions, replacing `TOOLS_BY_ROLE` as the sole source of truth; read-only default when absent.
- **`src/providers/codex.ts`** — Translate `capabilities` to `sandboxMode`/`networkAccessEnabled` (and MCP via `CodexOptions.config`), replacing `SANDBOX_BY_ROLE` as the sole source; read-only default when absent.
- **`src/providers/mock.ts`** — `PASS_JSON`/`FAIL_JSON` emit `{ pass, notes }`.

### New (core, small)

- **A `# Skills` parser** — hand-rolled regex, in/near `enumerate.ts`. No new dependency.
- **A `JudgeCapabilities` type + per-provider translation** — provider-neutral descriptor; translation lives in each provider.
- **A workspace-copy helper** — `fs.cpSync`-based, for copying `workspace/` → `judge-workspace/`.
- **An extraction of `snapshotWorkspace`/`diffSnapshots`** — these metadata-only (`{ mtimeMs, size }`) helpers exist today but are **private, unexported functions inside `src/pipeline/testing-agent.ts`** (lines ~109/162). To diff-guard the canonical workspace from `agent-loop.ts`, they must first be lifted into a shared module (or exported) — a small refactor, not free reuse. The behavior is unchanged; only the visibility moves.

### Removed (core)

`Paths.rubrics`, `DEFAULT_PATHS.rubrics`, `rubrics` from the `checkPaths` loop; all rubric-blob loading (inline in `judge-agent.ts` and `enumerate.ts`); the `Scenario` fields `rubrics`/`acceptance`/`description`/`prompt`; `isScenarioShape`; `nameSource` (field, type, and provenance); `validateConfiguredScenarioNamesAreUnique` (and its call). The `{rubrics,acceptance}` fallback in `classifyVerdict` becomes dead but is left harmless (see Key Decisions).

### Untouched-but-relevant (core)

- **`src/improvement/context.ts` + `improver.ts`** — Carry the verbatim `review` block and the failing scenarios' skill files; `collectSkillIds` reads `scenario.skills`, which still exists. No change (req. 12).
- **`src/reports/scenario-report.ts`, `summary.ts`, `progress/*`** — Key off `scenario.name`, which still exists and now equals `id`. No change.
- **`src/improvement/verify.ts` + `VerificationResult`/`applyVerification`/`normalizeVerification` + the `afterAllScenarios` consumed-return contract** — Kept as a **generic, optional** extra gate. It is provider/rubric/WP-agnostic and costs nothing when a project defines no such hook. `testing-project` stops using it for the e2e gate, but the mechanism stays in core.
- **Selection/filter (`id`-based matching), provider registry, api/vercel providers** — api/vercel providers stay text + local-fs and ignore `capabilities` (degrade to read-only default).

### `testing-project`

- Convert all 11 scenarios to the two-file model.
- Remove the entire Playwright harness: every `e2e.spec.mjs`, `playwright.config.ts`, `global-setup.mjs`, `eval/utils/verify-e2e.ts`, and the `afterAllScenarios` e2e gate; remove `eval/rubrics/`; remove all `scenario.yaml`.
- Rewrite `skillsmith.config.ts`: judge-capability config (Bash + Playwright MCP) and per-pair env hooks (`beforeJudgeAgent`/`afterJudgeAgent`) instead of the e2e gate; set judge concurrency to `serial`.
- Update `package.json` deps (drop Playwright/e2e; keep `@wordpress/env` + `wp-scripts`); keep `scaffold-plugin`/`wp-cli`/`env:start`/`env:stop`.

### Docs

- **README.md** — substantial rewrite (not line edits) of the rubrics/acceptance/e2e/`scenario.yaml` model and the example `{rubrics,acceptance}` review JSON.
- **`docs/index.html`** — remove the ~6 old-model mentions.

## Interfaces and Data Flow

### Scenario record and enumeration shape

```ts
// src/config/types.ts
interface Scenario {
  name: string;          // === id (normalized folder path)
  skills: string[];      // parsed from the `# Skills` section of TESTING-AGENT.md
  testingBrief: string;  // raw TESTING-AGENT.md text (testing agent user message)
  judgeBrief: string;    // raw JUDGE.md text (judge system prompt body)
}

// EnumeratedScenario keeps { scenario, id, dirName, error? } — drops `nameSource`.
```

`RunScenario` continues to expose `{ id, dirName, scenario }` with `dirName === id`. `name === id === dirName` everywhere, so every name-keyed downstream join (artifact dirs `iteration-N/<name>/<agent>/`, report keys, progress rows, re-run selection, improver name→scenario map) keeps working unchanged.

### `# Skills` parsing rules

- Find the first heading matching `^#{1,6}\s+Skills\s*$` (case-insensitive on "Skills"; any heading depth accepted, `# Skills` is the documented h1 form). Record that heading's depth `d` (its `#` count).
- Collect lines until the next heading at the **same-or-shallower depth** as the matched Skills heading (i.e. a heading whose `#` count is `≤ d`), or end of file. A **deeper** sub-heading (`#` count `> d`, e.g. a `##` under an h1 `# Skills`) does **not** terminate the section — it is part of it — so an author may nest sub-sections inside Skills without silently truncating the list. (This is self-consistent with accepting the Skills heading at any depth: nesting is never penalized, on the heading itself *or* within the section.)
- From that block, take list items `^\s*[-*]\s+(.+?)\s*$`; per item, strip surrounding backticks and unwrap a Markdown link `[id](...)` to its text, then trim → a bare skill id. Non-list lines (prose) are ignored.
- Empty section (zero ids) is **valid** (a zero-skill scenario, matching today's shape-valid `skills: []`).
- Multiple `# Skills` headings: first wins; extras ignored (forgiving, not fatal).

### Enumeration error strings (per-scenario `error`, never a throw)

- Missing `# Skills` section → `"missing required # Skills section in TESTING-AGENT.md"` (acceptance #2: clear, names the section).
- Unknown skill id(s) → reuse today's exact phrasing and shape: a single `"unresolved reference: "` prefix followed by a **comma-joined list of the unresolved skill ids**, each as `skill "<id>"` (today's code does `missing.join(', ')`, e.g. `unresolved reference: skill "a", skill "b"`). After rubrics are removed the list is skills-only (no more `rubric "<id>"` entries) but remains a joined list, not a single-id form. Each id is validated via `existsSync(<skills>/<id>/SKILL.md)` (the same contract `loadSkill` relies on).
- One brief file missing → `error` naming the missing file.
- Multiple problems concatenate into one `error` string (as today) — including multiple unknown skill ids, which join into the one `unresolved reference:` list above.

An errored scenario survives selection every iteration, runs no agents, aggregates with `pass: false`, and shows as skipped in progress — unchanged from today's reference-validation path.

### Judge capability descriptor

A provider-neutral, role-scoped descriptor carried on `InvokeParams` for the judge call only:

```ts
// src/providers/types.ts
interface InvokeParams {
  agent: AgentDefinition;
  systemPrompt: string;
  prompt: string;
  cwd: string;
  role: Role;
  capabilities?: JudgeCapabilities;  // present only for the judge invoke; absent = today's role default
}

interface JudgeCapabilities {
  tools?: string[];                              // base built-in tool set (e.g. ['Read','Bash'])
  mcpServers?: Record<string, McpServerConfig>;  // project MCP servers (e.g. Playwright)
  allowWrite?: boolean;                          // default false
  network?: boolean;
}
// McpServerConfig mirrors the Claude SDK stdio/http shape, e.g. { command, args, env }.
```

The project sets these keys on the **judge agent definition** in `skillsmith.config.ts`, riding the existing open `[key: string]: unknown` passthrough on `AgentDefinition` (the same seam `effort`/`network`/`webSearch`/`providerOptions` already use). The pipeline reads those keys off the judge agent and assembles them into the typed `capabilities` it passes to `invoke`. For DX, optional typed fields (`tools?`, `mcpServers?`, `allowWrite?`, `network?`) are added to `AgentDefinitionInput`; validation stays permissive (unknown keys are not rejected, preserving passthrough). The exact field names / `McpServerConfig` reuse are a plan-phase detail (Open Question Q4).

**Per-provider translation:**
- **claude-code:** `tools` → SDK `tools`; `mcpServers` → SDK `mcpServers`; `allowWrite: false` → keep `Write`/`Edit` out of `tools` and `disallowedTools: ['Write','Edit']`; `network` → permissions as needed. Default (no `capabilities`): `tools: ['Read']`.
- **codex:** `allowWrite`/live-needs → `sandboxMode` (`workspace-write` when live checks are needed, else `read-only`); `network` → `networkAccessEnabled`; MCP → `CodexOptions.config` TOML overrides (no typed `mcpServers`). Default: `read-only`. (See Risk R1: with `approvalPolicy: 'never'`, `read-only` appears to block command execution, so a live Codex judge needs `workspace-write`; the no-modify guarantee then rests on the copied workspace, not the sandbox.)
- **vercel / api providers (anthropic-api, openai-api, gemini-api):** ignore `mcpServers`, fall back to `fsTools(role)` (text + local-fs). Live judging is intended for claude-code/codex (Risk R3).
- **mock:** ignores `capabilities`.

### Verdict shape and judge prompt

The judge emits exactly:

```json
{ "pass": true, "notes": "<freeform string>" }
```

No per-check machine-readable breakdown (req. 9, out of scope). `notes` is the single freeform carrier of all detail (reasons, per-criterion findings, live observations — everything the improver needs). It is persisted verbatim as the `review` block of the per-agent `report.json`.

- `buildJudgeSystemPrompt` = verbatim `judgeBrief` + a minimal output instruction asking for exactly `{ "pass": <bool>, "notes": "<string>" }` (keep the JSON-escaping guidance + recursion guard) + the optional `config.roles.judge.prompt`. All rubric/acceptance assembly removed.
- `buildUserMessage` drops the `scenario.description` push. Since the judge now reads files and the live env via its own tools, file inlining is optional; keep at most a lightweight pointer to the workspace/copy path (Open Question Q7).
- `parseJudgeJson` gains a **lenient fallback**: try strict parse first; on failure, extract the last balanced `{...}` object and parse that. Unparseable still degrades safely to a FAIL with `raw` retained.

### `classifyVerdict` fix (the one behavioral change in core verdict logic)

In the `pass === false` branch of `classifyVerdict`, surface the judge's actual reason: if `typeof v.notes === 'string' && v.notes.length > 0`, push `v.notes` into `failures` before the existing `'verdict failed without detail'` fallback. The existing `v.error` / `v.failures[]` handling stays intact (so the retained `afterAllScenarios` gate and error shapes still classify). `pass: true` → PASS unchanged; notes are not shown for passes on the dashboard but are still stored verbatim under `review`.

### End-to-end data flow (new model)

1. `enumerateScenarios` walks scenario dirs. For each dir with both briefs: read `TESTING-AGENT.md`/`JUDGE.md`, parse `# Skills`, validate skill ids → `EnumeratedScenario { scenario: { name=id, skills, testingBrief, judgeBrief }, id, dirName, error? }`.
2. Selection/filter by `id`; the pipeline runs per `(scenario, agent)` pair.
3. **Testing agent:** system prompt = skill blob + workspace constraint/contents + recursion guard + `roles.test.prompt`; user message = `testingBrief`; writes into `workspace/`.
4. **Harness:** copies `workspace/` → `judge-workspace/`. If judge concurrency is `serial`, the harness now acquires the run-wide judge mutex (released in step 5's `finally`), so the env up/verify/down below runs uninterleaved with any other pair. The project's `beforeJudgeAgent` hook brings the live env up (built from the judge copy) and sets per-pair env vars.
5. **Judge agent:** system prompt = `judgeBrief` + `{ pass, notes }` instruction + `roles.judge.prompt`; capabilities from the judge agent def (tools/MCP/sandbox); `cwd` = judge copy → emits `{ pass, notes }`. The harness diff-guards the canonical `workspace/`. The project's `afterJudgeAgent` tears the env down; the judge mutex (if held) is then released. The whole `beforeJudgeAgent` → judge → `afterJudgeAgent` span is the serialized critical section.
6. **Verdict:** `{ pass, notes }` stored verbatim as `review`; `classifyVerdict` derives PASS/FAIL (notes surfaced on FAIL); `aggregateScenarioReport` stores `review` verbatim and computes pass via `classifyVerdict(...).kind === 'PASS'`; `projectReportForImprover` forwards `review` verbatim for passing and failing pairs; re-selection uses `classifyVerdict(...).kind`.

### Lifecycle hook timing (already in core; unchanged)

Order around testing → judge per pair: `beforeTestAgent` → testing writes plugin → `afterTestAgent` → `beforeJudgeAgent` → judge → `afterJudgeAgent`. `beforeJudgeAgent` is the **first** point where this pair's produced artifact exists **and** the env can be up before the judge runs; `afterJudgeAgent` is the teardown seam. `AgentContext` already carries `agent`, `agentWorkspace`, `scenario`, and the run context — enough to scope a per-pair env.

### Judge concurrency knob

A config knob (e.g. `roles.judge.concurrency: 'serial' | 'parallel'`, default `parallel` to preserve today's behavior).

**What the knob serializes — the whole judge bracket, not just the judge call.** The pipeline parallelizes on two dimensions: `Promise.all` over scenarios (`pipeline.ts`, `runScenario` per selected scenario) *and* `Promise.all` over agents within each scenario (`agent-loop.ts`, `runAgentPair` per testing agent). The env lifecycle lives in the `beforeJudgeAgent` / `afterJudgeAgent` hooks that **bracket** the judge call inside `runAgentPair` — `beforeJudgeAgent` (env up) → `runJudgeAgent` (verify) → `afterJudgeAgent` (env down) — and those hooks are *not* part of `runJudgeAgent`. Serializing only the judge *invocation* would therefore leave two concurrent pairs free to both enter `beforeJudgeAgent` and both run `env:start` (for `testing-project`, `wp-env start` on the fixed port) before either judge acquires the lock — exactly the cross-talk the knob exists to prevent (R7). So when `serial`, the harness must hold a single process-wide mutex across the **entire per-pair bracket**: `beforeJudgeAgent` + `runJudgeAgent` + `afterJudgeAgent` run uninterleaved with any other pair's bracket.

Because that bracket is nested under *both* fan-outs, the mutex spans both the scenario-level and the agent-level `Promise.all` — it is one lock shared across all pairs in the iteration, not per-scenario. Concretely: a shared async mutex (a chained promise, or a tiny semaphore of size 1) acquired immediately before `beforeJudgeAgent` and released in a `finally` after `afterJudgeAgent`. The testing phase (`beforeTestAgent` → testing agent → `afterTestAgent`) is **unaffected** and keeps running fully parallel across all pairs; only the judge bracket is gated. When `parallel`, no mutex is taken and every pair's bracket runs concurrently (today's behavior).

This lets a project that uses one shared live environment stand the env up/verify/tear-down for one pair at a time and avoid cross-talk, without forcing N parallel environments. The exact config key/placement, and whether the mutex is a module-level singleton or threaded through the run context, are plan-phase details; *what* is serialized (the whole bracket, across both fan-outs) is fixed.

## Key Decisions

### Decision: `name === id`; no parsed name/title

- **Choice:** The scenario's `name` is set equal to its `id` (normalized folder path, e.g. `blocks/counter`). No `name:` field exists in the new model and none is synthesized from the brief.
- **Alternatives:** Parse a title from the brief's first `#` heading.
- **Trade-offs:** Parsing a title reintroduces a structural field the spec wants opaque (req. 3), risks duplicate/empty names, and re-creates the old `name ≠ id` divergence. Using the folder id makes names unique by construction, keeps every name-keyed downstream join working, and makes the duplicate-name guard provably unreachable (so it is deleted). Cost: nested ids contain `/` and `name` is used as a path segment — but that is pre-existing behavior today (`dirName === id` for nested scenarios), not new.
- **Traces to:** Requirements 1, 3; Acceptance 1.

### Decision: Discover on "both briefs present"; errors are per-scenario, not throws

- **Choice:** A directory is a scenario iff **both** `TESTING-AGENT.md` and `JUDGE.md` exist. Walk recursively (reuse the existing `visit`/`visitChildren` so nested scenarios + parent-folder filtering keep working). A folder with exactly one of the two files is a misconfiguration → emit an **errored** scenario naming the missing file. Folders with neither are not scenarios (stray files like `_candidates.yaml` are ignored). All validation failures (missing file, missing `# Skills`, unknown skill id) produce a per-scenario `error` string, never a throw.
- **Alternatives:** (a) Discover on either file alone. (b) Hard-throw on a validation failure, aborting the whole run.
- **Trade-offs:** "Both present" gives a crisp, typo-resistant rule and makes a typo'd filename loud instead of silently dropping the scenario. The per-scenario error path matches today's reference-validation semantics exactly (the bad scenario survives selection, runs no agents, aggregates `pass: false`, re-surfaces each iteration), so reports stay consistent and one bad scenario doesn't mask the rest. A hard throw would diverge from that and mask other scenarios.
- **Traces to:** Requirements 1, 4; Acceptance 1, 2, 3.

### Decision: Hand-rolled `# Skills` parser, no new dependency

- **Choice:** A small regex-based parser, matching house style (cf. `skill-loader.ts`'s `MD_LINK_RE`), with the rules in Interfaces above (first matching heading at any depth `d`; collect to the next heading at the **same-or-shallower depth** — `≤ d` — so deeper sub-headings nest inside the section rather than truncating it; list items only; strip backticks/links; empty-section valid; first heading wins).
- **Alternatives:** Add a Markdown-parsing dependency.
- **Trade-offs:** The repo has no Markdown parser and only one structured element to extract; the rest of the file must stay opaque (req. 3). A full parser is overkill and adds a dependency for a one-section extraction. The hand-rolled parser is forgiving (any heading depth, prose ignored) so authors aren't broken by minor formatting.
- **Traces to:** Requirements 3, 4; Acceptance 2, 3, 4.

### Decision: Project-configurable judge capabilities via a typed descriptor over the existing passthrough

- **Choice:** Introduce an optional, role-scoped `JudgeCapabilities` descriptor on `InvokeParams` (set only for the judge call). The project supplies capability keys on the judge agent definition (riding the existing open agent-key passthrough); the pipeline assembles them into the typed descriptor; each provider translates it to its native surface. Core's default is read-only. WordPress/browser tooling lives only in the project's config.
- **Alternatives:** (a) Pure untyped per-agent keys each provider reads ad hoc. (b) A fixed core enum of capability "profiles."
- **Trade-offs:** The open agent-key seam already exists and is how `effort`/`network` flow today, so this is low-friction and backward-compatible (absent → today's role default). A thin typed descriptor gives providers one contract to translate against, avoiding per-provider drift (the weakness of (a)). A fixed profile enum would re-prescribe what the judge can do, violating req. 7's "projects differ." Providers that can't honor a capability degrade safely to read-only.
- **Traces to:** Requirements 6, 7; Acceptance 5, 7.

### Decision: No-modify guarantee via a copied workspace, with a diff-guard backstop

- **Choice:** Before the judge runs, copy the testing agent's `workspace/` to a sibling `judge-workspace/` (`fs.cpSync`) and run the judge with `cwd` set to the copy. The canonical `workspace/` (the artifact under evaluation, the source reports/improver read) is never exposed to the judge. Additionally, snapshot the canonical workspace immediately before and after the judge phase (using `snapshotWorkspace`/`diffSnapshots`, which must first be extracted from their current private home in `testing-agent.ts` into a shared module — a small refactor, see Components); if it changed, log a loud warning / mark the pair failed. If the project builds its live env from the produced files, it builds from the **judge copy** so "what the judge sees == what it verifies."
- **Alternatives:** (a) Read-only file tools only. (b) Diff-detect only (no copy).
- **Trade-offs:** Read-only tools alone don't hold: granting the judge Bash lets it write files via the shell (`echo > file`, `sed -i`), and Codex `read-only` blocks live commands entirely. Diff-detect alone detects corruption after the fact but doesn't prevent it. The copied workspace makes the guarantee **structurally impossible to violate** while preserving full live power, and it is the only option that holds uniformly across claude-code and codex without depending on each SDK's sandbox subtleties. The diff-guard is a cheap tripwire (and protects against a future regression if the copy step is ever dropped — Risk R2). Cost: an extra workspace copy per pair (a few lines, acceptable).
- **Traces to:** Requirement 8; Acceptance 6.

### Decision: Keep the judge per-(scenario, agent); env via project hooks; serialize the whole judge bracket under a serial/parallel knob

- **Choice:** Keep the judge inside `runAgentPair` per pair (where it is today), now with live tools and the copied workspace. The project owns env setup/teardown in hooks — for any env built from the produced artifacts, in the per-pair `beforeJudgeAgent`/`afterJudgeAgent` (forced by timing). Add an optional judge-concurrency knob (default `parallel`). When `serial`, the **serialized critical section is the entire per-pair judge bracket** — `beforeJudgeAgent` + the judge invocation + `afterJudgeAgent` — held under a single run-wide mutex, **not** merely the judge call. Because the env lives in the bracketing hooks (not in `runJudgeAgent`) and the pipeline parallelizes over both scenarios (`pipeline.ts`) and agents (`agent-loop.ts`), the mutex must span both fan-outs so no two pairs run their env-up/verify/env-down concurrently.
- **Alternatives:** (a) Force one env per pair in core. (b) Always serialize judges. (c) Per-iteration shared env via `beforeAllScenarios`. (d) Serialize only the judge *invocation* (`runJudgeAgent`).
- **Trade-offs:** Per-pair judging preserves the per-(scenario, agent) verdict the whole report/improver pipeline expects. A per-iteration shared env in `beforeAllScenarios` is **infeasible** for any env built from produced artifacts — workspaces/plugins don't exist until the testing agent runs inside the scenario sweep (Risk R6); `beforeJudgeAgent` is the only point where the artifact exists and the env can be up before the judge. Forcing one env per pair is heavy (N environments/ports) and nudges env policy Skillsmith doesn't own. Always serializing needlessly loses parallelism for projects with isolated or no envs. **Serializing only the judge invocation (alt. d) is unsound:** the shared env is started in `beforeJudgeAgent` and stopped in `afterJudgeAgent`, which sit outside `runJudgeAgent`, so two concurrent pairs would both run `env:start` (for `testing-project`, `wp-env start` on port 8987 keyed by the shared `WP_ENV_HOME`) before either judge call acquires the lock — the second start rewrites the first's wp-config (R7). The only correct unit is the whole bracket. The optional knob (default `parallel`) preserves today's behavior, lets the project pick its env model, and bracket-serialization is the minimal core addition that actually resolves shared-env cross-talk.
- **Traces to:** Requirements 6, 10; Acceptance 5.

### Decision: `{ pass, notes }` verdict mapped onto the existing classifier with a one-line fix

- **Choice:** The judge emits exactly `{ pass, notes }`; `notes` is the single freeform detail carrier (no structured breakdown). Map it onto the existing `classifyVerdict` `pass` branch and add a one-line fix to surface `notes` on FAIL. Add a lenient JSON fallback to `parseJudgeJson`. Update the mock provider's verdict JSON to `{ pass, notes }`.
- **Alternatives:** (a) A brand-new verdict classifier path. (b) Strict JSON parse only. (c) Remove the `afterAllScenarios` verification gate machinery.
- **Trade-offs:** The simplified `{ pass, ... }` branch already exists and `verify.test.ts` already exercises `{ pass: true }`, so teaching the existing branch to surface `notes` is the smallest correct change — a rewrite is unjustified. A freeform `JUDGE.md` raises the odds the judge wraps its JSON in prose; strict-parse-only fails safe to FAIL but loses the verdict, which the lenient last-balanced-`{...}` fallback avoids cheaply (Risk R8). The `afterAllScenarios` gate is generic and costs nothing unused, so removing it would be scope creep against a still-useful extension point; it is kept. The reporting/improver wiring already carries `review` verbatim, so req. 11/12 need no rework.
- **Traces to:** Requirements 9, 11, 12; Acceptance 8, 9.

### Decision: Remove `Paths.rubrics`, `nameSource`, and the duplicate-name guard

- **Choice:** Drop `rubrics` from `Paths`/`DEFAULT_PATHS` and the `checkPaths` loop (now `['skills','scenarios']`). Delete `nameSource` (field, type, provenance) and `validateConfiguredScenarioNamesAreUnique` (and its call). Trim the `Scenario` fields `description`/`prompt`/`acceptance`/`rubrics`. The `{rubrics,acceptance}` fallback in `classifyVerdict` becomes dead but is left in place (harmless).
- **Alternatives:** Keep a compatibility shim for `rubrics`; keep a minimal collision guard.
- **Trade-offs:** This is a clean break (no backward compatibility per spec). `name === id` makes names unique by construction, so the duplicate guard is unreachable — keeping it would be dead code. `Scenario`/`Paths` are public exported types, so trimming them is a public breaking change, covered by the `minor` + `BREAKING:` changeset. Researcher confirmed zero dangling reads to the trimmed fields. Leaving the dead `{rubrics,acceptance}` classifier branch avoids touching verdict logic beyond the one needed fix.
- **Traces to:** Requirements 2, 15; Acceptance 10.

### Decision: Keep the role-prompt mechanism; `testing-project` inlines the rubric per `JUDGE.md`

- **Choice:** Keep `roles.test.prompt` / `roles.improver.prompt` as a generic core feature (it is **not** part of the removed "linked inputs"). In `testing-project`, shared workspace/scaffold instructions stay as `roles.test.prompt`; each `TESTING-AGENT.md` holds the per-scenario prompt + `# Skills`. The shared rubric is **inlined** into each `JUDGE.md` (not referenced).
- **Alternatives:** Inline the shared testing instructions into every `TESTING-AGENT.md`; reference the shared rubric from each `JUDGE.md`.
- **Trade-offs:** The role-prompt mechanism already exists and avoids duplicating shared instructions across 11 files; removing it would be a needless core change. Referencing an external rubric from `JUDGE.md` is fragile: Skillsmith treats `JUDGE.md` as opaque and does **not** resolve links inside it, and the judge's `cwd` (the deep judge-workspace) can't reliably reach project-root `eval/rubrics/`. Inlining the ~37-line rubric into each `JUDGE.md` (~400 lines duplicated total) is the only robust, self-contained option and what the spec prefers. A project may keep a source-of-truth rubric + a generator that stamps it in (project convenience, not a Skillsmith concept).
- **Traces to:** Requirements 3, 13, 14; Acceptance 4, 11.

### Decision: `testing-project` — per-pair WP env in `beforeJudgeAgent`, serial judges, Bash + Playwright MCP, env-var facts

- **Choice:** `testing-project` brings the WP env up in `beforeJudgeAgent` (build the plugin with `wp-scripts`, boot wp-env on the fixed port 8987, activate the plugin, create a test post) and tears it down in `afterJudgeAgent`, lifting the proven boot/build logic from the now-removed `verify-e2e.ts`. It sets judge concurrency to `serial`, which (per the concurrency decision above) holds the run-wide mutex across the **whole** `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket — so only one pair at a time runs `wp-env start`/verify/`wp-env stop` on the single shared `WP_ENV_HOME`/port 8987. It configures the claude-code judge with **Bash + a Playwright MCP server** (`mcpServers: { playwright: { command:'npx', args:['@playwright/mcp@latest'] } }`). Per-pair runtime facts (URL/port/slug/post id) reach the judge via **env vars** set in `beforeJudgeAgent` (e.g. `SKILLSMITH_JUDGE_URL`, `SKILLSMITH_PLUGIN_SLUG`, `SKILLSMITH_POST_ID`), which `JUDGE.md` references by convention. Scenarios stay flat with their current slug-safe names.
- **Alternatives:** Per-iteration shared env in `beforeAllScenarios`; per-pair env + parallel via `WP_ENV_HOME`/port isolation; `serial` that gates only the judge call (not the env hooks).
- **Trade-offs:** A per-iteration shared env is infeasible by timing (artifacts don't exist at `beforeAllScenarios`). Vanilla wp-env cannot run two instances concurrently on one `WP_ENV_HOME` — a second start rewrites the first's wp-config (Risk R7) — so per-pair env + parallel judges is unsafe without `WP_ENV_HOME`/port-per-pair isolation, which is heavy and the project's burden (req. 10). A `serial` knob that gated only the judge call would still let two pairs' `beforeJudgeAgent` hooks both run `wp-env start` before either judge ran, so it must gate the whole bracket (see the concurrency decision). Per-pair env + **bracket-serial** judges is the only safe combo with vanilla wp-env, and the spec's testing posture (req. 16: pipeline runs at most one scenario × one agent; full runs are manual) means parallelism is not load-bearing. Bash covers `curl` of the rendered page + `wp-env run cli` for server-rendered/HTML/directive checks; Playwright MCP drives a real browser for interactive checks (the analog to the deleted e2e specs). All WP/browser specifics stay in `testing-project` (req. 14). Env vars are the path of least resistance for per-pair facts because `JUDGE.md` is static/opaque and there is no per-pair seam to mutate the judge user message. (Codex judges inherit only allow-listed/`CODEX_`-prefixed env keys — use a prefixed var if ever run on Codex; Risk for other providers.)
- **Traces to:** Requirements 5, 10, 13, 14; Acceptance 5, 7, 11.

## Dependencies

### Internal (existing, relied on)

- `snapshotWorkspace` / `diffSnapshots` (existing metadata-only helpers) — currently **private/unexported inside `src/pipeline/testing-agent.ts`**; to reuse them for the judge diff-guard they must first be extracted/exported into a shared module (a small refactor — see New components), then used unchanged.
- The open `[key: string]: unknown` passthrough on `AgentDefinition` — the seam judge capabilities ride.
- `roles.test.prompt` / `roles.judge.prompt` — kept; carry shared testing instructions and the judge output-format/role prompt.
- The `afterAllScenarios` verification gate (`VerificationResult`/`applyVerification`/`normalizeVerification`) — kept as a generic optional gate.
- The per-pair `beforeJudgeAgent`/`afterJudgeAgent` hooks and `AgentContext` (`agent`, `agentWorkspace`, `scenario`) — the env-ownership seam.

### External / SDK levers (existing, newly used by the judge)

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — `tools`, `disallowedTools`, `mcpServers`, `canUseTool`/permissions; already a dependency.
- **Codex SDK** (`@openai/codex-sdk`) — `sandboxMode`, `networkAccessEnabled`, `CodexOptions.config` for MCP; already a dependency.
- `fs.cpSync` (Node built-in) — workspace copy.

### New dependencies introduced

- **Core:** none. No new npm dependency; the `# Skills` parser is hand-rolled and capability translation reuses existing SDK options.
- **`testing-project` (new):** a Playwright MCP server (`@playwright/mcp`, invoked via `npx`) configured on the judge agent. WordPress env tooling (`@wordpress/env`, `wp-scripts`) already present and retained. Playwright **test/e2e** deps are **removed**.

## Failure Modes and Observability

- **Malformed scenario folder** (one brief missing, missing `# Skills`, unknown skill id) → per-scenario `error` string at enumeration; the scenario surfaces in the report with its error, runs no agents, aggregates `pass: false`, shows as skipped, and re-surfaces each iteration. No throw; the rest of the run proceeds.
- **Judge produces unparseable output** → `parseJudgeJson` tries strict parse, then the lenient last-balanced-`{...}` fallback; if both fail, `runJudgeAgent` returns `{ error: 'unparseable', raw }` and `classifyVerdict` FAILs it with `raw` retained. The verdict is lost for that pair but the run does not crash (Risk R8). The output instruction firmly says "output only the JSON object"; manual review of early runs is recommended.
- **Judge mutates the canonical workspace** → structurally prevented by judging the copy; the snapshot diff-guard around the judge phase additionally detects any change to the canonical `workspace/` and logs a loud warning / fails the pair (Risk R2 tripwire).
- **Project mis-wires env at the wrong hook** (e.g. `beforeAllScenarios` for an artifact-dependent env) → the judge runs against an empty/missing env and fails the pair; the design and the `testing-project` example make `beforeJudgeAgent` explicit (Risk R6).
- **Shared env + `parallel` judges** → cross-talk on the shared env produces flaky/incorrect verdicts (for wp-env, the second concurrent `wp-env start` rewrites the first's wp-config). Mitigated by setting the knob to `serial`, which `testing-project` does; the serialized unit is the **whole** `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket (env up/verify/down), held under one run-wide mutex across both fan-outs — gating only the judge call would not prevent two `beforeJudgeAgent` hooks from racing on `env:start` (Risk R4/R7).
- **Observability:** the `{ pass, notes }` verdict is stored verbatim under `review` in each pair's `report.json`; the console summary and progress tracker render the verdict (notes surfaced on FAIL via the `classifyVerdict` fix); the improver receives the verbatim notes. Env-setup failures surface through the hook (e.g. a thrown `execSync` error) and through the failing judge verdict.

## Risks and Open Questions

### Risks (carried forward from research)

- **R1 — Codex judge live verification.** With `approvalPolicy: 'never'`, Codex `read-only` appears to block command execution, so a live Codex judge needs `workspace-write`, which reintroduces write capability; the no-modify guarantee for Codex then rests entirely on the copied workspace, not the sandbox. The exact never+read-only exec behavior was not settled by a live experiment — consider a Codex spike before depending on it.
- **R2 — Bash escapes a tool-surface no-write.** Any provider granting the judge Bash can write via the shell; the guarantee relies on the copied workspace, not the tool surface. If the copy step is ever dropped, the guarantee regresses — the diff-guard is the tripwire.
- **R3 — vercel/api providers + Bash.** vercel Bash is unsandboxed `execSync` with harness privileges; a judge on an api provider with Bash is an unsandboxed host shell. Document that live judging is intended for claude-code/codex; api providers stay text + local-fs.
- **R4/R7 — Concurrency + shared env / wp-env.** A shared live env with `parallel` judges cross-talks; vanilla wp-env cannot run concurrent instances on one `WP_ENV_HOME` (a second `wp-env start` rewrites the first's wp-config). The `serial` knob mitigates **only if it serializes the whole `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket** — because the env up/down lives in those hooks, not in the judge call, and the pipeline fans out over both scenarios and agents; a knob that gated only the judge invocation would still race on `env:start`. `testing-project` uses `serial`; the default (`parallel`) must be chosen carefully and a project must pick a coherent env+concurrency combo.
- **R5 — Manual-testing posture.** Per req. 16, pipeline agents must not run the self-improvement loop or depend on a green full-suite run; at most one scenario × one agent as a sanity check. Deterministic parts (parsing/validation/discovery/reporting wiring) are covered by unit/integration tests; live judge behavior is verified manually. Downstream phases must honor this.
- **R6 — Env timing.** A live env built from produced artifacts MUST be set up in `beforeJudgeAgent` (per pair), not `beforeAllScenarios`. The design and the `testing-project` example must make this explicit.
- **R8 — Freeform judge parse robustness.** A freeform `JUDGE.md` raises the chance the judge wraps its `{ pass, notes }` JSON in prose; strict parse fails safe to FAIL (verdict lost). The lenient fallback mitigates but is not bulletproof; the output instruction must firmly require JSON-only.
- **R9 — Freeform brief quality.** With Skillsmith no longer prescribing verification structure, a vague `JUDGE.md` yields a vague verdict. Not a code risk; a usage/quality risk the docs should address (guidance on writing good judge briefs).
- **R10 — README/docs drift.** README + `docs/index.html` are heavily coupled to the old rubrics/acceptance/e2e model and need a substantial rewrite (not line edits) to avoid documenting a model that no longer exists. Scope it as a real component in the docs phase.

### Open Questions (deferred to plan/implementation; none load-bearing for the architecture)

- **Q1 — Exact final filenames.** `TESTING-AGENT.md` / `JUDGE.md` are the spec's working names, used as named constants. Confirm with the owner if a different convention is wanted.
- **Q4 — Final `JudgeCapabilities` / `McpServerConfig` core shape** and whether to add the typed agent-input fields (`tools`/`mcpServers`/`allowWrite`/`network`) for DX or rely purely on passthrough. Decision: typed + permissive; pin exact field names + `McpServerConfig` reuse in the plan.
- **Q6 — Judge-copy wiring.** Whether to surface the judge-copy workspace path on a context field for env hooks (so the project doesn't re-derive it), and whether the judge's `cwd` is the copy with the env built from the same copy. The copy + judge-cwd + env source must reference the **same** path; pin the exact wiring in the plan.
- **Q7 — Judge user message.** Whether to still inline the produced files into the judge user message or rely entirely on the judge's own Read/Bash tools now that it is live. Not load-bearing; pin in the plan.
- **Q8 — `counter` scenario.** Rename its folder to `counter-block` (preserve the old name) or accept the new slug `plugin-counter-<agent>` (the e2e spec hardcoding it is deleted). Trivial; decide during conversion.
- **Q9 — `summarizeFailures` cleanup.** Whether to simplify its now-dead rubric/acceptance counting or leave it (harmless). Cleanup only, not load-bearing.

(Q2, Q3, Q5 from the research record are resolved: `Paths.rubrics` and `checkPaths` are settled; `nameSource` + duplicate guard are removed; the concurrency knob defaults to `parallel` with `testing-project` set to `serial`.)
