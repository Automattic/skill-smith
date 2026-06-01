# Requirements — Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37

## Rough idea

When `skillsmith` runs in a project whose `skillsmith.config.ts` defines agents, any agent that is misconfigured — e.g. an invalid API token, a provider that doesn't exist, or similar configuration errors — should be skipped for the entire run rather than causing failures or being partially executed. A skipped agent does no work in any phase: testers don't generate code, judges don't review, and the agent is excluded from evaluation in subsequent iterations. In effect, misconfigured agents are ignored everywhere for that run.

Constraints from the prompt:
- Hooks must be informed about misconfigured agents — either the set of agent definitions that failed, or the filtered list of agents that will actually run (shape open for design).

Assumptions to validate:
- The CLI already announces failing agents today. (Open — to confirm; desired behaviour is failures continue to be surfaced in the CLI.)

## Current-code findings (pre-Q&A, from reading the worktree)

- `src/config/validate.ts` (`collectConfigErrors`) validates config **shape** only: provider id must be a known `ProviderId`, `model` must be a non-empty string, role references must resolve. An unknown provider id is a hard config error that aborts the whole run before any agent work.
- Runtime misconfiguration (missing API key) is detected **per invocation inside each provider**. e.g. `anthropic-api.ts`, `openai-api.ts`, `gemini-api.ts` return `{ finalText: "", toolUseCount: 0, error: "<KEY> is not set" }` when the env var is absent. `claude-code`/`codex` surface SDK/transport errors as `error`.
- Today a misconfigured testing agent is **not skipped**: `agent-loop.ts` runs it, the testing call returns an `error`, the judge is then skipped for that pair (`status: "skipped", detail: "testing failed"`), and a `{ skipped: "testing failed: ..." }` review is persisted. This repeats **per scenario and per iteration**, producing repeated failed/error rows in the matrix.
- The judge agent is a single agent (`config.roles.judge.agent`); the improver is a single agent (`config.roles.improver.agent`). Testing agents are a list (`config.roles.test.agents`).
- Re-selection (`select-scenarios.ts`, `failed-pairs`/`failed-scenarios`) keys off the previous iteration's report, so a misconfigured agent's failures currently feed back into what gets re-run.
- Hooks receive `config` in their context (`RunContext`/`AgentContext`); there is no existing field naming skipped/misconfigured agents.

## Q&A

### Q1 — What concretely counts as "misconfigured"? (static vs runtime; permanent vs transient)

Researcher findings (verified against code):
- TWO classes handled at different layers:
  1. **Static / structural** — caught at load by `collectConfigErrors`, throws `PreconditionError`, aborts the WHOLE run before any phase. Includes: unknown `provider`, empty `model`, role referencing an unknown agent id, bad `mode`/`scope`. The issue's example "a provider that doesn't exist" falls HERE today (hard abort, not skip).
  2. **Runtime credential / dispatch** — NOT caught at load; surfaces per-invocation inside the 6 providers. Missing env var → providers return `{ error: "<KEY> is not set" }`. An *invalid* (present-but-wrong) key is NOT pre-checked — it surfaces as a thrown/SDK error captured into `InvokeResult.error` at invoke time.
- **No pre-flight credential probe** anywhere today.
- Issue #37 body == prompt verbatim; no extra detail, no comments.
- Today nothing remembers a bad agent across the run: a missing-key tester re-fails on every (scenario, agent) pair, every iteration, and is NOT excluded from re-selection — contradicting "excluded from evaluation in subsequent iterations."

Detail (researcher follow-up, all verified against code unless flagged as intent-reading):
- (a) Unknown provider is detectable with ZERO I/O (`getProvider` would throw); it is the example most entangled with existing structural validation. Flipping it abort→skip means demoting the `isProviderId` check and updating `config-validate.test.ts`. Researcher reads the prompt's spirit ("ignored everywhere", "rather than causing failures") as favouring a per-agent skip over a whole-run abort, but flags this as the single biggest open scope question — recommend escalating to maintainer.
- (b) Detection splits three ways today: missing-env-var is deterministic/pre-call for `anthropic-api`/`openai-api`/`gemini-api`; `codex` has no guard (surfaces in SDK); `claude-code` has NO env guard at all (ambient CLI/subscription auth, so "missing credential" isn't an env-var question for it). Invalid-but-present token is NEVER pre-checked — only fails on first real API call (401/403) captured into `InvokeResult.error`. So a pure pre-flight skip is deterministic ONLY for the three env-var providers' missing-key case; the prompt's "invalid API token" example forces the design to ALSO handle the runtime-discovered case (skip the agent for the REST of the run after first auth failure).
- (c) NO existing code distinguishes error class — every failure (missing key, 401, 429, 500, timeout) lands in the same `InvokeResult.error` string and is treated identically. Drawing this line is net-new. Recommended split:
  - **Skip-everywhere** (agent-local, deterministic, fails identically every retry regardless of scenario): missing API key; invalid/revoked/unauthorized token (401/403); unknown provider (pending decision); nonexistent model (404/"model not found").
  - **Real test failure** (agent IS configured; this attempt failed; keep current behaviour, stays in matrix): rate limit / 429, 5xx, network timeout, context-length exceeded, content filter, MAX_STEPS exhaustion.
- Classifier hard part: the discriminating signal (HTTP status / error name) lives inside SDK error objects, but the harness flattens to `err.message` string at catch time. Two design forks: (i) inspect structured error before stringifying (full status-aware classifier), or (ii) minimal — treat only the deterministic "<KEY> is not set" (+ unknown provider) as skips, leave everything else (incl. 401-on-call) as a normal failure. Option (ii) is much smaller/safer but under-covers the prompt's "invalid API token" example.
- Closest prior art: commit 134431a "Skip judge phase when testing agent reports an error" — skips the judge on tester error but keeps the failed row; no notion of skip-everywhere or error class.

Two scope decisions to escalate to maintainer (carried as OPEN, below): (1) does unknown-provider flip abort→skip? (2) full HTTP-status-aware classifier vs minimal deterministic-only classifier?

### Q2 — What does "skipped everywhere" mean per role/phase? (testers vs judge vs improver; same id in multiple roles)

Researcher findings (verified against report/tracker/config code):
- (a) TESTING — the load-bearing requirement is that a misconfigured tester must be **excluded from pass/fail math** (count as neither pass nor fail; removed from the denominator), NOT marked as a failure.
  - Today pass math is computed over whatever agent rows exist: scenario passes iff `agentsList.length > 0 && every row PASS` (`scenario-report.ts:82-92`); run passes iff every scenario passes and non-empty (`iteration-report.ts:166-177`).
  - CRITICAL: the existing `classifyVerdict` SKIPPED kind currently counts as FAIL (pass math requires `kind === "PASS"`). So a "present but marked skipped" row would still fail the scenario unless the pass-math functions are changed to exclude misconfigured-skip rows. **This pass-math change is required regardless of surface representation.**
  - Per-agent rows are built by `readdirSync` of the scenario dir (a row exists iff a workspace dir + report.json exist). So "absent" = never dispatch / never write the row; "marked-skipped" = deliberately write a `{ skipped: "misconfigured: ..." }` row.
  - ProgressTracker grid is built UP FRONT from `config.roles.test.agents.map(a => a.id)` and `slots()` THROWS on unknown agent id. "Marked-skipped" maps cleanly (mark phases `skipped`); "absent" requires filtering ids at tracker construction — and runtime-discovered misconfig (invalid token on first call) can't be filtered at construction, the tracker has no API to retroactively shrink the grid.
  - Researcher's read: cleanest end-state honoring both wording and pass math = a distinct "skipped: misconfigured" state EXCLUDED from pass/fail; surfaced once as "agent X skipped (misconfigured: <reason>)" rather than N identical failed rows. Surface form (true absence vs marked-and-ignored) is a design choice; the pass-math exclusion is the load-bearing change.
- (a-edge) ALL-TESTERS-MISCONFIGURED needs an EXPLICIT decision — it won't fall out cleanly. Empty agent list currently makes the scenario fail (`agentsList.length > 0` is false) and an all-empty run fails. Options: abort / inconclusive / fail.
- (b) JUDGE (cardinality 1) — "skip everywhere" is incoherent: with no judge nothing grades, so the run can't produce its core output (the matrix). Today a judge error fails EVERY pair. Researcher recommends **fail-fast / abort** with a clear "judge agent X is misconfigured: <reason>" message, ideally PRE-FLIGHT before any tester runs (analogous to `PreconditionError`/`checkPaths`). The issue's "skip everywhere" wording was written for the plural-testers case and doesn't transfer to the single blocking judge — flag asymmetry to maintainer.
- (c) IMPROVER (cardinality 1, self-improvement mode only) — today an improver error is logged and the loop continues (runs again against unedited skills until maxIterations). Only `runImprovement` mutates skills between iterations, so iterating without an improver is pointless. Researcher recommends **degrade self-improvement → test-only**: run the test/judge sweep, never attempt edits, don't spin N identical iterations. Alternative: abort. Leans degrade (matches current lenient behaviour + issue's "ignored, not fatal" spirit).
- (d) SAME AGENT ID ACROSS MULTIPLE ROLES — confirmed SUPPORTED and USED in practice (`examples/skillsmith.config.ts` uses `cc-opus` as both tester and improver; smoke fixture uses `opus` as both judge and improver). No validator forbids cross-role reuse; `normalizeConfig` shares the same `AgentDefinition` by reference. Misconfiguration is a property of the agent's config (provider/model/credentials), identical across roles → **detect once per agent id, apply the role-appropriate consequence at each reference** (tester → exclude rows; judge → fail-fast; improver → degrade). Hooks contract should expose the misconfigured set keyed by AGENT ID (with which role(s) it fills), not per-phase.
- BUG CONFIRMED (the one the issue calls out): `select-scenarios.ts:68-94` re-selection treats `entry.error` and non-PASS as failing, so today a skipped/errored agent gets RE-SELECTED every iteration — it is NOT excluded from subsequent evaluation. The new behaviour must make re-selection skip misconfigured agents.

### Q3 — pending
