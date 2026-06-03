# Design: skip misconfigured agents across a run

Issue: Automattic/skillsmith#37.

This document is a standalone architecture specification. It describes the
components, the public and internal API surface, the runtime wiring, and the
trade-offs behind each decision, in enough detail to be turned into tasks
without consulting any other artifact. It satisfies the approved requirements
R1–R7 (acceptance criteria AC1–AC6).

The descriptive names used here — "misconfigured", "runnable", "policy seam",
"warn policy" — are vocabulary for this document. The shipped identifiers are
ordinary domain words (`providerRunnable`, `agentRunnable`, `runnableTestAgentIds`,
`decideRunnability`, `excluded`, `misconfigured`); no internal-process vocabulary
(phase names, spec/design/plan, acceptance-criteria or task tags) appears in any
produced code, comment, test, or documentation.

---

## 1. Problem and goal

A run evaluates skills with agents in three roles: a list of **test** agents,
one **judge**, and one **improver**. An agent is **misconfigured** when it cannot
run for an environmental reason knowable *without* grading its output — the
canonical case being an absent provider credential.

Today a misconfigured agent is invoked anyway. The invocation errors, and that
error is conflated with a *graded* failure. This burns compute, scaffolds
workspace artifacts for an agent that can never produce output, and — in the
end-to-end (e2e) harness — runs Playwright tests against a plugin that was never
built, producing spurious failures. There is also no role-awareness: a
misconfigured judge or improver is treated identically to a misconfigured test
agent.

The goal is an **upfront, pre-invoke** notion of misconfiguration, handled under
a default **"warn"** policy with role-specific behavior, routed through a
**single policy seam** so that two future policies ("fail", "skip") become a
localized addition rather than a rewrite. A new **public API** lets the e2e
harness agree with the runtime on which agents are runnable.

### Role behavior under "warn" (the only policy built now)

- **Test agent** — the run proceeds with the test agents that *can* run; the
  misconfigured one is excluded from execution, surfaced clearly, and **the run
  exits non-zero** so a partial run never looks green.
- **Judge** — a misconfigured judge **stops the run** up front; nothing can be
  graded; exit non-zero.
- **Improver** — a misconfigured improver **degrades the run to test-only**: test
  agents and judge still run, no improvement step runs. This does *not* by itself
  force a non-zero exit; the exit derives from the test/judge matrix.

### Key terms

- **Misconfigured** — cannot run for an environmental reason knowable without
  grading (e.g. an absent provider credential). The condition the policy keys off.
- **Failed** — *ran* and produced an error or non-passing result. Distinct from
  misconfigured; unchanged by this feature.
- **Runnable** — not misconfigured, from the static view (configuration plus
  environment, no model invocation).
- **Provider** — the backend that executes an agent. Some providers gate on a
  single environment variable checkable before invocation; others do not.

---

## 2. Architecture overview

### 2.1 The single policy seam (centerpiece)

All new logic lives in **one new, self-contained module**:
`src/policy/runnability.ts`. It is isolated (R7.1): its runtime imports are
SDK-free, it invokes no provider, and it depends on the providers module only
through a *type-only* import of `ProviderId`. The module owns exactly two
responsibilities and nothing else:

1. **Static runnability** — given an agent's declared provider plus the
   environment, decide whether the agent is misconfigured. Pure and synchronous,
   no model call (R1, R5).
2. **The policy seam** — given the declared agents and their runnability, produce
   a per-role *plan* describing what happens under the active policy (R2). "warn"
   is the only policy whose body is written now; the seam is shaped so "fail" and
   "skip" are localized future additions (R2.2).

Every decision point consults this one module and only **reads** the plan it
produces. There is no policy-specific branching at any decision point (AC4.1).
The four consumers are:

- the test-agent loop (`runAgents`) — reads the test-agent split;
- the judge pre-flight (in `runPipeline`) — reads the judge field;
- the improver pre-flight (in `runPipeline`) — reads the improver field;
- the e2e Playwright `projects` array — reads the runnable test-agent ids via the
  public API.

### 2.2 Component diagram (data flow)

```
                    src/policy/runnability.ts  (new, isolated)
                    ┌─────────────────────────────────────────────┐
                    │ PROVIDER_CREDENTIAL_ENV  (static map)        │
                    │ MISCONFIGURED_REASON_PREFIX  (const)         │
                    │ providerRunnable(provider, env)  ── atom ──┐ │
                    │ agentRunnable(rawConfig, id, env)          │ │
                    │ runnableTestAgentIds(rawConfig, env)       │ │
                    │ decideRunnability(config, env) → Plan ─────┘ │
                    └───────┬─────────────────────┬────────────┬───┘
         public exports     │                     │            │ internal seam
   (re-exported via         │                     │            │
    src/index.ts)           │                     │            │
                            ▼                     ▼            ▼
       testing-project/playwright.config.ts   runPipeline   runAgents
       projects = runnableTestAgentIds(...)   judge.stop    testAgents split
                                              improver.degrade  (run / excluded)
                                                              │
                                                  excluded ⇒ writeAgentReport
                                                  marker { skipped:"misconfigured: …" }
                                                              │
                                          unchanged scoring chain ⇒ exit 1
```

### 2.3 Why one isolated module (trade-offs)

- **Isolation (R7.1).** Putting the static map, the atom, and the seam together
  in one module keeps the policy as a single reviewable unit, decoupled from the
  runtime it advises.
- **Minimal change (R7.2).** The seam advises; it does not restructure. Existing
  scoring (`prepareSummary`/`isRowPass`), verdict classification (`classifyVerdict`),
  the `Provider` contract, the tracker enums, and the report-merge logic are all
  left untouched. The new module is additive; the touched call sites are small,
  localized reads.

---

## 3. Static runnability (R1, R5)

### 3.1 The provider→credential map

```ts
// runtime imports are SDK-free; ProviderId is a type-only import
import type { ProviderId } from "../providers/types";

const PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId, string>> = {
  "openai-api": "OPENAI_API_KEY",
  "anthropic-api": "ANTHROPIC_API_KEY",
  "gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
};
```

"Is this provider statically checkable" is exactly "is its id a key in the map".
`claude-code`, `mock`, and `codex` are intentionally **absent**, so they are never
statically misconfigured (R1.3); any real misconfiguration for them continues to
surface through the existing invoke-time error path.

`ProviderId` is the existing union (`claude-code | openai-api | anthropic-api |
gemini-api | codex | mock`) exported from `src/providers/types.ts`. The map is
typed `Partial<Record<ProviderId, string>>`, so adding a provider to the gate
later is a one-line edit — the seam already supports it.

### 3.2 The shared atom

```ts
function providerRunnable(provider: ProviderId, env: NodeJS.ProcessEnv): boolean {
  const required = PROVIDER_CREDENTIAL_ENV[provider];
  return required === undefined || Boolean(env[required]);
}
```

A provider absent from the map is always runnable. A mapped provider is runnable
iff its credential variable is present and truthy in `env`. This atom is the
**single source of truth** consumed by *both* the public raw-input predicates and
the internal normalized seam, so the two layers agree by construction (R5.2).

### 3.3 Why a standalone map, not extending the `Provider` contract

The `Provider` contract today is essentially `{ id, invoke }`, with each
provider's credential variable hardcoded as a string literal inside its `invoke`.
Two alternatives were weighed:

- **Extend the `Provider` interface** with a capability (e.g. a `requiredEnv`
  field). Rejected: this touches every provider object in the registry and
  entangles the policy with the provider runtime, contradicting minimal change
  (R7.2) and isolation (R7.1). It would also pull the SDK-bound provider objects
  into the predicate's dependency graph.
- **A standalone map (chosen).** A `Partial<Record<ProviderId, string>>` that only
  *type-imports* `ProviderId` lives wholly inside the isolated policy module,
  calls no provider, needs no SDK, and is therefore pure/synchronous (R5.1) and
  unit-testable without mocking any provider.

The SDK-free discipline is good hygiene for unit-testing the predicate in
isolation; it is **not** what makes the e2e import cheap. The package barrel
(`src/index.ts`) already value-re-exports `run`, whose static import chain loads
every provider SDK, and the testing-project already imports the barrel via
`defineConfig`. Adding `runnableTestAgentIds` to that same barrel therefore adds
zero new transitive cost. No sub-path export or lazy import is needed; the
package only exposes `.` → `index.ts`.

### 3.4 Why `codex` stays out (substantive call)

`codex` reads the same `OPENAI_API_KEY` as `openai-api`, so opting it into the
map is tempting. It stays **out** because codex auth is broader than that one
variable: the Codex CLI can authenticate via a session (`codex login` /
`CODEX_HOME`), and the codex provider passes `apiKey: process.env.OPENAI_API_KEY`
even when that value is `undefined` while the CLI session still authenticates.
Therefore an absent `OPENAI_API_KEY` is **not a reliable misconfiguration signal**
for codex — opting it in risks falsely excluding a CLI-authenticated codex agent.

The pure-API providers have no such fallback (the SDK's only auth is the env
var), so the gate is exact for them. Keeping codex out matches R1.3's
conservative default and avoids the false positive. If codex ever gains a
reliable static signal, it is a one-line map addition.

---

## 4. Public API (R5) consumed by the e2e harness

Two **named exports** are added to the package's public entry point
(`src/index.ts`), re-exported from `src/policy/runnability.ts`. Both are pure,
synchronous functions of *raw* configuration plus environment — no async, no
model call — because the testing-project holds the **un-normalized** config
object and imports it synchronously at Playwright module-eval time.

```ts
function agentRunnable(
  config: SkillsmithConfigInput,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean;
// providerRunnable(config.agents[agentId].provider, env)

function runnableTestAgentIds(
  config: SkillsmithConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): string[];
// config.roles.test.agents.filter(id => agentRunnable(config, id, env))
```

- **`agentRunnable`** is the atom the pre-invoke unit tests assert against
  directly (AC1.1/AC1.2): `openai-api` with `OPENAI_API_KEY` unset is not
  runnable, set is runnable; analogous for `anthropic-api` /`ANTHROPIC_API_KEY`
  and `gemini-api`/`GOOGLE_GENERATIVE_AI_API_KEY`; `claude-code` and `mock` are
  runnable regardless of environment.
- **`runnableTestAgentIds`** is the one the e2e harness consumes. It returns the
  ids of the test agents that can run. **The same function feeds both** the
  runtime test-loop exclusion and the e2e `projects` array (R5.2), so the two
  agree on which agents are runnable.

### 4.1 Raw vs normalized — why the signature is over `SkillsmithConfigInput`

The codebase has two config shapes:

- **`SkillsmithConfigInput`** — the raw object authored in
  `skillsmith.config.ts`. In it, `roles.test.agents` is a list of **string ids**
  and `agents` is a record keyed by id. `defineConfig` is an identity function,
  so the testing-project holds exactly this raw shape and imports it
  synchronously into `playwright.config.ts`.
- **`SkillsmithConfig`** — the normalized object the runtime works with after
  `loadConfig`. In it, `roles.test.agents` is a list of **`AgentDefinition`
  objects** (each carrying `.id`, `.provider`, `.model`).

The public API takes `SkillsmithConfigInput` because that is what the external
consumer holds. The internal seam (next section) takes the normalized
`SkillsmithConfig` because that is what the runtime has in hand. Both ultimately
call `providerRunnable`, so they cannot disagree.

---

## 5. The policy seam (R2, AC4.1) — internal, not exported

The seam is a single function over the **normalized** config that returns a plan.
It is internal to the package (the e2e consumer never needs it).

```ts
interface RunnabilityPlan {
  testAgents: {
    run: AgentDefinition[];
    excluded: { agent: AgentDefinition; reason: string }[];
  };
  judge:    { stop: boolean; reason?: string };
  improver: { degrade: boolean; reason?: string };
}

function decideRunnability(
  config: SkillsmithConfig,
  env: NodeJS.ProcessEnv = process.env,
): RunnabilityPlan;
```

`decideRunnability` is the **one** policy seam (R2.1). Its body *is* the "warn"
policy:

- **Test agents** partition into `run` / `excluded` by `providerRunnable`. Each
  excluded entry carries a `reason` string built from the shared prefix and the
  missing variable name (Section 6).
- **Judge**: `stop = !providerRunnable(judge.provider, env)`.
- **Improver**: `degrade = !providerRunnable(improver.provider, env)`.

Call sites **only read** the plan — they contain no policy branching (AC4.1).

### 5.1 Extensibility: "fail" and "skip" are branches *inside* the seam (R2.2)

The two out-of-scope policies become localized changes to how the plan is
*filled*, never to the call sites:

- **"fail"** — if *any* agent in *any* role is non-runnable, set a whole-run stop
  up front (the seam returns a plan whose judge/run-abort field signals stop).
- **"skip"** — `excluded` is left empty (drop misconfigured test agents from the
  matrix, exit zero), with no judge stop and no improver degrade. A future "skip"
  that drops test agents from the matrix **must explicitly re-establish the
  all-excluded guard** (Section 7.3) that "warn" preserves implicitly via its
  marker rows.

In all three policies the call sites are identical. That invariance is the seam:
adding a policy is editing `decideRunnability` (or swapping a policy object keyed
by a policy name), not touching the runtime. The `"warn"` policy name need not
appear in shipped code — the seam can implement the single current behavior
directly and name the future policies only when they are added. If a policy
identifier is introduced, it is a plain domain word (`warn`/`fail`/`skip`).

---

## 6. Verdict / surfacing (R3.2, AC2.4) — reuse `SKIPPED`

The status vocabulary is a fixed enum (`PASS`/`FAIL`/`SKIPPED`). An excluded test
agent is surfaced by **reusing the existing `SKIPPED` verdict kind** rather than
adding a new one.

The excluded agent's per-agent report carries:

```ts
review: { skipped: MISCONFIGURED_REASON_PREFIX + "<VAR> is not set" }
// e.g. review: { skipped: "misconfigured: OPENAI_API_KEY is not set" }
```

A shared constant `MISCONFIGURED_REASON_PREFIX = "misconfigured: "` is defined
once in the policy module and reused by both the runtime marker-writer and the
tests, so the prefix never drifts.

`classifyVerdict` maps `{ skipped: string }` → `SKIPPED` with **no change**. The
misconfiguration is carried entirely in the reason string's stable,
machine-parseable prefix.

### 6.1 Why reuse `SKIPPED`, not a new verdict kind

The only payload that `classifyVerdict` maps to the `SKIPPED` kind is
`{ skipped: string }`. A novel key (`{ misconfigured }`, `{ excluded }`) falls
through to the raw-judge branch and renders as **FAIL** with a "no rubrics or
acceptance in verdict" message — indistinguishable from a grading failure, which
would violate R3.2. Making a new key distinct would require extending
`classifyVerdict`, adding a new verdict-cell kind, updating the result formatter,
the failure-line renderer, the coloring, and the tracker counters — a wide change
rejected under minimal change (R7.2). Reusing `{ skipped }` yields a non-PASS,
distinct-from-FAIL, already-rendered kind for free.

### 6.2 Distinguishability (the design lever is the reason *string*)

The exclusion outcome must be distinguishable from a normal grading failure
**and** from an unrelated skip. There is already one other `SKIPPED` producer in
the codebase: the **testing-failure** path, which writes
`{ skipped: "testing failed: …" }`.

- **Machine-distinguishable (AC2.4).** In the merged report the excluded agent's
  row is `{ review: { skipped: "misconfigured: …" } }`. A grading **FAIL** has no
  `skipped` key. The testing-failure skip has prefix `"testing failed: "`. The two
  skips are separated by the stable reason **prefix**, which is grep-checkable.
- **Human-distinguishable (R3.2).** The summary matrix column shows the kind
  (`SKIPPED`) for both skip types; the *reason* surfaces in the detail block as
  `<agent>: SKIPPED <reason>`. The human therefore sees
  `<agent>: SKIPPED misconfigured: OPENAI_API_KEY is not set` versus
  `<agent>: SKIPPED testing failed: …`. The reason text is the designed
  distinguisher; nothing else keys off the kind in a way that would conflate the
  two (any yellow coloring applies to both skip kinds, which is acceptable —
  color is not the distinguisher).

---

## 7. Exit-code threading (R3.3, R3.4) — per-agent non-PASS marker row

This is the central anti-regression mechanism. The exit code is decided at a
**single chokepoint** (`prepareSummary`) from the merged run report, and today no
signal that an agent was *excluded* ever reaches it — only the rows that actually
appear are scored. Merely dropping the excluded agent's row would let the
remaining rows all pass and the run exit zero, which is forbidden.

### 7.1 Mechanism

A misconfigured test agent is excluded from **execution** (no invoke, no
`beforeTestAgent`/scaffold hook, no e2e) **but the runtime still writes its
per-agent `report.json`** carrying the non-PASS `SKIPPED` marker from Section 6.
That marker row then flows through the *unchanged* scoring chain to the
chokepoint:

- `aggregateScenarioReport` reads agent rows from disk, so the marker file becomes
  a row in the scenario report.
- `classifyVerdict` scores the marker as non-PASS → the scenario's "all pass" is
  false → the iteration's "all agents pass" is false → `isRowPass` is false →
  `prepareSummary` returns exit 1.

No existing scoring code changes. This reuses the exact path the testing-failure
skip already travels.

### 7.2 Why this over a top-level "excluded agents" field

The alternative — a new top-level field on the report plus a new branch inside
`prepareSummary` that forces non-zero and re-handles the all-excluded case — was
rejected. It touches the scoring chokepoint and adds bespoke logic. The marker-row
mechanism touches **zero** existing scoring code and is the more minimal change
(R7.2). Both satisfy R3.3/R3.4; the marker row is chosen for minimality.

### 7.3 R3.4 (all-excluded) is auto-preserved

When **all** declared test agents are misconfigured, every agent row is the
non-PASS marker, so "all agents pass" and "all scenarios pass" are false. The
existing empty-agents guard never even has to fire — the all-excluded matrix is
non-green for free. (A *future* "skip" policy that drops rows instead of marking
them would lose this and must re-establish the guard explicitly; "warn" gets it
implicitly.)

### 7.4 Survival across iteration topologies (design rule)

The runtime re-selects scenarios across iterations in three scopes — `all`,
`failed-scenarios`, `failed-pairs`:

- In `failed-pairs` / `failed-scenarios`, the failing-agent collector adds the
  excluded agent to the re-run set because its marker is non-PASS. On
  re-selection the runtime re-excludes it and re-writes the same marker row;
  `mergeIntoRunningReport` merges agent rows (new wins, untouched inherit), so the
  marker is never dropped.
- In `all` scope the marker is re-written every iteration.

So the marker reaches the chokepoint in every iteration topology. **Design rule:**
the exclusion site must write the marker row on every iteration the agent is in
the active selection — i.e. exclusion and marker-write happen *together*, at/inside
the per-scenario agent loop, not once globally.

---

## 8. Runtime wiring (where each plan field is consumed)

### 8.1 Test-agent split — inside `runAgents` (`src/pipeline/agent-loop.ts`)

`runAgents` already has the normalized `config`, the `scenario`, the
`scenarioDirectory`, and the `tracker`. It derives the active agent list from
`config.roles.test.agents`, optionally narrowed by the existing `agentIdFilter`.
The change:

1. After deriving the active set (filter first, then runnability — both are
   set-membership and order-independent), partition it by `providerRunnable` (via
   the plan from `decideRunnability`).
2. Run the **runnable** set through the unchanged `runAgentPair` path.
3. For each **excluded** agent: `mkdir` its agent directory and call the existing
   `writeAgentReport(agentDirectory, testing, { skipped: MISCONFIGURED_REASON_PREFIX + "<VAR> is not set" })`.
   No invoke, no `beforeTestAgent`/scaffold hook fires for it (R3.1, AC2.2). The
   `testing` block records zero duration.

Because `runAgents` runs per scenario per iteration, a re-selected misconfigured
agent is harmlessly re-excluded and re-marked, never re-invoked (the Section 7.4
design rule).

`AgentDefinition` is already imported in `agent-loop.ts`; the excluded-agent
entry's `reason` is built from `MISCONFIGURED_REASON_PREFIX` plus the variable
name, which the seam supplies.

### 8.2 Tracker (display-only)

The dashboard seeds its roster from the full declared test-agent list up front.
That seeding is **left untouched** (changing it would push a runnability call up
into the pipeline file — more change than necessary). Because the excluded agent
is already in the seeded roster, the runtime *may* emit a "skipped" tracker event
for it (`status: "skipped"`, detail `"misconfigured"`) for a tidy dashboard
without tripping the tracker's unknown-agent guard. This is display only; it never
feeds the exit code (Section 7).

### 8.3 Judge stop + improver degrade — pre-flight in `runPipeline`

The earliest point at which the normalized config exists is right after
`loadConfig`. Nothing invokes an agent before the iteration loop (the first
invoke is deep inside `runAgentPair`). The pre-flight is inserted **right after
`resolveSelfImprovement` and before the iteration loop** — and, critically,
**before the outer `try`** that wraps the loop:

- **`plan.judge.stop`** ⇒ abort up front (Section 9), exit non-zero, no graded
  matrix (R4.1, AC3.1).
- **`plan.improver.degrade`** ⇒ set `selfImprovement.mode = "test-only"` **once**.
  This single mutation propagates to all three mode gates: `maxIterations`
  collapses to 1, the per-iteration improvement guard goes false, and the final
  improvement sweep guard goes false. That *is* "degrade to test-only" by the
  existing semantics. Surface it via a log line (and a report note). It does
  **not** force a non-zero exit — the exit derives from the test/judge matrix
  (R4.2, AC3.2), because `prepareSummary` is mode-agnostic (Section 7).

The judge stop and the improver degrade both read fields the seam already
computed; neither introduces policy branching at the call site.

---

## 9. Judge stop (R4.1) — throw the internal `UserFacingError` pre-loop

When `plan.judge.stop`, the pre-flight throws the **already-imported** internal
`UserFacingError` with a clear single message, e.g.:

```
judge cannot grade — <PROVIDER> credential <VAR> is not set
```

- **No new export, no new type.** The throw site is internal to `runPipeline`,
  which already imports `UserFacingError`. The testing-project never reaches this
  path, so no public export is needed.
- **No `PreconditionError` reuse.** `UserFacingError` is the right semantic fit;
  `PreconditionError` means specifically "config/path problem", and overloading it
  would muddy meaning.

`run()` already catches `UserFacingError`, prints its message, and returns 1.

### 9.1 Placement guarantees no graded matrix and is not swallowed

The outer `try` in `runPipeline` wraps the iteration loop; its `finally` (which
runs `afterAll` and `tracker.finish`) has no catch, so it re-raises. Placing the
judge-stop throw **before** that `try` means the throw is outside it entirely: it
does not fire the `finally`/`afterAll`, no iteration runs, no `report.json` is
written, and `prepareSummary` is never reached. The throw propagates straight to
`run()`'s catch → prints the message → returns 1.

Result: the run aborts up front, exits non-zero, and produces **no graded
matrix** — observably distinct from a matrix of grading FAILs (R4.1, AC3.1).

---

## 10. e2e harness changes (R6)

### 10.1 `testing-project/skillsmith.config.ts`

Two edits, nothing else:

1. Add to `agents`:
   `"openai-api-nano": { provider: "openai-api", model: "gpt-4.1-nano" }`.
2. Change `roles.test.agents` from `["haiku"]` to `["haiku", "openai-api-nano"]`.

`haiku` (`claude-code`, no static gate) stays runnable. So with `OPENAI_API_KEY`
absent the run proceeds with `haiku` only and exits non-zero on the excluded
`openai-api-nano` (AC5.1); with the key present, `openai-api-nano` joins the e2e
set (AC5.2). The `opus` judge/improver are unaffected.

The nano model id `gpt-4.1-nano` is free-form: config validation requires only a
non-empty model string plus a known provider (no model allow-list), and the id is
never reached when `OPENAI_API_KEY` is unset because the credential gate
short-circuits before any invoke.

### 10.2 `testing-project/playwright.config.ts`

One change: the `projects` array, today
`config.roles.test.agents.map((agentId) => ({ name: agentId, metadata: { agentId } }))`,
becomes

```ts
import { runnableTestAgentIds } from "skillsmith";
// …
projects: runnableTestAgentIds(config, process.env).map((agentId) => ({
  name: agentId,
  metadata: { agentId },
})),
```

`config` here is the raw `SkillsmithConfigInput` (identity `defineConfig`), which
`runnableTestAgentIds` accepts. There is **no second filter site**: e2e specs
self-activate by `projectName`, and the e2e verification step only builds plugins
from workspaces that actually exist — so a never-scaffolded excluded agent
self-excludes from verification too. No import cycle is introduced: nothing under
`src/providers` or `src/config` imports `src/index.ts`; the testing-project →
skillsmith edge is an existing external dependency.

### 10.3 How the report expresses "misconfigured/excluded, not an e2e failure"

Three machine-readable surfaces, all distinct from an e2e failure:

- **Excluded agent row** in the merged report:
  `{ testing: { duration: 0 }, review: { skipped: "misconfigured: <VAR> is not set" } }`
  → `SKIPPED`; the `"misconfigured: "` prefix machine-distinguishes it from the
  testing-failure skip (`"testing failed: "`) and from any FAIL (no `skipped` key).
- **An e2e failure** is a different shape entirely — a verification failure
  `{ scenario, agent, details: "e2e failed: <spec>" }` folded in as a FAIL cell.
  The excluded agent never produces this: it has no Playwright project (R6.1) and
  no built plugin, so no e2e spec runs for it. AC5.1's "no 'e2e failed' attributed
  to `openai-api-nano`" therefore holds by construction.
- **Human summary** — matrix column `SKIPPED`; detail line
  `openai-api-nano: SKIPPED misconfigured: OPENAI_API_KEY is not set`, visibly
  distinct from a testing-failure skip and from FAIL detail lines.

---

## 11. Deterministic testability (R4.4, AC3)

All three role behaviors are driven by a fixture agent declared
`provider: "openai-api"` with `OPENAI_API_KEY` **deleted from `process.env`** in
the test (the established save → `delete` → restore-in-`finally` pattern). This
exercises the **real** upfront predicate: the credential gate short-circuits
before any invoke, so there is zero network and full determinism regardless of
whether CI has the key set. No fake/mock-misconfigured provider is introduced.

Why not a dedicated mock-misconfigured provider: `mock` and `claude-code` are
deliberately absent from the credential map (R1.3, "not statically
misconfigurable"); adding them would either violate R1.3 or invent a mock-only
path the production predicate never uses (i.e. test a fake instead of the real
gate). Config validation accepts an `openai-api` agent with any non-empty model,
and judge/improver single-role validation is provider-agnostic, so `openai-api`
fixtures load fine.

Each fixture pairs the misconfigured agent with a **runnable** agent so the run
proceeds:

- **Test-agent exclusion (AC2.1/AC3.3):** two test agents — one `openai-api` (key
  scrubbed, excluded) and one `mock` (runs, PASS). Assert exit 1; the excluded
  agent's row is `{ review: { skipped: "misconfigured: OPENAI_API_KEY is not set" } }`;
  the mock row is PASS.
- **All-excluded (AC2.3):** all test agents `openai-api` (key scrubbed). Assert
  exit 1, no vacuous pass (every row is the misconfigured marker).
- **Judge stop (AC3.1):** judge `openai-api` (key scrubbed); test and improver
  `mock`. Assert exit 1, a single clear message, and **no graded matrix** (no run
  `report.json`).
- **Improver degrade (AC3.2):** improver `openai-api` (key scrubbed) in
  self-improvement mode; test and judge `mock` and PASS. Assert the run completes
  test-only (no improvement step), the degrade is surfaced, and exit 0 (clean
  matrix).

---

## 12. Constraints honored (R7)

- **R7.1 isolation** — all new logic is in one self-contained module
  (`src/policy/runnability.ts`) with SDK-free runtime imports and only a type-only
  dependency on the providers module.
- **R7.2 minimal change** — the `Provider` contract and every `invoke`,
  `prepareSummary`/`isRowPass`, `classifyVerdict`, the tracker enums/counters, and
  `mergeIntoRunningReport`/scenario-reselection are all **untouched**. The touched
  sites are: add two named exports in `src/index.ts`; partition + marker-write
  inside `runAgents`; a pre-flight block in `runPipeline`; two edits to the
  testing-project config; one edit to the testing-project playwright config.
- **R7.3 sparse comments** — comment only what is non-obvious; do not touch
  comments on code that did not change.
- **R7.4 no process vocabulary** — every shipped identifier is a domain word
  (`runnable`, `misconfigured`, `excluded`, `degrade`, `provider credential`).
  None are phase/spec/design/plan/acceptance-criteria/task tags.

---

## 13. Module and wiring summary

**New module** `src/policy/runnability.ts` (isolated, SDK-free runtime imports):

- `PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId, string>>` — the static map
  (`openai-api`/`anthropic-api`/`gemini-api`; `codex`/`claude-code`/`mock` absent).
- `MISCONFIGURED_REASON_PREFIX = "misconfigured: "` — shared by the marker-writer
  and the tests.
- `providerRunnable(provider, env)` — the shared atom (map lookup + env
  truthiness).
- `agentRunnable(config: SkillsmithConfigInput, agentId, env?)` — public.
- `runnableTestAgentIds(config: SkillsmithConfigInput, env?)` — public; feeds both
  the runtime exclusion and the e2e `projects` array.
- `decideRunnability(config: SkillsmithConfig, env?): RunnabilityPlan` — the one
  internal policy seam ("warn" body).

**Public barrel additions** (`src/index.ts`): re-export `agentRunnable` and
`runnableTestAgentIds`.

**Touched internal sites:**

- `src/pipeline/pipeline.ts` — pre-flight after `resolveSelfImprovement` and
  before the outer `try`: build the plan; judge-stop throws `UserFacingError`;
  improver-degrade sets `selfImprovement.mode = "test-only"`.
- `src/pipeline/agent-loop.ts` (`runAgents`) — partition test agents into
  run/excluded via the plan; run the runnable set unchanged; write the
  misconfigured marker via the existing `writeAgentReport` for each excluded
  agent; optional tracker "skipped" events.
- `testing-project/skillsmith.config.ts` — add the `openai-api-nano` agent and add
  its id to `roles.test.agents`.
- `testing-project/playwright.config.ts` — derive `projects` via
  `runnableTestAgentIds`.

**Explicitly untouched:** `prepareSummary`/`isRowPass` (Section 7 reuses them),
`classifyVerdict` (Section 6 reuses `{ skipped }`), the `Provider` contract and
every `invoke` (Section 3), the tracker enums/counters (Section 8.2 seeds then
marks), `mergeIntoRunningReport`/scenario-reselection (Section 7.4 survives them
as-is).
