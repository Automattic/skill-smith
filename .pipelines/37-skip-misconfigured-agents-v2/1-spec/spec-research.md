# Spec research: skip misconfigured agents across all phases of a run

Issue: Automattic/skillsmith#37. Source request: `0-prompt/prompt.md` (authoritative).

This document is the running record of the spec-phase Q&A. It captures WHAT and the
observable behavior, not HOW. Implementation choices belong to the design phase.

## Current behavior on trunk (established via spec-researcher, Q1)

These are facts about how the runtime behaves TODAY, cited file:line in the worktree.

- **Detection is lazy, at invoke time.** Each API provider checks its own env var
  inside `invoke()` and, if missing, returns `InvokeResult{ error: "<VAR> is not set" }`
  rather than throwing — `src/providers/openai-api.ts:8-14` (OPENAI_API_KEY),
  `anthropic-api.ts:8-14` (ANTHROPIC_API_KEY), `gemini-api.ts:8-14`
  (GOOGLE_GENERATIVE_AI_API_KEY). Codex reads `process.env.OPENAI_API_KEY`
  (`codex.ts:65`) but does not pre-check. `claude-code` and `mock` have no key gate.
- **No "is this agent configured" predicate exists.** `src/config/validate.ts` is
  purely structural. The public barrel `src/index.ts` exports only `defineConfig`,
  config types, `Provider`/`ProviderId`, `run`, `RunOptions` — no policy/credential seam.
- **Exit code is computed once, at the end**, by `prepareSummary`
  (`src/reports/summary.ts:52-77`): exit 0 iff `rows.length > 0 && rows.every(isRowPass)`,
  else 1. `run()` (`src/runner.ts:29-46`) returns that; returns 1 on
  PreconditionError/UserFacingError.
- **Run flow:** `runPipeline` (`src/pipeline/pipeline.ts:79`) → `runOneIteration` →
  `runScenario` → `runAgents` (`src/pipeline/agent-loop.ts:66`) iterates
  `config.roles.test.agents` and runs each via `runAgentPair`. Judge runs per pair in
  the same function; improver runs between iterations (`runImprovement`,
  `src/improvement/improver.ts:70`).
- **A misconfigured TEST agent today:** `runTestingAgent` returns `{ error }`
  (`testing-agent.ts:95`) → `runAgentPair` records it, SKIPS the judge, writes a
  per-agent report `{ review: { skipped: "testing failed: <VAR> is not set" } }`
  (`agent-loop.ts:209-222`). `classifyVerdict` maps `{skipped}` → `kind:"SKIPPED"`
  (`verdict.ts:26-28`); non-PASS rows make the scenario fail
  (`scenario-report.ts:83-92`); `isRowPass` treats SKIPPED as non-pass
  (`summary.ts:309-317`). **Net: the run already exits 1 today** (asserted by
  `src/__tests__/agent-loop.test.ts:25`, "any agent failing testing fails the run").
  BUT today this is a per-pair FAIL/SKIP that conflates "misconfigured" with "failed",
  still burns compute invoking the agent, and still spins up a Playwright project for it.
- **Role-aware behavior does NOT exist today.** Misconfigured JUDGE:
  `runJudgeAgent` returns `{ error: "judge dispatch failed: ..." }` per pair
  (`judge-agent.ts:69-75`), classified FAIL per cell — does NOT stop the run.
  Misconfigured IMPROVER: `runImprovement` only logs `result.error` and continues
  (`improver.ts:164-168`) — no degrade-to-test-only.
- **The "all test agents misconfigured" guard is emergent, not a function.**
  `prepareSummary` requires `rows.length > 0` AND every row PASS; `isRowPass` /
  `aggregateScenarioReport` return false when the agent list is empty
  (`summary.ts:67,309-317`; `scenario-report.ts:85`). So an empty/all-skipped matrix
  is a FAIL today — but ONLY because skipped agents still produce non-PASS rows. A
  future "skip" policy that EXCLUDES agents from the matrix entirely could collapse
  this into a vacuous pass. **Flag for design.**
- **The e2e Playwright seam:** `defineConfig` is an identity passthrough returning the
  RAW `SkillsmithConfigInput` (`src/config/define-config.ts`). In
  `testing-project/playwright.config.ts:23`, `config.roles.test.agents` is the raw
  `string[]` of ids; it maps one Playwright project per declared agent (`name: agentId`)
  with zero misconfiguration awareness. The e2e hook `runE2eVerification`
  (`testing-project/eval/utils/verify-e2e.ts`) builds plugins per agent workspace and
  attributes failures by Playwright `projectName` (= agent id). A misconfigured agent
  writes no plugin (empty workspace) but still has a Playwright project → its specs run
  against a non-existent plugin → spurious fail.
- **`testing-project/skillsmith.config.ts` currently declares only `claude-code`
  agents (haiku/opus).** There is NO `openai-api-nano` agent yet; the prompt's
  verification implies one must be added.

## Detection feasibility (established via spec-researcher, Q2)

- **Upfront, pre-invoke detection is feasible and exact for the three API-key
  providers.** Each gate is a single truthiness check on one env var at the top of
  `invoke()`, before any network/SDK call: `openai-api` reads `OPENAI_API_KEY`
  (`openai-api.ts:8`), `anthropic-api` reads `ANTHROPIC_API_KEY`
  (`anthropic-api.ts:8`), `gemini-api` reads `GOOGLE_GENERATIVE_AI_API_KEY`
  (`gemini-api.ts:8`). The agent's `model` field is irrelevant to the gate. So
  "is this agent misconfigured" is knowable with zero model invocation for these.
- **codex** has no pre-check but uses the SAME `OPENAI_API_KEY` (`codex.ts:65`); the
  same env check COULD apply to it by design choice. Today its misconfiguration
  surfaces only as an arbitrary SDK error string at invoke time, not a clean "not set".
- **claude-code and mock have NO upfront credential gate.** `claude-code` reads no
  env var; it authenticates via the Claude Agent SDK's own ambient mechanism
  (CLI session / its own env handling). skillsmith has no static visibility into
  whether claude-code is configured. **Consequence:** the testing-project's existing
  agents (haiku/opus) are `claude-code`, so they are NOT upfront-checkable; only the
  NEW `openai-api-nano` agent (provider `openai-api`) is. The design must NOT assume
  every provider has an upfront gate.
- **Provider id is statically derivable from the normalized `AgentDefinition`.**
  Users declare each agent with an explicit `provider` field
  (`AgentDefinitionInput.provider: ProviderId`, `types.ts:25-29`). `normalizeConfig`
  (`normalize.ts:23-39`) resolves `roles.test.agents` (a `string[]` of ids) into full
  `AgentDefinition`s carrying `provider`+`model`. The provider object is fetched via
  `getProvider(agent.provider)` (`registry.ts:23-29`). So the provider id needed to
  decide misconfiguration is available statically, before invoke.
- **The `Provider` contract today exposes only `{ id, invoke }`**
  (`src/providers/types.ts:50-53`) — no `requiredEnv` field, no `isConfigured()`
  method. The provider→env-var mapping is NOT data anywhere; it is hardcoded as string
  literals inside each provider's `invoke`. So an upfront predicate requires EITHER
  extending the provider contract OR a separate provider→credential mapping. (Which one
  is a design-phase choice; the spec only requires that an upfront predicate exist and
  be consumable by the e2e harness.)
- **The "<VAR> is not set" message is THREE separate string literals**, one per API
  provider (`openai-api.ts:12`, `anthropic-api.ts:12`, `gemini-api.ts:12`). There is
  no shared canonical "missing credential" function. The SAME invoke path is shared
  across roles (test/judge/improver all funnel through
  `getProvider(agent.provider).invoke(...)`); role-specific differences live only in
  how the CALLER handles the returned `{ error }`, not in detection.

## Boundary: "misconfigured" vs "failed" (confirmed; see R1)

- **Misconfigured** = the agent cannot run for an environmental reason knowable
  without grading its output — paradigmatically, a required provider credential is
  absent. The policy seam keys off this.
- **Failed** = the agent ran and produced an error or a non-passing result.
- Today the two are conflated into a single per-pair `{ error }` → SKIPPED path. The
  feature must separate "misconfigured (excluded up front)" from "ran and failed".

## Role-aware semantics (established via spec-researcher, Q3)

- **Judge and improver are each a SINGLE agent; only test is a list.**
  `NormalizedRoles.judge`/`improver` are `{ agent: AgentDefinition; prompt? }`
  (`types.ts:69-73`); `test` is `{ agents: AgentDefinition[] }`. So a run has exactly
  one judge and one improver, each with one provider — both upfront-checkable by the
  same predicate as test agents (judge dispatched at `judge-agent.ts:60`, improver at
  `improver.ts:148`).
- **Judge "stops the run" — mechanism and placement.** No pre-flight judge check
  exists today; the judge is invoked deep inside `runAgentPair`, once per pair, after
  that pair's testing agent ran (`agent-loop.ts:236-246`). The idiomatic early hard
  stop is a thrown `UserFacingError` (`util/errors.ts:1-6`) or `PreconditionError`
  (`resolve-cwd.ts:58-65`); `run()` catches exactly those two, prints the message, and
  returns 1 (`runner.ts:39-44`). `PreconditionError` is already used for config/path
  problems before any agent runs. Natural placement for a misconfigured-judge stop:
  early in `runPipeline`, after `loadConfig`/`resolveSelfImprovement`
  (~`pipeline.ts:82-84`), before the iteration loop. Observable distinction from a
  normal grading failure: a normal grading failure runs the whole matrix and exits 1
  with FAIL cells; a misconfigured-judge stop aborts up front with a single clear
  message and no graded matrix. Both are numerically exit 1. NOTE: `UserFacingError`
  is internal-only — NOT exported from `src/index.ts` today.
- **Improver "degrade to test-only" — reuses an existing seam.** The iteration count
  is mode-driven: `maxIterations = selfImprovement.mode === "test-only" ? 1 :
  selfImprovement.maxIterations` (`pipeline.ts:118-119`). The improver runs ONLY in
  `"self-improvement"` mode (`pipeline.ts:188-208`, plus a final sweep at
  `pipeline.ts:215-219`). So "test-only" already means "single iteration, run test
  agents + judge, no improver." Degrading a misconfigured improver = treat the run as
  `mode: "test-only"` (the intended reading; keeping N iterations without an improver
  is pointless because unchanged skills can't converge).
- **Degrading does NOT, by itself, change the exit code.** Exit code is computed solely
  from the persisted matrix by `prepareSummary` regardless of mode (`summary.ts:66-76`);
  mode/iteration-count only affect how many iterations feed the merged report. So a
  degraded-to-test-only run still exits per the test/judge matrix. The prompt is SILENT
  on whether a misconfigured improver should force non-zero on its own; from the code,
  "degrade to test-only" is purely "don't run the improver." **Needs a spec decision —
  see Q4.**
- **The `judge-skip-project` fixture is UNRELATED to this feature.** It exercises the
  existing "testing agent errored → skip THAT pair's judge" branch
  (`agent-loop.ts:209-222`), driven by the `mock-fail-testing` mock agent. The test
  ("judge phase is skipped when the testing agent reports an error",
  `agent-loop.test.ts:12-81`) asserts exit 1, a `{ skipped }` review for the failing
  agent, and a real PASS for the other agent. There is NO user-facing "turn off
  judging" toggle. The new "misconfigured judge stops the run" is a different axis and
  won't collide — but the design must avoid overloading the word "skip."
- **Testing-project caveat for tests.** In `testing-project/skillsmith.config.ts`, BOTH
  judge and improver are `claude-code` (`opus`), which has no upfront gate. So the
  judge/improver role-aware stops can only be EXERCISED with a provider that reports
  misconfiguration upfront. Researcher recommends defining misconfiguration via a
  provider-capability predicate and adding a deterministic mock-misconfigured provider
  (mirroring how `mock-fail-testing` drives the testing-failure path) so all three role
  behaviors can be unit-tested. (Implementation detail for the design phase; the spec
  only needs to require that all three role behaviors be deterministically testable.)

## Exit-code chokepoint and output surfacing (established via spec-researcher, Q4)

### Exit code (Part A)
- **Single chokepoint.** Exit code is decided ONLY in `prepareSummary` from the merged
  `report.json`: `allPass = rows.length > 0 && rows.every((r) => isRowPass(r, sortedAgents))`,
  `exitCode: allPass ? 0 : 1` (`summary.ts:66-67,76`). Everything depends on what reaches
  that function.
- **CENTRAL CONSTRAINT — excluding a test agent must NOT silently re-green the run.**
  There is no existing signal that an agent was "excluded" reaching `prepareSummary`.
  `isRowPass`/`agentsAllPass`/`aggregateScenarioReport` iterate only the agent ids that
  ACTUALLY APPEAR as rows in the report (`summary.ts:309-317,115-121`;
  `iteration-report.ts:179-188`; `scenario-report.ts:82-92`). "Declared agent count" is
  never carried into the report. The full declared roster IS seeded into the progress
  tracker (`config.roles.test.agents.map((a) => a.id)`, `pipeline.ts:113`), but the
  tracker is DISPLAY-ONLY and does not feed the exit code. **Therefore: if "warn" merely
  drops the misconfigured agent (no row) and the remaining rows all PASS, the run exits
  0 — re-introducing the exact bug.** Forcing non-zero on a partial run requires NEW
  state threaded to the single chokepoint. Two design-compatible shapes (design's
  choice): (a) exclude from EXECUTION (no invoke, no e2e) but still emit a non-PASS
  marker/row for the agent so existing "non-pass ⇒ exit 1" machinery fires — this ALSO
  auto-preserves the all-test-agents-excluded guard, since every row would be non-PASS;
  (b) add a top-level "excluded agents" field and force `allPass=false` when non-empty —
  must then handle the all-excluded case explicitly.
- **Improver degrade does NOT force non-zero by itself.** `test-only` is the DEFAULT
  mode (`self-improvement.ts:21`) and is exactly what `testing-project` runs
  (`skillsmith.config.ts:19`); a passing test-only matrix exits 0 today. Exit code is
  mode-agnostic (`summary.ts:52-77`). The prompt gives the improver different language
  ("degrades to test-only", no exit-code clause) than test agents ("warn" + explicit
  non-zero). So: misconfigured improver ⇒ degrade to test-only, exit derives from the
  test/judge matrix (can legitimately be 0 if all pass). **Spec decision: confirm the
  softer reading — the forced-non-zero rule is specific to test-agent exclusion.**
- **Misconfigured judge cannot yield exit 0** when implemented as the up-front hard stop
  (throw bypasses `prepareSummary`; `run()` hard-returns 1, `runner.ts:40-42`). Even the
  old per-pair path produced FAIL cells ⇒ exit 1. No exit-0 path exists.

### Output surfacing (Part B)
- **One end-of-run summary renderer:** `src/reports/summary.ts` — `renderSummaryLines`
  (123-150) builds the matrix table + final `RUN RESULT: PASS|FAIL` line; `fmtResult`
  (252-255) maps a `Cell` to its display string; `failureLines` (331-333) already
  special-cases SKIPPED as `"<agent>: SKIPPED <reason>"`; yellow coloring for SKIPPED at
  233-237. The plain-text mirror is `${runDirectory}/summary.txt` (line 74); colored
  output printed by `emitSummary` (80-83). A "misconfigured/excluded" annotation slots
  in here.
- **Machine-readable per-agent record:** `${scenario}/<agent>/report.json` via
  `writeAgentReport` (`agent-loop.ts:298-308`); merged `${runDirectory}/report.json` via
  `writeRunReport` (`iteration-report.ts:153-164`) — the canonical artifact
  `prepareSummary` consumes; coarser `${runDirectory}/run.json` via `writeRunSummary`
  (`iteration-report.ts:97-105`).
- **Status vocabulary is a fixed enum:** `TerminalStatus = "passed"|"failed"|"skipped"`
  (`progress/types.ts:3`), `PhaseSlot = "pending"|"running"|"passed"|"failed"|"skipped"`
  (`tracker.ts:60`), `Cell = PASS|FAIL|SKIPPED` (`verdict.ts:9-12`). An
  "excluded/misconfigured" outcome either reuses `skipped` (minimal change, already
  non-pass, but semantically muddy vs. testing-failure skips) or adds a new kind
  (clearer, wider change across enums + counters at `tracker.ts:284-318` + render +
  `fmtResult`). Design's trade-off. Spec only requires the outcome be CLEARLY surfaced
  and machine-distinguishable as a misconfiguration, not how.

## e2e harness contract (established via spec-researcher, Q5)

- **Public-barrel constraint (hard).** The testing-project is an OUTSIDE consumer of the
  skillsmith package (`testing-project/package.json` maps `"skillsmith": "file:.."`;
  root `package.json` exposes only `"exports": { ".": "./src/index.ts" }`). It can see
  ONLY what `src/index.ts` re-exports — today that is `defineConfig`, the config types,
  `Provider`/`ProviderId`, `run`, `RunOptions`. **The new "which agents are runnable /
  is this agent misconfigured" API MUST be a named export from `src/index.ts`.**
- **The predicate must operate on the RAW input shape and be synchronous + pure.**
  `playwright.config.ts` holds the un-normalized `SkillsmithConfigInput` (because
  `defineConfig` is identity), so `config.roles.test.agents` is a `string[]` of ids and
  each id's provider lives at `config.agents[id].provider`. Playwright evaluates its
  config module at startup synchronously, so the predicate must be a pure synchronous
  function of (config input + `process.env`) — no async, no model call. (For
  `openai-api-nano` this is exactly `!process.env.OPENAI_API_KEY`.)
- **Single e2e filter point.** `testing-project/playwright.config.ts:23-26` maps one
  Playwright project per declared test-agent id
  (`config.roles.test.agents.map((agentId) => ({ name: agentId, metadata: { agentId } }))`).
  Filtering misconfigured ids out of this `projects` array is the entire e2e-side change:
  removing a project removes its spec runs automatically (specs activate
  `plugin-counter-block-${project.metadata.agentId}`, so no second filter site is needed).
- **`openai-api-nano` must be ADDED** to `testing-project/skillsmith.config.ts`: an
  `agents` entry `{ provider: "openai-api", model: "<nano id>" }` plus its id in
  `roles.test.agents` (currently `["haiku"]`). Model string is FREE-FORM — validation
  requires only a known `provider` and a non-empty `model` (`validate.ts:77-84`); no
  model allow-list exists. Any plausible nano id works (e.g. `gpt-4.1-nano`); it is never
  reached because the credential gate short-circuits when `OPENAI_API_KEY` is unset. The
  id `openai-api-nano` is a valid plugin slug (`SLUG_PATTERN`, `scaffold-plugin.ts:5,13`).
- **`counter` scenario / e2e hook.** Scenario dir is `counter` (scenario NAME is
  `counter-block`); `npx skillsmith counter` selects by DIR name (`filterScenarios`
  matches `dirName`, `pipeline.ts:469`). The e2e spec `counter/e2e.spec.mjs` activates
  `plugin-counter-block-${project.metadata.agentId}`. `runE2eVerification`
  (`testing-project/eval/utils/verify-e2e.ts`) builds whatever `plugin-*` dirs exist in
  each agent's workspace (a misconfigured agent's workspace is EMPTY → builds nothing,
  already self-excluding) and attributes Playwright failures back by `projectName`
  (= agent id). **The bug:** `playwright.config.ts` still declares an `openai-api-nano`
  project, so Playwright runs the counter spec under it → activates a never-built
  `plugin-counter-block-openai-api-nano` → spurious `unexpected` failure attributed to
  (counter-block, openai-api-nano).
- **Two filter points consume the SAME public predicate** (the prompt's "harness must
  consume the API"): (1) runtime side — drop misconfigured TEST agents at/above the
  test-agent iteration (`agent-loop.ts:81-86`) BEFORE `beforeTestAgent`/`scaffoldPlugin`/
  invoke fire, so no scaffold dir is created and no compute is burned; (2) e2e side — the
  `projects` array (`playwright.config.ts:23-26`). Plus the role checks for judge/improver
  (Q3) on the runtime side.
- **Acceptance artifacts for the verification** (`npx skillsmith counter`, no OPENAI creds):
  - e2e runs for `haiku` only: Playwright JSON report `${iterationDir}/tests-report.json`
    contains results for `projectName: "haiku"` and NONE for `openai-api-nano`; the
    `list` reporter console output shows no `openai-api-nano` project.
  - no plugin built for the skipped agent: no `plugin-counter-block-openai-api-nano` in the
    wp-scripts build output / `.wp-env.json` plugins list (already true; the NEW guarantee
    is that no Playwright project references it).
  - no SPURIOUS failure: merged `${runDirectory}/report.json` has NO "e2e failed"
    VerificationFailure attributed to `openai-api-nano`; `haiku`'s counter e2e runs and is
    graded normally.
  - overall exit is still NON-ZERO (per Q4) because `openai-api-nano` was declared but
    excluded — surfaced as "misconfigured/excluded", NOT as an e2e failure. (The non-zero
    comes from the excluded-agent marker reaching `prepareSummary`, not from a fake e2e
    failure — these are compatible.)

## Resolved findings

_See "Current behavior on trunk" (Q1), "Detection feasibility" (Q2),
"Role-aware semantics" (Q3), "Exit-code chokepoint / surfacing" (Q4), and
"e2e harness contract" (Q5) above. All planned questions resolved._

## Requirements

Each requirement states WHAT and the observable behavior, not HOW. (Naming below —
"warn", "misconfigured", "policy seam" — is descriptive for this spec; it does not
prescribe identifiers. The design phase chooses names, types, and placement.)

### R1 — Misconfiguration is a distinct, pre-invoke condition
- R1.1 An agent is "misconfigured" when it cannot run for an environmental reason that
  is knowable WITHOUT grading its output — paradigmatically, a required provider
  credential is absent. This is conceptually distinct from "ran and failed".
- R1.2 For providers whose credential requirement is a plain environment read
  (`openai-api`→`OPENAI_API_KEY`, `anthropic-api`→`ANTHROPIC_API_KEY`,
  `gemini-api`→`GOOGLE_GENERATIVE_AI_API_KEY`), misconfiguration MUST be determinable
  before the agent is invoked — purely from the agent's declared provider plus the
  environment — with no model call.
- R1.3 Providers with no environment-readable credential gate (`claude-code`, `mock`,
  and `codex` unless the design opts it into the `OPENAI_API_KEY` check) are treated as
  "not statically misconfigurable": they are considered runnable from the static view,
  and any real misconfiguration continues to surface via the existing invoke-time error
  path. The design MUST NOT assume every provider can be checked upfront.

### R2 — Single policy seam (extensibility)
- R2.1 The decision "what to do about a misconfigured agent" MUST be routed through ONE
  policy seam consumed at the decision points, not scattered as policy-specific branches.
- R2.2 Only the "warn" policy is implemented now. The seam MUST be shaped so that "fail"
  (stop the whole run up front when ANY agent is misconfigured) and "skip" (proceed and
  exit zero) can each be added later by a localized change at the seam, NOT a rewrite.
- R2.3 "warn" is the DEFAULT behavior. "fail" and "skip" are NOT implemented (see Out of
  scope).

### R3 — "Warn" policy for a misconfigured TEST agent
- R3.1 The run proceeds with the test agents that CAN run; the misconfigured test agent
  is excluded from EXECUTION — it is not invoked, and its pre-test hooks (e.g. plugin
  scaffolding) do not fire. (Exclusion happens at/above the test-agent loop so no compute
  or workspace artifacts are produced for it.)
- R3.2 The misconfiguration is surfaced CLEARLY in the run output: in the human-readable
  end-of-run summary AND in the machine-readable run report, identifiable as a
  misconfiguration/exclusion and distinguishable from a normal grading failure (FAIL) and
  from an unrelated skip.
- R3.3 The run's exit status MUST be NON-ZERO whenever one or more declared test agents
  were excluded as misconfigured — EVEN IF every test agent that did run passed. A partial
  run must not exit zero. (This is the central anti-regression requirement: excluding an
  agent must thread a signal to the single exit-code chokepoint; merely dropping its row
  so the remaining rows all pass — yielding exit 0 — is FORBIDDEN.)
- R3.4 The existing "all test agents are misconfigured" degenerate case MUST remain a
  FAILURE (non-zero exit), never a vacuous pass. An empty/all-excluded matrix is not green.

### R4 — Role-aware handling
- R4.1 A misconfigured JUDGE STOPS the run: the run aborts with a clear, single message
  stating the judge cannot grade, and exits non-zero. This is observably distinct from a
  matrix of grading failures (no graded matrix is produced). It SHOULD be detected up
  front (before test agents are invoked) when the judge's provider is statically
  checkable.
- R4.2 A misconfigured IMPROVER DEGRADES the run to test-only: the test agents and judge
  run, but no improvement step runs. Degrading to test-only does NOT, by itself, force a
  non-zero exit — the exit status still derives from the test/judge matrix (so a clean
  test-only run may legitimately exit zero). The degrade MUST be surfaced in the run
  output. (The forced-non-zero rule of R3.3 is specific to excluded TEST agents.)
- R4.3 A misconfigured TEST agent follows the "warn" policy (R3).
- R4.4 All three role behaviors MUST be deterministically testable without real provider
  credentials (e.g. via a provider that can be made misconfigured on demand), mirroring
  how the existing deterministic testing-failure path is tested today.

### R5 — Public API consumed by the e2e harness
- R5.1 The runtime exposes a runnability/misconfiguration determination as a NAMED EXPORT
  from the package's public entry point, callable by an outside consumer (the
  testing-project). It MUST operate on the configuration the consumer holds and be a pure
  SYNCHRONOUS function of configuration plus environment (no async, no model call).
- R5.2 The SAME public API is consumed at BOTH the runtime exclusion point and the e2e
  harness, so the two agree on which agents are runnable.

### R6 — e2e harness excludes misconfigured agents
- R6.1 The e2e harness MUST NOT create a Playwright project (and therefore MUST NOT run
  any e2e spec) for a misconfigured agent. The project list is derived from the runnable
  agents via the R5 API.
- R6.2 `testing-project/skillsmith.config.ts` gains an `openai-api-nano` test agent
  (`provider: openai-api`) alongside the existing configured agent, so that absent
  `OPENAI_API_KEY` makes exactly that agent misconfigured.

### R7 — Constraints on all produced code, tests, and documentation
- R7.1 The policy logic is a SELF-CONTAINED, isolated component; it is not entangled with
  unrelated runtime code.
- R7.2 MINIMAL change: existing internal APIs/signatures are left unchanged wherever
  possible; only the minimal change needed is made. No gratuitous refactors.
- R7.3 Comment SPARINGLY — only what is not obvious from the code. Do not comment
  self-explanatory code; never modify comments on code that did not change.
- R7.4 NO internal-process vocabulary anywhere in the produced code, comments, tests, or
  documentation — no phase names, specifications, design documents, plans,
  acceptance-criteria/task identifiers, or similar tags.

## Acceptance criteria

Each criterion is observable and testable.

### AC1 — Pre-invoke misconfiguration determination
- AC1.1 Given an agent with `provider: openai-api` and `OPENAI_API_KEY` unset, the
  runnability API reports it as misconfigured/not-runnable WITHOUT invoking any model;
  with `OPENAI_API_KEY` set, it reports it runnable. (Analogous for `anthropic-api`,
  `gemini-api`.)
- AC1.2 An agent with `provider: claude-code` (or `mock`) is reported runnable regardless
  of environment (no static gate).

### AC2 — "Warn" exit-code behavior (anti-regression)
- AC2.1 A run with two declared test agents where one is misconfigured and the other runs
  and PASSES exits NON-ZERO. The passing agent's result is recorded as a pass; the
  misconfigured agent is clearly marked as misconfigured/excluded, not graded.
- AC2.2 The misconfigured test agent is NOT invoked and produces no workspace/scaffold
  artifacts (no pre-test hook side effects for it).
- AC2.3 A run where ALL declared test agents are misconfigured exits NON-ZERO (not a
  vacuous pass).
- AC2.4 The misconfiguration appears in BOTH the end-of-run summary text and the merged
  run report, distinguishable from a FAIL verdict.

### AC3 — Role-aware behavior (deterministic, no real credentials)
- AC3.1 A run whose JUDGE is misconfigured aborts up front with a clear single message and
  exits non-zero; no graded matrix is produced. (Driven deterministically by a provider
  that can be made misconfigured.)
- AC3.2 A run whose IMPROVER is misconfigured runs test agents + judge with no improvement
  step (degraded to test-only), surfaces the degrade, and exits per the test/judge matrix
  (e.g. exits zero if that matrix all-passes).
- AC3.3 A run whose TEST agent is misconfigured behaves per AC2.

### AC4 — Single seam / extensibility (structural)
- AC4.1 All decision points consult one policy seam; there is no policy-specific branching
  scattered across the runtime. (Reviewable in the diff; the "fail"/"skip" cases are
  expressible as additions at the seam without touching the decision points.)

### AC5 — e2e harness verification (the prompt's named acceptance)
- AC5.1 Running `npx skillsmith counter` in `testing-project` with NO OpenAI credentials
  (so `openai-api-nano` is misconfigured):
  - runs the counter e2e for the configured (`claude-code`) agent only; the Playwright
    report contains results for the configured agent and NONE for `openai-api-nano`;
  - builds no plugin for `openai-api-nano` and creates no Playwright project for it;
  - does NOT fail spuriously on `openai-api-nano` (no "e2e failed" attributed to it);
  - the overall run exits NON-ZERO, with `openai-api-nano` surfaced as
    misconfigured/excluded (not as an e2e failure).
- AC5.2 The same run with OpenAI credentials present creates the `openai-api-nano`
  Playwright project and includes it in the e2e set (the exclusion is conditioned on
  actual misconfiguration, not hard-coded).

### AC6 — Constraints (reviewable)
- AC6.1 The policy logic is isolated; existing internal signatures are unchanged except
  where strictly necessary (reviewable in the diff).
- AC6.2 No process vocabulary (phase/spec/design-doc/plan/acceptance-criteria/task tags)
  appears in any produced code, comment, test, or doc. (Grep-checkable.)
- AC6.3 Comments are sparse and only on non-obvious code; unchanged code's comments are
  untouched.

## Open decisions deferred to the design phase

These are intentionally NOT resolved here (they are HOW, not WHAT); the design phase must
settle them within the requirements above:
- The exact mechanism that threads "an agent was excluded" to the single exit-code
  chokepoint (`prepareSummary`/`isRowPass`): reuse the existing non-pass marker for the
  excluded agent vs. a new top-level "excluded agents" field. Either is acceptable if it
  satisfies R3.3/R3.4.
- Whether to add a new status/verdict kind (e.g. "excluded"/"misconfigured") or reuse the
  existing SKIPPED kind for surfacing — provided R3.2's "distinguishable from a normal
  failure and unrelated skips" holds.
- How the provider→credential requirement is expressed (extend the `Provider` contract
  with a capability vs. a separate provider→env mapping) and whether `codex` opts into the
  `OPENAI_API_KEY` check.
- The precise public-API surface/signature of the R5 runnability export (what it takes and
  returns) — constrained only by "named export from the public entry point, pure and
  synchronous over config input + env".
- Whether to export `UserFacingError` (currently internal-only) or reuse an existing
  precondition/abort path for the judge stop (R4.1).
- The exact nano model id string for the `openai-api-nano` agent (free-form; never reached
  when `OPENAI_API_KEY` is unset).

## Out of scope

- Implementing the "fail" policy (stop the whole run up front when any agent is
  misconfigured). The seam must make it a localized future addition.
- Implementing the "skip" policy (proceed and exit zero). Same — a localized future
  addition. (Note: any future "skip" that EXCLUDES agents from the matrix must explicitly
  re-establish the all-excluded guard of R3.4, which "warn" preserves implicitly.)
- Changing exit-code semantics for the improver-degrade or judge cases beyond what R4
  states.
- Adding misconfiguration detection for providers that have no environment-readable
  credential gate (`claude-code`, `mock`); they remain runnable from the static view.
