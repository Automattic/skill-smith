# Design: Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37
Spec: `1-spec/spec.md` (approved, commit `7bdc87e`)

## Overview

`skillsmith` sweeps every (scenario, testing-agent) pair, grades each with a
single judge, and may iterate, re-selecting failures. Today a *misconfigured*
agent — one with an agent-local config or credential defect that fails
identically every attempt — is dispatched anyway: it errors, its paired judge
is skipped, a `{ skipped: "testing failed: ..." }` row is written, that row
counts as a failure, and the agent is re-selected and re-fails every iteration.

This design makes a misconfigured agent **identified once and ignored
everywhere for the rest of the run**. The load-bearing mechanism is a single
run-scoped registry — the **misconfiguration ledger** — that records each
agent id found bad, the reason, and the role(s) it fills. The ledger is
consulted at every decision point: tester dispatch, judge dispatch,
re-selection, pass/fail accounting, the hook context, and the CLI summary.
Detection feeds the ledger from two places: a **pre-flight probe** (run once,
before any phase) and a **runtime classifier** (run on the first invocation
that fails with a misconfiguration-class error). A run with no misconfigured
agents never touches any new branch and is byte-for-byte unchanged.

The design treats the three roles asymmetrically, as the spec requires: a bad
**tester** is excluded from its scenarios' pass/fail math; a bad **judge**
fails the run fast (it is the single point that produces the matrix); a bad
**improver** degrades self-improvement to test-only. Because misconfiguration
is a property of the agent's config — not of a role — detection is **per agent
id**, and the role-appropriate consequence is applied at each reference.

## Approach

### The classifier: what makes an agent "misconfigured" (R1, Decisions 1 & 2)

A new pure module `src/config/misconfig.ts` exposes a single classifier that
maps a credential/dispatch outcome to a verdict:

```ts
export type MisconfigReason =
  | { kind: "missing-credential"; envVar: string }      // pre-flight, deterministic
  | { kind: "unknown-provider"; provider: string }      // pre-flight, deterministic
  | { kind: "invalid-credential"; status: number }      // runtime, 401/403
  | { kind: "model-not-found"; status: number };         // runtime, 404

/** Pre-flight: deterministic, zero-I/O. Returns undefined when the agent
 * has no statically-detectable defect (it may still fail at runtime). */
export function preflightMisconfig(agent: AgentDefinition): MisconfigReason | undefined;

/** Runtime: inspect a captured invocation error. Returns undefined for
 * transient/operational errors (429, 5xx, timeout, context-length,
 * content-filter, MAX_STEPS) — those stay ordinary test failures (R1, AC5). */
export function classifyRuntimeError(err: unknown): MisconfigReason | undefined;
```

The classifier is the single source of truth for the in-scope/out-of-scope
line. Its in-scope set (resolving Decisions 1 and 2 — see Key Decisions):

- **Pre-flight, deterministic**: a required env-var credential is absent (for
  the three env-var providers); an unknown provider id.
- **Runtime, on first failing call**: an authorization failure (401/403 →
  `invalid-credential`); a model-not-found failure (404 → `model-not-found`).

Everything else — 429, 5xx, network timeout, context-length-exceeded, content
filter, MAX_STEPS exhaustion — returns `undefined` and remains an ordinary test
failure (AC5).

### Pre-flight probe (R3 pre-flight, AC6, AC9)

Before any phase work, the pipeline builds the ledger's initial contents by
running `preflightMisconfig` over **every distinct agent id** referenced in any
role (testers, judge, improver — deduplicated, since one id can fill several;
AC10). Pre-flight is deterministic only for the three env-var providers'
missing-key case and for unknown-provider; `claude-code` (ambient auth) and
`codex` (SDK-internal auth) have no pre-flight signal and simply produce no
pre-flight entry — they can still be caught at runtime.

The probe needs the env-var name per provider. A small static map lives beside
the classifier:

```ts
const CREDENTIAL_ENV_VAR: Partial<Record<ProviderId, string>> = {
  "anthropic-api": "ANTHROPIC_API_KEY",
  "openai-api": "OPENAI_API_KEY",
  "gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
};
```

This duplicates the literal each provider already checks; the design accepts
the duplication (small, static, well-covered by tests) rather than threading a
probe method through the `Provider` interface, which would enlarge the public
provider contract for no runtime benefit. (See Risks.)

### Runtime detection (R3 runtime, AC7, AC7b)

The 6 providers already flatten every failure into `InvokeResult.error`
(a string) — the discriminating HTTP status lives inside the SDK error object
and is lost at catch time. To honor Decision 2 (full classifier) without
rewriting every provider's error handling, the design has the classifier match
against the **error string** the providers already produce, plus a thin
enrichment: the three env-var API providers and `vercel-runner` capture the
SDK error's `status`/`statusCode` (when present) into the error string in a
recognizable form (e.g. a leading `[HTTP 401] ...`), so `classifyRuntimeError`
can read the status without the provider contract changing shape. The
missing-credential strings (`"<KEY> is not set"`) are already recognizable and
map to `missing-credential`.

When `classifyRuntimeError` returns a reason for a tester's first failing call,
the agent-loop records it in the ledger and the triggering result is **not
counted** (it is neither a PASS nor a FAIL — it is a skip). Subsequent
scenarios/iterations consult the ledger and never dispatch that agent again.

### The ledger (R2, R4, R7, R8; Decisions 4, 5, 7)

```ts
export interface SkippedAgent {
  id: string;
  roles: ("test" | "judge" | "improver")[];   // every role this id fills
  reason: MisconfigReason;
}

export class MisconfigLedger {
  /** Pre-flight entries, frozen after the probe (Decision 5 boundary). */
  preflight(): ReadonlyMap<string, SkippedAgent>;
  /** All entries known so far, pre-flight + runtime (grows over the run). */
  all(): ReadonlyMap<string, SkippedAgent>;
  has(agentId: string): boolean;
  record(id: string, roles: SkippedAgent["roles"], reason: MisconfigReason): void;
}
```

The ledger is created once per run, seeded by the pre-flight probe, and lives on
`RunContext` (so all hooks see it; R7). `has(id)` is the universal "should this
agent do work?" predicate. The ledger is the single place the
forward-only/retroactive choice (Decision 7) is interpreted, and the single
keyed-by-id surface hooks read (R7) and the CLI summarizes (R8).

## Components

| Component | File | Change |
| --- | --- | --- |
| Classifier + env-var map | `src/config/misconfig.ts` (new) | Pure: `preflightMisconfig`, `classifyRuntimeError`, reason types. |
| Ledger | `src/config/misconfig-ledger.ts` (new) | Run-scoped registry keyed by agent id. |
| Pre-flight wiring | `src/pipeline/pipeline.ts` | Seed ledger from probe over all role agent ids; judge fail-fast; improver degrade; pass ledger into iterations/hooks. |
| Tester exclusion | `src/pipeline/agent-loop.ts` | Filter ledger ids before dispatch; record runtime detections; do not count the triggering failure. |
| Provider error enrichment | `src/providers/lib/vercel-runner.ts`, `anthropic-api.ts`, `openai-api.ts`, `gemini-api.ts` | Surface HTTP status into the error string in a parseable form. |
| Re-selection | `src/pipeline/select-scenarios.ts` | Drop ledger ids from the re-selected agent set. |
| Pass/fail math (in-memory) | `src/reports/scenario-report.ts`, `iteration-report.ts`, `reports/verdict.ts` | Exclude misconfigured-skip from numerator AND denominator (`aggregateScenarioReport`, `agentsAllPass`, `scenariosAllPass`). |
| Pass/fail math (on-disk verdict + exit code) | `src/reports/summary.ts` | Fourth, independent verdict computation: `isRowPass`/`prepareSummary` must apply the same exclusion and emit `inconclusive` exit code, not FAIL. |
| Empty-set outcome | `scenario-report.ts`, `iteration-report.ts`, `summary.ts` | Surface explicit "all testers misconfigured" inconclusive outcome (Decision 3) at both verdict-computing layers. |
| Hook context | `src/config/types.ts` (`RunContext`) | Add a passive, keyed-by-id misconfigured-set field. |
| CLI surfacing | `src/reports/summary.ts`, `src/progress/*` | One-time per-run announcement; visually distinct from a real FAIL. |
| Config validation | `src/config/validate.ts` | Remove ONLY the `isProviderId` branch (`validate.ts:80-84`) from `validateAgentEntry`; empty-`model`, role-reference, mode/scope checks stay hard aborts (Decision 1). |

## Interfaces and Data Flow

```
loadConfig ─► (Decision 1) validate.ts drops ONLY the isProviderId branch;
   │           other structural checks still hard-abort
runPipeline
   ├─ build ledger; preflightMisconfig over every distinct role agent id
   │     (detects unknown-provider via isProviderId/PROVIDER_IDS, NEVER getProvider)
   │     ├─ judge id in ledger?  ──► fail-fast: PreconditionError naming judge+reason (AC12)
   │     └─ improver id in ledger? ─► mark degrade-to-test-only (AC13)
   ├─ put ledger on RunContext  ──► all hooks read RunContext.misconfigured (AC8/AC9/AC10)
   │
   for each iteration:
     selectScenarios(...) ─► drop ledger ids from agent filter (AC2)
     for each scenario:
       runAgents ─► agents = role.test.agents \ ledger ids          (R2/AC1/AC6)
                    (ledger filter short-circuits BEFORE getProvider; KD1)
         for each surviving agent:
           beforeTestAgent fires (skipped agents never reach here)  (AC9)
           runTestingAgent ─► provider.invoke
             error? ─► classifyRuntimeError
                ├─ misconfig ─► ledger.record(id, roles, reason); skip judge;
                │                write {skipped:"misconfigured: <reason>"};
                │                DO NOT count                        (AC7/AC7b)
                └─ transient ─► ordinary FAIL row, counted           (AC5)
       aggregateScenarioReport ─► pass math excludes misconfigured-skip rows
         empty surviving denominator? ─► explicit outcome (Decision 3)  (AC11a/AC11b)
   writeRunReport/scenariosAllPass ─► in-memory run verdict, same exclusion
   afterAll fires ─► RunContext.misconfigured now includes runtime finds (AC8)
   prepareSummary (reads report.json) ─► RECOMPUTES verdict + exit code:
       isRowPass excludes misconfigured-skip cells (num+denom);             (AC1/AC4/AC7/AC7b)
       all-skip/empty row ─► inconclusive exit, not FAIL;                   (AC11a/AC11b)
       one-time misconfigured announcement, distinct styling                (AC3/AC4/AC8)
   emitSummary ─► returns prepared.exitCode as the process exit code (pipeline.ts:265)
```

### Hook-context shape (R7, AC8)

`RunContext` gains one optional, passive field — not a new callback (R7):

```ts
export interface MisconfiguredEntry {
  reason: string;                                   // human-readable
  roles: ("test" | "judge" | "improver")[];
}
export interface RunContext {
  // ...existing fields...
  /** Agents skipped as misconfigured, keyed by agent id. Pre-flight
   * entries are present from `beforeAll`; runtime-discovered entries
   * accumulate and are present by `afterAll`. */
  misconfigured: Readonly<Record<string, MisconfiguredEntry>>;
}
```

Because every hook context extends `RunContext`, the field reaches all hooks
for free. It is a **live view** backed by the ledger (Decision 5: progressive),
so a hook reading at `beforeAll` sees the frozen pre-flight set and a hook
reading at `afterAll` sees the accumulated set. The field is always present
(empty object on a clean run) so consumers need no presence check, but on a
clean run it is `{}` and changes nothing observable (R9/AC14).

### Tester skip representation (Decision 4)

A misconfigured tester is **truly absent**: it is filtered out before dispatch,
so no workspace dir, no `report.json`, no row. This keeps the verdict math
trivially correct (the agent is simply not in `agents`), needs zero changes to
the on-disk-walking e2e hook (`verify-e2e.ts` already tolerates absent
agents), and matches AC1's "as if only the N-1 well-configured were
configured." The single exception is the **runtime-detected** tester that fails
on scenario B: at that moment a workspace dir already exists for scenario B,
so the agent-loop writes a sentinel `{ skipped: "misconfigured: <reason>" }`
row for that one cell instead of a row that would count. The pass-math change
below (KD8) treats that sentinel as excluded at all four verdict surfaces —
including the on-disk `summary.ts` reader that re-derives the verdict and exit
code — so the representation difference is invisible to the verdict and the
sentinel cannot flip the run to FAIL/exit-1.

## Key Decisions

### KD1 — Unknown provider becomes a per-agent skip (resolves Open Decision 1)

- **Choice**: Demote an unknown `provider` id from a whole-run
  `PreconditionError` abort to a per-agent skip (`unknown-provider` reason),
  recorded in the ledger like any other misconfiguration.
- **Exactly what changes in load-time validation**: the **only** part removed
  from `collectConfigErrors` is the `isProviderId` branch inside
  `validateAgentEntry` (`validate.ts:80-84`). Every sibling check in the same
  function and its callers stays a hard `PreconditionError` abort: the
  empty/non-string `model` branch (`validate.ts:77-79`) in the *same*
  `validateAgentEntry`, the role-reference checks (`validateRoles` →
  `validateTestRole`/`validateSingleRole`, including "references unknown agent",
  duplicate-id, and empty-id), and mode/scope/`selfImprovement` validation. An
  unknown provider is the single structural check that becomes a skip; nothing
  else is loosened, and nothing becomes silent.
- **Why this does not crash at dispatch**: `provider` is typed `ProviderId` on
  `AgentDefinitionInput`, and removing the load-time guard lets a non-`ProviderId`
  string flow through `normalizeConfig` into a runtime `AgentDefinition.provider`
  that `getProvider(id)` would throw on (`registry.ts:23-29`). The design
  forecloses that path: the **pre-flight probe** detects unknown-provider
  *structurally*, before any provider is resolved, by testing the id with
  `isProviderId` / membership in `PROVIDER_IDS` (`registry.ts:21,31-33`) —
  **never** by calling `getProvider`. The agent is recorded in the ledger at
  pre-flight, and from then on `getProvider` is never reached for it:
  - **As a tester**, the agent-loop filters ledger ids out of `agents` *before*
    the dispatch loop (so before `runTestingAgent` → `provider.invoke` →
    `getProvider`); the short-circuit is the `has(id)` ledger check, which runs
    ahead of any provider resolution (R2/AC1/AC6).
  - **As the judge**, the judge fail-fast (KD6) fires from the same pre-flight
    probe and terminates with a `PreconditionError` *before* the first judge
    dispatch, so the judge's `getProvider` is never called for an unknown-provider
    id (AC12).
  - **As the improver**, the degrade-to-test-only path (KD6) attempts no edits,
    so the improver's provider is never resolved (AC13).
  Because the unknown-provider id is deterministic and caught in the pre-flight
  probe, no role's runtime path ever passes a ledgered unknown-provider id to
  `getProvider`; the raw `Error` thrown by `registry.ts:26` is unreachable for
  these agents.
- **Alternatives**: (a) Keep fail-fast — treat a typo'd provider as an author
  error that aborts. (b) Hybrid — abort only if *every* agent has an unknown
  provider, else skip.
- **Trade-offs**: The issue explicitly lists "a provider that doesn't exist" as
  a misconfiguration example and the whole feature's thesis is "ignored
  everywhere rather than causing failures," which points at skip. Skipping one
  agent with a typo lets the rest of a multi-agent run complete — the precise
  derailment this feature removes. The cost is that a config-wide typo (all
  agents) no longer aborts loudly at load; it now surfaces via the empty-set
  inconclusive outcome (KD3), which is still explicit and non-silent, so no
  failure is hidden.
- **Traces-to**: R1 (in-scope set), R2, Open Decision 1; the empty-set path
  ties to R5/AC11b.

### KD2 — Full, status-aware classifier (resolves Open Decision 2)

- **Choice**: Implement the full classifier: `missing-credential` and
  `unknown-provider` pre-flight, plus `invalid-credential` (401/403) and
  `model-not-found` (404) at runtime, by surfacing the SDK error's HTTP status
  into the error string and matching on it.
- **Alternatives**: Minimal classifier — only the deterministic
  missing-credential (+ unknown-provider) cases are skips; a 401-on-call stays
  an ordinary failure.
- **Trade-offs**: The minimal option is smaller and lower-risk, but it
  under-covers the prompt's flagship "invalid API token" example (R1 lists
  present-but-invalid credentials as in-scope) — an invalid token would
  re-fail every iteration, exactly the bug the feature exists to fix. The full
  classifier covers it. The risk — misclassifying a transient error as
  misconfiguration — is contained by an **allowlist** discriminator: only the
  specific statuses 401/403/404 (and the exact missing-key strings) classify as
  skip; everything else, including any status the harness cannot read, falls
  through to ordinary failure (AC5's safety direction). When the SDK error
  carries no status, the result is an ordinary failure, never a false skip.
- **Traces-to**: R1, R3 (runtime branch), AC5, AC7, AC7b, Open Decision 2.

### KD3 — Empty surviving-tester set: per-scenario `inconclusive`, no whole-run abort (resolves Open Decision 3)

- **Choice**: An empty surviving denominator yields a distinct **`inconclusive`
  scenario outcome** (a new verdict state, neither pass nor fail). Granularity
  is **per-scenario**: a single all-misconfigured scenario (R5a) marks only
  that scenario inconclusive while siblings proceed and roll up normally; when
  *every* scenario is inconclusive because every tester is misconfigured (R5b),
  the run's overall verdict is a non-PASS, explicitly-surfaced "inconclusive"
  result (exit code 1) listing the misconfigured ids and reasons.
- **Concrete data-model representation (single, unambiguous home)**:
  `inconclusive` is a **scenario-level** state, so it lives on `ScenarioReport`
  — **not** on the per-(scenario, agent) `Cell` union (`verdict.ts:9-12`),
  which keeps its existing three kinds (PASS / FAIL / SKIPPED) unchanged.
  Specifically:
  - `ScenarioReport` (`scenario-report.ts:31-36`) gains one optional discriminator,
    `inconclusive?: { reason: "all-testers-misconfigured"; agents: string[] }`,
    set by `aggregateScenarioReport` exactly when the surviving denominator is
    empty (≥0 agents present, but every present agent is a misconfigured-skip
    cell, or no agents at all after exclusion). When `inconclusive` is set,
    `pass` is `false` (it is not a pass), and the scenario is **not** a FAIL —
    consumers branch on the `inconclusive` field, which is the distinguisher.
  - `report.json` for the run therefore carries, per scenario, either
    `{ pass: true }`, `{ pass: false }` (real failure), or
    `{ pass: false, inconclusive: {...} }`. The third shape is what makes
    AC11a "distinguishable from a real failure" verifiable on disk.
  - **`scenariosAllPass`** (`iteration-report.ts:166-177`) already returns
    non-PASS for any `pass !== true` scenario, so an inconclusive scenario
    correctly fails the run-level PASS — but the run verdict reported to the
    user must be rendered "inconclusive," not "FAIL," when *every* non-pass
    scenario is inconclusive (R5b). The run-level distinction is derived (run is
    inconclusive iff it is non-PASS and at least one scenario is inconclusive
    and no scenario is a genuine FAIL), not stored as a fourth run state.
  - **`summary.ts`** (the authoritative verdict/exit-code computer, KD8) reads
    the per-scenario `inconclusive` field from `report.json` and renders the
    run line as `RUN RESULT: INCONCLUSIVE (N scenarios: all testers
    misconfigured)` with **exit code 1** (non-PASS, AC11b) in its own
    visually-distinct section, separate from the red FAIL block. A run that has
    both genuine FAILs and inconclusive scenarios renders FAIL (a real failure
    dominates) but still lists the inconclusive scenarios distinctly. The empty
    `rows.length > 0` guard (`summary.ts:67`) is reconciled here: an
    all-misconfigured run is not "no rows" — the scenarios still exist with an
    `inconclusive` marker — so it is neither a silent pass (guard) nor an
    ordinary FAIL.
- **Alternatives**: (a) Abort the whole run on the first all-misconfigured
  scenario. (b) Mark the empty-set scenario a plain FAIL. (c) Reuse a per-cell
  `SKIPPED` marker to stand in for scenario-level inconclusiveness — rejected
  because `Cell` is per-agent and an empty surviving set has *no* agent cell to
  carry the state, so the marker would have no home.
- **Trade-offs**: Abort throws away every sibling scenario's results — the
  opposite of "one bad agent must not derail the run," and indistinguishable
  from the derailment this feature removes. Plain FAIL violates R5's "must NOT
  be reported as an ordinary failure indistinguishable from a real test
  failure" and AC11a's "not indistinguishable from a real failure." A distinct
  `inconclusive` field on `ScenarioReport` satisfies the no-silent-pass
  invariant (it is never a pass over an empty set), is explicit, and is
  visually separable in the CLI. The cost is one new optional field on
  `ScenarioReport` plus the rendering branch in `summary.ts` — the per-agent
  `Cell` union is untouched, so the existing SKIPPED rendering path for
  individual cells is unaffected. Whole-run all-misconfigured naturally rolls up
  as "every non-pass scenario inconclusive → run inconclusive," so R5b needs no
  separate stored run state.
- **Traces-to**: R5, R5a, R5b, AC11a, AC11b, Open Decision 3. Note: an empty
  set caused by an all-agents unknown-provider typo (KD1) lands here, keeping
  that case explicit.

### KD4 — Tester skip is true absence (runtime cell marked-skipped) (resolves Open Decision 4)

- **Choice**: Pre-flight-known misconfigured testers are wholly absent (never
  dispatched, no row). Runtime-detected testers leave a marked
  `{ skipped: "misconfigured: <reason>" }` sentinel on the one cell where
  detection happened; both are excluded from pass math.
- **Alternatives**: Present-but-marked for *all* skipped testers (write a
  sentinel row for every (scenario, agent) the absent agent would have had).
- **Trade-offs**: True absence is transparent to the on-disk-walking e2e hook
  (zero changes), keeps the verdict math trivial (the agent is not in the set),
  and matches AC1's "as if only the N-1 were configured." Present-but-marked
  for all cells would manufacture rows for an agent that did nothing, inflating
  the matrix and requiring the tracker grid to carry phantom skipped slots
  across every scenario. The hybrid (absence for pre-flight, marked-skip for
  the single runtime-trigger cell) is forced by reality: at runtime the
  workspace dir already exists, so a sentinel is the cheapest way to keep that
  cell from counting as a failure. The pass-math exclusion (below) makes the
  two representations verdict-equivalent.
- **Traces-to**: R4, R8, AC1, AC4, Open Decision 4; pass-math exclusion is the
  load-bearing invariant that holds either way.

### KD5 — Hook contract is progressive (live, keyed by id) (resolves Open Decision 5)

- **Choice**: One field `RunContext.misconfigured` backed by the live ledger:
  pre-flight entries present from `beforeAll`; runtime entries accumulate and
  are present by `afterAll`. Passive data, not a callback.
- **Alternatives**: Static-only — freeze the pre-flight set at `beforeAll`,
  never grow it; expose only that frozen roster.
- **Trade-offs**: R7 requires pre-flight skips visible at `beforeAll` (so
  `beforeTestAgent` provisioning is not wasted; AC9) **and** runtime skips
  visible by `afterAll` (AC8). Static-only satisfies the first but not the
  second — an `afterAll` reporting hook would never learn about a tester killed
  by an invalid token at runtime. The progressive single-field design satisfies
  both with one field. The cost is that the field is a live view (a hook
  reading early vs late sees different contents); this is documented on the
  field and is exactly the temporal behavior R7 describes. Keyed by agent id
  with `roles[]` satisfies AC10 (one id in many roles → one entry listing all
  roles).
- **Traces-to**: R7, AC8, AC9, AC10, Open Decision 5.

### KD6 — Judge fails fast (pre-flight); improver degrades to test-only (resolves Open Decision 6)

- **Choice**: A misconfigured **judge** aborts the run with a clear message
  naming the judge id and reason — ideally pre-flight (before any tester runs),
  via a `PreconditionError`-style path; if only detectable at runtime, the run
  terminates on the first judge invocation that classifies as misconfiguration,
  still naming the judge. A misconfigured **improver** (self-improvement only)
  **degrades to test-only**: the test/judge sweep runs, no edits are attempted,
  and the loop does not spin redundant identical iterations.
- **Alternatives**: Judge — produce a partial matrix / mark every pair skipped
  (incoherent: nothing grades). Improver — abort the run.
- **Trade-offs**: The judge is cardinality-1 and produces the run's core output;
  with no judge there is no matrix, so "skip everywhere" is meaningless and
  fail-fast is the only coherent, non-misleading outcome (AC12 — "rather than
  producing repeated per-pair failures or a partial matrix"). Doing it
  pre-flight saves dispatching testers whose results can never be graded.
  Detecting the judge in the same pre-flight probe as testers (KD's pre-flight
  step) gives this for free for the deterministic cases; ambient-auth providers
  fall back to runtime termination on first judge use. The improver is
  cardinality-1 but **non-blocking**: a valid test/judge matrix is still
  produced, so the lenient "degrade, don't fail" outcome matches both the
  current behavior (an improver error is logged, the loop continues) and the
  issue's "ignored, not fatal" spirit (AC13). Degrade specifically means: set
  `maxIterations` effectively to 1 for the run (no point iterating without an
  improver to edit between iterations) so the run does not spin N identical
  sweeps.
- **Traces-to**: R6, AC12, AC13, AC10 (same id as tester+improver: excluded as
  tester, degrades as improver), Open Decision 6.

### KD7 — Runtime exclusion is forward-only (resolves Open Decision 7)

- **Choice**: When a tester is discovered misconfigured at runtime *after* it
  recorded an earlier PASS, that earlier PASS **remains counted**; only the
  triggering invocation and all later work are excluded.
- **Alternatives**: Retroactive — purge the agent's earlier PASS from
  accounting too, so the agent contributes to no scenario at all.
- **Trade-offs**: Forward-only is the smaller, more truthful change: an earlier
  PASS is a real result the agent genuinely produced (the artifact passed the
  judge), and erasing a true PASS because a *later, unrelated* scenario hit an
  auth error overstates what we know. The existing merge logic
  (`mergeIntoRunningReport`) already preserves prior-iteration rows for agents
  not re-run, so forward-only aligns with how the matrix already accumulates —
  retroactive would require a new "purge this agent's history" pass that fights
  that machinery. Both satisfy R4's firm invariant (the triggering failure is
  never a failure; the agent is absent from the denominator of any scenario
  where it did no counted work) and AC7b's common assertion. Forward-only's
  only user-visible consequence is that a run can show one PASS row for an agent
  later found misconfigured — which is accurate, and the agent is still
  announced once as misconfigured (R8) so the picture is not misleading.
- **Traces-to**: R3, R4, AC7, AC7b, Open Decision 7.

### KD8 — Pass/fail math excludes misconfigured-skip from numerator and denominator, across all FOUR verdict-computing surfaces (load-bearing, holds across KD4/KD7)

- **Context — there are four independent verdict computations, not three.**
  The codebase derives a PASS/FAIL judgment from the matrix in four places that
  do **not** share a code path; all four must apply the same exclusion or the
  feature leaks. (1) `aggregateScenarioReport` (`scenario-report.ts:82-92`)
  computes a scenario's boolean `pass` while writing `<scenario>/report.json`.
  (2) `scenariosAllPass` (`iteration-report.ts:166-177`) computes the run's
  boolean `pass` while `writeRunReport` writes `report.json`; `agentsAllPass`
  (`:179-188`) is the per-scenario helper. (3) and (4) **`summary.ts`
  recomputes the verdict and the process exit code from scratch by re-reading
  `report.json`** — `prepareSummary` derives `allPass = rows.length > 0 &&
  rows.every((r) => isRowPass(r, ...))` (`summary.ts:66-67`), `isRowPass` fails
  the row on any non-PASS cell including a `SKIPPED` one (`:309-317`), and the
  returned `exitCode` (`:76`) is what the pipeline ultimately exits with via
  `return emitSummary(prepared)` (`pipeline.ts:265`). `summary.ts` calls none
  of the three functions in (1)/(2); it is a fourth, co-equal verdict computer
  and the *authoritative* one for the user-visible RUN RESULT line and the
  process exit code.
- **Choice**: Apply one exclusion rule at all four surfaces — a
  misconfigured-skip cell (the runtime sentinel `{ skipped: "misconfigured:
  ..." }`, KD4) and any `inconclusive` scenario (KD3) are excluded from both
  numerator and denominator rather than counting as a FAIL. A scenario passes
  iff it has ≥1 surviving tester and every surviving tester PASSes; an empty
  surviving set is `inconclusive` (KD3), not a pass.
  - **In-memory (surfaces 1–2)**: `aggregateScenarioReport` / `agentsAllPass`
    skip a cell whose `classifyVerdict` yields `SKIPPED` with a reason matching
    the misconfigured marker before applying `every(... PASS)`; `scenariosAllPass`
    treats an `inconclusive` scenario as non-PASS-but-not-FAIL per KD3.
  - **On-disk verdict + exit code (surfaces 3–4, `summary.ts`)**: this is the
    fix the prior revision omitted. `isRowPass` (`:309-317`) must **skip**
    misconfigured-skip cells when scanning `sortedAgents` (so a row of
    surviving-PASS + misconfigured-skip cells passes), and must not let the
    misconfigured cell flip the row to fail. `failureLines` (`:319-338`) must
    not list a misconfigured-skip cell under the red FAIL block (it belongs in
    the one-time SKIPPED announcement, KD-CLI). The misconfigured cell is also
    excluded from `collectAgentIds`/`sortedAgents` membership for verdict
    purposes so it is not a phantom denominator entry. The empty-row guard
    `rows.length > 0` (`:67`) and the `sortedAgents.length === 0` /
    all-misconfigured-row case must map to KD3's **inconclusive exit** path
    (`exitCode` non-zero, distinct rendering — see KD3), **not** to today's
    plain `RUN RESULT: FAIL` and **not** to a silent pass. The result: the
    on-disk verdict in `summary.ts` agrees cell-for-cell with the in-memory
    verdict in `iteration-report.ts`, and the process exit code honors AC1/AC7.
- **Alternatives**: Leave `classifyVerdict`'s SKIPPED counting as FAIL (today's
  behavior) and rely only on absence — but that fails the runtime-sentinel cell
  and the present-but-marked option, and (critically) leaves `summary.ts`
  flipping the visible verdict and exit code to FAIL on any misconfigured-skip
  cell regardless of what the in-memory layers computed.
- **Trade-offs**: This is the one change R4 requires "regardless of surface
  representation." Today `classifyVerdict` returns a `SKIPPED` kind that every
  pass-math surface treats as non-PASS → FAIL; this design distinguishes a
  *misconfiguration* skip (excluded) from any other skip. Concretely, the
  sentinel review uses a recognizable marker (`skipped: "misconfigured: ..."`)
  that the math filters out before computing `every(... PASS)`. The cost is
  touching four pass-computing functions across two files instead of three in
  one; the benefit is that KD4 and KD7 both reduce to "is this cell excluded?"
  with no further special-casing, and the authoritative exit code can no longer
  contradict the in-memory verdict.
- **Traces-to**: R4, AC1, AC4, AC7, AC7b, AC11a, AC11b (inconclusive exit code
  in `summary.ts`), AC14 (clean run: no misconfigured-skip cells exist, so the
  filter is a no-op at all four surfaces and math/exit code are identical).

## Dependencies

- **No new packages.** The classifier reads strings/status already produced by
  `@ai-sdk/*` and `@openai/codex-sdk`; no new SDK surface is used.
- **Internal**: `providers/registry.ts` (`isProviderId`, `PROVIDER_IDS`) for
  the unknown-provider check; `config/types.ts` for `RunContext`/`AgentContext`;
  `reports/verdict.ts` `Cell` type (read unchanged — the new `inconclusive`
  state lives on `ScenarioReport`, not on the per-agent `Cell` union; KD3);
  `reports/scenario-report.ts` `ScenarioReport` (gains the optional
  `inconclusive` field); `progress/types.ts` for the dashboard counters. The
  pre-flight probe depends only on `process.env` and the static
  `CREDENTIAL_ENV_VAR` map.
- **Ordering constraint** (not an implementation plan, a data dependency): the
  ledger must exist and be seeded before `runOneIteration` so `beforeAll` and
  `beforeTestAgent` see pre-flight entries (AC9) and so the judge fail-fast
  (KD6) happens before any tester dispatch.

## Failure Modes and Observability

- **CLI one-time announcement (R8, AC3, AC4)**: `prepareSummary` today reads
  only `report.json` from disk and has no `RunContext` access, so the
  misconfigured roster must be available to it either persisted into
  `report.json` (the ledger snapshot written alongside the matrix at run end)
  or passed through `PrintSummaryParams`. `prepareSummary` emits a dedicated
  block from that roster, e.g.:

  ```
  SKIPPED AGENTS (misconfigured):
    bad-key      test            invalid-credential (HTTP 401)
    typo-prov    test, improver  unknown-provider "claud-code"
  ```

  This is emitted **once per run**, replacing today's N identical failure rows.
  A misconfigured agent is rendered in a distinct style/section (reusing the
  existing yellow `SKIPPED` paint, separate from red `FAIL`), so it is visually
  distinct from a genuine test failure (AC4). A well-configured agent that
  genuinely fails still appears in the red FAIL section and still counts (R8,
  AC4, AC5).
- **Live dashboard**: pre-flight-skipped testers are simply not in the grid
  (true absence; tracker built from surviving ids). The runtime-sentinel cell
  renders as `skipped`, which the tracker already supports — but it does not add
  to the `failed` counter (it uses the existing `skipped` slot).
- **Judge fail-fast (AC12)**: a single clear line naming the judge id and reason
  (e.g. `Judge agent "j1" is misconfigured: ANTHROPIC_API_KEY is not set`),
  exit code 1, no partial matrix.
- **Empty-set / inconclusive (AC11a/AC11b)**: an all-misconfigured scenario
  carries the `ScenarioReport.inconclusive` field (KD3); `summary.ts` renders it
  as `RUN RESULT: INCONCLUSIVE` (or, when genuine FAILs co-exist, FAIL with the
  inconclusive scenarios still listed distinctly) with exit code 1, lists the
  misconfigured ids and reasons, and never reports a silent pass over the empty
  set. The `rows.length > 0` guard (`summary.ts:67`) does not fire because the
  inconclusive scenarios are present as rows.
- **Logs**: each ledger record is logged once (`log.info("agent X skipped:
  <reason>")`) for the evidence trail; runtime detection logs at the point of
  classification.
- **Backward-compat observability (AC14)**: when `misconfigured` is empty, no
  new block prints, the grid is unchanged, the math filter is a no-op, and hook
  firing order is untouched — output is byte-for-byte identical.

## Coverage of every acceptance criterion

- **AC1** — pre-flight tester absent from dispatch (KD4) and from pass math at
  all four surfaces including `summary.ts`'s exit code (KD8); verdict equals the
  N-1 run. ✔
- **AC2** — `selectScenarios` drops ledger ids, so no re-selection/re-dispatch
  (ledger consulted in re-selection). ✔
- **AC3** — single CLI announcement from the ledger, not per (scenario,
  iteration). ✔
- **AC4** — distinct SKIPPED styling vs red FAIL; genuine failure still counts
  (and still flips `summary.ts` exit code), misconfigured does not (KD8). ✔
- **AC5** — `classifyRuntimeError` returns `undefined` for transient errors →
  ordinary counted FAIL (KD2 allowlist). ✔
- **AC6** — pre-flight probe runs before phase work; surviving-set filter means
  no testing, no judge, and `beforeTestAgent` never fires for the agent. ✔
- **AC7** — runtime classify → ledger record → triggering result not counted,
  agent absent from later numerators/denominators, not re-selected (KD2, KD7,
  KD8). ✔
- **AC7b** — forward-only (KD7): scenario-A PASS counts, scenario-B trigger and
  later work excluded; misconfiguration never a failure. ✔
- **AC8** — `RunContext.misconfigured` keyed by id with `roles[]`; pre-flight
  at `beforeAll`, runtime by `afterAll`; passive (no new callback) (KD5). ✔
- **AC9** — pre-flight tester absent before `beforeTestAgent`, so provisioning
  never fires for it (KD4, KD5). ✔
- **AC10** — detection per agent id; ledger entry lists all roles; tester
  reference excluded (KD4), improver reference degrades (KD6); hook entry
  reflects all roles. ✔
- **AC11a** — single all-misconfigured scenario → `ScenarioReport.inconclusive`
  field (distinct from a FAIL on disk and in `summary.ts`), siblings proceed
  (KD3). ✔
- **AC11b** — whole-run all-misconfigured → every non-pass scenario inconclusive
  → `summary.ts` renders RUN RESULT: INCONCLUSIVE, exit code 1, explicit,
  ids+reasons surfaced (KD3, KD8). ✔
- **AC12** — misconfigured judge fail-fast, names judge + reason, no partial
  matrix (KD6). ✔
- **AC13** — misconfigured improver degrades to test-only, valid matrix, no
  edits, no redundant iterations (KD6). ✔
- **AC14** — empty ledger → no new branch taken; identical matrix, verdict,
  hook firing, CLI (R9, KD8 no-op). ✔

## Risks and Open Questions

- **Provider error-string parsing is brittle.** The full classifier (KD2)
  relies on the SDK surfacing a recognizable HTTP status. The enrichment in the
  three env-var providers + `vercel-runner` is best-effort; if an SDK changes
  its error shape, an invalid-credential failure silently falls through to an
  ordinary FAIL (the safe direction — it never produces a *false* skip). Tests
  must pin the exact error strings (mockable via the `mock` provider). Mitigated
  by KD2's allowlist: unknown status → ordinary failure, never a skip.
- **`claude-code` and `codex` have no pre-flight credential signal.** Their
  missing/invalid auth is only catchable at runtime. This is inherent (ambient
  CLI/subscription auth, SDK-internal key handling); the design covers them via
  the runtime path only. No new pre-flight probe is added for them
  (out-of-scope: "changing any provider's authentication mechanism").
- **Env-var-name duplication** between `CREDENTIAL_ENV_VAR` and each provider's
  literal. Accepted (small, static, test-covered) rather than expanding the
  `Provider` interface with a `credentialEnvVar()` method. If providers later
  diverge in env-var handling this map must track them — a one-line maintenance
  point flagged here.
- **New `inconclusive` verdict state** is a scenario-level field on
  `ScenarioReport` (KD3) — it does **not** widen the per-agent `Cell` union. It
  touches all four pass-computing surfaces (KD8: `aggregateScenarioReport`,
  `agentsAllPass`/`scenariosAllPass`, and `summary.ts`'s `isRowPass`/
  `prepareSummary`) and the run-result rendering in `summary.ts`. Risk is
  contained because the per-agent SKIPPED rendering path is untouched and the
  math change (KD8) is the same change R4 mandates anyway; the residual risk is
  keeping the on-disk verdict in `summary.ts` in agreement with the in-memory
  verdict, addressed by applying the identical exclusion rule at both layers.
- **Live hook field semantics** (KD5): a hook that caches `misconfigured` early
  will not see later runtime additions. Documented on the field; this is the
  intended progressive contract, not a bug.
- **No true open questions block design.** All seven Open Decisions are resolved
  above with defensible defaults grounded in the spec's invariants; none has a
  billing/user-visible consequence the spec gives no basis to choose. The
  forward-only choice (KD7) is the only one that changes a verdict for affected
  runs, and the spec explicitly frames both readings as invariant-preserving and
  leaves the choice to design.
