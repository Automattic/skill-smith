# Code plan: Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37
Spec: `1-spec/spec.md` (approved, commit `7bdc87e`)
Design: `2-design-doc/design-doc.md` (approved, commit `ef9a791`)

## Overview

The feature makes a *misconfigured* agent — one with an agent-local config or
credential defect that fails identically every attempt — **identified once and
ignored everywhere for the rest of the run**. The load-bearing mechanism is a
single run-scoped **misconfiguration ledger** keyed by agent id, fed by a
**pre-flight probe** (deterministic, zero-I/O) and a **runtime classifier**
(inspecting the first failing invocation's error). The ledger is consulted at
every decision point: tester dispatch, judge fail-fast, improver degrade,
re-selection, pass/fail accounting (all four verdict surfaces), the hook
context, and the CLI summary. A run with no misconfigured agents touches no new
branch and is byte-for-byte unchanged (R9/AC14).

The three roles are treated asymmetrically: a bad **tester** is excluded from
its scenarios' pass/fail math (true absence pre-flight; sentinel cell at
runtime); a bad **judge** fails the run fast; a bad **improver** degrades
self-improvement to test-only. Detection is **per agent id** (one id can fill
several roles; the role-appropriate consequence applies at each reference).

### Build order (dependency summary)

1. **Task 1** — classifier + env-var map (`misconfig.ts`), pure, no deps.
2. **Task 2** — ledger (`misconfig-ledger.ts`), depends on Task 1's reason type.
3. **Task 3** — `RunContext.misconfigured` field on `types.ts`, depends on
   Task 1's reason type (for the human-readable rendering shape).
4. **Task 4** — provider error-string enrichment (HTTP status), depends on
   Task 1 (the recognizable form the classifier reads).
5. **Task 5** — config validation: remove the `isProviderId` branch only
   (`validate.ts`), no deps.
6. **Task 6** — `ScenarioReport.inconclusive` field + `aggregateScenarioReport`
   exclusion (`scenario-report.ts`), depends on a shared "is this cell a
   misconfigured skip?" predicate (Task 1 defines the marker shape).
7. **Task 7** — in-memory run verdict exclusion + inconclusive roll-up
   (`iteration-report.ts`), depends on Task 6.
8. **Task 8** — re-selection drops ledger ids (`select-scenarios.ts`), depends
   on Task 2 (consumes a ledger/predicate).
9. **Task 9** — tester exclusion + runtime detection + sentinel write
   (`agent-loop.ts`), depends on Tasks 1, 2.
10. **Task 10** — pipeline wiring: build/seed ledger, judge fail-fast, improver
    degrade, put ledger on `RunContext`, persist roster, thread into iterations
    (`pipeline.ts`), depends on Tasks 1, 2, 3, 9.
11. **Task 11** — `summary.ts` fourth-surface verdict + exit code + inconclusive
    rendering + one-time announcement, depends on Tasks 6, 10 (roster source).
12. **Task 12** — tracker/dashboard true-absence for pre-flight skips
    (`pipeline.ts` tracker init + `progress/*`), depends on Tasks 2, 10.

Tasks 1–5 are independent of each other and may be built in any order; 6–12
have the dependencies listed.

---

## Task 1 — Pure misconfiguration classifier and credential env-var map

**Goal.** Provide the single source of truth that maps a credential/dispatch
outcome to a misconfiguration verdict, for both pre-flight and runtime, with the
exact in-scope set the design fixes (KD1, KD2). Also define the recognizable
**marker string** used to tag a runtime sentinel cell so later pass-math tasks
can identify it.

**Files to change.**
- `src/config/misconfig.ts` (new).

**Changes.**
- Export the `MisconfigReason` discriminated union exactly as the design lists:
  `{ kind: "missing-credential"; envVar: string }`,
  `{ kind: "unknown-provider"; provider: string }`,
  `{ kind: "invalid-credential"; status: number }`,
  `{ kind: "model-not-found"; status: number }`.
- Export `preflightMisconfig(agent: AgentDefinition): MisconfigReason | undefined`:
  - If `agent.provider` is **not** a `ProviderId` (test via `isProviderId` /
    `PROVIDER_IDS` membership from `providers/registry.ts` — **never** call
    `getProvider`), return `{ kind: "unknown-provider", provider: <the id> }`.
  - Else, look the provider up in the static `CREDENTIAL_ENV_VAR` map (below);
    if the provider has an entry and `process.env[<envVar>]` is absent/empty,
    return `{ kind: "missing-credential", envVar }`.
  - Otherwise return `undefined` (providers `claude-code`, `codex`, `mock` have
    no pre-flight signal; a present env var has no pre-flight signal).
- Export the static map:
  ```ts
  const CREDENTIAL_ENV_VAR: Partial<Record<ProviderId, string>> = {
    "anthropic-api": "ANTHROPIC_API_KEY",
    "openai-api": "OPENAI_API_KEY",
    "gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
  };
  ```
- Export `classifyRuntimeError(err: unknown): MisconfigReason | undefined`,
  operating on the **error string** providers already produce (Task 4 enriches
  it with HTTP status in a recognizable leading form):
  - The missing-key strings (`"<KEY> is not set"`, matching the three env-var
    providers' literals) → `{ kind: "missing-credential", envVar: <KEY> }`.
  - A recognizable HTTP-status form carrying `401` or `403` →
    `{ kind: "invalid-credential", status }`.
  - A recognizable HTTP-status form carrying `404` →
    `{ kind: "model-not-found", status }`.
  - **Everything else** — including 429, 5xx, network timeout,
    context-length-exceeded, content filter, MAX_STEPS exhaustion, **and any
    error with no readable status** — returns `undefined` (allowlist
    discriminator: only 401/403/404 and the exact missing-key strings classify
    as skip; unknown status → ordinary failure, never a false skip).
- Export a human-readable renderer for a `MisconfigReason` (a single function,
  e.g. `describeReason(reason): string`) producing strings like
  `invalid-credential (HTTP 401)`, `unknown-provider "claud-code"`,
  `ANTHROPIC_API_KEY is not set`. This is the string the ledger/hook/CLI/log
  surfaces reuse so wording is defined in one place.
- Export the constant **misconfigured sentinel marker** used in the
  `{ skipped: "misconfigured: <reason>" }` row (e.g. a `MISCONFIG_SKIP_PREFIX =
  "misconfigured: "` constant) plus a predicate
  `isMisconfiguredSkipReason(skipReason: string): boolean` that returns true iff
  a `SKIPPED` cell's reason begins with that prefix. Pass-math tasks (6, 7, 11)
  import this predicate so the "is this cell excluded?" test is defined once.

**Depends on.** None (reads `providers/registry.ts` and `providers/types.ts`
exports that already exist).

**Traces to.** R1, R3, KD1, KD2; AC5 (transient → `undefined`), AC6/AC7/AC7b
(reasons), AC11a/AC11b (unknown-provider reason).

**Acceptance.**
- `preflightMisconfig` returns `missing-credential` with the correct env-var
  name when that provider's env var is unset, and `undefined` when it is set,
  for each of the three env-var providers.
- `preflightMisconfig` returns `unknown-provider` for a provider id not in
  `PROVIDER_IDS`, without ever resolving a provider instance.
- `preflightMisconfig` returns `undefined` for `claude-code`, `codex`, and
  `mock`.
- `classifyRuntimeError` returns `invalid-credential` for an enriched 401/403
  error string, `model-not-found` for an enriched 404 string,
  `missing-credential` for a `"<KEY> is not set"` string, and `undefined` for a
  429, a 5xx, a timeout, a context-length error, a content-filter error, a
  MAX_STEPS error, and any error carrying no readable status.
- `isMisconfiguredSkipReason` is true exactly for skip reasons produced via the
  misconfigured marker prefix and false for any other `SKIPPED` reason (e.g.
  today's `"testing failed: ..."`).

---

## Task 2 — Run-scoped misconfiguration ledger

**Goal.** Provide the run-scoped registry keyed by agent id that records every
agent found misconfigured (pre-flight + runtime), the role(s) each fills, and
the reason; expose a frozen pre-flight view and a live "all known so far" view
(KD5 progressive), plus the universal `has(id)` predicate.

**Files to change.**
- `src/config/misconfig-ledger.ts` (new).

**Changes.**
- Export `SkippedAgent { id: string; roles: ("test" | "judge" | "improver")[];
  reason: MisconfigReason }`.
- Export class `MisconfigLedger` with:
  - `record(id, roles, reason)` — add/merge an entry; when an id is recorded
    more than once, **union** the roles so a single entry lists every role the
    id fills (AC10). The reason is the first recorded reason (pre-flight wins if
    seeded first; a later runtime record for an already-ledgered id is a no-op
    on reason).
  - `has(agentId): boolean` — true iff the id is in the ledger.
  - `preflight(): ReadonlyMap<string, SkippedAgent>` — the entries present after
    the pre-flight probe, frozen at that boundary (KD5 boundary).
  - `all(): ReadonlyMap<string, SkippedAgent>` — every entry known so far
    (pre-flight + runtime); grows as `record` is called.
  - A method to snapshot the current `all()` set into the keyed-by-id,
    human-readable shape the hook context and CLI roster consume (id → `{
    reason: string; roles[] }`, using Task 1's `describeReason`). Exact name at
    the code-writer's discretion; it must produce the `MisconfiguredEntry` shape
    Task 3 defines.
  - A "freeze pre-flight" affordance (e.g. the probe-seeding code calls a method
    that snapshots the current set as the pre-flight roster) so `preflight()`
    never reflects later runtime additions.

**Depends on.** Task 1 (`MisconfigReason`).

**Traces to.** R2, R4, R7, R8, KD5, KD7; AC8, AC10.

**Acceptance.**
- A freshly constructed ledger reports `has(x) === false` for any id and both
  `preflight()` and `all()` empty.
- After `record("a", ["test"], r)`, `has("a")` is true and `a` appears in
  `all()` with `roles: ["test"]`.
- Recording the same id twice with different roles yields one entry whose
  `roles` is the union (e.g. `["test", "improver"]`), order-insensitive
  (AC10).
- After the pre-flight freeze, a subsequent runtime `record` of a *new* id
  appears in `all()` but **not** in `preflight()`; an id present pre-flight
  appears in both.
- The snapshot produces, per ledgered id, a `{ reason, roles }` object with a
  human-readable `reason` string and the full role list.

---

## Task 3 — `RunContext.misconfigured` passive hook field

**Goal.** Expose the misconfigured set to all hooks as passive, keyed-by-id data
on the existing `RunContext`, present from `beforeAll` (pre-flight entries) and
accumulating to `afterAll` (runtime entries) — no new mandatory callback (R7,
KD5).

**Files to change.**
- `src/config/types.ts`.

**Changes.**
- Add `export interface MisconfiguredEntry { reason: string; roles: ("test" |
  "judge" | "improver")[]; }`.
- Add to `RunContext` (types.ts:144-150) one field:
  `misconfigured: Readonly<Record<string, MisconfiguredEntry>>;` documented as a
  **live view** backed by the ledger — pre-flight entries present from
  `beforeAll`, runtime entries present by `afterAll`. The field is **always
  present** (empty object `{}` on a clean run) so consumers need no presence
  check. Because every hook context (`ScenarioContext`, `AgentContext`,
  `IterationHookContext`, etc.) extends `RunContext`, the field reaches all
  hooks automatically — no other interface changes.

**Depends on.** Task 1 (role/reason vocabulary); conceptually pairs with Task 2.

**Traces to.** R7, KD5; AC8, AC9, AC10.

**Acceptance.**
- `RunContext` carries a required `misconfigured` field typed as a read-only
  record of id → `{ reason: string; roles[] }`.
- A `RunContext` constructed for a clean run has `misconfigured` equal to an
  empty object (so AC14: no observable change).
- The type is structurally satisfied by the ledger snapshot Task 2 produces (no
  cast needed at the construction site in Task 10).

---

## Task 4 — Surface HTTP status into provider error strings

**Goal.** Make the SDK error's HTTP status readable by `classifyRuntimeError`
(Task 1) without changing the `InvokeResult` contract shape, for the three
env-var API providers and the shared Vercel runner (KD2). Honors the safe
direction: when no status is present the string is unchanged and classifies as
an ordinary failure.

**Files to change.**
- `src/providers/lib/vercel-runner.ts` (the shared catch for `anthropic-api`,
  `openai-api`, `gemini-api`).
- (No change to `anthropic-api.ts` / `openai-api.ts` / `gemini-api.ts`
  dispatch except as needed; their missing-key strings already match Task 1.)

**Changes.**
- In `runVercel`'s `catch (err)` (vercel-runner.ts:64-66), before assigning
  `error`, read the SDK error's HTTP status when present. The Vercel AI SDK
  surfaces `APICallError` with a numeric `statusCode`; detect it
  defensively (read `statusCode` and/or `status` off the error object when it is
  an object) and, when a numeric status is found, prepend a **recognizable
  leading form** to the message in the exact shape Task 1 parses (the design's
  example: a leading `[HTTP <status>] `). When no status is readable, keep the
  message exactly as today (`err.message` / `String(err)`), so a transient or
  unknown error string is unchanged.
- Do **not** change `InvokeResult`'s fields or the success path; only the
  `error` string content for failures that carry a status.

**Depends on.** Task 1 (the recognizable form the classifier expects).

**Traces to.** R3 (runtime branch), KD2; AC7, AC7b.

**Acceptance.**
- When `generateText` throws an error object carrying a numeric HTTP status, the
  returned `InvokeResult.error` begins with the recognizable status form that
  `classifyRuntimeError` reads (round-trips to the right `MisconfigReason` for
  401/403/404).
- When the thrown error carries no readable status, `InvokeResult.error` is
  byte-for-byte the message produced today (no false enrichment).
- The success path (`finalText`, `toolUseCount`, `usage`) is unchanged.

---

## Task 5 — Demote unknown-provider from load-time abort to a skip

**Goal.** Remove **only** the `isProviderId` branch from load-time validation so
an unknown provider id no longer aborts the whole run; every other structural
check stays a hard `PreconditionError` abort (KD1). Unknown-provider is then
caught structurally by the pre-flight probe (Task 1/Task 10) and skipped.

**Files to change.**
- `src/config/validate.ts`.

**Changes.**
- In `validateAgentEntry` (validate.ts:68-85), **delete only** the
  `if (!isProviderId(entry.provider)) { ... }` branch (validate.ts:80-84). Keep
  the empty/non-string `model` branch (validate.ts:77-79) and every other
  check. Remove the now-unused `isProviderId` / `PROVIDER_IDS` imports **only if
  they become unused** (they may still be used elsewhere in the file — verify;
  if unused after the deletion, remove the import to keep the build clean).
- Do **not** touch `validateRoles`, `validateTestRole`, `validateSingleRole`
  (including "references unknown agent", duplicate-id, empty-id),
  `validateSelfImprovement`, or mode/scope validation — all remain hard aborts.

**Depends on.** None (but the pre-flight probe in Task 10 is what makes this
safe; Task 10 must land for the end-to-end behavior).

**Traces to.** Open Decision 1, KD1; R1, R2, AC11b.

**Acceptance.**
- A config whose agent has an unknown `provider` id no longer produces a
  validation error from `collectConfigErrors` (it loads).
- A config with an empty/non-string `model`, an unknown agent reference in any
  role, a duplicate test agent id, an empty agent id, or an invalid
  `mode`/`scope`/`selfImprovement` still produces the same validation error(s)
  as today (hard abort preserved).

---

## Task 6 — Scenario-level pass math excludes misconfigured skips; `inconclusive` field

**Goal.** Make `aggregateScenarioReport` exclude a misconfigured-skip cell from
**both numerator and denominator**, and set a distinct, on-disk
`inconclusive` marker when a scenario's surviving tester denominator is empty —
neither a silent pass nor an ordinary FAIL (KD3, KD8 surface 1). The per-agent
`Cell` union is **unchanged** (verdict.ts:9-12).

**Files to change.**
- `src/reports/scenario-report.ts`.

**Changes.**
- Add to `ScenarioReport` (scenario-report.ts:31-36) one optional field:
  `inconclusive?: { reason: "all-testers-misconfigured"; agents: string[] }`.
- In `aggregateScenarioReport` (scenario-report.ts:46-105), change the
  `allPass` computation (scenario-report.ts:82-92) so that a misconfigured-skip
  cell is **excluded** before applying `every(... PASS)`:
  - An agent entry is a misconfigured-skip iff its `review` classifies (via
    `classifyVerdict`) to `{ kind: "SKIPPED" }` **and** Task 1's
    `isMisconfiguredSkipReason(reason)` is true. Such entries are dropped from
    the surviving set (they count toward neither numerator nor denominator).
  - The surviving set is the remaining agent entries. The scenario `pass` is
    `true` iff `scenarioError === undefined`, the surviving set is non-empty,
    and every surviving entry classifies `PASS` (same rule as today, applied to
    survivors only).
  - When the surviving set is **empty** (zero agent dirs, or every present
    agent is a misconfigured-skip cell) and `scenarioError === undefined`, set
    `pass = false` **and** populate `inconclusive = { reason:
    "all-testers-misconfigured", agents: [<ids of the misconfigured-skip cells,
    if any>] }`. When `inconclusive` is set, the scenario is **not** a FAIL —
    consumers branch on the `inconclusive` field.
  - A genuine empty directory caused by a `scenarioError` (enumeration failure)
    keeps today's behavior: `pass = false`, `error` set, **no** `inconclusive`
    marker (an enumeration error is a real scenario error, not an
    all-misconfigured set).
- Persist `inconclusive` into `<scenario>/report.json` when present.

**Depends on.** Task 1 (`isMisconfiguredSkipReason`).

**Traces to.** R4, R5, R5a, KD3, KD8 (surface 1); AC1, AC4, AC7, AC7b, AC11a.

**Acceptance.**
- A scenario with one surviving PASS tester and one misconfigured-skip cell has
  `pass: true` and no `inconclusive` field (the skip cell neither fails the
  scenario nor counts in the denominator).
- A scenario whose only present testers are all misconfigured-skip cells has
  `pass: false` and `inconclusive: { reason: "all-testers-misconfigured",
  agents: [...] }`, with the ids of those cells listed.
- A scenario with zero agent directories and no `scenarioError` is
  `inconclusive` (not a silent pass).
- A scenario with a real `scenarioError` keeps `pass: false`, `error` set, and
  **no** `inconclusive` field.
- A clean scenario (no misconfigured-skip cells) produces a byte-for-byte
  identical `report.json` to today (the exclusion is a no-op; AC14).

---

## Task 7 — Run-level in-memory verdict excludes misconfigured skips and rolls up `inconclusive`

**Goal.** Make the in-memory run verdict (`scenariosAllPass`, `agentsAllPass`)
treat misconfigured-skip cells as excluded and treat an `inconclusive` scenario
as non-PASS-but-not-FAIL, so the merged matrix verdict matches Task 6 (KD3, KD8
surface 2). Keep `mergeIntoRunningReport`'s forward-only accumulation intact
(KD7).

**Files to change.**
- `src/reports/iteration-report.ts`.

**Changes.**
- In `agentsAllPass` (iteration-report.ts:179-188), exclude misconfigured-skip
  entries from the surviving set before the `PASS`-only check (same predicate as
  Task 6): an entry whose `review` classifies `SKIPPED` with
  `isMisconfiguredSkipReason(reason)` true is dropped. A scenario passes iff it
  has ≥1 surviving entry and all survivors are `PASS`; an all-skip survivor set
  is **not** a pass (returns `false`). This keeps `mergeIntoRunningReport`'s
  recomputed `pass` (iteration-report.ts:139) consistent with Task 6.
- In `scenariosAllPass` (iteration-report.ts:166-177), keep treating any
  `pass !== true` scenario as non-PASS for the run-level boolean (an
  inconclusive scenario already has `pass: false`, so the run boolean correctly
  becomes non-PASS). No new run-stored state is added — the run-level
  "inconclusive" distinction is **derived** in `summary.ts` (Task 11), not
  stored here.
- `mergeIntoRunningReport` (iteration-report.ts:115-146) is **not changed** in
  behavior beyond what the recomputed `agentsAllPass` yields: an agent's earlier
  PASS row in a prior scenario is preserved by the existing merge (forward-only,
  KD7). Confirm the `inconclusive` field rides along when a `ScenarioReport` is
  carried forward (it is part of the `ScenarioReport` body, spread by `...body`
  at iteration-report.ts:136).

**Depends on.** Task 6 (shared predicate, `inconclusive` field).

**Traces to.** R4, KD3, KD7, KD8 (surface 2); AC1, AC7, AC7b, AC11a, AC11b.

**Acceptance.**
- A merged scenario with surviving PASSes plus a misconfigured-skip cell yields
  `agentsAllPass === true` for that scenario.
- A merged scenario whose survivors are all misconfigured-skip cells yields a
  non-pass (`agentsAllPass === false`).
- `scenariosAllPass` returns non-PASS when any scenario is `inconclusive`
  (`pass: false`), and PASS when every scenario passes over its surviving set.
- An agent that PASSed scenario A in iteration 1 and is absent from a later
  iteration's selection retains its scenario-A PASS row in the merged report
  (forward-only preserved; KD7).
- A clean run's in-memory verdict is identical to today (AC14).

---

## Task 8 — Re-selection drops ledger ids

**Goal.** Ensure a misconfigured agent is never re-selected or re-dispatched in
any subsequent iteration or final full pass (R2, AC2). This fixes the confirmed
re-selection bug.

**Files to change.**
- `src/pipeline/select-scenarios.ts`.

**Changes.**
- Thread the ledger's skipped-id predicate into `selectScenarios`. Add a
  parameter that lets the caller supply the set of misconfigured agent ids (or
  the `has` predicate) — the pipeline (Task 10) passes the live ledger view.
- Apply the exclusion at every place an agent id enters the selection:
  - In `collectFailingAgents` (select-scenarios.ts:68-95), do **not** add a
    misconfigured id to any scenario's failing set (the triggering misconfig
    failure must not re-select the agent). A scenario whose only failing agents
    were misconfigured therefore contributes no failing-agent entry from those
    ids.
  - In the `failed-pairs` `agentFilter` construction (select-scenarios.ts:54-64)
    and the `failed-scenarios` filtered set, ensure no misconfigured id appears
    in any returned `agentFilter` list.
- Iteration 1 / `mode === "all"` early return (select-scenarios.ts:39-41) must
  also not surface misconfigured ids downstream — but since the agent-loop
  filter (Task 9) is the universal short-circuit before dispatch, the
  `select-scenarios` change is specifically about not **re-selecting** an agent
  because it "failed." Keep the existing scenario-level error re-selection
  behavior (scenarios with `s.error` still always stay selected).

**Depends on.** Task 2 (ledger / predicate).

**Traces to.** R2, KD's re-selection step; AC2.

**Acceptance.**
- Given a previous iteration where a misconfigured agent produced a non-PASS
  cell, the agent id appears in no returned `agentFilter` list and forces no
  scenario into the `failed-pairs`/`failed-scenarios` selection on its account.
- A well-configured agent that genuinely failed is still re-selected exactly as
  today.
- With no misconfigured ids supplied, `selectScenarios` returns byte-for-byte
  today's selection (AC14).

---

## Task 9 — Tester exclusion, runtime detection, and sentinel write in the agent loop

**Goal.** In the per-scenario agent loop: filter ledgered ids out **before**
dispatch (true absence, no workspace, no `beforeTestAgent`), and on a tester's
first failing call classify the error — if misconfiguration, record it in the
ledger, write a misconfigured **sentinel** cell, skip the judge, and do **not**
count the cell (KD4, KD7, KD2); transient errors stay ordinary FAIL rows (AC5).

**Files to change.**
- `src/pipeline/agent-loop.ts`.

**Changes.**
- `RunAgentsParams` gains access to the ledger (passed down from the pipeline;
  Task 10 supplies it via `runScenario` → `runAgents`).
- In `runAgents` (agent-loop.ts:66-111), after computing `agents` from
  `config.roles.test.agents` and the optional `agentIdFilter`, **also** filter
  out any agent whose id is in the ledger (`ledger.has(a.id)`), **before** the
  `Promise.all` dispatch loop. A filtered agent gets no `mkdirSync`, no
  `beforeTestAgent` (AC9), no testing, no judge — true absence (KD4). Log the
  surviving filter as today.
- In `runAgentPair` (agent-loop.ts:127-278), in the testing-failure branch
  (agent-loop.ts:209-222), before writing today's `{ skipped: "testing failed:
  ..." }` row, call `classifyRuntimeError(testingResult.error)`:
  - **Misconfiguration** (non-`undefined`): `ledger.record(agent.id, ["test"],
    reason)` (idempotent if already present), log once (`agent <id> skipped:
    <describeReason>`), mark the judge phase `skipped`, and write the **sentinel
    row** `{ skipped: "misconfigured: <describeReason(reason)>" }` (the marker
    Task 1 defines) for this one cell. The paired judge does not run (as today
    for a failed testing phase). This cell is later excluded from pass math by
    Tasks 6/7/11.
  - **Transient** (`undefined`): keep **exactly** today's behavior — write
    `{ skipped: "testing failed: ${testingResult.error}" }`, judge skipped,
    counts as a non-PASS (ordinary failure; AC5).
- The runtime-detection record uses role `["test"]` here; the ledger unions
  roles, so an id already pre-flighted in another role keeps all roles (AC10).
- Do **not** change the success path or the transient path's surfacing.

**Depends on.** Task 1 (`classifyRuntimeError`, `describeReason`, marker), Task 2
(ledger).

**Traces to.** R2, R3 (runtime), R4, KD2, KD4, KD7; AC5, AC6, AC7, AC7b, AC9.

**Acceptance.**
- A tester whose id is in the ledger pre-flight is never dispatched: no
  workspace dir is created, `beforeTestAgent`/`afterTestAgent` do not fire for
  it, and no row is written (true absence; AC6, AC9).
- A tester whose first call fails with a misconfiguration-class error gets a
  ledger entry (role `test`), is logged once, has its judge skipped, and writes
  a `{ skipped: "misconfigured: <reason>" }` cell — recognizable by Task 1's
  predicate — and that cell does not count as a FAIL (verified via Tasks 6/7).
- A tester whose first call fails with a transient error writes the unchanged
  `{ skipped: "testing failed: ..." }` row, does **not** get a ledger entry, and
  is **not** announced as misconfigured (AC5).
- A run with no misconfigured testers dispatches and writes exactly as today
  (AC14).

---

## Task 10 — Pipeline wiring: ledger build/seed, judge fail-fast, improver degrade, RunContext, roster persistence, threading

**Goal.** Create and seed the ledger once per run before any phase work; fail
the run fast on a misconfigured judge; degrade self-improvement to test-only on
a misconfigured improver; attach the live ledger view to `RunContext`
(`misconfigured`); persist the ledger roster so `summary.ts` can read it; and
thread the ledger into iterations, scenarios, and re-selection (KD1, KD5, KD6,
the ordering constraint).

**Files to change.**
- `src/pipeline/pipeline.ts`.

**Changes.**
- After `loadConfig` + `checkPaths` and before building `RunContext`
  (pipeline.ts:82-106): construct a `MisconfigLedger`, then run
  `preflightMisconfig` over **every distinct agent id** referenced by any role
  — `config.roles.test.agents`, `config.roles.judge.agent`,
  `config.roles.improver.agent` — deduplicated by id; for each non-`undefined`
  reason, `ledger.record(id, <roles that id fills>, reason)`. Compute the role
  set per id from which role references point at it (an id may fill multiple
  roles; AC10). Then **freeze** the pre-flight roster (Task 2 affordance) so
  `preflight()` is the `beforeAll`-visible set (KD5).
- **Judge fail-fast (KD6, AC12):** if the judge agent id is in the ledger after
  the pre-flight probe, throw a `PreconditionError` (from
  `config/resolve-cwd.ts`, the existing precondition path) naming the judge id
  and the human-readable reason (e.g. `Judge agent "j1" is misconfigured:
  ANTHROPIC_API_KEY is not set`), **before** any tester dispatch and before the
  iteration loop. (Runtime-only judge misconfig for ambient-auth providers is
  out of this task's deterministic path; it is acceptable for the run to
  terminate on first judge use — no new code required beyond the existing
  judge-dispatch failure surfacing, which already names the judge.)
- **Improver degrade (KD6, AC13):** if the improver agent id is in the ledger
  and `selfImprovement.mode === "self-improvement"`, degrade to test-only for
  this run: effectively force `maxIterations` to 1 (so `runImprovement` is never
  reached and the loop does not spin redundant identical sweeps) and skip the
  improver invocation. The test/judge sweep still runs and produces a valid
  matrix. Do **not** abort. (Implement by adjusting the `maxIterations` used at
  pipeline.ts:118-119 and/or guarding the `runImprovement` call at
  pipeline.ts:188-208 on "improver not ledgered".)
- **RunContext field (KD5, AC8):** set `runCtx.misconfigured` to a **live view**
  backed by the ledger's `all()` snapshot — i.e. a getter or an object the
  pipeline refreshes so a hook reading at `beforeAll` sees the frozen pre-flight
  set and a hook reading at `afterAll` sees the accumulated set. Simplest
  conforming approach: expose `misconfigured` as a property whose read returns
  the current ledger snapshot (Task 2). Construct it at pipeline.ts:100-106.
- **Thread the ledger** into `runOneIteration` → `runScenario` → `runAgents`
  (Task 9) and into `selectScenarios` (Task 8) so both consult the same live
  ledger.
- **Persist the roster for `summary.ts` (R8):** `prepareSummary` reads only
  `report.json` and has no `RunContext`. Persist the ledger's `all()` snapshot
  at run end into the run-level report (the merged `report.json` written by
  `writeRunReport`, or a sibling field) **or** pass it through
  `PrintSummaryParams` to `prepareSummary` (Task 11 consumes whichever channel
  this task provides). Pick one channel and make Task 11's source match it.
  Persisting alongside the matrix in `report.json` is preferred (it survives as
  an artifact and is available to the on-disk reader). The snapshot must be
  taken **after** the final iteration so runtime finds are included.
- **Ordering constraint:** the ledger must exist and be seeded (and frozen)
  before `runOneIteration` so `beforeAll`/`beforeTestAgent` see pre-flight
  entries (AC9) and the judge fail-fast happens before any tester dispatch.

**Depends on.** Task 1 (`preflightMisconfig`, `describeReason`), Task 2
(ledger), Task 3 (`RunContext.misconfigured`), Task 9 (agent-loop consumes the
ledger), Task 8 (re-selection consumes the ledger).

**Traces to.** R2, R3 (pre-flight), R6, R7, R8, KD1, KD5, KD6; AC6, AC8, AC9,
AC10, AC12, AC13.

**Acceptance.**
- The ledger is seeded from a pre-flight probe over the deduplicated set of all
  role agent ids before the iteration loop runs; an id filling two roles yields
  one entry listing both roles (AC10).
- A run whose **judge** is misconfigured terminates with a `PreconditionError`
  naming the judge id and reason, with no tester dispatch and no partial matrix
  (AC12).
- A self-improvement run whose **improver** is misconfigured still runs the
  test/judge sweep (valid matrix), invokes no improver, and runs no redundant
  extra iterations; it does not fail solely because the improver is
  misconfigured (AC13).
- A hook reading `RunContext.misconfigured` at `beforeAll` sees the pre-flight
  entries keyed by id with their roles; a hook reading at `afterAll` also sees
  runtime-discovered entries (AC8).
- The ledger roster reflecting both pre-flight and runtime finds is available to
  `prepareSummary` via the chosen channel.
- A clean run constructs an empty ledger, sets `misconfigured = {}`, takes no
  fail-fast/degrade branch, and behaves exactly as today (AC14).

---

## Task 11 — `summary.ts`: fourth-surface verdict, exit code, inconclusive rendering, one-time announcement

**Goal.** Make the authoritative on-disk verdict computer agree cell-for-cell
with the in-memory verdict: exclude misconfigured-skip cells from numerator and
denominator, map an all-misconfigured/inconclusive run to an **inconclusive
exit** (exit code 1, distinct rendering) rather than a plain FAIL or a silent
pass, keep the misconfigured cell out of the red FAIL block, and emit the
**one-time** misconfigured-agents announcement that is visually distinct from a
real failure (KD3, KD8 surfaces 3–4, R8). The returned `exitCode` is what the
process exits with (pipeline.ts:265).

**Files to change.**
- `src/reports/summary.ts`.

**Changes.**
- **Exclude misconfigured-skip cells from the verdict.** In `isRowPass`
  (summary.ts:309-317), when scanning `sortedAgents`, **skip** any cell that is
  `SKIPPED` with `isMisconfiguredSkipReason(reason)` true — such a cell neither
  fails the row nor is required to be PASS (a row of surviving-PASS +
  misconfigured-skip cells passes). A row with **no** surviving (non-misconfig)
  cells is **not** a pass (it is inconclusive — see below), so do not return
  `true` for an all-misconfig row.
- **Keep the misconfig cell out of the denominator.** Exclude misconfigured-skip
  cells from `collectAgentIds`/`sortedAgents` membership **for verdict
  purposes** so a misconfigured id is not a phantom denominator entry. (The cell
  may still be rendered in the table for transparency at the code-writer's
  discretion, but it must not participate in the pass/fail math or the red FAIL
  block.)
- **Inconclusive detection on disk (KD3).** Read each scenario's `inconclusive`
  field (Task 6) from `report.json` when loading rows. A scenario carrying
  `inconclusive` (or a row whose only cells are misconfigured-skips / has zero
  surviving cells) is an **inconclusive** scenario: it is non-PASS but **not** a
  red FAIL.
  - Reconcile the empty-rows guard `rows.length > 0` (summary.ts:67) and the
    `sortedAgents.length === 0` table path (summary.ts:160-170) so an
    all-misconfigured run is **not** treated as "no rows" (a silent
    pass) and **not** as an ordinary FAIL: the inconclusive scenarios are
    present as rows and route to the inconclusive path.
- **Verdict + exit code (KD8 surface 4).** Compute:
  - PASS (exit 0): every scenario passes over its surviving set and no scenario
    is inconclusive.
  - FAIL (exit 1): at least one genuine FAIL exists (a real failure dominates);
    render the red FAIL block as today, **excluding** misconfigured-skip cells
    from `failureLines` (summary.ts:319-338), and still list any inconclusive
    scenarios distinctly.
  - INCONCLUSIVE (exit 1): non-PASS, at least one scenario inconclusive, and no
    genuine FAIL. Render a distinct line, e.g. `RUN RESULT: INCONCLUSIVE (N
    scenarios: all testers misconfigured)`, in its own section (reuse the yellow
    `SKIPPED` paint), separate from the red FAIL block, listing the misconfigured
    ids and reasons.
- **One-time misconfigured announcement (R8, AC3, AC4).** Read the persisted
  ledger roster (the channel Task 10 provides — `report.json` field or
  `PrintSummaryParams`). Emit a single dedicated block **once per run**, e.g.:
  ```
  SKIPPED AGENTS (misconfigured):
    bad-key      test            invalid-credential (HTTP 401)
    typo-prov    test, improver  unknown-provider "claud-code"
  ```
  using the yellow SKIPPED paint (distinct from red FAIL). This replaces the N
  identical per-(scenario, iteration) failure rows. A genuinely-failing
  well-configured agent still appears in the red FAIL section and still counts.
- The returned `exitCode` honors the verdict above; `emitSummary`
  (summary.ts:80-83) and the pipeline `return emitSummary(prepared)`
  (pipeline.ts:265) carry it to the process exit unchanged.

**Depends on.** Task 6 (`inconclusive` field + predicate), Task 10 (roster
channel).

**Traces to.** R4, R5, R5a, R5b, R8, KD3, KD8 (surfaces 3–4); AC1, AC3, AC4,
AC7, AC7b, AC11a, AC11b.

**Acceptance.**
- A run with N-1 surviving PASS testers and one misconfigured (pre-flight or
  runtime sentinel) tester reports `RUN RESULT: PASS` with exit code 0 — the
  misconfigured cell neither flips the verdict nor appears in a red FAIL block
  (AC1, AC4).
- A run with one genuinely-failing well-configured tester and one misconfigured
  tester reports `RUN RESULT: FAIL` (exit 1) with the genuine failure in the red
  block and the misconfigured agent only in the one-time SKIPPED announcement —
  visually distinct (AC4).
- A single all-misconfigured scenario among healthy siblings renders that
  scenario distinctly (inconclusive), the healthy siblings roll up normally, and
  the run is PASS iff every sibling passes (AC11a).
- A whole-run all-misconfigured set renders `RUN RESULT: INCONCLUSIVE` with exit
  code 1, lists the misconfigured ids and reasons, and never reports a silent
  pass over the empty set (AC11b).
- Each misconfigured agent appears in the announcement exactly once per run with
  its id and reason, not once per (scenario, iteration) (AC3).
- A clean run's `summary.txt`, console lines, verdict, and exit code are
  byte-for-byte identical to today (AC14).

---

## Task 12 — Live dashboard reflects true-absence and runtime sentinel without false failures

**Goal.** Keep the live progress dashboard consistent with true-absence
(pre-flight skips are simply not in the grid) and with the runtime sentinel cell
(rendered as `skipped`, not added to the `failed` counter), so the dashboard
does not double-count or mislabel a misconfigured agent (R8 surfacing
consistency).

**Files to change.**
- `src/pipeline/pipeline.ts` (tracker construction at pipeline.ts:108-117).
- `src/progress/*` only if a counter change is required (see below).

**Changes.**
- At tracker construction (pipeline.ts:111-114), build each scenario's
  `agentIds` from the **surviving** tester ids (i.e. exclude ledgered
  pre-flight ids) rather than all `config.roles.test.agents`, so a
  pre-flight-skipped tester occupies no grid slot (true absence). This requires
  the ledger to be seeded before the tracker is built (consistent with Task 10's
  ordering).
- The runtime sentinel cell is reported via the agent loop's existing
  `tracker.phaseFinished(..., { status: "skipped", ... })` (Task 9 already marks
  the judge phase skipped). Confirm the tracker's `skipped` slot — not the
  `failed` counter — receives a misconfigured runtime skip, matching today's
  treatment of a `skipped` phase. If the tracker currently routes a testing
  failure to `failed`, ensure the misconfigured runtime case still uses the
  `skipped` status path (no new counter is introduced; reuse the existing
  `skipped` slot in `RunCounters`).
- No new fields on `progress/types.ts` are required; the existing `skipped`
  counters and `Failure` rows suffice.

**Depends on.** Task 2 (ledger), Task 10 (ledger seeded before tracker).

**Traces to.** R8 (dashboard consistency), KD4; AC4 (distinct from failure),
AC6 (no grid slot for pre-flight skip).

**Acceptance.**
- A pre-flight-misconfigured tester occupies no slot in the live grid (its id is
  absent from the scenario's `agentIds`).
- A runtime-detected misconfigured cell increments the `skipped` counter, not
  the `failed` counter, and is not rendered as a red failure row.
- A clean run's dashboard grid, counters, and failure list are identical to
  today (AC14).

---

## Coverage map (every acceptance criterion has a task)

- **AC1** — Tasks 9 (absence), 6/7/11 (pass math all surfaces).
- **AC2** — Task 8 (re-selection drops ledger ids).
- **AC3** — Task 11 (one-time announcement).
- **AC4** — Tasks 11 (distinct rendering, genuine FAIL still counts), 12
  (dashboard).
- **AC5** — Tasks 1 (`classifyRuntimeError` → `undefined` for transient), 9
  (ordinary FAIL path preserved).
- **AC6** — Tasks 10 (pre-flight before phase work), 9 (filter before dispatch,
  no `beforeTestAgent`), 12 (no grid slot).
- **AC7** — Tasks 4 (status surfaced), 1 (classify), 9 (record + sentinel, not
  counted), 6/7/11 (excluded), 8 (not re-selected).
- **AC7b** — Tasks 7 (forward-only merge preserves earlier PASS, KD7), 9
  (later work skipped), 6/7/11 (trigger never counted).
- **AC8** — Tasks 3 (field), 2 (live view), 10 (set on `RunContext`).
- **AC9** — Task 9 (no `beforeTestAgent` for filtered agent), 10 (pre-flight
  before phase work).
- **AC10** — Tasks 2 (role union), 10 (probe over all roles, judge/improver
  consequences), 9 (tester reference).
- **AC11a** — Tasks 6 (`inconclusive` field per scenario), 11 (distinct
  rendering, siblings proceed).
- **AC11b** — Tasks 6/7 (every scenario inconclusive), 11 (`RUN RESULT:
  INCONCLUSIVE`, exit 1), 5/10 (all-agents unknown-provider lands here).
- **AC12** — Task 10 (judge fail-fast `PreconditionError`).
- **AC13** — Task 10 (improver degrade to test-only, maxIterations→1).
- **AC14** — every task's final acceptance bullet pins byte-for-byte / identical
  behavior on a clean run (empty ledger → all new branches are no-ops).
