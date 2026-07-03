# Design Research: More flexible scenario definition and judge-verified behavior

> Spec: `1-spec/spec.md`. Intent: `0-intent/intent.md`.
> This document is the running record of the design Q&A driven by the analyst,
> with evidence supplied by the researcher. Decisions live under `## Topics`.

## Orientation (analyst's own reading of the codebase)

Key files the design touches (read directly by the analyst before the Q&A):

- `src/scenarios/enumerate.ts` — today walks scenario dirs, parses `scenario.yaml`,
  validates `skills[*]` (resolve to `<skills>/<id>/SKILL.md`) and `rubrics[*]`
  (resolve to `<rubrics>/<id>.md`). Produces `EnumeratedScenario { scenario, id, dirName, nameSource, error? }`.
- `src/config/types.ts` — `Scenario { name, description, skills[], prompt, acceptance[], rubrics[], [k] }`.
  Hook lifecycle incl. `afterAllScenarios` (the one hook whose return is consumed),
  `VerificationResult { pass?, failures?, details? }`, `RunScenario`, `AgentContext` (has `agentWorkspace`).
- `src/pipeline/testing-agent.ts` — builds testing system prompt: `skillBlob` (loadSkill per id) +
  workspace constraint + workspace contents + recursion guard + `roles.test.prompt`. User msg = `scenario.prompt`.
  Dispatches `provider.invoke({ role: 'testing' })`. Tracks `filesWritten` via mtime/size snapshot diff.
- `src/pipeline/judge-agent.ts` — builds judge system prompt from rubric blobs + acceptance items +
  a strict JSON output instruction (`{ rubrics, acceptance }`). User msg = produced files + scenario.description.
  Dispatches `provider.invoke({ role: 'judge' })`. Parses single JSON object. **Read-only today.**
- `src/pipeline/agent-loop.ts` — single writer of per-agent `report.json` (`{ testing, review }`).
  Runs testing then judge; skips judge if testing errored. Classifies verdict via `classifyVerdict`.
- `src/reports/verdict.ts` — `classifyVerdict(raw)` → PASS / FAIL{failures[]} / SKIPPED. Already handles a
  simplified `{ pass, failures }` shape AND the raw `{ rubrics, acceptance }` shape.
- `src/improvement/context.ts` — builds improver context: projects iteration report (drops `testing` blocks,
  keeps verbatim `review`), concatenates skill files for failing scenarios (`collectSkillIds` via `scenario.skills`).
- `src/providers/types.ts` — `Role = 'testing' | 'judge'`. `InvokeParams { agent, systemPrompt, prompt, cwd, role }`.
- `src/providers/claude-code.ts` — `TOOLS_BY_ROLE = { testing: [Read,Write,Edit,Glob,Grep,Bash], judge: [Read] }`.
  Maps role → SDK `tools`. `permissionMode: bypassPermissions`.
- `testing-project/skillsmith.config.ts` — uses `beforeTestAgent` to scaffold plugin, `afterAllScenarios`
  to run Playwright e2e and fold failures into the verdict. Judge = opus (read-only).
- `testing-project/eval/scenarios/<id>/{scenario.yaml,e2e.spec.mjs}` — current per-scenario inputs.
- `testing-project/eval/{rubrics,prompts}/`, `testing-project/global-setup.mjs`, `playwright.config.ts`.

## Research

<!-- Non-trivial findings from the researcher, with sources cited. -->

### Config surface (analyst-confirmed) — capability passthrough + rubrics removal

- **Config validation is hand-rolled** (`src/config/validate.ts`, no zod for config). `validateAgentEntry` (validate.ts:72-89)
  checks only `model` + `provider`; it does **NOT** reject unknown agent keys. So `tools`/`mcpServers`/`network`/`allowWrite` on a
  judge agent pass validation untouched. `normalizeConfig` spreads `{ ...def, id }` (normalize.ts:24-26), carrying every extra key
  into `AgentDefinition`. **Conclusion: judge capabilities ride the existing open-key passthrough; no config-schema change needed**
  (confirms Decision 2A's low-friction claim). `validateSingleRole` already supports judge `{ agent, prompt? }` — capabilities live
  on the agent def, not the role, so no role-validation change.
- **Rubrics removal scope (config):** `DEFAULT_PATHS` (defaults.ts:3-8) includes `rubrics: './eval/rubrics'`; `Paths` type
  (types.ts:87-92) has `rubrics: string`; `normalizeConfig` merges `paths: { ...DEFAULT_PATHS, ...input.paths }` (normalize.ts:45);
  `checkPaths` (pipeline.ts:551) iterates `['skills','scenarios','rubrics']`. Clean break: drop `rubrics` from `Paths`,
  `DEFAULT_PATHS`, and the `checkPaths` loop. (Researcher Topic-4 inventory will confirm the rest.)

### Provider tool/sandbox model (analyst-confirmed, pre-research)

- Only two providers constrain tools by role today:
  - `src/providers/claude-code.ts:14` — `TOOLS_BY_ROLE = { testing: [Read,Write,Edit,Glob,Grep,Bash], judge: ['Read'] }`.
    The judge is **read-only with no Bash** — it cannot run commands or exercise a live env today. `permissionMode: 'bypassPermissions'`.
  - `src/providers/codex.ts:16` — `SANDBOX_BY_ROLE = { testing: 'workspace-write', judge: 'read-only' }`.
- API providers (`anthropic-api`, `openai-api`, `gemini-api`) do not reference `role` and expose no file-mutation tools.
- Implication: today the judge's "cannot modify files" guarantee is enforced *by the per-provider read-only tool surface*,
  which also blocks live verification. The new design must let the judge run live (commands/UI) while still not writing the
  produced files — these two needs pull against each other and the resolution is a key decision (judge-capabilities topic).

### Verdict flow chokepoint (analyst-confirmed)

- `src/reports/verdict.ts::classifyVerdict` is the single place PASS/FAIL is derived from the judge `review` payload.
  It already accepts a simplified `{ pass: bool, failures?: [...] }` shape (verdict.ts:29-50) in addition to the legacy
  `{ rubrics, acceptance }` shape. A new `{ pass, notes }` verdict maps onto the existing `pass` branch with minimal change.
- `src/reports/scenario-report.ts::aggregateScenarioReport` passes each agent's `review` through verbatim and computes
  scenario `pass` via `classifyVerdict(...).kind === 'PASS'`. The improver context (`src/improvement/context.ts`) forwards
  the verbatim `review` to the improver. So a `{ pass, notes }` verdict already flows to reports + improver if `classifyVerdict`
  understands it.

### Claude Agent SDK capability surface (analyst-confirmed from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

The SDK `Options` already exposes everything needed for project-configurable, role-scoped judge capabilities + a no-modify guardrail:

- `tools?: string[] | { type:'preset'; preset:'claude_code' }` (sdk.d.ts:1235) — the **base built-in tool set**. `[]` disables
  all built-ins. The current provider passes `tools: TOOLS_BY_ROLE[role]` (claude-code.ts:84). This is the lever for "which
  built-in tools the judge has" (e.g. `['Read','Bash']` to run commands but no `Write`/`Edit`).
- `mcpServers?: Record<string, McpServerConfig>` (sdk.d.ts:1469) — attach project-configured MCP servers (e.g. a Playwright/
  browser MCP) keyed by name; config shape `{ command, args }` (also http/sse variants). **This is the clean path for
  "project-configurable capabilities" that keeps WP/browser specifics out of core.**
- `allowedTools?: string[]` (auto-allow without prompt), `disallowedTools?: string[]` (removed from context entirely,
  sdk.d.ts:1208/1228), and `canUseTool?: CanUseTool` (sdk.d.ts:1213) — a **per-tool permission callback** invoked before each
  tool execution to allow/deny. `canUseTool` is the seam for a guardrail that denies any write targeting the produced files.
- `permissionMode: 'bypassPermissions'` is already used (claude-code.ts:86); SDK requires `allowDangerouslySkipPermissions: true`
  with it (already set).
- Implication: judge capabilities become a role-scoped bundle `{ tools?, mcpServers?, disallowedTools? }` the project supplies;
  core supplies a safe default (Read-only). The no-modify guarantee is layered: (a) omit `Write`/`Edit` from the judge's `tools`;
  (b) optionally a `canUseTool`/post-run snapshot guard for the Bash-can-write hole.

### Topic 1 findings — discovery + `# Skills` parsing (researcher, file:line)

- **`scenario.name` is the load-bearing join key**, not cosmetic: artifact dir `iteration-N/<name>/...` (pipeline.ts:485);
  report keys (scenario-report.ts:97); progress rows (pipeline.ts:121-124); re-run selection (select-scenarios.ts:47,57,62);
  improver name→scenario map (context.ts:130); duplicate-name guard (selection.ts:167); log/judge/testing scopes.
- **Today `name` can diverge from folder id**: `counter/scenario.yaml` → `name: counter-block`, folder `counter`.
  The new model has no `name:` key, so a name must be synthesized — `id` (folder path) is the natural choice → `name === id === dirName`.
  Then uniqueness is automatic (ids unique by construction) and the duplicate-name guard's reason mostly evaporates.
  Caveat: nested ids contain `/`, and `name` is used as a path segment (pipeline.ts:485) — but that already happens today
  because nested `dirName === id`, so it's pre-existing, handled behavior.
- **Fields consumed downstream:** `name`, `skills`, `prompt` (testing user msg), `description` (judge msg only — judge-agent.ts:181),
  `acceptance` (judge sys prompt only), `rubrics` (judge sys prompt only), `id`/`dirName` (selection/filter only).
  **Structurally required after change:** `name` + `skills` + the two prose blobs. **Dead after change:** `description`,
  `acceptance`, `rubrics`, and the `nameSource` `configured`/`synthetic` distinction.
- **No markdown parser in the repo** (deps: only `yaml`, `zod`, AI SDKs). `# Skills` extraction is a small hand-rolled parse;
  house style is small regex (cf. `skill-loader.ts` `MD_LINK_RE`). Edge cases to settle: heading depth (spec fixes `# Skills` = h1),
  item formats (`- id`, backticks, md-links, trailing prose), where the section ends, empty section, multiple `# Skills`, CRLF.
- **Skill-id validation today:** enumerate.ts:91-95 checks `existsSync(<skills>/<id>/SKILL.md)`; missing → `error: "unresolved
  reference: skill \"x\""` on the EnumeratedScenario (NOT a throw). `loadSkill` (skill-loader.ts:12-19) throws if SKILL.md absent,
  so the enumeration check is the guard that keeps loadSkill from throwing at runtime — must stay consistent on the same
  `<skills>/<id>/SKILL.md` contract.
- **Error propagation:** errored scenarios are kept, not dropped — survive selection every iteration (select-scenarios.ts:46),
  skip agent execution but still aggregate with `scenarioError` (pipeline.ts:510,526-530), force `pass:false`
  (scenario-report.ts:86), shown as skipped in progress (pipeline.ts:321-323). So an unknown-skill scenario fails the run,
  appears in the report with its error, runs no agents, and re-surfaces each iteration.
- **Missing `# Skills`** (acceptance #2) is a new failure mode; researcher recommends matching the existing per-scenario `error`
  pattern (keeps run going, surfaces in report) rather than a hard throw.
- **Selection layer** depends only on `id` (selection.ts) and `name`+`nameSource` (duplicate guard); folder discovery interacts
  cleanly. Discovery rule should be "both prose files present" so non-scenario files like `_candidates.yaml` are ignored.
- **Test/fixture surface:** 8 `scenario.yaml` fixtures + scenarios/selection/report tests + `smoke-project`/`target-project`
  fixtures assert on `dirName`/`nameSource`/`scenario.name` — all need updating for the new model.

### Topic 2 findings — judge live verification, capabilities, no-modify (researcher, file:line + SDK)

- **Three independent provider-side no-write gates today** (must all be reconciled): claude-code `TOOLS_BY_ROLE.judge=['Read']`
  (claude-code.ts:14-17 → SDK `tools`); codex `SANDBOX_BY_ROLE.judge='read-only'` (codex.ts:16-19 → `sandboxMode`); vercel
  `fsTools(cwd,role)` returns only `{Read}` for judge (fs-tools.ts:292). `mock` ignores tools. Same gates are why the judge
  can't do live checks today.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk@0.2.141`): `tools` = base built-in set; `disallowedTools` removes tools
  even if otherwise allowed; `permissions: { allow/deny/ask }` supports command-pattern granularity (`Bash(npm run build:*)`,
  `Edit`, `Write`); `canUseTool` per-call callback for programmatic allow/deny; `mcpServers: Record<name,McpServerConfig>` for
  project MCP servers (stdio `{command,args,env}`, e.g. Playwright MCP). `additionalDirectories`/`permissions.additionalDirectories`
  widen FS scope beyond cwd. **Bash can write files** → granting Bash defeats a pure tool-surface no-write guarantee.
- **Codex SDK** (`@openai/codex-sdk@0.128.0`): `SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`. ThreadOptions
  expose `sandboxMode`, `networkAccessEnabled`, `webSearchMode`, `additionalDirectories` (already maps `agent.network`/`agent.webSearch`,
  codex.ts:174-179). **No typed `mcpServers`** — Codex MCP/sandbox-net config goes via `CodexOptions.config` (TOML `--config` overrides).
  With `approvalPolicy:'never'` (codex.ts:79), `read-only` effectively **blocks command execution** → a Codex judge needs at least
  `workspace-write` to run live commands, which **reintroduces workspace write capability**. So Codex cannot give "run commands but
  provably can't write" via sandbox alone. (One OpenAI-doc ambiguity on never+read-only exec behavior was NOT settled by live
  experiment — flagged as a Risk.)
- **Config→provider seam already exists:** `config.roles.judge.agent` is an `AgentDefinition` with open `[key:string]: unknown`
  (types.ts:37-42); providers already read extra keys (codex `extraThreadOptions` reads `effort`/`network`/`webSearch`, codex.ts:167-181;
  vercel reads `agent.providerOptions`). So a project can put capability keys on the judge agent in `skillsmith.config.ts` and the
  provider translates them — no mandatory core type change. `config.roles.judge.prompt` is a separate already-wired role prompt
  (judge-agent.ts:142-145).
- **`InvokeParams` blast radius** if we add an optional capability field: claude-code MUST translate (→tools/disallowedTools/
  mcpServers/permissions); codex MUST translate (→sandboxMode/networkAccessEnabled, +`config` for MCP); vercel-runner MUST handle
  IF those providers should do live checks — realistically they stay text+local-fs (safe default: ignore field, keep `fsTools(role)`);
  anthropic/openai/gemini-api are thin runVercel wrappers (no change); mock ignores it. **Optional field, absent = today's role default
  → backward-compatible.** Caveat: vercel Bash is unsandboxed `execSync` with harness privileges (fs-tools.ts:7-9) — giving judge Bash
  there = unsandboxed shell.
- **No-modify guarantee (acceptance #6):** judge shares the testing agent's workspace exactly — `cwd: agentWorkspace`
  (judge-agent.ts:69-70), the same dir the testing agent wrote (agent-loop.ts:142-144). Options: (a) read-only file tools + Bash/MCP —
  **Bash circumvents** (`echo>file`, `sed -i`); claude-code `permissions.deny` helps but is brittle; Codex read-only blocks live cmds.
  (b) judge against a **copy/snapshot** of the workspace — no copy helper in repo today (`snapshotWorkspace`/`diffSnapshots` are
  metadata-only), but `fs.cpSync`/`cp -r` is a few lines; strongest *prevention*, provider-agnostic; judge verifies the copy.
  (c) **diff-guard**: run `snapshotWorkspace`+`diffSnapshots` around the judge to *detect* mutation and flag/fail. Acceptance #6 is a
  post-condition satisfiable by prevention (b) or detection+guarantee (c); (b) is the only option that holds uniformly across
  claude-code AND codex without sacrificing live power.
- **Lifecycle/hooks:** per-pair `beforeJudgeAgent`/`afterJudgeAgent` are `HookFn<AgentContext>` (fire-and-forget, return ignored;
  AgentContext has `agent`,`agentWorkspace`,`scenario`,run ctx; fired agent-loop.ts:224-230,270-276). Per-iteration `beforeAllScenarios`
  (fire-and-forget) and `afterAllScenarios` (**only hook whose return is consumed**, can mark failures). Project already owns env
  up/down via `@wordpress/env` (`env:start`/`env:stop`); the current e2e gate proves the pattern in `afterAllScenarios` (verify-e2e.ts:117-172),
  but for a per-pair live judge the env must be up **while the judge runs**, i.e. earlier than `afterAllScenarios`.
- **CONCURRENCY tension:** testing+judge run **all pairs in parallel** via `Promise.all` (agent-loop.ts:94-110). The current e2e gate
  avoids cross-talk by running once-per-iteration after all pairs on one shared wp-env (single port, per-spec activate/deactivate).
  A per-pair parallel live judge against one shared env has cross-talk. Resolutions: (1) one env per pair (clean, but N parallel
  wp-env instances/ports — heavy); (2) one shared env + serialize judges (simple env, loses parallelism); (3) one shared env, judges
  coexist via per-scenario isolation (fragile). Must be an explicit design decision.

### Run lifecycle & `name`/`id` distinction (analyst-confirmed)

- `scenario.name` is the pervasive report/artifact key: iteration artifact dirs are `iteration-N/<scenario.name>/<agent>/`
  (`pipeline.ts:485`), report scenario keys, progress tracker, and `agentFilter` lookups all key off `name`.
  The folder identifier is `id`/`dirName` (e.g. `blocks/counter`), kept distinct from `name`.
- `counter/scenario.yaml` sets `name: counter-block` while the folder id is `counter` — today `name` *can* diverge from the
  folder. Removing `scenario.yaml` removes the only source of a custom `name`; the new model must decide where `name` comes from.
- `pipeline.ts::checkPaths` (line ~551) currently hard-requires `paths.rubrics` to exist as a directory — removing rubrics
  means this precondition (and the `Paths.rubrics` field) must change or the run will throw.
- The current Playwright e2e gate lives in the project's `afterAllScenarios` hook (`testing-project/skillsmith.config.ts`),
  whose `VerificationFailure[]` return is folded into the report via `src/improvement/verify.ts::applyVerification`. This is
  the precedent for "an external/live check folds a pass/fail into the per-pair verdict."

### Topic 3 findings — verdict shape + report/improver flow (researcher, file:line)

- **Judge prompt/parse (judge-agent.ts):** `buildJudgeSystemPrompt` (94-147) must drop rubricBlobs (99-106), acceptanceBlock
  (108-112), rubricIdList (114-116) — all read now-removed fields — and replace the strict `{rubrics,acceptance}` jsonInstruction
  (117-139) with a minimal "return exactly `{ \"pass\": <bool>, \"notes\": \"<string>\" }`" instruction (keep JSON-escaping guidance
  + recursion guard). Body becomes the verbatim `JUDGE.md` brief + that instruction; `config.roles.judge.prompt` still appends.
  `buildUserMessage` (163-183) must drop the `scenario.description` push (181); file inlining optional now the judge reads files/env.
- **`parseJudgeJson` (149-161):** parses `{pass,notes}` with NO change. BUT a freeform judge is likelier to wrap JSON in prose,
  which the anchored-fence/trim handling misses. Failure degrades safely: `runJudgeAgent` returns `{error:'unparseable', raw}`
  (82-88) → `classifyVerdict` FAILs it (53-55) — verdict lost but no crash. Recommend a lenient fallback: on strict-parse failure,
  extract the last balanced `{...}` and parse that.
- **THE GAP — `classifyVerdict` (verdict.ts):** `{pass:true,notes}`→PASS (29). `{pass:false,notes}`→pass===false branch (30);
  failures built from `v.error` (absent) + `v.failures[]` (absent in new shape) → empty → pushes `'verdict failed without detail'`
  (47-48), **dropping `notes`.** Minimal fix: in the pass===false branch, if `typeof v.notes==='string' && v.notes.length>0`, push
  `v.notes` into `failures` before the empty fallback. Keep existing `v.error`/`v.failures[]` handling. Only the collapsed dashboard
  cell is affected; full verbatim `{pass,notes}` is stored under `review` regardless.
- **Verbatim carry (no change needed):** `aggregateScenarioReport` copies `review` verbatim (scenario-report.ts:78-80), pass via
  `classifyVerdict(review).kind==='PASS'` (93); `projectReportForImprover` forwards `review` verbatim for passing AND failing agents
  (context.ts:108-113) → improver gets `{pass,notes}` unchanged (req. 12). Re-selection uses `classifyVerdict(...).kind` (pass/fail
  only) — works on `{pass}`.
- **`summarizeFailures` (verdict.ts:99-116):** freeform notes (no `rubric `/`acceptance ` prefix) hit pass-through (106) and render
  verbatim on the dashboard — already correct. Counting logic becomes dead-ish; can simplify, harmless if left. Sharp edge: notes
  literally starting with "rubric "/"acceptance " miscounted (unlikely).
- **`afterAllScenarios` folding (verify.ts):** per-pair judge verdict alone now drives matrix/exit/re-selection — no e2e gate needed.
  `VerificationResult`/`VerificationFailure`/`applyVerification`/`normalizeVerification` are fully generic; a project dropping the
  hook → clean pass, report untouched (verify.ts:28-31,103). **Keep the mechanism** as an optional extra gate; nothing strands.
- **Test surface:** `verdict.test.ts` (rewrite), `summary.test.ts` (heaviest rewrite — `{rubrics,acceptance}` fixtures + asserted
  failing-line text), `agent-loop.test.ts` (light), `scenario-report.test.ts` (minimal), `self-improvement*.test.ts` (couple to
  **mock provider** PASS_JSON/FAIL_JSON at mock.ts:22-36 — update mock to emit `{pass,notes}`), `verify.test.ts` (already `{pass:true}`
  — no change; confirms gate speaks `{pass}`).
- **Net change set:** (a) judge prompt/parse, (b) classifyVerdict FAIL-detail fix, (c) mock provider verdict→`{pass,notes}`,
  (d) rewrite verdict.test.ts + summary.test.ts + mock-dependent assertions. context.ts / scenario-report pass-through / verify.ts /
  re-selection / summarizeFailures need no behavioral change.

### Topic 4 findings — config surface + complete removal inventory (researcher, file:line)

- **Rubrics removal (config) = 4 real edits:** `types.ts:91` (`Paths.rubrics`), `defaults.ts:7` (`DEFAULT_PATHS.rubrics`),
  `pipeline.ts:551` (`checkPaths` array → `['skills','scenarios']`), `enumerate.ts:50` (`rubricsRoot`, removed with the rewrite).
  `validate.ts` does NOT validate `paths` at all → no validation change. `normalize.ts:45` auto-drops `rubrics` once out of the
  type/default. `load.ts`/`define-config.ts`/`resolve-cwd.ts` have no rubrics refs.
- **Rubric-loading code dead:** all inline in `judge-agent.ts:99-106,114-116,122-132` + `enumerate.ts:96-99`. **No standalone
  `loadRubric` util, no rubrics-enumerate.** `verdict.ts:57-88` `{rubrics,acceptance}` fallback becomes dead-ish (kept harmless).
- **`Scenario` field-trim — zero dangling reads confirmed:** `.description` only judge-agent.ts:181 + enumerate isScenarioShape;
  `.prompt` only testing-agent.ts:72 + enumerate (other `params.prompt` hits are provider `InvokeParams.prompt`, unrelated);
  `.acceptance`/`.rubrics` only judge-agent + enumerate. **No zod Scenario schema** — `isScenarioShape` (enumerate.ts:146-161) is the
  only hand-rolled guard, rewritten with Topic 1. `Scenario` is a public exported type (index.ts) → trim is a public breaking change
  (covered by the `minor`+`BREAKING:` changeset). Progress/summary/hooks read only `scenario.name`.
- **`nameSource` + duplicate-guard blast radius:** defined enumerate.ts:11,31,70,82,107,115; sole consumer selection.ts:172 inside
  `validateConfiguredScenarioNamesAreUnique` (167-190); called pipeline.ts:43,93; smoke fixture asserts `RunScenario` does NOT expose
  it. Tests: scenarios.test.ts, scenario-filter-selection.test.ts, select-scenarios.test.ts, scenario-selection.test.ts. With
  `name===id`, the duplicate guard is **provably never triggerable** → remove outright; remove `nameSource`; the two duplicate-error
  test cases become obsolete.
- **Judge capabilities ride the existing passthrough — NO config-schema change required** (confirms analyst pre-read):
  `AgentDefinitionInput` has `[key:string]: unknown`; `validateAgentEntry` checks only model+provider (rejects nothing);
  `normalizeConfig` spreads all keys; no zod in config. Precedent exact: `effort`/`network`/`webSearch`/`providerOptions` ride this
  today. A typed `capabilities`/`tools`/`mcpServers` agent field is **optional DX polish** (additive types.ts + optional validate.ts),
  not required for function.
- **Acceptance-#10 inventory (whole repo):**
  - `scenario.yaml`: 11 in `testing-project/eval/scenarios/*` + 7 test fixtures → delete/convert. Doc-comment scrubs in
    select-scenarios.ts, config/types.ts:176, README.
  - `e2e.spec.mjs`: 11 in `testing-project/eval/scenarios/*` → delete. The whole testing-project Playwright harness becomes obsolete:
    `verify-e2e.ts`, `playwright.config.ts`, `global-setup.mjs`, and the `afterAllScenarios` e2e gate (skillsmith.config.ts:54-60).
  - rubrics: `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` (+ dir) + 6 fixture rubric dirs → delete.
  - **"linked prompts" clarification:** per-scenario `prompt` is **inline in scenario.yaml today, not a linked file.** The only linked
    prompts are the **role-level** `eval/prompts/{testing-agent,improver}.md` via `roles.test.prompt`/`roles.improver.prompt`. These
    are config role prompts, **NOT** the spec's "separately-linked rubric/prompt inputs" (= the rubric files + acceptance/rubric
    linkage). Intent.md:24 wants the testing-agent prompt folded into `TESTING-AGENT.md`, but the role-prompt *mechanism* stays valid.
  - `_candidates.yaml`: backlog file, ignored by discovery; optional cleanup (header references old shape).
- **Components possibly missed:**
  - **README.md is heavily coupled to the old model** (rubrics/acceptance philosophy lines 94-96, scenario.yaml 45/54/64, the
    `{rubrics,acceptance}` review JSON example 150-171, the e2e "does it actually work" section 138). **Substantial doc rewrite**, a
    real component, not line edits. **`docs/index.html`** has 6 old-model mentions. CONTRIBUTING.md is clean.
  - `src/index.ts`/`runner.ts`: export `Scenario`/`Paths`/`VerificationResult`; `Scenario`+`Paths` shapes change (public breaking,
    changeset). `runner.ts` clean of scenario fields. No CLI flag references scenario.yaml/rubrics.
  - `testing-project/playwright.config.ts` + `global-setup.mjs` — part of the removed e2e harness; easy to overlook (not `*.spec.mjs`).
  - Role-prompt-vs-inline (`eval/prompts/`): keep the role-prompt mechanism or fold into the brief — design call (Decision below).

### Lifecycle timing + slug-safety (analyst-confirmed) — input for the testing-project topic

- **Hook order around testing→judge (agent-loop.ts):** `beforeTestAgent` (159) → testing writes plugin (171) → `afterTestAgent`
  (201) → [if testing ok] `beforeJudgeAgent` (224) → judge (237) → `afterJudgeAgent` (270). **`beforeJudgeAgent` is the first point
  where THIS pair's produced plugin exists AND the env can be brought up before the judge runs**; `afterJudgeAgent` is the teardown
  seam. Confirms per-pair env setup in `beforeJudgeAgent`/`afterJudgeAgent` is the natural fit. Note: `beforeAllScenarios` fires
  before any testing agent runs → plugins do NOT exist yet there, so a per-iteration "build all plugins then boot one env" can only
  happen AFTER the sweep (where the old e2e gate ran, in `afterAllScenarios`) — which is too late for a judge that runs during the
  sweep. This is the decisive reason the per-pair env (in `beforeJudgeAgent`) is the right model for a per-pair live judge.
- **Slug-safety (verified):** all 11 testing-project scenario folders match `^[a-z0-9-]+$`; 10 already have `name===folder`. Only
  `counter` has a divergent configured name (`counter-block`). Under `name===id`, the only change is the scaffold slug becomes
  `plugin-counter-<agent>` — trivial, slug-safe. **No folder renames needed; scenarios can stay flat** (avoiding the `/`-in-id slug
  issue). `scaffoldPlugin`'s `^[a-z0-9-]+$` guard keeps passing.

### Topic 5 findings — testing-project WP adaptation feasibility (researcher, evidence)

- **Lifecycle timing (decisive):** workspaces are mkdir'd inside `runAgentPair` (agent-loop.ts:144), which runs *inside* the scenario
  sweep — **after** `beforeAllScenarios`. The implemented plugin exists only **after the testing agent returns** (afterTestAgent /
  beforeJudgeAgent). So **a per-iteration shared env in `beforeAllScenarios` is INFEASIBLE** (no artifacts yet). The old e2e gate
  worked only because it ran in `afterAllScenarios` (post-sweep). For a per-pair live judge, **`beforeJudgeAgent` is the first (and
  essentially only) point where this pair's plugin exists AND the env can be up before the judge** — `afterJudgeAgent` is teardown.
- **CONCURRENCY blocker (decisive):** vanilla wp-env keys each project by md5 of project path under one home dir, and **starting a
  second instance rewrites the first's wp-config.php (port/URL)** → cross-talk; you cannot run two wp-env instances concurrently
  without per-instance `WP_ENV_HOME` isolation (not just distinct ports). (developer.wordpress.org packages-env; gutenberg#49843.)
  So **per-pair wp-env + parallel judges is NOT safe** on one home dir. **Recommended combo: per-pair env in `beforeJudgeAgent` +
  judge concurrency = SERIAL** (the 2C knob). Serial avoids the cross-talk, keeps wp-env vanilla; the spec's testing posture (req. 16:
  at most one scenario×one agent in pipeline; full runs manual) means parallelism isn't load-bearing. Parallelism would require the
  *project* to own `WP_ENV_HOME`-per-pair isolation (req. 10) — not core.
- **Hook mechanics:** `beforeJudgeAgent`/`afterJudgeAgent` are awaited fire-and-forget `HookFn<AgentContext>` — a synchronous
  `execSync('wp-env start')` in `beforeJudgeAgent` blocks until the env is up before the judge dispatches (the gating needed). Returns
  ignored (fine — side-effecting env management).
- **Judge→site interaction:** **Bash** (already wraps wp-cli in wp-cli.mjs) covers `curl http://localhost:8987/?p=<id>` + `wp-env run
  cli wp ...` for server-rendered/HTML/directive checks; **Playwright MCP** (`@playwright/mcp` via judge agent `mcpServers`) gives a
  real browser for interactive checks (click → assert) — the closest analog to today's e2e specs. **Recommend Bash + Playwright MCP**
  on the claude-code judge, both project-configured (no WP/browser in core).
- **Passing per-pair runtime facts (URL/port/slug/post id) to the judge:** cleanest = **env vars set in `beforeJudgeAgent`** —
  claude-code passes `env: claudeCodeEnv(process.env)` to the SDK (claude-code.ts:87), so vars like `SKILLSMITH_JUDGE_URL` are visible
  to the judge's Bash/MCP child. (Codex inherits only allow-listed/`CODEX_`-prefixed keys — use a prefixed var for codex judges.)
  JUDGE.md is opaque/static so it can't carry per-pair facts; there's no per-pair seam to mutate the judge user message today, so env
  vars are the path of least resistance. JUDGE.md states the convention ("site at `$SKILLSMITH_JUDGE_URL`, block on post `$SKILLSMITH_POST_ID`").
- **Slug-safety:** all 11 folders slug-safe; keep flat. Only `counter` (yaml name `counter-block`) diverges; under `name===id` its
  slug becomes `plugin-counter-<agent>` (e2e spec hardcoding it is being deleted) — non-issue; optionally rename folder to
  `counter-block` to preserve the name.
- **Rubric/prompt folding — INLINE, don't reference:** Skillsmith treats JUDGE.md as opaque and does **not** resolve links inside it
  (unlike `loadSkill`, which follows md-links only within the skill dir). A judge reading a referenced rubric is fragile: judge cwd is
  the deep `…/workspace`, the rubric lives at project-root `eval/rubrics/`, and read-only/sandbox scope may forbid traversal. So
  **inline the 37-line shared rubric into each JUDGE.md** (~400 lines total dup) — the only robust, self-contained option, and what the
  spec prefers. A project may keep `eval/rubrics/x.md` as a source-of-truth + a generator that stamps it into each JUDGE.md (project
  authoring convenience, not a Skillsmith concept).
- **JUDGE.md composition:** [per-scenario acceptance items] + [inlined shared rubric] + [e2e intent as plain-language live checks,
  translated from the deleted `e2e.spec.mjs`]. **TESTING-AGENT.md composition:** [shared workspace instructions] + [per-scenario
  prompt] + [`# Skills`]; the shared workspace instructions can either be inlined per scenario OR kept as `roles.test.prompt` (the
  role-prompt mechanism stays) — same dedup-vs-self-containment tradeoff as the rubric.
- **Copied-workspace wiring caveat:** the judge today runs `cwd: agentWorkspace` (the original). If `beforeJudgeAgent` builds the env
  from a copy, ensure the judge's cwd and the env build use the **same** copy, or inputs/guarantee diverge — a wiring detail to bake in.

### `testing-project` mechanics (analyst-confirmed) — input for the conversion topic

- **Per-scenario inputs today:** `eval/scenarios/<id>/scenario.yaml` (name/description/prompt/skills/acceptance/rubrics) +
  `eval/scenarios/<id>/e2e.spec.mjs` (Playwright). Shared: `eval/prompts/testing-agent.md` (workspace/scaffold instructions),
  `eval/prompts/improver.md`, `eval/rubrics/wp-interactivity-api-best-practices.md` (one rubric applied to all scenarios).
- **New two-file mapping:** each scenario's `TESTING-AGENT.md` folds `eval/prompts/testing-agent.md` (shared workspace
  instructions) + the per-scenario `prompt` + a `# Skills` section. Each scenario's `JUDGE.md` folds the per-scenario
  `acceptance`, the shared rubric (`wp-interactivity-api-best-practices.md`) text or a reference to it, and the `e2e.spec.mjs`
  intent re-expressed as plain-language live checks ("activate the plugin, load the post, click Increment, expect the number to
  rise"). Whether the shared rubric is inlined per scenario or kept as one shared file the JUDGE.md points to is a conversion
  sub-decision (DRY vs. self-contained).
- **Env ownership already in the project:** `package.json` scripts `env:start`/`env:stop` (wp-env), `eval/utils/wp-cli.mjs`
  (`wpCli`/`deactivateAllPlugins`), `eval/utils/scaffold-plugin.ts` (scaffolds `plugin-<scenarioName>-<agentId>/` with a fixed
  block `skillsmith/testing-block`), `eval/utils/verify-e2e.ts` (the to-be-removed e2e gate), `global-setup.mjs`,
  `playwright.config.ts`. wp-env builds plugins with `wp-scripts` and boots on port 8987.
- **Slug constraint interaction:** `scaffoldPlugin` requires `scenarioName` to match `^[a-z0-9-]+$` (scaffold-plugin.ts:5-8).
  With Topic-1 decision `name===id`, a **nested** id (`blocks/counter`) contains `/` and would break this. Current scenarios are
  flat with hyphenated names. Conversion must either keep scenarios flat, sanitize the id→slug (`/`→`-`), or derive the plugin
  slug from a sanitized id. Flag for the conversion topic. (Pre-existing tension is masked today because `name` was hand-set to a
  slug-safe value like `counter-block`.)
- **Judge capability config for testing-project:** the project will configure the judge with browser/live tools — most likely a
  Playwright MCP server (`{ command:'npx', args:['@playwright/mcp@latest'] }`) and/or `Bash` to run wp-cli — via the judge agent's
  capability keys (Decision 2A). WP env brought up around the judge via hooks (Decision 2C).

## Topics

<!-- One decision per topic; each traces to a spec requirement / acceptance criterion. -->

### Topic: Scenario discovery and the new two-file model (incl. `# Skills` parsing/validation)

- **Spec link:** Requirements 1, 2, 3, 4; Acceptance 1, 2, 3, 10.

- **Decision — file model & names:**
  1. **Filenames:** `TESTING-AGENT.md` (testing-agent brief) and `JUDGE.md` (judge brief), as the spec's working names. Define
     them as named constants in `enumerate.ts` so a future rename is one edit.
  2. **Discovery rule:** a directory is a scenario iff **both** `TESTING-AGENT.md` and `JUDGE.md` are present. Walk recursively
     (reuse today's `visit`/`visitChildren` so nested scenarios + parent-folder filtering keep working). A folder with only one
     of the two files is a **misconfiguration** → emit an errored scenario (see error policy) rather than silently skipping, so a
     typo'd filename is loud. Folders with neither file are not scenarios (so `_candidates.yaml` and other stray files are ignored).
  3. **`name` = `id`** (the normalized folder path, e.g. `blocks/counter`). This collapses the old name≠id divergence: `name ===
     id === dirName` everywhere. No `name:` field exists in the new model and none is synthesized from the brief.

- **Decision — new `Scenario`/enumeration shape:** the in-memory scenario record carries: `name` (=id), `skills: string[]`
  (parsed from `# Skills`), `testingBrief: string` (raw `TESTING-AGENT.md` text), `judgeBrief: string` (raw `JUDGE.md` text).
  Drop `description`, `prompt`, `acceptance`, `rubrics` from the type. `EnumeratedScenario` keeps `{ scenario, id, dirName, error? }`
  and **drops `nameSource`** (its configured/synthetic provenance no longer exists). `prompt` is replaced by `testingBrief` as the
  testing agent's user message (handled in the interfaces topic); the judge brief replaces description/acceptance/rubrics.

- **Decision — `# Skills` parsing:** small hand-rolled parser (no new dependency), matching house style. Rules:
  - Find the first heading line matching `^#{1,6}\s+Skills\s*$` (case-insensitive on the word "Skills"; accept any heading depth so
    a project that nests the section isn't broken — though `# Skills` (h1) is the documented form).
  - Collect lines until the next heading of **any** depth (`^#{1,6}\s`).
  - From that block, take list items matching `^\s*[-*]\s+(.+?)\s*$`; for each item, strip surrounding backticks and unwrap a
    Markdown link `[id](...)` to its text, then trim — yielding a bare skill id. Ignore non-list lines (prose).
  - **Empty `# Skills` section (zero ids):** valid (a zero-skill scenario), matching today's shape-valid `skills: []`.
  - **Multiple `# Skills` headings:** first wins (documented), extra ones ignored — keep it forgiving, not fatal.

- **Decision — validation & error policy (preserve today's behavior exactly):** validation happens at enumeration and produces a
  per-scenario `error` string on `EnumeratedScenario` — never a throw — so the errored scenario stays visible: survives selection,
  runs no agents, aggregates with `pass:false`, shows as skipped, re-surfaces each iteration. Error cases:
  - **Missing `# Skills` section** → `error: "missing required # Skills section in TESTING-AGENT.md"` (acceptance #2: clear, names the section).
  - **Unknown skill id** → reuse today's exact phrasing: `error: "unresolved reference: skill \"<id>\""` (validated via
    `existsSync(<skills>/<id>/SKILL.md)`, same contract `loadSkill` relies on).
  - **One brief file missing** (only `TESTING-AGENT.md` or only `JUDGE.md`) → `error` naming the missing file.
  - Multiple problems concatenate into one `error` string, as today.

- **Options considered:**
  1. *name = folder id* (chosen) vs. *parse a name/title from the brief's first `#` heading*. Rejected the latter: it reintroduces
     a parsed structural field the spec wants to avoid (req. 3 "opaque except `# Skills`"), risks duplicate/empty names, and the
     folder id is already the unique, stable handle the whole pipeline joins on.
  2. *missing `# Skills` → per-scenario error* (chosen) vs. *hard throw aborting the whole run*. Rejected the throw: it diverges
     from today's reference-validation path, would mask other scenarios, and the existing machinery already surfaces per-scenario
     errors cleanly in the report.
  3. *discovery requires both files* (chosen) vs. *discover on either file alone*. Rejected single-file discovery: a scenario is
     meaningless without both a testing brief and a judge brief, and "both present" gives a crisp, typo-resistant rule.

- **Rationale:** keeps the entire downstream join (reports, artifacts, progress, selection, improver) working unchanged by holding
  `name` stable and equal to `id`; preserves the exact error semantics the spec calls for (acceptance 2 & 3) by reusing the
  enumeration-error path; adds no dependency; and removes precisely the now-dead fields. Hand-rolled parsing is justified because
  the only structured element is one section and the rest must stay opaque (req. 3).

- **Follow-ups logged:** `Paths.rubrics` removal + `checkPaths` (Open Questions / components topic); duplicate-name guard fate
  (now trivial since name=id) — keep a minimal collision guard or drop it (decide in components topic); fixture/test rewrites.

### Topic: Judge live-verification, project-configurable capabilities, and the "judge cannot modify files" guarantee

- **Spec link:** Requirements 6, 7, 8, 10; Acceptance 5, 6, 7.

#### Decision A — Project-configurable judge capabilities (req. 7, acceptance 7)

- **Mechanism:** introduce an **optional, role-scoped capability descriptor** that the project supplies and the provider
  translates. Core defines a small, provider-neutral shape; it never names WP/browser tools. Concretely:
  - Add an optional `capabilities?: JudgeCapabilities` to `InvokeParams` (set only for the judge call; `undefined` for testing).
    Shape (provider-neutral): `{ tools?: string[]; mcpServers?: Record<string, McpServerConfig>; allowWrite?: boolean; network?: boolean }`
    — a deliberately small union of the levers every provider can map. (`McpServerConfig` mirrors the Claude SDK stdio/http shape;
    providers that can't host MCP ignore it.)
  - The project sets these on the **judge agent definition** in `skillsmith.config.ts` (e.g.
    `agents: { judge: { provider, model, tools: ['Read','Bash'], mcpServers: { playwright: { command:'npx', args:[...] } } } }`),
    OR on a dedicated `roles.judge` capability block. Chosen sub-form: **read the capability keys off the judge `AgentDefinition`'s
    open `[key:string]: unknown` map** (the seam codex/vercel already use for `effort`/`network`/`providerOptions`), and have the
    pipeline assemble them into the typed `capabilities` passed to `invoke`. This keeps `skillsmith.config.ts` ergonomic and adds
    no required core type while still giving providers a typed object.
  - **Provider translation:** claude-code maps `capabilities.tools`→SDK `tools`, `mcpServers`→`mcpServers`, `allowWrite:false`→
    keep Write/Edit out of `tools` + `disallowedTools:['Write','Edit']`; codex maps `allowWrite`/live-needs→`sandboxMode`
    (`workspace-write` when live, else `read-only`) + `network`→`networkAccessEnabled` + MCP→`CodexOptions.config` overrides;
    vercel/api providers ignore `mcpServers` and fall back to `fsTools(role)` (text+local-fs only); mock ignores it.
  - **Default when a project configures nothing:** today's behavior — judge is read-only (`tools:['Read']` / `read-only` sandbox).
    So the WP/browser-specific judge powers live entirely in `testing-project`'s config, satisfying acceptance 7 ("no WP/browser
    toolset assumed by core").
- **Options considered:** (1) typed `capabilities` on `InvokeParams`, sourced from the open agent map (**chosen** — explicit
  provider contract + ergonomic config, optional/back-compat); (2) pure untyped per-agent keys each provider reads ad hoc (rejected:
  no shared contract, each provider reinvents translation, easy to drift); (3) a fixed core enum of capability "profiles" (rejected:
  re-prescribes what the judge can do, violating req. 7's "projects differ").
- **Rationale:** the open agent-key seam already exists and is how `effort`/`network` flow today, so this is low-friction; a thin
  typed `capabilities` gives providers one place to translate; core stays generic (no WP/browser). Providers that can't honor a
  capability degrade safely to the read-only default, preserving the guarantee.

#### Decision B — "Judge must not modify the produced files" (req. 8, acceptance 6)

- **Decision: run the judge against an isolated copy of the produced files, and additionally diff-guard the canonical workspace.**
  - **Primary (prevention):** before the judge runs, the harness copies the testing agent's `workspace/` to a sibling
    judge-scoped directory (e.g. `<agentDirectory>/judge-workspace/`) via `fs.cpSync`, and runs the judge with `cwd` set to that
    copy. The canonical `workspace/` (the artifact under evaluation, and the source the improver/reports read) is never exposed to
    the judge, so it **cannot** be modified regardless of whether the judge has Bash/MCP. This holds uniformly across claude-code
    AND codex (the only option that does), and lets the judge have full live power.
  - **Secondary (detection guardrail):** snapshot the canonical `workspace/` (reuse `snapshotWorkspace`/`diffSnapshots`) immediately
    before and after the whole judge phase; if it changed, log a loud warning / mark the pair failed. Cheap defense-in-depth that
    also covers any future path where the judge touches the original.
  - **Env note:** if the project builds its live env from the produced files (e.g. wp-env loads the plugin), it should build from
    the **judge copy** so "what the judge sees == what it verifies." The harness exposes the judge workspace path to the env hooks
    (it's on `AgentContext.agentWorkspace` analog — see Decision C for the exact context field).
- **Options considered:** (a) read-only file tools only (rejected as sole guarantee: Bash defeats it; Codex read-only kills live
  checks); (b) copy-then-verify (**chosen primary**); (c) diff-detect only (**chosen as secondary**, not sole — detection after the
  fact doesn't *prevent* corruption of the canonical artifact mid-run). Combining (b)+(c) gives prevention + a tripwire.
- **Rationale:** acceptance 6 is a post-condition on the produced files; copying makes it structurally impossible to violate while
  preserving the live power req. 6 demands, and it's provider-agnostic so it doesn't depend on each SDK's sandbox subtleties. The
  diff-guard is a low-cost backstop.

#### Decision C — Where live verification fits the lifecycle, env ownership, concurrency (req. 6, 10; acceptance 5)

- **Decision — placement:** keep the judge **per-(scenario,agent)** inside `runAgentPair` (where it is today), but give it live
  tools (Decision A) and the copied workspace (Decision B). The judge itself performs the live check by following `JUDGE.md`,
  replacing both the read-only grade and the separate Playwright e2e gate. The project's old `afterAllScenarios` e2e gate is removed.
- **Decision — env ownership (Skillsmith manages nothing):** the project stands up and tears down its live env in **hooks**. Two
  supported patterns, project's choice:
  - **Per-pair env (isolation):** project uses `beforeJudgeAgent` to make an env available for that pair (e.g. build the plugin
    from the judge copy, boot a wp-env on a per-pair port) and `afterJudgeAgent` to tear it down. `AgentContext` already carries
    `agent`, `agentWorkspace`, `scenario` — enough to scope an env. These hooks fire immediately around the judge call
    (agent-loop.ts:224-276).
  - **Shared env (simplicity):** project uses `beforeAllScenarios` to bring one env up for the iteration and `afterAllScenarios`/
    `afterIteration` to tear it down; the judges share it.
  Skillsmith provides the hook points and timing guarantees; it never runs `env:start`/`env:stop` itself (req. 10, out-of-scope).
- **Decision — concurrency:** because pairs run in parallel (`Promise.all`, agent-loop.ts:94) and a shared live env has cross-talk,
  Skillsmith adds an **optional concurrency control so a project can serialize the judge phase** when it uses a single shared env.
  Concretely: a config knob (e.g. `roles.judge.concurrency: 'serial' | 'parallel'`, default `parallel` to preserve today's behavior)
  that, when `serial`, runs judge calls one at a time (testing agents still parallelize). This lets a project opt into "one shared
  env, judges run serially" without forcing N parallel environments. Projects that prefer isolation keep `parallel` and stand up a
  per-pair env in `beforeJudgeAgent`. **`testing-project` will use the simplest correct combo (decided in the testing-project topic).**
- **Options considered for concurrency:** (1) force one env per pair (rejected: heavy — N wp-env instances/ports, and Skillsmith
  would be nudging env policy it doesn't own); (2) always serialize judges (rejected: needless loss of parallelism for projects with
  isolated envs or no env); (3) **optional serial/parallel knob, default parallel** (chosen: preserves current behavior, lets the
  project pick its env model, keeps env ownership with the project).
- **Rationale:** keeping the judge per-pair preserves the per-(scenario,agent) verdict the whole report/improver pipeline expects
  (Topic on verdict), and hooks already exist at exactly the right lifecycle points with the right context. The concurrency knob is
  the minimal core addition that resolves the shared-env cross-talk the researcher flagged, while leaving env management entirely to
  the project.

- **CORRECTION (from Topic 5 findings):** the "shared env via `beforeAllScenarios`" pattern listed above is **infeasible for any env
  built from the produced artifacts**, because workspaces/plugins do not exist until the testing agent runs *inside* the scenario
  sweep (after `beforeAllScenarios`). The only point where the artifact exists AND the env can be up before the judge is
  **`beforeJudgeAgent`** (per pair). For a live judge that depends on the produced files, env setup belongs in `beforeJudgeAgent` /
  teardown in `afterJudgeAgent`. The `beforeAllScenarios` shared-env option only works for an env that is independent of the produced
  artifacts (rare). Additionally, vanilla wp-env cannot run concurrent instances on one `WP_ENV_HOME`, so a per-pair wp-env requires
  judge concurrency = **serial** (see Topic 5). The serial/parallel knob remains the right core lever; `testing-project` uses serial.

- **Follow-ups logged (Open Questions):** exact `JudgeCapabilities`/`McpServerConfig` core shape; whether to also expose the judge
  copy path on a context field for env hooks; precise Codex never+read-only exec behavior (Risk); default concurrency value vs.
  testing-project's needs.

### Topic: New verdict shape (overall pass/fail + notes) and its flow into reports + improver

- **Spec link:** Requirements 9, 11, 12; Acceptance 8, 9.

- **Decision — verdict shape:** the judge emits exactly `{ "pass": boolean, "notes": string }`. No per-check machine-readable
  breakdown (req. 9 out-of-scope); `notes` is the single freeform carrier of all detail (reasons, per-criterion findings, live
  observations, anything the improver needs). This is persisted verbatim as the `review` block of the per-agent `report.json`.

- **Decision — judge prompt + parsing:**
  - `buildJudgeSystemPrompt` is rewritten to: the verbatim `JUDGE.md` brief (the opaque judge prompt from Topic 1) + a minimal
    output instruction asking for exactly `{ "pass": <bool>, "notes": "<string>" }` (keep the JSON-escaping guidance + recursion
    guard) + the optional `config.roles.judge.prompt`. Remove all rubric/acceptance assembly (they no longer exist).
  - `buildUserMessage` drops the `scenario.description` push. Since the judge now reads files and the live env itself, file
    inlining is **optional**; keep a lightweight pointer to the workspace/copy path but rely on the judge's own tools for content.
    (Exact inlining vs. tool-read is an interfaces-topic detail; not load-bearing.)
  - `parseJudgeJson` gains a **lenient fallback**: try strict parse (current path); on failure, extract the last balanced `{...}`
    object and parse that. Rationale: a freeform judge is more likely to wrap JSON in prose; current handling only catches bare or
    fully-fenced JSON. Unparseable still degrades safely to a FAIL with `raw` retained.

- **Decision — `classifyVerdict` fix (the one behavioral change):** in the `pass === false` branch, surface `notes` as the FAIL
  detail — if `typeof v.notes === 'string' && v.notes.length > 0`, push `v.notes` into `failures` before the empty-detail fallback.
  This makes the judge's actual reason reach the live dashboard and post-run summary instead of the generic
  `'verdict failed without detail'`. Keep the existing `v.error`/`v.failures[]` handling intact so the (retained) `afterAllScenarios`
  gate and error shapes still classify. `pass: true` → PASS unchanged (notes intentionally not shown for passes on the dashboard,
  but still stored verbatim in `review`).

- **Decision — reporting + improver flow (mostly unchanged, by design):** the `{pass,notes}` verdict already flows end-to-end because
  the report/improver carry the `review` block verbatim. Confirmed no behavioral change needed in: `aggregateScenarioReport`
  (stores `review`, computes pass via `classifyVerdict`), `projectReportForImprover` (forwards verbatim review for passing AND
  failing — req. 12), re-selection (`classifyVerdict(...).kind`), and `summarizeFailures` (passes a freeform notes string through).
  So req. 11 (record/report pass/fail + notes per pair) and req. 12 (improver gets verbatim notes + failing skills) are satisfied by
  the existing wiring once the shape changes.

- **Decision — keep the generic verification gate:** `VerificationResult`/`VerificationFailure`/`applyVerification`/
  `normalizeVerification` and the `afterAllScenarios` consumed-return contract **stay**. They are generic (no rubric/e2e/WP refs) and
  remain useful for a project that wants an extra gate beyond the judge. `testing-project` removes its e2e gate usage, but the
  mechanism is not removed from core. A project that defines no such hook → clean pass, report untouched.

- **Decision — mock provider:** update the mock provider's verdict JSON (`PASS_JSON`/`FAIL_JSON`) to emit `{pass,notes}` so unit
  tests and dry-runs stay representative of the real judge contract.

- **Options considered:**
  1. *`{pass,notes}` mapped onto the existing `classifyVerdict` `pass` branch + a one-line notes fix* (**chosen**) vs. *a brand-new
     verdict classifier path*. Rejected the rewrite: the simplified `{pass,...}` branch already exists and `verify.test.ts` already
     exercises `{pass:true}`, so the smallest correct change is to teach the existing branch to surface `notes`.
  2. *strict parse + lenient fallback* (**chosen**) vs. *strict parse only*. Chose the fallback because freeform briefs raise the
     odds of chatty output; failing-safe-to-FAIL loses the verdict, which the fallback avoids cheaply.
  3. *remove the `afterAllScenarios` gate machinery* vs. *keep it* (**chosen**). Kept: it's generic, costs nothing when unused, and
     removing it would be scope creep against a still-useful extension point.

- **Rationale:** matches req. 9 exactly (overall pass/fail + freeform notes, no structured breakdown); preserves req. 11/12 with no
  improver/report rework because the verbatim `review` already carries notes; the single `classifyVerdict` fix closes the only real
  gap (notes dropped on FAIL); the lenient parse hardens against freeform output; keeping the gate avoids needless removal.

- **Follow-ups logged:** exact file-inlining vs. tool-read for the judge user message (interfaces topic, Q in Open Questions);
  test rewrites (verdict/summary/mock) belong to the plan phase.

### Topic: Components map, public interfaces, data flow, and the config/`Paths` changes

- **Spec link:** Requirements 2, 5, 7, 10, 15; Acceptance 1, 7, 10, 11 (consolidating topic).

- **Decision — component map (new / modified / removed / untouched):**
  - **Modified (core):**
    - `src/scenarios/enumerate.ts` — rewrite: discover on both briefs present, parse `# Skills`, validate skill ids, emit
      `testingBrief`/`judgeBrief`; drop `scenario.yaml`/rubrics validation, `isScenarioShape`, `nameSource`.
    - `src/config/types.ts` — `Scenario` → `{ name, skills, testingBrief, judgeBrief }`; `Paths` drops `rubrics`; add optional typed
      judge-capability fields to the agent input (DX polish, see below). Trim `EnumeratedScenario` (drop `nameSource`).
    - `src/config/defaults.ts` — drop `rubrics` from `DEFAULT_PATHS`.
    - `src/pipeline/pipeline.ts` — `checkPaths` validates `['skills','scenarios']`; remove `validateConfiguredScenarioNamesAreUnique`
      import+call.
    - `src/scenarios/selection.ts` — remove the duplicate-name guard (unreachable once `name===id`).
    - `src/pipeline/testing-agent.ts` — user message = `testingBrief` (was `scenario.prompt`); skill blob unchanged.
    - `src/pipeline/judge-agent.ts` — rewrite prompt to `judgeBrief` + minimal `{pass,notes}` instruction; live tools via
      capabilities; copy-workspace cwd; lenient parse.
    - `src/reports/verdict.ts` — one fix: surface `notes` on FAIL.
    - `src/providers/types.ts` — `InvokeParams` gains optional `capabilities?: JudgeCapabilities`.
    - `src/providers/claude-code.ts`, `codex.ts` — translate `capabilities` (replacing the hardcoded `TOOLS_BY_ROLE`/`SANDBOX_BY_ROLE`
      as the *sole* source of truth; keep a read-only default).
    - `src/providers/mock.ts` — verdict JSON → `{pass,notes}`.
    - `src/pipeline/agent-loop.ts` — copy workspace before judge + snapshot diff-guard around judge; optional judge serialization knob.
  - **New (core, small):** a `# Skills` parser (in/near `enumerate.ts`); a `JudgeCapabilities` type + per-provider translation; a
    workspace-copy helper (`fs.cpSync`-based) + reuse of `snapshotWorkspace`/`diffSnapshots` for the guardrail.
  - **Removed (core):** `Paths.rubrics`, `DEFAULT_PATHS.rubrics`, rubric blob loading, `scenario.rubrics`/`acceptance`/`description`/
    `prompt` fields, `isScenarioShape`, `nameSource`, `validateConfiguredScenarioNamesAreUnique`.
  - **Untouched-but-relevant (core):** `improvement/context.ts` + `improver.ts` (carry verbatim `review` + skills — req. 12);
    `reports/scenario-report.ts`, `summary.ts`, `progress/*` (key on `name`); `improvement/verify.ts` +
    `VerificationResult`/`applyVerification` (kept as a generic optional gate); selection/filter `id`-based matching; provider
    registry; api/vercel providers (stay text+local-fs, ignore `capabilities`).
  - **testing-project:** convert 11 scenarios to two-file model; remove the entire Playwright harness (`*.spec.mjs`,
    `playwright.config.ts`, `global-setup.mjs`, `verify-e2e.ts`) and `eval/rubrics/`; rewrite `skillsmith.config.ts` (judge capability
    config + env hooks instead of the e2e gate); update `package.json` deps; keep `scaffold-plugin`/`wp-cli`/`env:start`/`env:stop`.
  - **Docs:** README.md (substantial rewrite of the rubrics/acceptance/e2e/scenario.yaml model), `docs/index.html`.

- **Decision — config/`Paths` surface:** remove `rubrics` from `Paths`/`DEFAULT_PATHS`/`checkPaths`. **Judge capabilities ride the
  existing open-agent-key passthrough** (no validation/normalization change is *required*). For authoring DX, **add optional typed
  fields to `AgentDefinitionInput`** (e.g. `tools?: string[]`, `mcpServers?: Record<string,McpServerConfig>`, `allowWrite?: boolean`,
  `network?: boolean`) — additive, non-breaking, and gives editor help; validation stays permissive (don't reject unknown keys, to
  preserve provider passthrough for `effort` etc.). The pipeline assembles these into the `InvokeParams.capabilities` for the judge
  call only.

- **Decision — `nameSource` + duplicate guard:** remove both. `name===id` makes names unique by construction, so
  `validateConfiguredScenarioNamesAreUnique` is unreachable; delete it, its call, the `nameSource` field/type, and the obsolete
  duplicate-error tests.

- **Decision — role-prompt vs. inline (the one genuinely open sub-call here):** **keep the role-prompt mechanism**
  (`roles.test.prompt` / `roles.improver.prompt`) as a generic core feature. How much testing-project inlines into each
  `TESTING-AGENT.md` vs. leaves in `roles.test.prompt` is a testing-project authoring choice (settled in the testing-project topic:
  shared workspace instructions stay as `roles.test.prompt`; TESTING-AGENT.md holds the per-scenario prompt + `# Skills`). Rationale:
  the role prompt is not part of the removed "linked inputs"; intent.md:24 wants the testing-agent prompt available to the brief, but
  the *mechanism* is separate from the removal. Keeping it avoids a needless core change.

- **Decision — data flow (end-to-end, new model):**
  1. `enumerateScenarios` walks scenario dirs → for each dir with both briefs: read `TESTING-AGENT.md`/`JUDGE.md`, parse `# Skills`,
     validate skill ids → `EnumeratedScenario { scenario:{name=id, skills, testingBrief, judgeBrief}, id, dirName, error? }`.
  2. selection/filter by `id`; pipeline runs per (scenario, agent).
  3. testing agent: system prompt = skill blob + workspace constraint/contents + recursion guard + `roles.test.prompt`; user message
     = `testingBrief`; writes into `workspace/`.
  4. harness copies `workspace/` → judge copy; (project env hook brings env up from the copy).
  5. judge agent: system prompt = `judgeBrief` + `{pass,notes}` instruction + `roles.judge.prompt`; capabilities from the judge
     agent def (tools/MCP/sandbox); cwd = judge copy → emits `{pass,notes}`; harness diff-guards the canonical `workspace/`.
  6. `{pass,notes}` stored verbatim as `review`; `classifyVerdict` derives PASS/FAIL (notes surfaced on FAIL); reports + improver
     carry notes verbatim; re-selection on pass/fail.

- **Options considered:** typed-capability-fields vs. pure passthrough — chose **typed + permissive** (best DX without losing the
  passthrough other keys rely on). Keep-role-prompt vs. remove-and-inline-only — chose **keep** (generic feature; removal is scope
  creep). Remove-vs-keep the verification gate — chose **keep** (already decided Topic 3).

- **Rationale:** holds the public surface change to exactly what the clean break requires (`Scenario`/`Paths` shapes), removes all
  old-model code/inputs for acceptance #10, keeps every name-keyed downstream component working, and threads capabilities with the
  minimum core change by reusing the existing passthrough.

### Topic: `testing-project` adaptation (conversion + WP env + judge-capability config)

- **Spec link:** Requirements 13, 14; Acceptance 5, 7, 11.

- **Decision — env around the judge (per-pair in `beforeJudgeAgent`):** testing-project brings the WP env up in `beforeJudgeAgent`
  and tears it down in `afterJudgeAgent`, for that pair. This is forced by timing: the produced plugin exists only after the testing
  agent returns, and `beforeJudgeAgent` is the first lifecycle point where the artifact exists and the env can be up before the
  judge. `beforeJudgeAgent` builds the plugin (`wp-scripts build`), boots wp-env with that plugin (lifting the proven boot/build
  logic from the now-removed `verify-e2e.ts`), activates it, and creates a test post; `afterJudgeAgent` stops wp-env. Skillsmith runs
  no env commands itself (req. 10/14).

- **Decision — concurrency = serial for the WP judge:** because vanilla wp-env cannot run two instances concurrently on one
  `WP_ENV_HOME` (a second start rewrites the first's wp-config), testing-project sets the judge concurrency knob (Decision 2C) to
  **serial**. One wp-env at a time on the fixed port (8987); judges run one-at-a-time. Acceptable given req. 16 (pipeline runs at most
  one scenario×one agent; full runs are manual and costly), so parallelism is not load-bearing. If the project later wants parallel
  judges it owns `WP_ENV_HOME`+port-per-pair isolation — a project concern, not core.

- **Decision — judge capabilities for testing-project:** configure the claude-code judge agent with **Bash + a Playwright MCP server**
  (`mcpServers: { playwright: { command:'npx', args:['@playwright/mcp@latest'] } }`). Bash covers `curl` of the rendered page +
  `wp-env run cli` (wp-cli) for server-rendered/HTML/directive checks; Playwright MCP drives a real browser for interactive checks
  (click → assert state flip), the analog to the deleted e2e specs. These live entirely in `testing-project/skillsmith.config.ts`
  (acceptance 7: no WP/browser toolset in core).

- **Decision — passing per-pair runtime facts to the judge:** the project sets **env vars in `beforeJudgeAgent`** (e.g.
  `SKILLSMITH_JUDGE_URL=http://localhost:8987/?p=<postId>`, `SKILLSMITH_PLUGIN_SLUG`, `SKILLSMITH_POST_ID`); the claude-code provider
  passes `process.env` through to the judge's Bash/MCP child, so they are visible. JUDGE.md states the convention ("the site is at
  `$SKILLSMITH_JUDGE_URL`, the block is on post `$SKILLSMITH_POST_ID`"). No core seam needed. (For a codex judge, use a `CODEX_`-prefixed
  var or extend its env allowlist — flagged as a Risk for other providers.)

- **Decision — conversion mechanics (the 11 scenarios):**
  - **TESTING-AGENT.md** = shared workspace/scaffold instructions + per-scenario `prompt` + `# Skills`. The shared workspace
    instructions stay as `roles.test.prompt` (the role-prompt mechanism is kept; Topic 4) so they are not duplicated 11×; each
    TESTING-AGENT.md holds the per-scenario prompt + `# Skills`. (Equally valid to inline; chose the role prompt to avoid dup, since
    the mechanism already exists and is generic.)
  - **JUDGE.md** = per-scenario acceptance items + the **inlined** shared rubric (37 lines, stamped into each file — referencing an
    external rubric is fragile because Skillsmith does not resolve JUDGE.md links and the judge cwd can't reliably reach project-root
    files) + the e2e intent rewritten as plain-language live checks translated from each deleted `e2e.spec.mjs`.
  - Scenarios stay **flat** with their current slug-safe folder names (`name===id` holds); `counter` either renamed to `counter-block`
    or accepts slug `plugin-counter-<agent>` (e2e hardcoding is deleted).
  - **Removed from testing-project:** all `e2e.spec.mjs`, `playwright.config.ts`, `global-setup.mjs`, `eval/utils/verify-e2e.ts`,
    `eval/rubrics/`, all `scenario.yaml`, and the `afterAllScenarios` e2e gate. `package.json` drops Playwright/e2e deps; keeps
    `@wordpress/env` + `wp-scripts`; `scaffold-plugin`/`wp-cli` kept.

- **Options considered:** per-iteration shared env (rejected — infeasible by timing; artifacts don't exist at `beforeAllScenarios`);
  per-pair env + serial judges (**chosen** — only safe combo with vanilla wp-env); per-pair env + parallel via `WP_ENV_HOME`
  isolation (rejected for now — heavy, project's burden if ever needed). Inline rubric (**chosen**) vs. referenced shared file
  (rejected — fragile, not resolved by Skillsmith). Role-prompt for shared testing instructions (**chosen**) vs. inline per scenario.

- **Rationale:** the conversion is concretely buildable with the per-pair `beforeJudgeAgent` env + serial knob; the judge reaches the
  live site via project-configured Bash + Playwright MCP and env-var facts; inlining keeps JUDGE.md self-contained per the spec; and
  all WP/browser specifics stay in testing-project (req. 14), fully meeting acceptance 5, 7, 11.

## Spec coverage matrix

Every spec requirement and acceptance criterion mapped to the deciding topic, to verify completeness.

| Spec item | Served by |
|---|---|
| Req 1 (two prose files; discovery keys off them) | Topic 1 (discovery rule; filenames) |
| Req 2 (old inputs removed) | Topic 1 + Topic 4 (acceptance-#10 inventory) |
| Req 3 (files opaque except `# Skills`) | Topic 1 (opaque briefs; only `# Skills` parsed) |
| Req 4 (`# Skills` required; ids resolved; unknown-id error) | Topic 1 (`# Skills` parse + validation + error policy) |
| Req 5 (skills first-class; improver reads/rewrites) | Topic 1 (skills kept) + Topic 3/4 (improver unchanged) |
| Req 6 (judge verifies behavior on live env) | Topic 2 (live tools; per-pair judge) |
| Req 7 (judge capabilities project-configurable) | Topic 2A (capability descriptor via passthrough) |
| Req 8 (judge must not modify produced files) | Topic 2B (copy-workspace + diff-guard) |
| Req 9 (overall pass/fail + notes; no per-check breakdown) | Topic 3 (`{pass,notes}`) |
| Req 10 (project owns env; Skillsmith manages none) | Topic 2C + Topic 5 (env via project hooks) |
| Req 11 (record/report pass/fail + notes per pair) | Topic 3 (verbatim review flow) |
| Req 12 (improver gets verbatim notes + failing skills) | Topic 3 (unchanged improver wiring) |
| Req 13 (every testing-project scenario converted) | Topic 5 (conversion of all 11) |
| Req 14 (testing-project provides WP env + judge config; specifics not in core) | Topic 5 (Bash+MCP, env hooks, all in project) |
| Req 15 (new system usable; old model removed) | Topic 4 (removal inventory) + Topic 5 |
| Req 16 (manual testing posture; no self-improvement loop) | Risk R5 (honored by downstream phases) |
| Acc 1 (discover from new files, runnable) | Topic 1 |
| Acc 2 (missing `# Skills` → clear validation error) | Topic 1 (error policy) |
| Acc 3 (skills resolve+load; unknown id error) | Topic 1 |
| Acc 4 (files passed through as prompts) | Topic 1 + Topic 3 (testingBrief/judgeBrief as prompts) |
| Acc 5 (judge verifies on live env) | Topic 2 + Topic 5 |
| Acc 6 (judge cannot alter implementation) | Topic 2B |
| Acc 7 (capabilities project-configurable; no WP/browser in core) | Topic 2A + Topic 5 |
| Acc 8 (verdict recorded + reported) | Topic 3 |
| Acc 9 (self-improvement receives notes + skills) | Topic 3 |
| Acc 10 (old model gone) | Topic 4 (inventory) + Topic 5 |
| Acc 11 (testing-project fully converted) | Topic 5 |

All requirements and acceptance criteria are served by a decision; open items are deferred non-load-bearing details (see Open Questions) and flagged risks (see Risks).

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- **Q1 (Topic 1):** Exact final filenames (`TESTING-AGENT.md` / `JUDGE.md` vs. alternatives) — spec leaves naming to design;
  decision uses the working names as constants. Confirm with owner during implementation if a different convention is wanted.
- **Q2 (RESOLVED, Topic 4):** `Paths.rubrics` removed from `Paths`/`DEFAULT_PATHS`; `checkPaths` validates `['skills','scenarios']`
  (+ `base` separately). Clean break, no compatibility shim.
- **Q3 (RESOLVED, Topic 4):** `validateConfiguredScenarioNamesAreUnique` + `nameSource` removed (unreachable once `name===id`).
- **Q4 (Topic 2A/4):** Final core shape of `JudgeCapabilities` + whether to add the typed agent-input fields (`tools`/`mcpServers`/
  `allowWrite`/`network`) for DX or rely purely on passthrough. Pin the exact field names + `McpServerConfig` reuse in the design-doc /
  plan. (Decision: typed + permissive, but exact field naming is a plan-phase detail.)
- **Q5 (RESOLVED, Topic 2C/5):** Concurrency knob default = `parallel` (preserves today's behavior); `testing-project` sets it to
  `serial` and uses per-pair env in `beforeJudgeAgent`.
- **Q6 (Topic 2B/5):** Whether to surface the judge-copy workspace path on a context field for env hooks (so the project doesn't
  re-derive it), and whether the judge's `cwd` should be the copy or stay the original with the copy only as the env source. Pin the
  exact wiring in the design-doc / plan (the copy + judge-cwd must reference the same path — see Topic 5 caveat).
- **Q7 (Topic 3):** Whether the judge user message still inlines the produced files or relies entirely on the judge's own
  Read/Bash tools to fetch them (now that the judge is live). Not load-bearing; pin in the design-doc.
- **Q8 (Topic 5):** `counter` scenario — rename folder to `counter-block` (preserve the name) or accept the new slug
  `plugin-counter-<agent>`. Trivial; decide during conversion.
- **Q9 (Topic 3):** Whether to simplify `summarizeFailures`'s now-dead rubric/acceptance counting, or leave it (harmless). Cleanup,
  not load-bearing.

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **R1 (Codex judge live verification):** With `approvalPolicy:'never'`, Codex `read-only` sandbox appears to block command
  execution, so a live Codex judge needs `workspace-write`, which reintroduces workspace write capability — the no-modify guarantee
  for Codex then rests entirely on the copy-workspace prevention (Decision B), not the sandbox. The exact never+read-only exec
  behavior was NOT settled by a live experiment. Downstream: if a project runs the judge on Codex with live checks, rely on the
  copy isolation; consider a live Codex spike before depending on it.
- **R2 (Bash escapes tool-surface no-write):** Any provider that grants the judge Bash can write files via shell; the design does
  not rely on tool-surface alone for the guarantee — it relies on the copied workspace. If a future change drops the copy step, the
  guarantee regresses. Keep the diff-guard as a tripwire.
- **R3 (vercel/api providers + Bash):** vercel Bash is unsandboxed `execSync` with harness privileges; if a project configures a
  judge on an api provider with Bash, that's an unsandboxed shell on the host. Document that live judging is intended for
  claude-code/codex; api providers stay text+local-fs.
- **R4 (Concurrency + shared env):** if a project uses one shared live env but leaves judge concurrency at `parallel`, parallel
  judges will cross-talk on that env (the very reason the old e2e gate ran once-per-iteration). The serial knob mitigates, but the
  default must be chosen carefully and `testing-project` must pick a coherent combo.
- **R5 (Manual-testing posture):** per spec req. 16, pipeline agents must not run the self-improvement loop or depend on a green
  full-suite run; at most one scenario × one agent as a sanity check. Deterministic parts (parsing/validation/discovery/reporting
  wiring) are covered by unit/integration tests; live judge behavior is verified manually. Downstream phases must honor this.
- **R6 (Env timing):** A live env that depends on the produced artifacts MUST be set up in `beforeJudgeAgent` (per pair), not
  `beforeAllScenarios` — the artifacts do not exist before the scenario sweep. A project that wires env setup at the wrong hook will
  judge against an empty/missing env. The design-doc + testing-project example must make this explicit.
- **R7 (wp-env concurrency):** Per-pair wp-env on one `WP_ENV_HOME` cannot run concurrently (a second start rewrites the first's
  wp-config). The serial knob is mandatory for the WP case. If a future project wants parallel WP judges it must isolate
  `WP_ENV_HOME`+port per pair (project's responsibility, req. 10).
- **R8 (Freeform judge parse robustness):** A freeform `JUDGE.md` raises the chance the judge wraps its `{pass,notes}` JSON in prose;
  strict parse fails-safe to a FAIL (verdict lost). The lenient last-balanced-`{...}` fallback mitigates but is not bulletproof; the
  output instruction must firmly say "output only the JSON object." Manual review of early runs recommended.
- **R9 (Freeform brief consistency):** With Skillsmith no longer prescribing verification structure, scenario authors carry more
  responsibility — a vague `JUDGE.md` yields a vague verdict. Not a code risk, but a usage/quality risk the docs should address
  (guidance on writing good judge briefs).
- **R10 (README/docs drift):** README + `docs/index.html` are heavily coupled to the old rubrics/acceptance/e2e model and require a
  substantial rewrite (not line edits) to avoid documenting a model that no longer exists (acceptance #10 spirit). Scope it as a real
  component in the docs phase.
