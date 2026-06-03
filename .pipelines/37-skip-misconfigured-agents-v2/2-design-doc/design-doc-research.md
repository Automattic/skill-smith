# Design research: skip misconfigured agents across a run

Issue: Automattic/skillsmith#37. Inputs: `1-spec/spec.md` (R1–R7 / AC1–AC6, Open items),
`1-spec/spec-research.md` (grounded current behavior). This document is the running
record of the design-phase Q&A and the DECIDED design. It states HOW; it does not
re-open settled requirements.

Naming below ("warn", "misconfigured", "policy seam", "runnable") is descriptive for
this document only. The shipped deliverables carry no internal-process vocabulary
(R7.4 / AC6.2): the chosen identifiers (`providerRunnable`, `agentRunnable`,
`runnableTestAgentIds`, `decideRunnability`, `excluded`, `misconfigured`) are ordinary
domain words, not phase/spec/plan/AC tags.

---

## The core architecture (one policy seam)

A single self-contained module — `src/policy/runnability.ts` (new, isolated per
R7.1) — owns two responsibilities and nothing else:

1. **Static runnability** — given an agent's declared provider plus the environment,
   decide whether the agent is misconfigured (R1, R5). Pure, synchronous.
2. **The policy seam** — given the declared agents and their runnability, decide what
   happens per role under the active policy (R2). "warn" is the only policy built; the
   seam is shaped so "fail"/"skip" are a localized addition (R2.2).

Every decision point (test-agent loop, judge pre-flight, improver pre-flight, e2e
`projects` array) consults this one module. No policy-specific branching lives at the
decision points (AC4.1).

---

## Open items and their resolution

_(All six settled. Status: COMPLETE.)_

1. Exit-code threading (R3.3/R3.4) — **DECIDED (Q1): per-agent non-PASS marker row written to disk**
2. Verdict kind (R3.2) — **DECIDED (Q2): reuse `SKIPPED` via `{skipped:"misconfigured: …"}` with a stable prefix**
3. Provider→credential mapping + `codex` opt-in (R1.2/R1.3/R5) — **DECIDED (Q3): standalone SDK-free map; codex OUT**
4. Judge-stop error path (R4.1) — **DECIDED (Q5): throw internal `UserFacingError` pre-loop; no new export**
5. R5 public runnability API surface/signature — **DECIDED (Q4): `providerRunnable` atom + `agentRunnable` + `runnableTestAgentIds` (public); `decideRunnability` plan (internal)**
6. Concrete bits: nano model id, playwright filter point, report shape — **DECIDED (Q5)**

Deterministic testability (R4.4) — **DECIDED (Q5): real `openai-api` provider + env-scrubbed `OPENAI_API_KEY` for all three role fixtures.**

(Improver-degrade mechanism also DECIDED at Q4: flip `selfImprovement.mode="test-only"`.)

---

## DECISION 1 — Exit-code threading: per-agent non-PASS marker row (Open item 1; R3.3/R3.4)

**Mechanism (option (a)).** A misconfigured TEST agent is excluded from EXECUTION
(no invoke, no `beforeTestAgent`/scaffold, no e2e) but the runtime still WRITES a
per-agent `${scenario}/<agentId>/report.json` carrying a distinct non-PASS marker in
its `review` block. This row flows through the unchanged chain to the single
chokepoint:

- `aggregateScenarioReport` reads agent rows from DISK (`scenario-report.ts:53-79`),
  so the marker file becomes a row in `<scenario>/report.json`.
- `classifyVerdict` scores the marker non-PASS → `aggregateScenarioReport.allPass`
  false (`scenario-report.ts:83-92`), `agentsAllPass` false
  (`iteration-report.ts:179-188`), `scenariosAllPass` false, `isRowPass` false
  (`summary.ts:309-317`) → `prepareSummary` exit 1 (`summary.ts:66-67,76`).

**Why this and not a top-level "excluded" field (option (b)).** Option (a) touches
ZERO existing scoring code — it reuses the exact path the testing-failure SKIP
already travels (researcher reproduced the on-disk row shape via the judge-skip
fixture). Option (b) requires a NEW branch inside `prepareSummary` plus bespoke
re-handling of the all-excluded case. Option (a) is the more minimal change (R7.2).

**R3.4 auto-preserved.** When ALL declared test agents are misconfigured, every row
is the non-PASS marker, so `agentsAllPass`/`scenariosAllPass` are false and the
empty-agents guard (`iteration-report.ts:170,182`) never even has to fire. The
all-excluded matrix is non-green for free.

**Multi-iteration survival (verified).** In `failed-pairs`/`failed-scenarios`,
`collectFailingAgents` (`select-scenarios.ts:80-92`) adds the excluded agent to the
re-run set because its marker is non-PASS. On re-selection the runtime re-excludes it
and re-writes the same marker row; `mergeIntoRunningReport` (`iteration-report.ts:115-146`)
merges agent rows (new wins, untouched inherit) so the marker is never dropped. In
`all` scope it is re-written every iteration. The row therefore reaches the chokepoint
in every iteration topology. **Design rule:** the exclusion site MUST write the marker
row on every iteration the agent is in the active selection (i.e. exclusion + marker
write happen together at/above the test loop, not once).

---

## DECISION 2 — Verdict kind: reuse `SKIPPED` with a stable reason prefix (Open item 2; R3.2/AC2.4)

**Decision.** The excluded agent's marker row is `review: { skipped: "misconfigured: <VAR> is not set" }`.
`classifyVerdict` maps `{skipped:string}` → `{kind:"SKIPPED"}` with NO change
(`verdict.ts:26-28`). The misconfiguration is carried in the reason string with a
stable, machine-parseable prefix. A shared constant (e.g. `MISCONFIGURED_REASON_PREFIX
= "misconfigured: "`) is defined once in the policy module and reused by the runtime
marker-writer and the tests so the prefix never drifts.

**Why reuse, not a new Cell kind.** The researcher experimentally confirmed
(`verdict.ts:20-81`) that the ONLY payload reaching the `SKIPPED` kind is
`{skipped:string}`. A novel key (`{misconfigured}`, `{excluded}`) falls through to the
raw-judge branch (`verdict.ts:76-78`) and renders as **FAIL with "no rubrics or
acceptance in verdict"** — indistinguishable from a grading failure, VIOLATING R3.2. To
make a new key distinct would require extending `classifyVerdict` + a new `Cell` kind +
`fmtResult`/`failureLines`/coloring + the tracker counters switch
(`tracker.ts:294-318`) — a wide change rejected under R7.2. Reusing `{skipped}` gets a
non-PASS, distinct-from-FAIL, already-rendered kind for free.

**Machine-distinguishable (AC2.4).** In the merged `report.json` the excluded agent's
row is `{ review: { skipped: "misconfigured: …" } }`. It is distinguishable from:
- a grading **FAIL** — a FAIL row has no `skipped` key (it is `{review:{pass:false,…}}`
  or rubric/acceptance shape); `classifyVerdict` → `FAIL`.
- an **unrelated skip** (testing-failure) — that row is `{skipped:"testing failed: …"}`
  (`agent-loop.ts:220-222`). The two are separated by the reason-string PREFIX
  (`"misconfigured: "` vs `"testing failed: "`), which is stable and grep-checkable.

**Human-distinguishable (R3.2).** The matrix column shows `cell.kind` = `"SKIPPED"` for
both (`fmtResult`, `summary.ts:252-255`); the reason surfaces ONLY in the detail block
via `failureLines` (`summary.ts:331-333`) as `"<agent>: SKIPPED <reason>"`. So the human
sees `<agent>: SKIPPED misconfigured: <VAR> is not set` vs
`<agent>: SKIPPED testing failed: …` — visibly different. The reason string is the
designed human-distinguishability lever; nothing else keys off the kind that would
conflate them (yellow coloring at `summary.ts:233-237` applies to both, which is
acceptable — color is not the distinguisher; the reason text is).

---

## DECISION 3 — Provider→credential mapping: standalone SDK-free map; codex stays out (Open item 3; R1.2/R1.3/R5)

**The map.** A new policy module declares a static, type-only-dependent map:

```ts
// runtime imports are SDK-free; ProviderId is a type-only import
import type { ProviderId } from "../providers/types";
const PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId, string>> = {
  "openai-api": "OPENAI_API_KEY",
  "anthropic-api": "ANTHROPIC_API_KEY",
  "gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
};
```

"Is this provider statically checkable" ≡ "is its id a key in the map". `claude-code`,
`mock`, and `codex` are absent ⇒ never statically misconfigured (R1.3).

**Why a standalone map, not extending the `Provider` contract.** Two reasons, in
priority order:
1. **Minimal change / isolation (R7.2/R7.1, the load-bearing reason).** Extending the
   `Provider` interface would touch every provider object in `registry.ts` and entangle
   the policy with the provider runtime. A standalone `Partial<Record<ProviderId,string>>`
   that type-imports `ProviderId` (`providers/types.ts:1` is a type-only import) lives
   wholly inside the isolated policy module, calls no provider, and needs no SDK — so it
   is pure/synchronous (R5.1) and unit-testable without mocking any provider.
2. **SDK decoupling of the predicate's own module (hygiene, NOT load-bearing for the
   e2e path — see correction below).** The `Provider` objects live in `registry.ts`,
   which eagerly imports every SDK (`registry.ts:1` `@openai/codex-sdk`; the six provider
   modules each top-level-import their SDK: `openai-api.ts:1`, `anthropic-api.ts:1`,
   `gemini-api.ts:1`, `claude-code.ts:1`, `codex.ts:6`). Keeping the predicate's module
   free of any registry/`Provider` runtime import keeps the policy component self-contained.

**CORRECTION (verified) — the SDK-cost argument does NOT spare Playwright.** I initially
reasoned the SDK-free module would keep Playwright's startup cheap. That is FALSE and I
am recording it rather than letting the wrong rationale stand. `index.ts:34` is a VALUE
re-export `export { run } from "./runner"`; under ESM, importing ANY named binding from
`"skillsmith"` eagerly evaluates the whole barrel, and `run`'s static chain
(`runner.ts:3 → pipeline.ts:43 → agent-loop.ts:21 → testing-agent.ts:8 →
providers/registry.ts:1`) loads ALL SDKs. `testing-project/skillsmith.config.ts:4`
ALREADY does `import { defineConfig } from "skillsmith"`, and `playwright.config.ts:4`
imports that config — so Playwright's module-eval ALREADY pays the full SDK load today,
in the working harness. Adding `import { runnableTestAgentIds } from "skillsmith"` adds
ZERO new transitive cost. So the SDK-free discipline is good hygiene for isolating and
unit-testing the predicate (reason 1 above), but it is NOT what makes the e2e import
cheap — the barrel is already SDK-bound via `run`. No sub-path export / lazy import is
needed or warranted (the package only exposes `.` → `index.ts` anyway). This correction
does not change the decision (standalone map is still right for R7.1/R7.2); it corrects
the stated rationale.

**codex stays OUT (the substantive call).** Opting codex into the map is test-safe —
no fixture declares `provider:"codex"`; the only real codex env path is
`codex.e2e.test.ts`, double-gated by `CODEX_E2E=1` AND requiring `OPENAI_API_KEY`
present (it asserts `error===undefined` with the key set), so an upfront check (which
only fires when the key is ABSENT) never collides; `providers.test.ts` uses an injected
fake ctor. BUT codex auth is broader than `OPENAI_API_KEY`: the Codex CLI can
authenticate via session (`codex login` / `CODEX_HOME`, forwarded at codex.ts env
allowlist) and `codex.ts:64-65` passes `apiKey: process.env.OPENAI_API_KEY` which may be
`undefined` while the CLI session still authenticates. So absent `OPENAI_API_KEY` is NOT
a reliable misconfiguration signal for codex — opting it in risks FALSELY excluding a
CLI-authenticated codex agent. The pure-API providers have no such fallback (the SDK's
only auth is the env var), so the gate is exact for them. Keeping codex out matches
R1.3's conservative default and avoids the false positive. (Future: if codex ever gains
a reliable static signal, it is a one-line map addition — the seam supports it.)

---

## DECISION 4 — Public R5 API + internal policy seam (Open item 5; R2, R5, R6)

### The shared atom (single source of truth, R5.2)

```ts
function providerRunnable(provider: ProviderId, env: NodeJS.ProcessEnv): boolean {
  const required = PROVIDER_CREDENTIAL_ENV[provider];
  return required === undefined || Boolean(env[required]);
}
```

Both the public raw-input predicate and the internal normalized seam call this, so the
two layers AGREE by construction (R5.2). A provider absent from the map is always
runnable (claude-code/mock/codex).

### Public, named exports from `src/index.ts` (raw input, pure + sync)

```ts
function agentRunnable(
  config: SkillsmithConfigInput, agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean;          // providerRunnable(config.agents[agentId].provider, env)

function runnableTestAgentIds(
  config: SkillsmithConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): string[];         // config.roles.test.agents.filter(id => agentRunnable(config, id, env))
```

- `agentRunnable` is the atom AC1.1/AC1.2 unit-test against directly.
- `runnableTestAgentIds` is the ONE the e2e harness consumes — `playwright.config.ts`
  maps `projects` over it instead of the raw list (`playwright.config.ts:23-26`); that
  is the ENTIRE e2e-side change (R6.1). Specs self-activate by `projectName`, and
  `runE2eVerification` only builds plugins from workspaces that exist
  (`verify-e2e.ts:30-67`), so a never-scaffolded excluded agent self-excludes there too.
- Both operate on the RAW `SkillsmithConfigInput` because the testing-project holds the
  un-normalized object (`defineConfig` is identity) and imports it synchronously at
  Playwright module-eval. The module exporting these MUST stay SDK-free (Decision 3).

### Internal policy seam (the single seam, R2/AC4.1) — NORMALIZED config, not exported

```ts
interface RunnabilityPlan {
  testAgents: { run: AgentDefinition[]; excluded: { agent: AgentDefinition; reason: string }[] };
  judge:    { stop: boolean; reason?: string };
  improver: { degrade: boolean; reason?: string };
}
function decideRunnability(
  config: SkillsmithConfig, env: NodeJS.ProcessEnv = process.env,
): RunnabilityPlan;
```

`decideRunnability` is the ONE policy seam (R2.1). Its body is the "warn" policy: test
agents partition into run/excluded by `providerRunnable`; judge `stop = !runnable`;
improver `degrade = !runnable`. Call sites only READ the plan — no policy branching at
any call site (AC4.1). The two consumers:
- pre-flight (early `runPipeline`, after `resolveSelfImprovement`) reads
  `plan.judge`/`plan.improver`.
- `runAgents` reads `plan.testAgents` (its split) per scenario.

**Extensibility (R2.2).** "fail" and "skip" are future branches INSIDE
`decideRunnability` (or a swapped policy object keyed by a policy name), changing how the
plan is filled — NOT the call sites:
- "fail" = if ANY agent (any role) is non-runnable, set a stop (whole-run abort up
  front).
- "skip" = `excluded` empty (drop them from the matrix, exit zero) + no judge stop / no
  degrade — BUT a future "skip" that drops test agents from the matrix MUST re-establish
  the R3.4 all-excluded guard explicitly (warn gets it free via the marker rows).
The call sites are untouched in all three policies — that is the seam.

## DECISION 5 — Runtime wiring (where each plan field is consumed)

**Test-agent split — inside `runAgents` (`agent-loop.ts:66-111`).** `runAgents` has the
normalized `config`, `scenario`, `scenarioDirectory`, `tracker`. After deriving `agents`
(`agent-loop.ts:81-86`, optionally narrowed by `agentIdFilter`), partition the surviving
set by `providerRunnable` (via the plan). Run the runnable set through `runAgentPair`
unchanged (`agent-loop.ts:94-110`); for each EXCLUDED agent, `mkdir` its agent dir and
call the existing `writeAgentReport(agentDirectory, testing, { skipped: MISCONFIGURED_REASON_PREFIX + "<VAR> is not set" })`
(`agent-loop.ts:298-308`) — no invoke, no `beforeTestAgent`/scaffold hook for it (R3.1,
AC2.2). This re-applies every iteration (runAgents runs per scenario per iteration), so a
re-selected misconfigured agent (`select-scenarios.ts:80-92` marks it failing) is
harmlessly re-excluded + re-marked, never re-invoked (Decision 1 design rule). Filter
order: `agentIdFilter` first, then runnability — both are set-membership, order-independent.

**Tracker (display-only).** Leave the full-roster seeding at `pipeline.ts:108-114`
untouched (changing it would push a runnability call up to `pipeline.ts` — more change).
The excluded agent IS in the seeded roster, so the runtime MAY emit
`tracker.phaseFinished(scenario, agentId, "testing"/"judge", {status:"skipped", detail:"misconfigured"})`
for a tidy dashboard without the unknown-agent throw (`tracker.ts:339-345`). Display
only; never feeds the exit code (Decision 1).

**Judge stop + improver degrade — pre-flight in `runPipeline`.** Earliest normalized
point is `config = await loadConfig(...)` (`pipeline.ts:82`; `loadConfig` returns
`normalizeConfig(...)`, `load.ts:33`). Nothing invokes an agent before the loop (first
invoke is deep in `runAgentPair`). Insert the pre-flight right after
`resolveSelfImprovement` (`pipeline.ts:84`), before `maxIterations` (`pipeline.ts:118`):
- `plan.judge.stop` ⇒ abort up front (Decision 6 / Q5 picks the throw type), exit
  non-zero, no graded matrix (R4.1, AC3.1).
- `plan.improver.degrade` ⇒ set `selfImprovement.mode = "test-only"` ONCE. This single
  mutation propagates to all three mode gates: `maxIterations` collapses to 1
  (`pipeline.ts:118-119`), the per-iteration `runImprovement` guard goes false
  (`pipeline.ts:191`), and the finalPass sweep guard goes false (`pipeline.ts:218`). That
  IS "degrade to test-only" by the existing semantics. Surface via a log line (and a
  report note); it does NOT force non-zero — exit derives from the test/judge matrix
  (R4.2, AC3.2), unchanged because `prepareSummary` is mode-agnostic (Decision 1).

---

## DECISION 6 — Judge stop: throw the existing internal `UserFacingError` pre-loop (Open item 4; R4.1)

**Decision.** At the pre-flight point (~`pipeline.ts:89`, after `resolveSelfImprovement`),
if `plan.judge.stop`, `throw new UserFacingError("<clear single message: judge cannot
grade — <PROVIDER> credential <VAR> is not set>")`. NO new export, NO new type, NO
`PreconditionError` reuse.

**Why the "export `UserFacingError` vs reuse `PreconditionError`" framing is moot.** The
throw site is INTERNAL to `runPipeline`, which ALREADY imports `UserFacingError`
(`pipeline.ts:40` `import { UserFacingError } from "../util/errors"`). The testing-project
never calls this path, so no public export is needed. `run()` already catches
`UserFacingError | PreconditionError`, prints the message, returns 1
(`runner.ts:40-42`). `UserFacingError` is the right semantic fit; `PreconditionError` is
specifically "config/path problem" — overloading it would muddy meaning. Use
`UserFacingError`.

**Placement guarantees no graded matrix + not swallowed (R4.1, AC3.1).** The outer `try`
in `runPipeline` begins at `pipeline.ts:141` and its `finally` (`pipeline.ts:249-263`,
runs `afterAll` + `tracker.finish`) has NO catch, so it re-raises. Placing the judge-stop
throw at ~`pipeline.ts:89` — BEFORE line 141 — means the throw is OUTSIDE the try
entirely: it does not fire the `finally`/`afterAll`, no iteration ever runs, no
`report.json` is written, and `prepareSummary` (`pipeline.ts:248`, inside the try) is
never reached. The throw propagates straight to `run()`'s catch → prints message →
returns 1. Result: aborts up front, exits non-zero, NO graded matrix — observably
distinct from a matrix of grading FAILs (R4.1).

## DECISION 7 — Deterministic testability: real `openai-api` provider + scrubbed env (R4.4; AC3)

**Decision.** Drive all three role behaviors with a fixture agent declared
`provider: "openai-api"` and `OPENAI_API_KEY` deleted from `process.env` in the test
(save → `delete` → restore in `finally`, the established pattern at
`providers.test.ts:262-263,286-288` / `vercel-providers.test.ts:58-63`). This exercises
the REAL upfront predicate — the credential gate short-circuits before any invoke, so
zero network, fully deterministic regardless of CI having the key set. No new mock
provider, no capability bolted onto `mock`.

**Why not a dedicated mock-misconfigured provider.** `mock`/`claude-code` are
deliberately absent from the credential map (R1.3 "not statically misconfigurable");
adding them would either violate R1.3 or invent a mock-only path the production predicate
never uses (testing a fake). `validateAgentEntry` (`validate.ts:77-84`) accepts an
`openai-api` agent at config-load with any non-empty `model`, and judge/improver
single-role validation is provider-agnostic — so openai-api fixtures load fine. This
mirrors the `mock-fail-testing` pattern structurally (fixture project + `run({cwd})` +
assert exit/report) but over the real gate.

**Fixture shapes (each needs a RUNNABLE agent alongside so the run proceeds):**
- **Test-agent exclusion (AC2.1/AC3.3):** two test agents — one `openai-api` (key
  scrubbed, excluded) + one `mock` (runs, PASS). Assert exit 1; excluded agent's row is
  `{review:{skipped:"misconfigured: OPENAI_API_KEY is not set"}}`; mock row PASS.
- **All-excluded (AC2.3):** all test agents `openai-api` (key scrubbed). Assert exit 1,
  no vacuous pass (every row is the misconfigured marker).
- **Judge stop (AC3.1):** judge is `openai-api` (key scrubbed); test/improver `mock`.
  Assert exit 1, single message, NO graded matrix (no `report.json`).
- **Improver degrade (AC3.2):** improver is `openai-api` (key scrubbed) in
  `mode:"self-improvement"`; test+judge `mock` and PASS. Assert run completes test-only
  (no improvement step), degrade surfaced, exit 0 (clean matrix).

## DECISION 8 — Concrete bits (Open item 6; R6)

- **Nano model id:** `gpt-4.1-nano`. `validate.ts:77-84` requires only a non-empty
  `model` string + a known `provider` (no allow-list anywhere); the id is never reached
  when `OPENAI_API_KEY` is unset (the gate short-circuits before invoke). Free-form pick;
  no validation barrier.
- **`testing-project/skillsmith.config.ts` (the whole change):**
  1. add to `agents`: `"openai-api-nano": { provider: "openai-api", model: "gpt-4.1-nano" }`.
  2. `roles.test.agents`: `["haiku"]` → `["haiku", "openai-api-nano"]`.
  `haiku` (claude-code, no gate) stays runnable, so absent `OPENAI_API_KEY` the run
  proceeds with `haiku` only and exits non-zero on the excluded `openai-api-nano`
  (AC5.1); with the key present, `openai-api-nano` joins the e2e set (AC5.2). Nothing
  else in this config changes (`opus` judge/improver unaffected).
- **`testing-project/playwright.config.ts` (one change):** line 23
  `projects: config.roles.test.agents.map(...)` →
  `projects: runnableTestAgentIds(config, process.env).map((agentId) => ({ name: agentId, metadata: { agentId } }))`,
  plus `import { runnableTestAgentIds } from "skillsmith"` at top. `config` is the raw
  `SkillsmithConfigInput` (identity `defineConfig`), which `runnableTestAgentIds` accepts.
  No second filter site (specs self-activate by `projectName`; `runE2eVerification` only
  builds plugins from workspaces that exist, `verify-e2e.ts:30-67`). No import cycle —
  nothing under `src/providers` or `src/config` imports `src/index.ts`; the
  testing-project→skillsmith edge is a clean external dependency already used today.

---

## How the report artifacts express "misconfigured/excluded, not an e2e failure" (R3.2/AC2.4/AC5.1)

Three machine-readable surfaces, all distinct from an e2e failure:
- **Excluded agent row** in merged `${runDirectory}/report.json`:
  `scenarios.<name>.agents.<id> = { testing: {duration:0}, review: { skipped: "misconfigured: <VAR> is not set" } }`.
  `classifyVerdict` → `SKIPPED`; the reason prefix `"misconfigured: "` machine-distinguishes
  it from a testing-failure skip (`"testing failed: "`) and from any FAIL (no `skipped`
  key).
- **An e2e failure** is a totally different shape: a `VerificationFailure`
  `{ scenario, agent, details: "e2e failed: <spec>" }` folded in by `applyVerification`
  as a FAIL cell (`verify-e2e.ts:203-208`). The excluded agent NEVER produces this —
  it has no Playwright project (R6.1) and no built plugin, so no e2e spec runs for it.
  Hence AC5.1's "no 'e2e failed' attributed to `openai-api-nano`" holds by construction:
  its only report presence is the misconfigured-SKIPPED marker.
- **Human summary** (`summary.txt` / console): matrix column `SKIPPED`; detail line
  `openai-api-nano: SKIPPED misconfigured: OPENAI_API_KEY is not set` — visibly distinct
  from `<agent>: SKIPPED testing failed: …` and from FAIL detail lines.

---

## Consolidated module/wiring summary (for the plan phase)

**New module** (isolated policy component, SDK-free runtime imports — R7.1):
- `providerRunnable(provider, env)` — shared atom (map lookup + env truthiness).
- `PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId,string>>` — the static map
  (openai-api/anthropic-api/gemini-api; codex/claude-code/mock absent).
- `MISCONFIGURED_REASON_PREFIX = "misconfigured: "` — shared by marker-writer + tests.
- `decideRunnability(config, env): RunnabilityPlan` — the ONE policy seam ("warn" body).

**Public barrel additions** (`src/index.ts`, named exports):
- `agentRunnable(config: SkillsmithConfigInput, agentId, env?): boolean`.
- `runnableTestAgentIds(config: SkillsmithConfigInput, env?): string[]`.

**Touched internal sites (minimal, R7.2):**
- `src/pipeline/pipeline.ts` ~84-89: pre-flight — build the plan; judge-stop throws
  `UserFacingError`; improver-degrade sets `selfImprovement.mode = "test-only"`. (Already
  imports `UserFacingError`.)
- `src/pipeline/agent-loop.ts` `runAgents` (66-111): partition test agents into
  run/excluded via the plan; run runnable set unchanged; for each excluded agent write
  the misconfigured marker via existing `writeAgentReport`; optional tracker skipped
  events.
- `src/index.ts`: add the two named exports.
- `testing-project/skillsmith.config.ts`: add the `openai-api-nano` agent (Decision 8).
- `testing-project/playwright.config.ts`: filter `projects` via `runnableTestAgentIds`
  (Decision 8).

**Untouched (explicitly):** `prepareSummary`/`isRowPass` (Decision 1 reuses them),
`verdict.ts`/`classifyVerdict` (Decision 2 reuses `{skipped}`), the `Provider` contract
and every `invoke` (Decision 3), the tracker enums/counters (Decision 5 seeds-then-marks),
`mergeIntoRunningReport`/`select-scenarios` (Decision 1 survives them as-is).

**Process-vocabulary check (R7.4/AC6.2):** every shipped identifier is a domain word —
`runnable`/`misconfigured`/`excluded`/`degrade`/`policy`/`provider credential`. None are
phase/spec/design/plan/acceptance-criteria/task tags. The `"warn"` policy name need not
appear in shipped code at all (the seam can implement the single current behavior
directly and name the future ones when added); if a policy identifier is introduced it
must be a plain word like `warn`/`fail`/`skip`, which are domain policy names, not process
vocabulary.

---

## Q&A record

_(Each entry: the question put to the researcher, the cited evidence returned, and
the DECISION I made on it. Full Q&A transcript preserved below.)_

- **Q1 → Decision 1** (exit-code threading): confirmed the per-agent non-PASS marker row
  survives `mergeIntoRunningReport` in all/failed-scenarios/failed-pairs topologies and
  auto-preserves R3.4; the marker must be written to disk each active iteration at/inside
  `runAgents`. Researcher reproduced the on-disk row shape via the judge-skip fixture.
- **Q2 → Decision 2** (verdict kind): `classifyVerdict` maps ONLY `{skipped:string}` to
  `SKIPPED`; novel keys fall through to a misleading FAIL. Reuse `{skipped:"misconfigured: …"}`
  with a stable prefix — distinguishable from FAIL and from the testing-failure skip in
  both the machine report and the human summary (researcher rendered all four cell types
  side by side). Zero enum/tracker churn (R7.2).
- **Q3 → Decision 3** (provider→env map + codex): standalone SDK-free
  `Partial<Record<ProviderId,string>>`; codex stays OUT (CLI session-auth false-positive
  risk; R1.3 default). Import-graph + zero-blast-radius confirmed.
- **Q4 → Decisions 4/5** (R5 API + wiring): shared `providerRunnable` atom; public
  `agentRunnable`/`runnableTestAgentIds` over raw input; internal `decideRunnability`
  plan; test-split in `runAgents`; judge/improver pre-flight after `resolveSelfImprovement`;
  improver degrade = flip `selfImprovement.mode="test-only"` (one mutation, all three
  mode gates). E2e needs nothing beyond `runnableTestAgentIds`.
- **Q5 → Decisions 6/7/8** (judge throw + deterministic lever + concrete bits): throw
  internal `UserFacingError` before the outer try (`pipeline.ts:141`) — no new export, no
  graded matrix; deterministic lever = real `openai-api` + scrubbed `OPENAI_API_KEY` for
  all three role fixtures; nano id `gpt-4.1-nano`; two-line testing-project config change;
  one-line playwright filter change. SDK transitive-load concern verified MOOT (barrel
  already loads SDKs via `run`; Playwright already imports the barrel) — Decision 3's
  rationale corrected accordingly.
