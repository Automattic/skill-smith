# Design Research: Unified cleanup, judge workspace, and centralized decision rule

Run: review-4 of pipeline `55-flexible-scenarios-and-judge-verification` (issue #55 / PR #56). Base ref `0addcb8`.
Spec: `../1-spec/spec.md` (authoritative). Reviewer reports: `../0-intent/reviewer-{pollution,simplification,improvements}.md` — inventories, re-verified against code below before being relied on.

## Research

<!-- Findings from the design-doc-researcher, with sources cited. -->

### A. Baseline: how judge material is wired today (researcher, verified at tip; src identical to `0addcb8`)

**Judge prompt assembly** — `buildJudgeSystemPrompt(scenario, config, task, rubricBlob?)` (`src/pipeline/judge-agent.ts:201-234`), pure string builder, sections joined by `\n\n` in this order:

1. `scenario.judgeBrief` verbatim (:220)
2. `# Testing task\n${task}` — task = `stripSkillsSection(scenario.testingBrief)` (caller :78; :221)
3. Output instruction (:207-217), verbatim:
   ```
   # Output format
   Return a single JSON object with exactly these two keys:
     { "pass": <bool>, "notes": "<string>" }
   `notes` is a JSON string: escape literal newlines as \n, double quotes as \", and backslashes as \\.
   Strict JSON only: no trailing commas, no comments, no single-quoted strings.
   Output only the JSON object — no prose, no Markdown fences, nothing before or after it.

   # Recursion guard
   Do not invoke `skillsmith` or any wrapper that would re-enter the harness.
   ```
   (`# Recursion guard` is part of the same `outputInstruction` section string.)
4. If `rubricBlob` non-empty: `# Grading rubrics\n${RUBRIC_SELECTION_LEAD_IN}\n\n${rubricBlob}` (:224-228). Lead-in (:167-171) verbatim: "The rubrics below are shared, reusable grading criteria. Apply ONLY the rubric(s) this scenario's brief refers to; the others are provided for reference and must not affect the verdict."
5. If `config.roles.judge.prompt` non-empty: `# Role instructions\n${rolePrompt}` (:229-232) — the environment manual lands **last**.

`RunJudgeAgentParams` (:15-36) includes `agentWorkspace` (documented "kept for logging and parity", never read — simplification finding 9 confirmed) and `buildUserMessage(_scenario, judgeWorkspace, filesWritten)` has an unused first param (:312-331, finding 9 confirmed). Judge invoked with `cwd: judgeWorkspace`, `role: 'judge'`, `capabilities: judgeCapabilities(judge)` (:98-105). User message = written files inlined from the judge copy as `=== <rel> ===` blocks (:312-331).

**Rubric loading** — `loadRubric(id, rubricsRoot)` (`src/scenarios/rubric-loader.ts:21-61`): entry `<root>/<id>.md`, throws if missing, BFS over md links inside root, emits `=== <rel> ===` sections. `loadAllRubrics(root)` (:86-128): undefined if root/files missing, wraps each as `# Rubric: <id>`, skips unreadable silently (:109-111); **self-reparse confirmed** at :116-120 via `SECTION_HEADER_RE = /^=== (.+?) ===$/gm` — re-derives file paths `loadRubric` already had in its `visited` set (finding 7 confirmed). Non-test call sites of `loadAllRubrics`: exactly one — `judge-agent.ts:77`. `loadRubric`'s only non-test caller is `loadAllRubrics`. **Retiring `paths.rubrics` orphans the whole module.**

**Existing `judgeWorkspace` (artifact copy)** — `AgentContext` (`src/config/types.ts:258-274`): `agentWorkspace` = `<agent-dir>/workspace`, `judgeWorkspace` = `<agent-dir>/judge-workspace` (siblings inside `<runDir>/iteration-N/<scenario>/<agent-id>/`). Copy materialized per pair at `agent-loop.ts:257` via `copyWorkspaceForJudge` (`workspace-snapshot.ts:109-115`, recursive `cpSync`), inside the serial-mutex bracket (:250-343), before `beforeJudgeAgent` (:260-266). Judge cwd = `judgeWorkspace`. The judge copy is **not** guaranteed read-only (allowWrite / Bash can write); the true guarantee is the canonical-workspace diff-guard (`agent-loop.ts:258`, :294-306). Mutating `judge-workspace/` is permitted by design.

**Judge capabilities / "no file-reading tool" detection** — `judgeCapabilities(judge)` (`judge-agent.ts:138-157`) lifts `tools`, `mcpServers`, `allowWrite`, `network` into `JudgeCapabilities` (`src/providers/types.ts:26-35`). claude-code judge default `tools: ['Read']`, `capabilities.tools` replaces the default (`claude-code.ts:72-91`). API providers (anthropic/openai/gemini via `vercel-runner.ts:29` → `fs-tools.ts:101,:292`) **always** give judges exactly `{ Read }` and ignore `capabilities` entirely (proposal 11's "silent lie" confirmed). codex: sandbox model, judge default `read-only` — can always read files (`codex.ts:35,:84-97`). **There is no existing predicate for "judge has no file-reading tool"**; the only expressible such judge today is claude-code with `tools` set excluding `Read`. Candidate mechanisms: (a) name-based heuristic over `capabilities.tools`, (b) new provider-declared flag, (c) explicit config knob.

**Config surface** — `Paths` (`types.ts:146-155`): `base`, `skills`, `scenarios`, `rubrics?` (:154). `NormalizedRoles.judge` = `{ agent, prompt?, concurrency }` (:126-130). `validate.ts`: judge prompt only "must be a string" (:215-217); **`paths` is not validated at all** (`collectConfigErrors` :19-42 covers mode/agents/roles/selfImprovement only). `normalize.ts`: prompt passthrough (:64), paths merged `{ ...DEFAULT_PATHS, ...input.paths }` (:45); `DEFAULT_PATHS` (`defaults.ts:3-7`) has no rubrics default. `testing-project/skillsmith.config.ts`: `readFileSync` boilerplate :13-25 (judge manual from `eval/prompts/judge.md` :18-21), `judge: { agent: 'opus', prompt: judgePrompt, concurrency: 'serial' }` (:66), `paths: { rubrics: './eval/rubrics' }` (:77-79). Rubrics dir holds exactly one file (`wp-interactivity-api-best-practices.md`). Manual references the bridge script via `$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs` (`judge.md:16`).

**Grading-leak baseline confirmed** — `testing-agent.ts:35-80`: system prompt = skills + workspace constraint/contents + recursion guard + optional `roles.test.prompt`; user message = `testingBrief` verbatim. Zero references to rubrics/judgeBrief/judge prompt; no capabilities passed for role 'testing'.

**Cache note** — today's prompt starts with the per-scenario brief, so there is zero cross-pair cacheable prefix (relevant to proposal 12).

### C. Supply-mechanism feasibility (researcher, Topic C)

**The reviewer's sibling placement is infeasible for API judges.** Every fs-tools path goes through `resolveInside(cwd, p)` (`src/providers/lib/fs-tools.ts:47-55`): resolves then rejects any path whose relative form starts with `..` or is absolute — "a hard jail, not a prompt rule" (:4-5). The API-provider judge gets exactly `{ Read }` (:292), no Bash escape hatch. Researcher ran the verbatim `resolveInside` logic experimentally: `../judge-library/...` and absolute paths **throw** `path escapes workspace`; cwd-relative paths resolve. Since these judges always *have* a file tool, the tool-less inline fallback would never rescue them — a sibling library is permanently unreachable for them.

**Other providers:** claude-code passes `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`, no `additionalDirectories` (`claude-code.ts:156-168`); SDK docs treat outside-cwd access as a permission-scope matter, which we bypass — sibling reads likely work but unverified live (flagged uncertainty). codex `read-only` sandbox blocks writes/commands, permits broad reads (partly model knowledge, unverified). Bash judges (testing-project has `tools: ['Read','Bash']`, `skillsmith.config.ts:45`) are unrestricted by our code. Precedent: the shipped judge already works outside cwd via Bash — `installPluginForPair` sets `SKILLSMITH_PROJECT_ROOT` on `process.env` (`wp-env-judge.ts:284`), reaching the judge child (`claude-code.ts:112-116, :163`), and the manual instructs `node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs"` (`judge.md:16`).

**Inside-cwd placement is uniformly readable** by every provider (everything cwd-relative), and the artifact-confusion risk is bounded: the judge's user message inlines only `testingResult.filesWritten` (`judge-agent.ts:312-331`), computed on the canonical workspace *before* the copy (`testing-agent.ts:88-91`) — an inside-cwd library can never leak into "files written".

**Copy mechanics:** `copyWorkspaceForJudge(src, dest)` (`workspace-snapshot.ts:109-115`) is generic (mkdir + recursive `cpSync`), directly reusable. Natural slot: inside `runAgentPair`'s judge bracket, beside the workspace copy at `agent-loop.ts:257`, before `beforeJudgeAgent` (:260-266) — also skipped for free when testing failed (:230-243). **Per-run copy is ruled out twice**: (1) `scenario.name` can be nested (`blocks/counter`; `pipeline.ts:497`, `enumerate.ts:186-189, :322-327`), so a run-level copy has scenario-dependent `../` depth — no uniform brief reference; (2) default judge concurrency is `parallel` (`normalize.ts:85`) and write-capable judges (allowWrite, or any Bash judge — tool stripping doesn't stop `bash > file`) could corrupt a shared copy invisibly (diff-guard covers only the canonical workspace, `agent-loop.ts:258, :294`). Per-pair cost is trivial at current library size.

**Manifest walker exists:** `snapshotWorkspace(root)` (`workspace-snapshot.ts:26-30, :42-68`) returns a `Map<relPath, …>`, files-only, recursive, error-tolerant; `[...keys()].sort()` is the established pattern (`testing-agent.ts:114`). No new walker needed.

**Type sharing:** roles are `test`, `judge`, `improver` (`types.ts:92-96`); judge and improver share `SingleRoleInput` (`types.ts:109-111`), which already carries a judge-only `concurrency` field with an "ignored elsewhere" doc note. All three roles carry `prompt` today (test: `types.ts:98-101`/`normalize.ts:33-35`; judge: `normalize.ts:64, :78-86`/`judge-agent.ts:229`; improver: `normalize.ts:38`/`pipeline.ts:215`, README:223). Removing `prompt` from judge only forces an input-type split (judge `{ agent, library?, concurrency? }`, improver keeps `{ agent, prompt? }`) — otherwise TS would keep accepting `roles.judge.prompt`, contradicting the loud validate-time rejection. The normalized side already declares per-role shapes (`types.ts:119-132`; `normalizeJudgeRole` is judge-specific, `normalize.ts:78-86`).

### D. The brief/template contract (researcher, Topic D)

**Conformance test** (`src/__tests__/testing-project-scenarios.test.ts`) — six tests; the "seven template invariants" live in test 5 (:166-227):

- Test 1 (:96-116): both brief files exist, no `scenario.yaml`/`e2e.spec.mjs`. Test 2 (:118-136): all 11 enumerate cleanly, skills = `['wp-interactivity-api']`. Test 3 (:138-143): anchors == scenario set. Test 4 (:145-164): TESTING-AGENT has Skills heading, preserves anchor prompt, no leaked rubric token.
- Test 5 invariants: (1) `Code checks`/`Behavior checks` headings (:171-180); (2) brief includes bare id `wp-interactivity-api-best-practices` (:183-186) — an `includes()` that would *still pass* against a path form, but its "bare id" meaning goes stale; (3) rubric-body sentinel NOT inlined (:189-193); (4) no `{ "pass"`-shaped JSON pre-statement (:196-200); (5) removed-env-var tombstone (:202-211) — R1 removal (pollution item 11); (6) decision-rule opener `/pass only if every check/i` (:213-219) — **the only code asserting the opener**; (7) no `# Rubrics` heading (:221-226). Test 6 (:229-246): `_candidates.yaml` tombstone — R1 removal. File header (:9-31) describes the old contract (fixed opener, bare id, resolved rubric bodies, judge role prompt) — full rewrite needed.
- Survive unchanged: tests 1-4; invariants 1, 3, 4, 7.

**The 11 briefs:** opener is **byte-identical line 1 in all 11** (md5-verified), two sentences: "Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied." The conformance regex pins only the second sentence. Rubric sentence byte-identical in all 11, always the closing line of `## Code checks`: "As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric." No brief states an alternative overall decision rule; the nearest rule-like prose is the two R6-protected conditional-fallback bullets (`async-fetch/JUDGE.md:21`, `config-fetch/JUDGE.md:25`), which define check-level fallback semantics only. No brief references the `# Grading rubrics` section or the lead-in wording.

**Downstream consumers of the opener: none.** Verdict handling reads only judge output (`src/reports/verdict.ts:20-96`; `summarizeFailures` :97-113 counts legacy `'rubric '`/`'acceptance '` prefixes — proposal 5's dead shapes); improver context carries judge `notes`, not brief text (`context.ts:83-122`). Dropping the opener is a pure text deletion. No brief duplicates the output-format instruction (invariant 4 forbids it; grep confirms), and today's output instruction contains **no decision-rule sentence** — the rule can move there with zero redundancy.

**Test blast radius (names only):** `judge-agent.test.ts` — role-instructions pair (:170, :184), rubric-section trio (:254, :278, :302), `paths.rubrics` trio (:633, :689, :719) die; Testing-task placement (:198), no-rubric scaffolding (:154), output-instruction content (:127) refit; ~14 others untouched (:406 is an R1 tombstone). `rubric-loader.test.ts` — all 16 tests die if the loader retires. `check-paths.test.ts` :35 (R1 tombstone), :49 refits for the library gate. `enumerate-rubrics.test.ts` :69-:164 reframe per pollution item 11 (:48 is the live opaqueness test). `testing-project-judge-config.test.ts` — config assertions refit to the library key; import-list regex :270-292 already R1 material.

### E. Testing-project migration mechanics (researcher, Topic E)

**Bridge script:** `judge-wp.mjs` resolves `PROJECT_ROOT` from its own location (`import.meta.url` two-up, :12-15) and derives `WP_ENV_CONFIG_PATH = join(PROJECT_ROOT, '.wp-env.json')` (:23) — load-bearing because wp-env identifies the warm instance by `md5(configFilePath)` (:17-22; hooks write `.wp-env.json` at the project root, `wp-env-judge.ts:24, :191-194`). Invokes `spawnSync('npx', ['wp-env', '--config', ..., 'run', 'cli', 'wp', ...])` (:29-42). **A plain per-pair copy breaks it** (config path derives to `<judge-cwd>/.wp-env.json`, wrong file + wrong md5); relocation into the library would require an env-var-based root rewrite, and its `npx` resolution from a copy works only because run dirs happen to nest inside the project (`paths.base` default `./.skillsmith`). Pinned by `judge-wp-bridge.test.ts:32-37` (a live behavior test of exactly the self-location property) and the manual's three command examples (`judge.md:16, :19, :34`). No package.json/CI/README references.

**Manual** (`eval/prompts/judge.md`, 48 lines): title, intro (live WP site; "Use it to verify the block's real behavior in addition to reading the produced source files" — the opener's framing content **already half-exists** at :3, so folding is a merge, not an append), env-var list (:5-9), `## Running WP-CLI` bridge form (:11-19), post-publish walkthrough (:21-37), rendered-post loading (:39-48). **No decision-rule/verdict/output text and no rubric mention** — nothing clashes with the new sections. `eval/prompts/` holds exactly `improver.md`, `judge.md`, `testing-agent.md`; the other two stay wired via `roles.test.prompt`/`roles.improver.prompt` (config :14-25, :57, :67).

**Path pinning:** `testing-project-judge-config.test.ts` (:207 rubrics path, :300-341 manual readFileSync + command-form regex — refit/R1); `core-types.test.ts:105-107` (type-level `Paths.rubrics` — dies with the removal); `check:config` executes the config so a missed edit throws loudly (natural tripwire); docs homes for phase 5: README:149-172, :314; `examples/skillsmith.config.ts:26, :201`. **Rubric file is self-contained** (zero md links; the loader's BFS finds nothing to expand) and is the only file in `eval/rubrics/` — a plain copy is behavior-identical.

**Layout:** `eval/` = `prompts/`, `rubrics/`, `scenarios/`, `utils/` — no `eval/judge/` exists, no clashes. `wp-env-judge.ts` references neither `eval/prompts` nor `eval/rubrics`.

**`SKILLSMITH_PROJECT_ROOT`:** set by `installPluginForPair` (`wp-env-judge.ts:284`), cleared by `cleanUpPair` (:309-311), **read by no code** — its only real consumer is the manual's Bash interpolation (`judge.md:7, :16, :19, :34`). It survives every arrangement where the judge must reach a project-root script. `$SKILLSMITH_WP_PORT`/`$SKILLSMITH_PLUGIN_SLUG` are independent.

### F. Cleanup verification sweep (researcher, Topic F) — every R1/R2 finding re-verified

**Pollution findings:** A1-A11 all CONFIRMED against code, with these nuances:
- A1: `setUpJudgeEnv`/`tearDownJudgeEnv` (`wp-env-judge.ts:323-364, :375-390`) — zero production callers; `execSync` used only at :355/:377; those are the only code invocations of `env:start`/`env:stop`.
- A2: legacy-export tombstone confirmed (:242-254); the negative regexes at :192-199 sit INSIDE an otherwise-live wiring test (:177-200) whose positive regexes are a real contract — delete negatives, keep positives.
- A3: `wp-cli.mjs` dead; sentinel test's "clean-slate primitive" claim false in practice (real call: `commands.wpCli(['plugin','deactivate','--all'])`, `wp-env-judge.ts:281, :306`).
- A4: `feature-changeset.test.ts` — :72-78 pivot tombstone; :80-87 fails on first release; **:89-126 ("exactly one feature changeset") is tripped by this revision itself** (R7 mandates new changesets); :128-205 pin release-note prose that this revision falsifies anyway (the note's "all rubrics loaded" claim dies with the library). The durable bit (:207-222, validate every changeset) is redundant: `changeset-gate.yml` runs `validate-changesets.ts` over the real `.changeset/` on every PR, and `validate-changesets.test.ts` covers the validator's branches. Current `.changeset/`: 5 md files incl. `flexible-scenarios-judge-verification.md`.
- A5: e2e-removal file confirmed pure negative space; **:105-112 pins `env:start`/`env:stop` as "must be retained"**; token grep must special-case `@playwright/mcp` (brittleness confirmed); scenario-file half duplicates `testing-project-scenarios.test.ts:107-114`.
- A6: retired-symbol scans (:434-458) + env-var negatives (:276-285) confirmed redundant with positives (:261-275 enumerate all three exported vars; the `8987` pin at :454-457 is also asserted behaviorally at :266-270).
- A7: `skill-tester-workflow.png` zero references; `self-improvement-loop.png` live (README:193).
- A8: confirmed, **relocation target corrected**: the live test (:25-36) belongs in `scenario-filter-selection.test.ts` (unit-level, same import), not `scenario-selection.test.ts` (CLI-level).
- A9/A10: stale wording confirmed (`scaffold-plugin.ts:92-94`; judge-config header :7-9 "per-pair" vs run-level reality); judge-config :142-150 negatives drop, positives :130-140 stay.
- A11 cohort: mostly pure tombstones, three nuances: (i) `core-types.test.ts:85-107` (Paths shape with `rubrics`) is LIVE but refits with the R3 type removal — an R3 casualty, not an R1 tombstone; (ii) `check-paths.test.ts:35-47` split — key-set assertion (:38-42) is a live defaults contract to keep under a reframed title; the rubrics-undefined probe is tombstone; (iii) `scaffold-block-name.test.ts:96-102` is negatively-phrased but behavioral (scaffold OUTPUT assertion) — reframe positively or fold, don't just delete; :104-113 and :171 are the pure source-text tombstones. **(iv) `enumerate-rubrics.test.ts` partially REFUTES "delete": tests :48/:69/:93/:115 encode the live brief-opaqueness / never-validate-at-enumeration contract, which remains true and load-bearing under the library model — keep-with-reframe** (rename as an opaque-brief contract file, dedupe :69/:115, drop pivot framing; its `PATHS_WITH_RUBRICS` fixture dies with the type removal regardless).

**env:start/env:stop:** after A1+A5, consumers = definitions only (`testing-project/package.json:7-8`); zero mentions in README/CONTRIBUTING/docs/examples/.github. `bootJudgeEnv`/`stopJudgeEnv` shell `npx wp-env start|stop --config <path>` directly (`wp-env-judge.ts:113-141`) — never via the npm scripts. The bare scripts run wp-env with NO `--config`, resolving `<cwd>/.wp-env.json`, which exists only during/after a crashed run — `env:stop` has a real crash-recovery use; `env:start` near-none; both are thin aliases of `npx wp-env start|stop` run from the project root.

**Simplification findings:** C6 safe (predicate has one caller; strip re-implements the identical scan; coverage 19+8 tests — better than the report claimed). C8 deletable with a nuance: `wp-env-judge-lifecycle.test.ts` imports `judgePluginSlug` as its slug oracle in 6 places — mechanical re-import from `scaffold-plugin`, diff bigger than "~20 lines". C10 merge feasible; a THIRD `makeProject` copy lives in `enumerate-rubrics.test.ts:25-46`. C13: comparator byte-equivalent (`enumerate.ts:279` vs `selection.ts:161-166`); file-inlining framing + read-error placeholder identical but **join separators and fallbacks differ** (`'\n\n'`+`'(empty workspace)'` vs `'\n'`+`'=== (no files written) ==='`) — unification must preserve byte-identical outputs per side; `checkPaths` export: leave as-is (test-only, not in public index). **C2 optional collapse (runWpCli → shell judge-wp.mjs) REFUTED as behavior-equivalent:** `runWpCli` pins `cwd: PROJECT_ROOT` (`wp-env-judge.ts:92`); the bridge inherits caller cwd (`judge-wp.mjs:30-42`), and the harness cwd may be a PARENT directory (`resolve-cwd.ts:26-44`) where `npx` can't resolve wp-env; equivalence needs a cwd fix, costs a node hop × 3/pair + TS→mjs coupling for ~15 lines.

### H. Disposition evidence: dirName, CLI, observability (researcher, Topic H) + changeset baseline (analyst-verified)

**`dirName`:** nothing in src/ ever *reads* it — every non-test occurrence is construction (`enumerate.ts:191, :261, :330-332` always `dirName: id`; `pipeline.ts:102-107` copies into `RunScenario[]`; `ScenarioRunRecord.dirName` is write-only). It IS public API: `RunScenario` exported (`index.ts:3-32`), README:105 documents the alias; the target-project fixture destructures it in a hook. Update sites on removal: 3 src files (~9 lines), ~10 test/fixture sites, README:105. **Small mechanical breaking change.** `scenario.name`: always `id` but NOT removable — it is the load-bearing key for artifact paths, report keys, tracker scopes, re-run matching, filters, improver context (`pipeline.ts:497`, `iteration-report.ts:39-62`, `select-scenarios.ts:47-62`, etc.). Triplet reduces to a documented pair.

**CLI:** real bin (`package.json` bin → `bin/skillsmith.mjs`, ~90 lines) with flat `parseArgs` flags; **positionals are scenario filters, no subcommand routing** — `skillsmith counter` means "run counter", so `inspect`/`new`/`lint` verbs need a dispatch design that disambiguates the claimed positional slot (compat wrinkle for the disposition).

**Observability baseline (proposal 6 claims verified):** per-pair `report.json` = `{ testing, review }` (`agent-loop.ts:392-402`); testing has `duration` + `tokenUsage?`; the judge's `InvokeResult.usage` is **never read** (`judge-agent.ts:98-126`); judge duration is computed but tracker-only (`agent-loop.ts:269, :316`), never persisted; no transcripts persisted for either role (judge raw text survives only in `review.raw` on parse failure). A `judging` block beside `testing` flows through scenario aggregation with zero changes (`scenario-report.ts:18-28`).

**Changeset baseline (analyst-verified against `origin/trunk` and `.changeset/`):** trunk carries BOTH removed surfaces — `roles.judge.prompt` (`origin/trunk:src/config/types.ts:58, :71`) and a `rubrics` config surface (`:91, :129`) — so the removals are genuinely breaking relative to trunk. No git tags exist (never released; 5 changesets pending). The existing feature changeset `.changeset/flexible-scenarios-judge-verification.md` is `minor` with `BREAKING:` prefix and its prose describes the load-all rubric model ("Skillsmith loads **all** rubrics from the optional `paths.rubrics` location and injects every one of them…", lines 12-14) — **falsified by this revision; must be updated**.

## Topics

<!-- One entry per design topic: spec link, options, trade-offs, decision, rationale. -->

### Topic B: Config key name and placement for the judge directory

- **Spec link:** R3 open point 1 ("the config key's name — owner's word is 'workspace'; reviewer flags the `judgeWorkspace` collision — design decides"); AC3.
- **Evidence (researcher, Topic B):**
  - The phrase "judge workspace" never appears in the repo; the concept surfaces as the identifier `judgeWorkspace` and dirname `judge-workspace/` — and both are **prominently author-facing**: `AgentContext.judgeWorkspace` is a public exported type every hook author destructures (`src/config/types.ts:267-273`, `src/index.ts:5`); README uses it in 11 author-facing lines including hook signatures (:112-119), the isolation-guarantee prose (:145, :330), and the hooks example (:303-307); `examples/skillsmith.config.ts` destructures it in both judge hooks (:272, :282); the reference implementation reads `ctx.judgeWorkspace` (`wp-env-judge.ts:265, :325`).
  - `library`, `kit`, `materials` are unclaimed in src/, README, docs/, examples/ (only "library" hits are WordPress upstream path strings in `_candidates.yaml`). `<agent-dir>/judge-library/` is free — the only per-agent-dir writers are `workspace/`, `judge-workspace/`, `report.json` (`agent-loop.ts:161-162, :399`).
  - Path resolution is not bound to the `paths` parent: `paths.*` values stay relative strings; every consumer resolves at point of use against `projectRoot` (`judge-agent.ts:77`, `testing-agent.ts:42`, `pipeline.ts:98`, `enumerate.ts:223-224`). No precedent for a path under `roles`, but nothing structural prevents it; `judge-agent.ts` already has `projectRoot` in scope. `checkPaths` (`pipeline.ts:575-596`) is the natural home for a start-up existence gate.
  - **Silent-vs-loud migration:** runtime validation never rejects unknown keys (`validate.ts:19-42`; `paths` not validated at all); stale `paths.rubrics`/`roles.judge.prompt` would be silently ignored. Typecheck catches removal only in examples/ (root tsconfig) and consumers' own tsc; testing-project's `check:config` is tsx (no type checking). There is no existing loud-failure mechanism to inherit.
- **Options:**
  1. `roles.judge.workspace` — the owner's literal word.
  2. `roles.judge.library` — reviewer recommendation; unclaimed vocabulary.
  3. `paths.judgeLibrary` (or similar) — keeps all path-valued config under `paths`.
- **Decision:** **`roles.judge.library`** — a project-relative path string, resolved against `projectRoot` at point of use (same convention as `paths.*`). On-disk per-pair copy destination: **`<agent-dir>/judge-workspace/judge-library/`** — inside the judge cwd, not the sibling the reviewer proposed (amended by Topic C evidence: the fs-tools jail makes a sibling unreachable for API judges; name `judge-library` confirmed unclaimed). The config input type splits: judge becomes `{ agent, library?, concurrency? }`, improver keeps `{ agent, prompt? }`, test keeps `prompt` (shared `SingleRoleInput` can no longer express both truthfully). Additionally, `validate.ts` gains explicit rejection of the two removed keys: a config that still sets `paths.rubrics` or `roles.judge.prompt` fails validation with a migration message pointing at `roles.judge.library`.
- **Rationale:** The owner delegated the name (spec Q&A A3) with the collision concern on record, and the evidence shows the collision is not hypothetical: a `workspace`-named config key would sit in the same README hook-signature lines and the same `AgentContext` destructures as `judgeWorkspace`, meaning a *different* directory with a *different* lifecycle. `library` is unclaimed, describes the content (a library of reference material: manual, rubrics, scripts), and matches the on-disk copy name so briefs, docs, and config share one word. Placement under `roles.judge` (not `paths`) groups the key with the judge's other knobs and puts the replacement where the replaced `roles.judge.prompt` lived — the migration reads as a substitution. The explicit validate-time rejection converts an otherwise silent breaking change into a loud, self-explaining failure (serves AC3 and the R8 migration notes); pre-1.0, a permanent named-key rejection is cheap and kind.

### Topic C: Supply mechanism, placement, and tool-less degradation

- **Spec link:** R3 (single judge-scoped directory; supply degrades to inlining for tool-less judges; grading material reaches judges only); AC3, AC4.
- **Options:**
  1. **Inline everything** — every library file inlined into every judge prompt. Uniform across providers; but token cost scales with library size × pairs, inlined helper scripts are dead weight, and it resurrects the need for a selection lead-in (everything unnamed is in the prompt again).
  2. **Mount only** — copy to disk, inline nothing. Zero eager tokens, but the load-bearing environment manual becomes skippable; a judge that never reads the entry file grades blind.
  3. **Two-tier, sibling copy** (improvements reviewer's recommendation) — `README.md` inlined; rest copied per pair to `<agent-dir>/judge-library/`, a *sibling* of the judge cwd. **Infeasible as specified**: fs-tools API judges are hard-jailed to cwd (verified experimentally) and can never read a sibling; claude-code/codex sibling reads rest on unverified SDK behavior.
  4. **Two-tier, inside-cwd copy** — as (3) but the copy lands at `<judge-cwd>/judge-library/`.
- **Decision:** **Option 4 — two-tier with the library copied per pair into the judge cwd.**
  - **Tier 1 (always inlined):** the library's entry file `README.md` — the environment manual, replacing `roles.judge.prompt`. Optional, like the prompt it replaces: if absent, the manual section is simply omitted.
  - **Tier 2 (on disk):** the *whole* library directory (README included — a faithful mirror is simpler than an exclusion rule) copied per pair to `<agent-dir>/judge-workspace/judge-library/` via the existing `copyWorkspaceForJudge` mechanics, inside the mutex bracket beside the `agent-loop.ts:257` copy, before `beforeJudgeAgent` so hooks see it. A generated **manifest section** in the system prompt lists the library's sorted relative paths (`judge-library/<rel>`, via `snapshotWorkspace`) so the judge knows what exists without globbing.
  - **Collision guard:** if the copied artifact already contains a top-level `judge-library` entry, the pair fails loudly at copy time (deterministic, observable) rather than silently merging.
  - **Per-pair, not per-run:** nested scenario ids make run-level relative paths depth-unstable, and write-capable judges could corrupt a shared copy invisibly (diff-guard covers only the canonical workspace). Per-pair bounds the blast radius and keeps one uniform reference form.
  - **Tool-less degradation:** when the judge cannot read files, the whole library is inlined (each file as a `judge-library/<rel>`-labelled section) instead of copied+manifested. Predicate: `capabilities.tools` is an explicit array containing neither `Read` nor `Bash` (the two file-capable tool names in the passthrough vocabulary); when `tools` is unset, provider defaults always include file reading (claude-code default `['Read']`, fs-tools always `{Read}`, codex sandbox always reads). False positives (e.g. an fs-tools judge with an exotic `tools` list that the provider ignores) degrade harmlessly to inlining. No new config knob.
- **Trade-offs:** Inside-cwd placement means a cwd-globbing judge sees `judge-library/` beside the artifact — the reviewer's stated reason for the sibling. Accepted because the risk is bounded (the user message names exactly the produced files, computed pre-copy, so the library can never appear in "files written"; the manifest section explains what `judge-library/` is) while the sibling's cost is hard infeasibility for a whole provider class plus unverified SDK behavior for the rest. Copying the README twice (inline + disk) costs nothing and keeps the copy rule trivial. The Read/Bash name heuristic is provider-vocabulary-coupled; documented, and superseded if proposal 11 (capability honesty) later gives providers declared capabilities.
- **Rationale:** Two-tier keeps the manual load-bearing (inlined, can't be skipped) while rubrics/reference docs become pay-per-read — strictly better token economics than today's load-all. Inside-cwd is the only placement every provider can read with zero jail changes and zero SDK uncertainty, and it makes the brief reference form (`judge-library/rubrics/….md`) identical for every provider and every scenario nesting depth.

### Topic C2: Observable failure for missing items

- **Spec link:** R3 ("a brief's reference to a missing item must fail observably (in the verdict notes or earlier), never silently"); AC4.
- **Decision (layered, earliest-first):**
  1. **Config time:** `roles.judge.library` pointing at a missing/non-directory path fails the run at `checkPaths` (`pipeline.ts:575-596`) — the directory is opt-in, but once configured it must exist (unlike today's ungated `paths.rubrics`).
  2. **Judge time:** the manifest lead-in instructs the judge explicitly: apply only the library items the brief names; if the brief references a library path that is missing from the manifest (or unreadable), **fail the verdict and name the missing path in `notes`**. The judge's read failure is the detection mechanism; the instruction makes the report deterministic instead of hoping the judge mentions it.
  3. Core parses nothing: briefs stay fully opaque (no path extraction, no lint pass in core — a `lint` command is dispositioned separately under proposal 4).
- **Rationale:** Satisfies "verdict notes or earlier" with two independent layers while preserving the opaque-brief architecture. A mistyped rubric name today fails *silently* (the lead-in just deselects it); under this design the same typo produces a manifest mismatch the judge is instructed to report.

### Topic D1: Prompt assembly, brief reference form, and the selection lead-in's fate

- **Spec link:** R3 (brief names the exact item; lead-in fate is a design decision); R4 interplay; AC4.
- **New judge system prompt** (sections joined `\n\n`, conservative order — same slots as today):
  1. `scenario.judgeBrief` verbatim (unchanged, still first).
  2. `# Testing task` — unchanged.
  3. Output instruction — unchanged JSON-shape text plus the new decision-rule default (Topic D2) and the existing `# Recursion guard`.
  4. **`# Judge library`** (present only when `roles.judge.library` is configured; replaces both `# Grading rubrics` and `# Role instructions`), containing in order: (a) the library `README.md` body inlined verbatim (when present) — the environment manual; (b) the manifest: a fixed lead-in naming `judge-library/` in the working directory plus the sorted relative file list; (c) the selection-and-failure instruction: apply only the library items the brief names; a brief-named item missing or unreadable ⇒ fail with `notes` naming the path. In inline-fallback mode, (b) is replaced by each file's body as `judge-library/<rel>`-labelled blocks.
- **Brief reference form:** relative path from the judge cwd, e.g. the 11 briefs' rubric sentence becomes "As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`." — same sentence slot (closing line of `## Code checks`), same check, so the R6 check set is untouched. Paths are prose to core (no parsing); mechanical enough for a future lint.
- **Selection lead-in (`RUBRIC_SELECTION_LEAD_IN`): deleted.** Its reason to exist — mitigating the load-everything mechanism — is gone; nothing unnamed is inlined anymore. Its surviving semantic content ("apply only what the brief names") moves into the library section's instruction line, now paired with the missing-item failure duty.
- **Options considered for prompt order:** (i) conservative (chosen): keep brief first, library section in the slot where rubrics+manual already lived; (ii) stable-prefix reorder (library/output first, brief last) — proposal 12's shape, better cache economics, but shifts judge behavior enough that the reviewer himself demands a re-baseline; out of this revision's budget (see disposition of proposal 12).
- **Rationale:** Minimal positional change bounds the behavior shift to what the mandate requires (rubrics become on-demand, manual moves from `# Role instructions` into `# Judge library`). One section instead of two removes the odd manual-lands-last shape the reviewer flagged, without re-ordering anything the briefs rely on.

### Topic D2: The decision rule's home, override semantics, and the conformance test (R4)

- **Spec link:** R4 (mandated); AC5; hard constraint "format contract only, never coverage".
- **Options for the home:**
  1. **Harness output instruction** (core-owned, always present, provider-independent).
  2. Library entry file (`README.md`) — user-supplied and optional; projects without a library would silently have no rule; the rule is verdict *semantics* (harness contract), not project content.
  3. A new standalone prompt section — one more section for one sentence; no benefit over (1).
- **Decision:** **The default rule lives in the harness output instruction** (`judge-agent.ts` outputInstruction block), phrased as a default with an explicit override clause. Sketch (wording finalized in implementation): "Decision rule: unless the brief states its own decision rule, return `"pass": true` only if every check the brief asks for — including any rubric check — is satisfied; otherwise return `"pass": false`." A brief stating a different rule in its own prose wins by construction (the instruction defers to it). The two R6-protected conditional-fallback bullets (`async-fetch`, `config-fetch`) are *check-level* semantics — they define what satisfying that one check means — and compose cleanly with the default; they are not overrides and are untouched.
- **The 11 briefs drop the entire opener line** (both sentences — the whole line-1 boilerplate is scenario-invariant). The decision-rule sentence is replaced by the core default. The framing sentence's methodological content ("using both the produced source files and the live, running site") is project-specific judging guidance (a "live, running site" is a WordPress-project fact, not a harness fact) and moves into the testing-project's library `README.md` (the manual) during migration. Check content below the opener is untouched; reviewers verify the R6 check set as always.
- **Conformance test's new invariant set** (format contract only):
  - Keep: tests 1-4 wholesale; test-5 invariants 1 (check headings), 3 (rubric-body sentinel not inlined), 4 (no JSON pre-statement), 7 (no `# Rubrics` heading).
  - Change: invariant 2 tightens from bare-id `includes()` to the path form (`judge-library/rubrics/wp-interactivity-api-best-practices.md`) — same strength of template contract, new reference form.
  - Remove: invariant 6 (the opener regex — the rule no longer lives in briefs) and invariant 5 + test 6 (R1 tombstones). **No inverse assertion is added** ("briefs do not contain the opener" would be a new negative/tombstone test, the exact pattern R1 purges); the opener's absence is verified once by this revision's reviewers.
  - Header (:9-31) rewritten to describe the new template (path-form rubric reference, decision rule owned by the harness output instruction, manual/library supplied at judge time).
- **Rationale:** The output instruction is the only home that is always present, core-owned, and already the single place where verdict mechanics (`{ pass, notes }`) are stated — the rule is the semantic half of that same contract (researcher confirmed no redundancy and no downstream consumer of the brief-stated rule). Eleven copies collapse to one; drift becomes impossible; a brief keeps the last word.

### Topic E: Testing-project migration

- **Spec link:** R3 bullet 4 (manual and rubric relocated, config updated, 11 briefs re-pointed, check set preserved verbatim per R6); AC3-AC6, AC8.
- **Decision — target layout and moves:**
  - `eval/judge/` is the library (`roles.judge.library: './eval/judge'`):
    - `eval/prompts/judge.md` → `eval/judge/README.md`. Content edits: merge the briefs' dropped framing ("using both the produced source files and the live, running site") into the intro sentence that already half-states it (judge.md:3) — a merge, not an append; everything else (env vars, bridge usage, post-publish, rendered-post sections) unchanged.
    - `eval/rubrics/wp-interactivity-api-best-practices.md` → `eval/judge/rubrics/wp-interactivity-api-best-practices.md` (self-contained, plain move; `eval/rubrics/` then deleted).
  - **The bridge script stays at `eval/utils/judge-wp.mjs`** — the reviewer's "optionally move it into the library" amendment is **rejected**: a per-pair copy breaks its load-bearing `--config` derivation (wp-env warm-instance identity = md5 of the exact config path, self-located via `import.meta.url`), fixing that requires an env-var root rewrite plus reworking a live behavior test (`judge-wp-bridge.test.ts`), and the copy's `npx` resolution would silently depend on `paths.base` nesting inside the project. The library holds *reference material*; executable tooling that must run against project infrastructure legitimately lives with the project and is reachable via `$SKILLSMITH_PROJECT_ROOT` exactly as today. (User libraries CAN carry self-contained scripts — nothing forbids it; this one is not self-contained.)
  - `skillsmith.config.ts`: drop the `judgePrompt` readFileSync boilerplate (:18-21) and `prompt: judgePrompt` (:66); add `library: './eval/judge'`; drop `paths: { rubrics: ... }` — with `rubrics` gone the testing-project sets no `paths` overrides, so the whole `paths` block goes.
  - The 11 briefs: line 1 (opener) deleted; rubric sentence re-pointed to `judge-library/rubrics/wp-interactivity-api-best-practices.md` (Topic D1). No other brief edits — check set verbatim (R6).
  - `SKILLSMITH_PROJECT_ROOT`/`WP_PORT`/`PLUGIN_SLUG` env plumbing: unchanged.
  - `eval/prompts/testing-agent.md` and `eval/prompts/improver.md`: unchanged, still wired via `roles.test.prompt`/`roles.improver.prompt`.
- **Rationale:** The migration touches exactly what the mandate names and nothing else. `check:config` acts as a built-in tripwire (it executes the config; a missed edit throws). The rubric move is behavior-identical (no md links, so the retired loader's BFS expansion was a no-op for it).

### Topic F1: The cleanup plan (R1) — per-finding resolutions

- **Spec link:** R1 (mandated, behavior-neutral); AC1, AC2.
- **Decisions** (each re-verified in Research §F before deciding; "delete" = this revision):
  1. **Delete** `setUpJudgeEnv`/`tearDownJudgeEnv` + the `execSync` import (`wp-env-judge.ts`).
  2. **Delete** the legacy-export tombstone test (`testing-project-judge-config.test.ts:242-254`) and the two negative regexes at :192-199; keep the live wiring positives (:179-190).
  3. **Delete** `wp-cli.mjs`, its sentinel test (`wp-env-judge-lifecycle.test.ts:35, :460-474`), and the `wp-env-judge.ts:10` comment clause.
  4. **Delete `feature-changeset.test.ts` outright** (not reduce): every block is either a pivot/prose tombstone, guaranteed future CI breakage (:80-87 on release; :89-126 tripped by this very revision's R7 changesets), or redundant with the CI changeset gate + the validator's own test. Nothing durable is lost — `changeset-gate.yml` validates the real `.changeset/` on every PR.
  5. **Delete** `testing-project-e2e-removal.test.ts` whole file — pure negative space; its only non-duplicated content is the env-script "must be retained" pin, which cements finding 1's dead consumers.
  6. **Delete** the retired-symbol scans (:434-458) and env-var negative assertions (:276-285) in `wp-env-judge-lifecycle.test.ts`; the positives fully specify the contract (including the port fact).
  7. **Delete** `assets/skill-tester-workflow.png`; keep `self-improvement-loop.png` (live).
  8. **Move** the live nested-leaf selection test to `scenario-filter-selection.test.ts` (corrected target — unit-level home of `selectScenariosByFilters`); **delete** `selection-duplicate-name-guard-removed.test.ts`.
  9. **Fix wording** `scaffold-plugin.ts:92-94` (activation is `installPluginForPair`'s job, not "the e2e run").
  10. **Rewrite** `testing-project-judge-config.test.ts` header to the run-level warm-env model; drop the :142-150 negative greps, keep the :130-140 positives.
  11. Cohort: **delete** `testing-project-scenarios.test.ts:202-211` + test 6 + rewrite header (folded into Topic D2); **delete** `core-types.test.ts:59-83` (keep the positive shape test; :85-107 refits under R3); **keep-with-reframe** `check-paths.test.ts:38-42` (live defaults contract; positive title; drop the rubrics-undefined probe); `scaffold-block-name.test.ts`: **delete** :104-113 and :171, **reframe :96-102 positively** (assert the derived block name, not the absence of the legacy one) or fold into an existing positive assertion; **delete** `judge-agent.test.ts:406-421` (dies with finding 9; live payload covered at :372); **keep-with-reframe `enumerate-rubrics.test.ts`** — recorded keep-reason: its opaqueness tests (:48, :69, :93, :115) encode the live never-validate-briefs-at-enumeration contract that remains load-bearing under the library model; rename to an opaque-brief-contract file, dedupe :69/:115, drop pivot framing and the :140 duplicate rider.
  - **`env:start`/`env:stop`: delete both.** Their only code consumers are finding 1's dead functions; zero doc references; each is a thin alias of `npx wp-env start|stop` run from the testing-project root (identical cwd-based config resolution), so the crash-recovery use survives as a one-line manual command — phase 5 adds that line to the docs where the warm-env lifecycle is described.
- **Rationale:** Matches AC1's named casualties exactly; every keep is recorded with its reason; no new negative assertions are introduced anywhere (the R1 anti-pattern). All deletions are behavior-neutral (test/dead-code/asset only) — AC2.

### Topic F2: Safe core simplifications (R2)

- **Spec link:** R2; AC2 (behavior-neutral except the sanctioned fix).
- **Decisions:**
  - **Finding 6 (apply):** extract a shared `findSkillsSectionBounds(lines)` in `enumerate.ts`; `parseSkillsSection` and `stripSkillsSection` both consume it; drop the unused predicate parameter. Safety: 19+8 existing tests pin the behavior.
  - **Finding 7 (moot — superseded):** the `loadAllRubrics` self-reparse fix is NOT applied as a fix; the workspace decision (Topic C) retires `rubric-loader.ts` entirely (its only non-test caller was `judge-agent.ts:77`). The latent bug dies with the module. The spec's one-permitted-behavior-change allowance goes unused; ordering question resolved: workspace change supersedes, no interim fix.
  - **Finding 9 (apply):** remove `RunJudgeAgentParams.agentWorkspace` (never read) and `buildUserMessage`'s unused `_scenario` param — subsumed by the R3 judge-agent rework; caller/test updates mechanical.
  - **Finding 10 (apply):** merge `scenarios.test.ts` + `enumerate-two-file.test.ts` unique assertions; extract the duplicated `makeProject`/`writeScenario` into a shared test helper; fold the third copy in `enumerate-rubrics.test.ts` onto the same helper during its Topic F1 reframe.
  - **Finding 13 (apply, byte-parity constraint):** (a) unify the sort comparator on `compareScenarioIds`; (b) unify the `=== <rel> ===` file-inlining helper **parameterized by separator and fallback** so both call sites' outputs stay byte-identical (`'\n\n'`/`'(empty workspace)'` vs `'\n'`/`'=== (no files written) ==='`) — no prompt-text change; (c) `checkPaths` export: leave as-is (test-only, not public surface).
  - **Simplification 2's optional extra (reject):** collapsing `runWpCli` onto `judge-wp.mjs` is not behavior-equivalent (bridge inherits caller cwd; harness may run from a parent dir where `npx` can't resolve wp-env) and buys ~15 lines for a node hop ×3/pair plus a TS→mjs coupling. Recorded as rejected with reason.
  - **Finding 8 (apply):** drop the `judgePluginSlug` alias, its tautological test, and the source-regex pin; re-import `pluginSlug` from `scaffold-plugin` at the 6 lifecycle-test sites (mechanical; noted the diff is larger than the report's estimate).
  - Finding 12 (`dirName`): dispositioned with the proposals (Topic H).
- **Rationale:** Everything applied is verification-confirmed safe and behavior-neutral by construction; the one sanctioned behavior change (finding 7) is superseded by a strictly better resolution (module retirement).

### Topic G: Approach, components, interfaces, and data flow

- **Spec link:** all of R1-R4 (the end-to-end mental model an implementer works from); AC2, AC3, AC8.
- **Approach (one paragraph):** This revision is three independent tracks that share files but not behavior: (1) a behavior-neutral cleanup that deletes churn residue and history-pinning tests; (2) the judge library — one judge-scoped directory (`roles.judge.library`) whose entry `README.md` is inlined as the environment manual and whose full contents are copied per pair into the judge's cwd at `judge-library/`, announced by a manifest, replacing `roles.judge.prompt` + `paths.rubrics` entirely; (3) the all-must-pass decision rule moved from 11 brief openers into the harness output instruction as an overridable default. Ship-now extras riding the same wave: `dirName` removal and the `judging` report block (Topic H).
- **Components:**
  - **New:** `src/pipeline/judge-library.ts` (+ test) — owns the tool-less predicate, the per-pair copy (collision-guarded), and building the `# Judge library` prompt section. Sketch:
    ```ts
    type JudgeLibrarySection = { text: string; mode: 'mounted' | 'inline' };
    // called from agent-loop inside the judge bracket, before beforeJudgeAgent
    prepareJudgeLibrary(opts: {
      projectRoot: string; libraryPath: string;       // from config
      judgeWorkspace: string;                          // copy destination parent
      capabilities: JudgeCapabilities;                 // drives mounted vs inline
    }): JudgeLibrarySection | undefined                // undefined: no files and no README
    ```
    Division of labor: `agent-loop.ts` owns the per-pair disk lifecycle (calls `prepareJudgeLibrary` beside the existing workspace copy), and passes the section text into `runJudgeAgent` (replacing today's internal `loadAllRubrics` call); `judge-agent.ts` stays a pure prompt assembler.
  - **Modified:** `src/config/types.ts` (judge input type `{ agent, library?, concurrency? }`; `Paths` loses `rubrics`; `RunScenario`/`EnumeratedScenario`/`ScenarioRunRecord` lose `dirName`), `validate.ts` (removed-key rejection + `library` string check), `normalize.ts` (judge role carries `library`), `pipeline.ts` (`checkPaths` gains the library existence gate), `judge-agent.ts` (assembly per Topic D1/D2; params per finding 9; returns judge usage), `agent-loop.ts` (library copy; `judging: { duration, tokenUsage? }` in `report.json`), `src/index.ts` (type surface follows), conformance test (Topic D2), testing-project (Topic E), test refits (Research §D blast radius).
  - **Deleted:** `src/scenarios/rubric-loader.ts` + `rubric-loader.test.ts`; `feature-changeset.test.ts`; `testing-project-e2e-removal.test.ts`; `selection-duplicate-name-guard-removed.test.ts` (live test relocated); `wp-cli.mjs`; the dead orchestrator pair; `assets/skill-tester-workflow.png`; `env:start`/`env:stop` scripts. Implementation verifies whether any rubric-loader symbol is exported via `src/index.ts` (if so, its removal is named in the BREAKING changeset).
  - **Untouched but relevant:** `testing-agent.ts` (grading-leak invariant — no library material flows there), `workspace-snapshot.ts` (reused as-is), providers (no capability semantics change), verdict parsing/aggregation.
- **Data flow (per pair):** testing agent runs in `workspace/` → `filesWritten` computed on canonical workspace → mutex bracket: `workspace/` copied to `judge-workspace/` → **library copied to `judge-workspace/judge-library/` (fails pair on top-level collision)** → `beforeJudgeAgent` (hooks see both) → judge invoked, cwd `judge-workspace/`, system prompt per Topic D1, user message = `filesWritten` inlined (unchanged) → verdict parsed → `report.json` = `{ testing, judging, review }` → `afterJudgeAgent`/`cleanUpPair`.
- **Dependencies:** no new external dependencies; internal reuse of `copyWorkspaceForJudge`-style `cpSync` and `snapshotWorkspace`. The testing-project migration adds no tooling.

### Topic H: Dispositions — the twelve proposals + `dirName` (R5)

- **Spec link:** R5 (every proposal gets exactly one disposition; ship-now items implemented in this revision); AC7. Owner set no hard bounds; revision size weighed honestly — the mandated tracks already make this a large revision, so ship-now is reserved for items that are mandated, near-zero marginal cost on top of code already being rewritten, or that avoid a second breaking wave.

| # | Proposal | Disposition | Reason |
|---|----------|-------------|--------|
| 1 | Judge library | **Ship now** (mandated R3) | Adopted with two amendments over the reviewer's shape: copy lands **inside** the judge cwd (`judge-workspace/judge-library/`) because the fs-tools jail makes the proposed sibling unreachable for API judges (Research §C); the bridge script is NOT moved into the library (Topic E — per-pair copy breaks its wp-env config-path identity). Name `roles.judge.library` per reviewer; two-tier supply + manifest + inline fallback per reviewer. |
| 2 | Slot-pool judge concurrency | **Future issue** | Real wall-clock value, but it is its own design: semaphore + `judgeSlot` context + fixing the `process.env` race by letting `beforeJudgeAgent` return an env map applied per invocation (the current global-env pattern is confirmed racy under parallelism). Additive; lands independently of this wave. |
| 3 | Centralized decision rule | **Ship now** (mandated R4) | Home = harness output instruction; override = brief prose wins (Topic D2). |
| 4 | `inspect`/`new`/`lint` DX | **Future issue** | Valuable (and `inspect` would have helped this very revision), but the CLI has no subcommand routing and positionals already mean scenario filters (`skillsmith counter` = run counter) — verb dispatch needs its own small compat design (Research §H). Not free to ride along. |
| 5 | Per-check verdicts | **Future issue** | Breaking, medium effort, and shifts judge output behavior in a revision already changing the judge prompt; parse-failure risk needs its own bake-off. Pre-1.0 policy makes a later breaking wave cheap (`minor` + `BREAKING:`). `summarizeFailures`' legacy dead branches go with it. |
| 6 | Judge-phase observability | **Ship now, scoped** to `judging: { duration, tokenUsage? }` beside `testing` in `report.json` | The judge's usage is verifiably dropped on the floor and duration is tracker-only (Research §H); the scoped block is near-zero marginal cost while `runJudgeAgent`/`agent-loop` are already being rewritten, and aggregation passes it through unchanged. The proposal's transcript-persistence half is explicitly deferred (needs provider-stream capture design) — recorded as the residual future direction inside this disposition. |
| 7 | Capability manifest injection | **Future issue** | Injects a new prompt section and invites brief edits that condition on capabilities — off-mandate brief changes are exactly what R6 scrutiny forbids this revision; needs its own coverage-safe rollout. |
| 8 | `repeats` + `compare` | **Future issue** | Medium effort; `compare` also lands on the unsolved CLI-verb question (see #4). |
| 9 | Improver memory | **Future issue** | Self-contained improvement-loop feature; no interaction with this wave. |
| 10 | Scenario seed workspaces | **Future issue** | Complements the library on the testing side (the reviewer's own answer to "symmetric test workspace?" — deliberately asymmetric); independent design. |
| 11 | Provider capability honesty | **Future issue** | Requires a warnings channel that validation doesn't have today; noted linkage: a provider-declared file-tool capability would replace the library's Read/Bash name heuristic (Topic C risk). |
| 12 | Cache-friendly prompt assembly | **Future issue** | The reviewer's own condition — re-baselining the 11-scenario suite — is out of this revision's budget; Topic D1 deliberately chose the conservative section order. Revisit with a planned re-baseline. |
| 13 | `dirName` removal (simplification finding 12) | **Ship now** | Small mechanical breaking change (nothing reads it; ~9 src lines + ~10 test/fixture sites + README:105), rides the already-mandatory `BREAKING:` wave instead of forcing a second one later. `scenario.name` stays (load-bearing reporting key — Research §H). |

- No proposal is rejected outright; the rejected *shapes* within adopted proposals (sibling placement, bridge relocation, `runWpCli` collapse) are recorded in Topics C/E/F2 with reasons.

### Topic I: Changeset plan (R7) and phase-5 docs inventory (R8)

- **Spec link:** R7; AC8. Baseline facts: Research §H (trunk carries both removed surfaces; never released; existing feature changeset stale).
- **Decision — three changeset actions:**
  1. **Update** `.changeset/flexible-scenarios-judge-verification.md` (stays `minor` + `BREAKING:`): its load-all/`paths.rubrics`/selection-lead-in prose is falsified by this revision; rewrite those paragraphs to describe the judge-library model so the eventual release notes describe what actually ships.
  2. **Add** one new `minor` changeset with `BREAKING:` summary prefix covering this revision's breaking wave: `roles.judge.prompt` and `paths.rubrics` removed (replaced by `roles.judge.library`, with the migration recipe), decision rule centralized into the harness output instruction (brief authors drop the opener; brief prose overrides), `RunScenario.dirName` removed (use `id`).
  3. **Add** one new `minor` changeset (non-breaking) for the additive `judging: { duration, tokenUsage? }` report block.
  - Cleanup (R1/R2) carries no changeset: tests, briefs, testing-project scripts, and assets are outside the release-relevant surface (`.changeset` config patterns cover `src/**`; the only src changes under R2 are behavior-neutral refactors folded into the wave above where visible at all).
- **Phase-5 docs inventory (pointers collected during research):** README config reference (:314-316), rubric section (:149-172), lifecycle/hook docs (:105, :112-119, :135, :145, :303-307, :330), example brief; `examples/skillsmith.config.ts` (:20-30 readFileSync boilerplate, :197-201 rubrics key, :265-285 hook comments); migration notes for the two removed keys (pointing at `roles.judge.library` and the validate-time error); the crash-recovery one-liner (`npx wp-env stop` from the testing-project root) replacing the deleted `env:stop` script; `docs/index.html` if it mirrors config surface.
- **Rationale:** Changesets stay per-change and honest: one wave = one breaking record; the additive block gets its own note; the stale feature changeset stops lying. AC8's gates (validator + `changeset status`) pass by construction — the deleted `feature-changeset.test.ts` is what would have failed.

### Topic J: Failure modes and observability (summary)

- **Spec link:** R3 observable-failure clause; AC4; workflow requirement to state how the design fails.
- **Failure inventory:**
  | Failure | Detection | Surface |
  |---|---|---|
  | Config still sets `paths.rubrics` / `roles.judge.prompt` | `collectConfigErrors` rejection (new) | run refuses to start, migration message |
  | `roles.judge.library` path missing / not a directory | `checkPaths` gate (new) | precondition error at run start |
  | Brief names a library item that is missing/unreadable | judge follows the library-section instruction | verdict `pass: false`, `notes` names the path (in `report.json.review`) |
  | Artifact contains top-level `judge-library` | copy-time collision guard (new) | pair fails loudly, recorded as pair error |
  | Library copy I/O failure | copy throws inside the judge bracket | pair error, not silent |
  | Library configured but empty (no files, no README) | `prepareJudgeLibrary` returns undefined | section omitted — mirrors today's empty-rubrics behavior; not an error |
  | Tool-less judge | Read/Bash heuristic | inline supply; parity of material guaranteed |
- **Observability additions:** `judging: { duration, tokenUsage? }` persisted per pair (Topic H #6); everything else logged through the existing tracker/log scopes.
- **Invariant restated for reviewers:** grading material flows only through `judge-agent`/`judge-workspace` paths; the testing agent's prompt assembly is untouched (Research §A baseline confirms zero leak paths today).

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- Exact user-facing wording of the decision-rule sentence and the library manifest lead-in (semantics fixed by Topics D1/D2; the code phase polishes phrasing).
- Whether any `rubric-loader.ts` symbol is re-exported through `src/index.ts` — implementation verifies; if so, the removal is named in the BREAKING changeset (Topic G).
- `scaffold-block-name.test.ts:96-102`: reframe positively vs fold into an existing positive assertion — implementation judges which is less redundant (Topic F1.11).

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **Judge behavior shift from prompt-assembly changes.** The workspace redesign necessarily changes the judge's system prompt (rubrics no longer all-inlined; manifest section added; manual section relocated/renamed). Coverage parity (R6) is a text-level check-set property and survives, but judge *behavior* on the 11 scenarios should be spot-verified in the code phase (at minimum: assembled-prompt inspection for a sample scenario; a full re-baseline run is out of this revision's budget).
- **Tool-less-judge heuristic is provider-vocabulary-coupled.** The `tools`-array Read/Bash name check lives in core but speaks claude-code/fs-tools vocabulary; codex never triggers it (sandbox always reads). Documented; a future provider-declared capability (proposal 11 direction) is the clean long-term home.
- **fs-tools jail experiment was run standalone**, not through a live API-provider invocation; the `resolveInside` logic was executed verbatim, so confidence is high, but the code phase's unit tests around library supply should cover the jail interaction directly.
- **R6 reviewer burden on the brief edits.** The 11 briefs each lose line 1 and change one sentence (rubric reference form). Both edits are designed to be check-set-neutral, but the pipeline's reviewers must still diff every brief's checks against `origin/trunk` sources; the framing sentence's relocation into the manual is flagged for them explicitly (Topic D2).
- **`dirName` removal breaks hook code that destructures it** (the target-project fixture demonstrates the pattern) — covered by the `BREAKING:` changeset and README migration note, but external consumers get no runtime warning (typecheck-only).
- **Three changeset actions must stay consistent** (updated feature changeset + two new ones) — the docs phase should read them together to avoid describing the retired load-all model anywhere.
