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

### Q3 — The hooks contract: what must hooks learn about misconfigured agents, and when?

Researcher findings (verified against both real configs, the e2e hook, and README):
- (a) TEMPORAL — splits by when misconfig is knowable:
  - Pre-flight-knowable (missing API key for env-var providers) → available at `beforeAll` and onward. This is the constraint's "filtered list of agents that will actually run" — a `beforeAll`/`beforeTestAgent` hook provisioning per-agent state should provision only for survivors.
  - Runtime-discovered (invalid/revoked token) → known only AFTER the first failing invoke of that agent; cannot be in the `beforeAll` set.
  - Two honest readings: (i) STATIC-only — expose the pre-flight set at beforeAll, frozen (cannot include runtime-discovered); (ii) PROGRESSIVE — set grows as agents are discovered-bad, so `afterAll`/`afterIteration` see the fuller set. The prompt's two phrasings map onto these: "filtered list that will run" = beforeAll-time frozen roster; "set of agent definitions that failed" = accumulating. Requirement: a `beforeAll`/`beforeTestAgent` consumer must see pre-flight skips (so it doesn't provision for a dead agent); an `afterAll`/reporting consumer should see everything skipped. Minimal version (i) satisfies the literal constraint and is far simpler — flag to maintainer.
  - Constraint: claude-code has NO pre-flight env check and codex's is in the SDK, so a fully-accurate beforeAll "will-run" list is only free for the 3 env-var providers' missing-key case unless new pre-flight probes are added.
- (b) SHAPE — passive data on context, NOT a new callback. All hook contexts extend `RunContext` (which carries `config`); adding a field (e.g. `skippedAgents`/`misconfigured`) to `RunContext` propagates to ALL hooks for free. The prompt's "set/list" phrasing describes DATA, not an event; a new `onAgentSkipped` callback would be the first hook off the fixed lifecycle order. README:48,76 contract — "forks implement only the hooks they need against the harness's runtime contract" — supports passive context data. Keyed by AGENT ID (id may fill multiple roles). If the set must grow over the run, the field is "live"/mutable on the shared-by-reference `RunContext` (a hook reading early vs late sees different contents) — spec should state this explicitly; or design passes a fresh per-hook snapshot.
- (c) REAL CONSUMER (grounds the success criterion): `testing-project` `beforeTestAgent` calls `scaffoldPlugin(agentWorkspace, scenario.name, agent.id)` — provisions a per-agent WP plugin (slug `plugin-${scenario}-${agentId}`). It should NOT scaffold for a skipped agent (wasted work; plants a plugin dir the e2e hook would try to build/boot for an agent that produced nothing). Strongest justification for the pre-flight "will-run" list reaching `beforeTestAgent`.
  - The `afterAllScenarios` e2e hook (`verify-e2e.ts`) discovers agents by walking ON-DISK workspaces and ALREADY tolerates absent agents (guards `if (!existsSync(workspaceDir)) continue` at :57; returns `[]` if no plugins at :69). So if the design takes "skipped tester = no workspace dir" (true-absence), THIS REAL HOOK NEEDS ZERO CHANGES. Strong point for the absence representation. A present-but-marked-skipped row also wouldn't break it, but a hook enumerating agents from `config.roles.test.agents` (not disk) would then need the skipped set to avoid provisioning for dead agents.

## Open scope decisions to escalate to maintainer (deferred to design, recorded for completeness)

These are genuine forks the spec does NOT resolve; design must choose with maintainer input. They are scope/behaviour decisions (WHAT), surfaced here so they aren't lost:
1. **Unknown provider: abort vs skip.** Today an unknown `provider` id is a hard `PreconditionError` abort. Issue lists "a provider that doesn't exist" as a misconfiguration example. Decision: flip to per-agent skip (honors "ignored everywhere"), or keep fail-fast for structurally-invalid config (typo'd provider id = author error) and apply skipping only to credential problems?
2. **Classifier breadth: full vs minimal.** Full = inspect structured SDK errors (HTTP status / error name) so invalid-token-on-call (401/403) and nonexistent-model (404) are classified as skip. Minimal = treat only the deterministic missing-key (+ unknown-provider, pending #1) as skip, leave everything else (incl. 401-on-call) a normal failure. Minimal is much smaller/safer but under-covers the prompt's explicit "invalid API token" example.
3. **All-testers-misconfigured outcome.** Empty tester set currently makes scenarios/run fail. Choose: abort with a clear message / inconclusive / fail.
4. **Tester skip surface representation.** True-absence (no row, no workspace) vs present-but-marked-`skipped: misconfigured`. Either way the pass-math functions must EXCLUDE misconfigured-skip from numerator AND the non-empty denominator. Absence is transparent to the existing e2e hook; marked-skip maps onto the existing tracker grid and `classifyVerdict` SKIPPED kind.
5. **Hooks contract temporal scope.** Static-only (pre-flight set at beforeAll, frozen) vs progressive (accumulating set visible by afterAll).
6. **Judge/improver consequence.** Recommended: misconfigured judge → fail-fast/abort (cardinality 1 blocks core function); misconfigured improver → degrade self-improvement to test-only. Confirm with maintainer (issue's "skip everywhere" wording was written for plural testers).

### CLI surfacing (prompt's open assumption — resolved)

The prompt assumed "the CLI already announces failing agents today; desired behaviour is failures continue to be surfaced." Researcher confirmed this is PARTIALLY true today: runtime invoke errors are announced per-pair via the live `ProgressTracker` (phase rows show pass/fail/skip) and the final summary; a static `PreconditionError` prints its error list and exits 1 (`runner.ts:40-44`). There is NO dedicated "agent X skipped for the whole run because misconfigured" announcement yet. So the desired behaviour ("failures continue to be surfaced") is preserved, but the NEW behaviour needs a clear, ONE-TIME per-run surfacing of each misconfigured/skipped agent and its reason — replacing today's N identical repeated failure rows.

## Consolidated Requirements

Scope: change how `skillsmith` treats an agent (defined in `skillsmith.config.ts` `agents`) whose configuration/credentials are defective, so it is skipped consistently across all phases of a run instead of producing repeated failures or partial execution. WHAT, not HOW.

1. **Definition of "misconfigured."** An agent is misconfigured when it has an agent-local configuration or credential defect that would fail identically on every attempt regardless of scenario or iteration. In scope: missing required API credential (deterministic, pre-call for env-var providers); invalid / revoked / unauthorized credential (401/403); and — pending open decision #1 — unknown provider id and nonexistent model (404). Out of scope (these remain ordinary test failures, NOT skips): transient/operational errors — rate limit (429), 5xx, network timeout, context-length exceeded, content filter, and step-cap (MAX_STEPS) exhaustion.

2. **A misconfigured agent does no work in any phase.** Once an agent is determined misconfigured, for the remainder of that run: as a TESTING agent it generates no code (its testing phase does not execute); its paired JUDGE review does not run; and it is excluded from evaluation in every subsequent iteration (including re-selection in `failed-pairs`/`failed-scenarios` scope and any final full pass). This fixes the confirmed bug where a defective agent is re-selected and re-fails every iteration.

3. **Detection timing.** Misconfiguration must be detected (a) pre-flight where deterministically knowable (e.g. a required credential is absent) so the agent can be excluded before any phase runs, and (b) at runtime on the first invocation that fails with a misconfiguration-class error, after which the agent is treated as misconfigured for the rest of the run. (The precise classifier breadth is open decision #2.)

4. **Pass/fail accounting.** A misconfigured agent must NOT count as a failure and must NOT count toward the pass denominator — it is excluded from the matrix verdict. The run's pass/fail is computed over the surviving (well-configured) agents only. (Today a skipped cell counts as a failure; that accounting must change.) The surface representation — entirely absent from the matrix vs present and marked "skipped: misconfigured" — is open decision #4; either way the verdict math must exclude it.

5. **Degenerate case — all testers misconfigured.** When every testing agent for a scenario (or the whole run) is misconfigured, the run must reach a clearly-defined, explicit outcome rather than silently passing on an empty set or failing as an empty-set artifact. The chosen outcome (abort / inconclusive / fail) is open decision #3; the requirement is that it is explicit and clearly surfaced.

6. **Single-instance roles (judge, improver).** Because the judge and improver are single agents, "skip everywhere" does not transfer directly:
   - Misconfigured JUDGE: the run cannot grade, so it must terminate in a clear, defined way (recommended: fail-fast/abort with a message naming the judge and reason; ideally pre-flight before any tester runs). Open decision #6.
   - Misconfigured IMPROVER (self-improvement mode only): the run still produces a valid test/judge matrix, so it must degrade gracefully (recommended: behave as test-only — run the sweep, attempt no edits, do not spin redundant iterations). Open decision #6.
   - Detection is per agent id; an id used in multiple roles (a supported, exercised configuration) is detected once and the role-appropriate consequence applies wherever it is referenced.

7. **Hooks are informed (explicit prompt constraint).** Hooks must be able to learn which agents are misconfigured/skipped, expressed by agent id (with the role(s) each fills). The pre-flight-known skips must be visible from `beforeAll` onward so per-agent provisioning hooks (e.g. `beforeTestAgent` infra scaffolding) do not set up state for an agent that will not run. Runtime-discovered skips should be visible to end-of-run/reporting hooks (e.g. `afterAll`). Provided as passive data on the existing hook context (keyed by agent id), not a new mandatory callback. Whether the contract is static-only or progressively accumulating is open decision #5.

8. **CLI surfacing.** Existing failure surfacing must be preserved, and each misconfigured/skipped agent must be announced once per run with its reason (replacing today's repeated identical per-scenario/per-iteration failure rows). A misconfigured agent must be visually distinguishable from a well-configured agent that genuinely failed its tests.

9. **Backward compatibility.** A run in which no agent is misconfigured must behave exactly as today (same matrix, same verdict, same hook firing, same CLI output). The new behaviour only changes the handling of defective agents.

### Success criteria (measurable)

- Given N testing agents where one has a missing/invalid credential and the rest are well-configured, the run completes; the matrix contains rows only for the well-configured agents (or rows clearly marked skipped that don't affect the verdict); the misconfigured agent appears in NO scenario's pass/fail accounting and in NO subsequent iteration's re-selection.
- The misconfigured agent is announced exactly once per run in the CLI with its id and reason, not once per (scenario, iteration).
- A transient error (e.g. a 429) on a well-configured agent still produces a real test failure in the matrix — it is NOT silently skipped.
- A `beforeTestAgent` hook does not fire any per-agent provisioning for a pre-flight-misconfigured agent; the misconfigured set (by agent id) is readable from a hook.
- When all testing agents are misconfigured, the run terminates in the defined explicit outcome (not a silent pass).
- A run with zero misconfigured agents is byte-for-byte equivalent in matrix/verdict/CLI to current behaviour.

### Explicitly out of scope

- Retrying or repairing a misconfigured agent (no auto-fix of credentials).
- Distinguishing degrees of transient failure or adding retry/backoff policy.
- Adding new providers or changing provider auth mechanisms.
- The exact API shape of the hooks field, the classifier implementation, and the surface representation of skipped rows (these are design-phase concerns; the open decisions above frame them).
