# Design Doc: Skip misconfigured agents across all phases of a run

## 1. Background and goal

`skillsmith` evaluates skills by running agents declared in `skillsmith.config.ts`
under three roles: a list of **test** agents that generate code, a single **judge**
that grades each result, and a single **improver** that edits skills between
iterations (self-improvement mode). A run sweeps every (scenario, test-agent) pair,
grades each, may repeat over several iterations re-selecting failures, and — in the
`testing-project` consumer — also runs a Playwright e2e suite against the artifacts
each agent produced.

An agent is **misconfigured** when it cannot run for an agent-local reason knowable
without grading its output and identical on every call this run — paradigmatically, a
required provider credential is absent from the environment (e.g. an `openai-api`
agent with `OPENAI_API_KEY` unset). Today such an agent is invoked anyway, its call
returns an error, and that error is conflated with a graded failure: it burns compute,
scaffolds a workspace, repeats once per scenario and iteration, and runs Playwright
against a plugin that was never built — producing spurious failures with no way to
tell "this agent could not run" from "this skill failed."

The goal is to make a misconfigured agent **vanish from everything that executes**
while being **recorded loudly in the outcome**, so a partial run is never mistaken for
a clean one. Two co-equal properties must hold:

- **In the work, it is gone.** The agent runs no phase, is absent from pass/fail
  accounting, is not re-selected in later iterations, triggers no per-agent
  provisioning, and gets no Playwright project. For everything that executes, the run
  behaves as if the agent were not in the configuration.
- **In the outcome, it is present.** Every skipped agent is announced once in the CLI
  with its id and reason, visually distinct from an agent that ran and failed; it
  appears the same way in the machine-readable run report; and the run exits non-zero.

Handling is **role-aware**, the policy decision routes through a **single seam** (only
the default "warn" behavior ships now), and the e2e harness consumes the result so it
no longer tests skipped agents.

### 1.1 Terms used in this document

- **Misconfigured** — an agent that cannot run for an agent-local reason knowable
  without invoking it and identical on every call this run. The condition the feature
  acts on.
- **Failed** — an agent that *ran* and produced an error or non-passing result.
  Distinct from misconfigured and unchanged by this feature.
- **Runnable** — not misconfigured, judged from the static view (configuration plus
  environment, with no model invocation).
- **Lane** — everything attributable to one agent across the whole run: its column of
  (scenario, iteration) cells, the judge reviews paired with it, and its use in any
  role it fills.
- **"warn"** — the default and only implemented policy for a misconfigured agent:
  remove its lane (test), or stop the run (judge), or halt after the iteration
  (improver); surface it; and force a non-zero exit.

These names are descriptive; they do not prescribe identifiers or code placement.

### 1.2 Scope guardrails

- **Detection is setup-time only.** Misconfiguration is determined once, before any
  phase runs, purely from the agent's declared provider plus the environment.
- **The classifier is minimal.** It covers exactly the three providers whose
  credential requirement is a plain environment read. Deeper runtime introspection
  (present-but-invalid key, 404 model-not-found, quota errors) is explicitly out of
  scope and remains an ordinary failure on the existing invoke-time error path; it
  must be *addable later at the policy seam* without reworking the accounting model.
- **The "skipped-lane invariant"** — a skipped lane contributes nothing, anywhere,
  ever, including any result it recorded before detection — is a stated invariant, not
  machinery to build now. Because shipped detection is setup-time only, the lane never
  starts and this holds trivially. It is named so that adding runtime detection later
  preserves the same accounting model rather than requiring a rewrite. **Do not build
  a retroactive result-purge.**
- **Out of scope entirely:** the "fail" and "skip" policies (only "warn" ships); deep
  error-body introspection; explicit missing-tool detection (a missing local tool
  stays an ordinary failure guarded only by error containment); treating an
  unknown/nonexistent provider id as a per-agent skip (it stays a hard abort); a CLI
  argument to intentionally skip named agents; retrying or repairing a misconfigured
  agent; and any per-scenario "empty surviving-tester set" handling (test agents are
  global to the run, so the only empty-tester case is the whole-run one).

## 2. Architecture overview

The change is **one new self-contained classifier component plus a handful of
localized wiring edits.** No existing internal signature changes except additive
parameters; the `Cell` set and the provider `invoke` paths are untouched.

```
                         skillsmith.config.ts + process.env
                                      │
                                      ▼
                  ┌───────────────────────────────────────────┐
                  │            classifier (new module)          │
                  │  classifyRunnability(config, env) → {       │
                  │     runnableTestAgentIds: string[],         │
                  │     skipped: SkippedAgent[],                │
                  │     judgeRunnable, improverRunnable }       │
                  │  decide(roles) → Consequence  ← POLICY seam │
                  │     reads getProvider(provider).requiredEnv │
                  └───────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        ▼                             ▼                              ▼
  judge STOP_RUN?              runCtx.skipped (R10.1)         skipped[] → report.json
  print + return 2            (readable from beforeAll)       (R4.3 + exit signal)
  before any hook/report             │                              │
        (R6.2)                       ▼                              ▼
                          tracker columns + runAgents      prepareSummary reads
                          restricted to runnable set       report.skipped:
                          via agentIdFilter pattern        exitCode =
                          (R3.1–R3.3)                       skipped.length>0 ? 2
                                     │                       : (allPass ? 0 : 1)
                                     ▼                       + once-per-run skip
                          improver HALT_AFTER_ITERATION:     block in consoleLines
                          gate in-loop improver branch +     (R4.1/R4.2/R5)
                          finalPass sweep on "runnable";
                          halt after current iteration (R6.3)
                                     │
                                     ▼
                          testing-project afterAllScenarios reads ctx.skipped,
                          forwards runnable ids → runE2eVerification →
                          --project <id> per runnable agent to Playwright child
                          (R10.2/R10.5); a skipped agent gets no project/plugin/spec
```

There is **one source of truth** — the classifier's `skipped` set — threaded three
ways: into `report.json` (machine-readable surface and exit-code signal), onto the
hook context (`runCtx.skipped`), and through the e2e hook into the spawned Playwright
child. The classifier itself is pure and synchronous, so it doubles as the standalone
runnability predicate a bare Playwright invocation may consult.

## 3. The classifier component

A new, isolated module under `src/` (name chosen by the implementer; it must avoid
internal-process vocabulary — no phase/spec/plan/acceptance-criteria tags). It imports
only `getProvider` and the relevant config/provider types — never pipeline internals —
so it stays a self-contained component the pipeline calls into. The module owns the
**policy** (what "misconfigured" means, the reason string, the role→consequence
mapping); the per-provider *datum* of which env var gates a provider lives on the
provider itself (§4.1).

### 3.1 Public surface

**`classifyRunnability(config, env)` — pure, synchronous; no async, no model call.**
Given the resolved config and the environment, it returns:

- `runnableTestAgentIds: string[]` — the test-agent ids that are runnable.
- `skipped: SkippedAgent[]` — one entry per misconfigured agent **id**, shaped
  `{ id, roles, reason }` where `roles` lists the role(s) the id fills (test / judge /
  improver) and `reason` is a human-readable string such as `"OPENAI_API_KEY is not
  set"`. Detection is per id (§3.3): an id that fills several roles appears once.
- the judge's runnability and the improver's runnability (so the pipeline can apply
  their role-specific consequences without re-deriving membership).

Determination is a pure read: for each declared agent id, look up
`getProvider(agent.provider).requiredEnv`; if that field is set and the named variable
is absent from `env`, the agent is misconfigured with reason `"<VAR> is not set"`;
otherwise it is runnable. No invocation, no I/O beyond the passed-in `env`.

This same function **is** the R10.3 "standalone runnability predicate" — a secondary
convenience a standalone Playwright invocation MAY consult. The in-run e2e path does
**not** depend on it (it depends on the forwarded `--project` selectors, §7.2),
because the predicate cannot observe any future runtime-detected skip.

### 3.2 The policy seam: `decide(roles) → Consequence`

A single function is the **only** place policy lives. Given the role(s) a misconfigured
id fills, it returns a `Consequence` — a small closed union. For the shipped "warn"
policy the values are exactly:

- `EXCLUDE_LANE` — a misconfigured **test** agent: remove its lane (§5).
- `STOP_RUN` — a misconfigured **judge**: abort the whole run up front (§6.1).
- `HALT_AFTER_ITERATION` — a misconfigured **improver**: finish the current iteration,
  then halt (§6.2).

The pipeline switches on the **`Consequence`**, never on "which policy is this." That
is what makes the seam the single decision point: the runtime reads a consequence and
acts; it does not contain policy branches.

**Extensibility (only the shape ships, not the policies).** Adding the future "fail"
policy (abort the whole run up front when any agent is misconfigured) is a localized
change *inside* `decide`: return a `STOP_RUN`-like consequence for every role. Adding
"skip" (proceed and exit `0`, an opt-in for intentional absence) is likewise inside
`decide` plus the exit-code rule. Neither is wired now; the seam merely admits them.

### 3.3 Multi-role, most-severe consequence

A single id is classified once. When it fills more than one role, `decide` returns the
**most-severe** consequence across the roles it fills, with the ordering:

```
STOP_RUN  >  HALT_AFTER_ITERATION  >  EXCLUDE_LANE
```

So a misconfigured id that is both the judge and a test agent yields `STOP_RUN` — the
run stops regardless of its other roles. The seam computes this max over the id's
roles; detection itself never runs twice for the same id.

## 4. Additive contract changes

All three are additive and backward-compatible. None changes an existing signature
beyond appending an optional/new field; consumers that ignore them are unaffected, so
a run with no misconfigured agent behaves exactly as today.

### 4.1 `Provider.requiredEnv?: string`

`Provider` is currently `{ readonly id; invoke(params) }` (a public exported type). Add
one optional readonly field naming the environment variable the provider's credential
requires:

- `openai-api` → `requiredEnv: "OPENAI_API_KEY"`
- `anthropic-api` → `requiredEnv: "ANTHROPIC_API_KEY"`
- `gemini-api` → `requiredEnv: "GOOGLE_GENERATIVE_AI_API_KEY"`
- `claude-code`, `mock`, and `codex` **omit it** — they are "not statically
  misconfigurable." Any real defect in these continues to surface through the existing
  invoke-time error path as an ordinary failure.

This field is **passive data** — a plain string on the provider literal. It does not
import or know about the classifier, so co-locating it on the provider does not
entangle provider files with policy. The decision to use a plain var name (rather than
a `runnability?(env)` predicate) is deliberate: every real provider gate today is a
single-env-var presence or nothing — `codex` reads `OPENAI_API_KEY` as the SDK key but
does not pre-check, and the shared vercel runner has no auth gate of its own — so a
predicate would be speculative generality the spec defers. The string is the minimal
change and is enough for all three shipped providers.

`requiredEnv` is **purely additive and pre-invoke**: it does **not** replace the
existing in-`invoke` key checks, which remain the ordinary-failure fallback for a
present-but-invalid key or any runtime defect. The env-var literal therefore appears
in two places by necessity — the runtime guard inside `invoke` and the static
descriptor — and that is expected; the descriptor is the new static surface, not a
refactor of the runtime guard.

### 4.2 `RunContext.skipped` (readonly)

`RunContext` is built once in `runPipeline` and is the base every hook context extends
(`ScenarioContext`, `AgentContext`, the iteration contexts, the improve context all
`extends RunContext`). Add one readonly field carrying the same `skipped` set:

```
readonly skipped: ReadonlyArray<{ id; roles; reason }>
```

It is set on `runCtx` at **construction**, before `beforeAll` fires, so it is present
on every derived context from the earliest run-scoped hook onward (R10.1, AC9). No new
mandatory callback is introduced — hooks that do not need this data simply ignore it.
Because detection is setup-only, this set is fully known before `beforeAll` and never
mutates mid-run; later runtime detection would append to the same field without
changing its shape. This is the **same data** the report `skipped` array carries and
the e2e hook forwards, keeping one source of truth.

### 4.3 Top-level `skipped` array in `report.json`

The merged `${runDirectory}/report.json` is currently `{ runId, pass, scenarios }`.
Add a new **top-level** array (sibling of `scenarios`):

```
skipped: [{ id, roles, reason }]
```

`writeRunReport` gains the array as a passthrough field (a new parameter the pipeline
supplies from the classifier result). A misconfigured agent is therefore **not** a
`Cell` and has no row in the matrix — it is a separate top-level signal. This is what
makes it inherently distinguishable from a `FAIL` (not in the matrix at all) and from
the existing per-cell `SKIPPED` marker (which remains a graded-skip inside a cell and
is untouched). See §4.4 for why a new `Cell` kind was rejected.

### 4.4 Why the skip is a top-level signal, not a `Cell`

The existing `SKIPPED` `Cell` is a **per-cell, review-level** marker: it occupies a
(scenario, agent) slot in the matrix, renders yellow, and yields exit `1`. A
misconfigured agent, by contrast, has **no cell anywhere** — the dead lane means it is
absent from every scenario's numerator and denominator and never enters the agent
loop, so it produces no per-agent report and therefore no `Cell`. Forcing it into a
`Cell` would contradict the dead-lane model and require manufacturing a phantom row per
scenario. Representing it as a top-level array keeps the matrix clean, leaves the
closed `Cell` set (`PASS | FAIL | SKIPPED`) unchanged, and satisfies "distinct from a
real failure AND from an unrelated skip" by construction rather than by color alone.

## 5. Test-agent exclusion (the dead lane)

When `decide` returns `EXCLUDE_LANE` for a test-agent id, that agent is removed from
the entire run. The mechanism reuses the **existing `agentIdFilter` pattern** the
agent loop already supports for per-scenario re-selection — the runnable id set becomes
a run-scoped allowlist. **`config` is never mutated**; the runnable id list is carried
alongside (mirroring the existing per-scenario filter), leaving `config` immutable for
all other readers.

The runnable test-agent set is applied at the two sites that today read
`config.roles.test.agents`:

1. **Progress-tracker init** — the tracker's per-scenario columns are built from the
   runnable ids only. A misconfigured test agent therefore never becomes a tracker
   column (which is also why the live re-render is unaffected — §8).
2. **The agent loop** — `runAgents` sees only survivors (intersect the runnable set
   with any existing per-scenario `agentIdFilter`).

This yields all of R3 by construction:

- **No execution / no provisioning (R3.1).** The agent is invoked in no scenario and
  its `beforeTestAgent`-style provisioning never fires, so no compute and no workspace
  artifacts are produced for it.
- **No accounting (R3.2).** With no cells, it contributes to neither numerator nor
  denominator; the verdict is computed over survivors only, identical to a run
  configured with only the runnable agents.
- **No re-selection (R3.3).** Re-selection only ever *narrows* the survivor set, so a
  skipped agent is never re-dispatched in a later iteration or final pass.

The excluded test-agent ids go into the `skipped` set (§4), which drives surfacing and
the exit code.

## 6. Role-aware mechanics in `runPipeline`

The classifier runs **once, up front** — right after config load / path checks /
self-improvement resolution and **before** the iteration loop — over every declared
agent id across all three roles. It returns the runnable set, the skipped set, and (via
the seam) the per-id consequence. The pipeline then acts on each consequence:

### 6.1 Judge-stop (`STOP_RUN`) — before any hook or report

If the judge id is misconfigured, the run **aborts up front**: `runPipeline` prints a
single clear message naming the judge agent and the reason, and **returns `2`
directly** — before entering the main work, before any hook fires, and before any
report is written.

- **No `beforeAll`/`afterAll`, no report, no tracker.** Because the abort happens
  before the iteration loop (and before constructing the tracker), `beforeAll` (which
  fires inside the per-iteration path) and `afterAll` (which lives in the loop's
  `finally`) never run, and no graded matrix and no `report.json` are produced. This is
  the one case where "always emit a report" does not apply — there is nothing to grade.
- **Why `return 2` rather than throw.** The runner's existing catch maps
  `PreconditionError`/`UserFacingError` to exit `1`, which is the wrong class for a
  configuration error and is reserved for the unknown-provider hard abort (§9).
  `runPipeline` already returns a number and owns the orchestration, so it prints the
  judge message and returns `2` directly. This keeps the runner untouched, leaves the
  unknown-provider abort on its existing `PreconditionError → 1` path, and is the only
  no-report path that produces `2`. Nothing depends on judge-stop throwing — there is
  no judge-stop concept today.

### 6.2 Improver-halt (`HALT_AFTER_ITERATION`)

If the improver id is misconfigured, the **current iteration runs to completion
normally** — test agents and judge produce a complete, valid matrix — and then the loop
**halts** with no improver call and no further iterations. Two localized gates
implement this; both add the condition "improver runnable":

1. **The in-loop improver branch** is additionally gated on "improver runnable," so no
   skill edit is attempted.
2. **The extra final-pass sweep** (which exists *only* to re-evaluate the matrix after
   improver edits) is additionally gated on "improver runnable." A misconfigured
   improver makes no edits, so re-running an unchanged failing matrix would be both
   wasted and a forbidden "further iteration"; suppressing the sweep is required.

The loop halts after the current iteration completes. The improver id goes into the
`skipped` set, forcing exit `2` (it is a configuration error, **not** a skill failure —
so it is not exit `1`). The matrix and its verdict still stand and are reported.

### 6.3 Test-agent exclusion (`EXCLUDE_LANE`)

As detailed in §5: the runnable test-agent subset replaces `config.roles.test.agents`
at the tracker-init and agent-loop read sites via the `agentIdFilter` pattern.

### 6.4 All test agents misconfigured (the degenerate case)

When every test agent is misconfigured, the runnable set is empty and the loop is **let
run** — no bespoke short-circuit. `runAgents` becomes a no-op (`Promise.all([])`), each
scenario yields an empty agent set, the per-scenario aggregation reports
not-all-pass, the summary's `allPass` is false, and the non-empty `skipped` array
forces exit `2` and surfaces the ids. No vacuous pass arises and no special-case branch
is needed. (An early surface is possible if preferred, but the chosen design avoids the
extra branch; wasted work for zero-agent scenarios is negligible.)

### 6.5 Per-agent error containment

Already structurally satisfied and **unchanged** by this feature. The testing and judge
invokes each turn a throw into that agent's `error` outcome; the hook wrapper never lets
a hook crash the run; the improver swallows its own error. The classifier adds no new
uncontained throw: it is pure/synchronous and its only "failure" is a declared
misconfig (data, not a throw). The one new whole-run abort is judge-stop (§6.1), which
is an intentional run-level stop, not a per-agent error.

## 7. Exit code, surfacing, and the report

### 7.1 The single exit-code chokepoint

For matrix-producing runs, `prepareSummary` (in `src/reports/summary.ts`) is the **sole
exit-code producer**: it reads only `${runDirectory}/report.json`, returns
`{ consoleLines, exitCode }`, and that number threads out unchanged through
`emitSummary` → `runPipeline` → `run()` → `process.exit(...)`. The third code (`2`)
need only be **produced** in `prepareSummary`, not plumbed.

Today `prepareSummary` does `allPass = rows.length > 0 && rows.every(isRowPass)` and
`exitCode = allPass ? 0 : 1`. The new rule reads the report's top-level `skipped` array
and becomes:

```
exitCode = skipped.length > 0 ? 2 : (allPass ? 0 : 1)
```

This satisfies the whole R5 exit-code class:

- **Distinct codes (R5.2).** `0` = every executed cell passed and no agent was skipped;
  `1` = a surviving agent genuinely failed (and nothing was skipped); `2` = a
  configuration error — one or more agents could not run.
- **Config-error precedence (R5.3).** Because any non-empty `skipped` forces `2`
  regardless of the surviving matrix, a run with both a skip and a genuine eval failure
  exits `2` — precedence falls out for free, and the report still carries both.
- **Anti-regression (R5.4).** The skipped agents are simply absent from `scenarios`, so
  the surviving rows could be all-PASS — but the non-empty `skipped` array forces `2`.
  Merely dropping a row can no longer yield `0`; the array is the thread to the
  chokepoint. This is the explicit guard against turning a partial run green.
- **All-misconfigured (R5.5).** With every test agent skipped, `scenarios` has no
  runnable cells. The non-empty `skipped` array returns `2` first; the existing
  empty-matrix handling already makes `allPass` false, so the "no rows" branch never
  prints a pass. The skipped ids are still surfaced.

The judge-stop path (§6.1) is the one exception: it produces no report, so it cannot
route through `prepareSummary` and returns `2` directly from `runPipeline`.

### 7.2 Surfacing the skip in the CLI

`prepareSummary` renders **one block per skipped agent** (its id + reason) and appends
it to the returned `consoleLines`, printed once per run by `emitSummary` after the
dashboard's final paint. The block is **visually distinct** — its own labelled
section / color — from both a `FAIL` and the per-cell `SKIPPED` marker. Because it is
top-level (not per-scenario), it is naturally "once per run," replacing today's
repeated identical per-scenario failure rows (R4.1/R4.2). Existing failure surfacing is
preserved unchanged: a runnable agent that genuinely fails is still reported and
counted (R4.4).

### 7.3 Machine-readable report

The same top-level `skipped` array in `report.json` is the machine-readable surface
(R4.3), distinguishable from a grading failure by being a sibling of `scenarios` rather
than a cell within it. One mechanism serves three needs: machine-readable surface,
exit-code signal, and (mirrored on `runCtx`) the hook-context push.

## 8. Live-CLI integrity

The live, in-place re-render is owned by the progress tracker, whose columns come from
the test-agent ids at init. Because misconfigured test agents are filtered out **before
the tracker is constructed** (§5), they never become tracker columns, so the re-render
math is unchanged and the in-place re-render / text positioning is preserved by
construction (R11.2). The skip surfacing lives **only** in the final static summary
(§7.2) — a one-shot print after the dashboard's final paint that does not interact with
the cursor re-render.

With an **empty** skipped set the entire new path is inert: no extra console lines,
`exitCode` reverts to `allPass ? 0 : 1`, tracker columns are unchanged, and the set and
order of hook firings are identical. A run with no misconfigured agent therefore
behaves exactly as today — identical matrix, verdict, hook firings, CLI output, and
exit code (R11.1).

## 9. Unknown provider stays a hard abort

An unknown or nonexistent provider id is a structural authoring error, **not** a
credential defect, and remains a hard precondition error that aborts the whole run on
any role — unchanged from today. The single provider-dispatch point already throws on
an unknown id, surfacing as the existing precondition error that the runner maps to
exit `1`. This feature does **not** turn an unknown provider into a per-agent skip; only
credential/environment defects get the dead-lane treatment. (Its exit code is left on
its existing `PreconditionError → 1` path; the misconfig class uses `2`.)

## 10. The e2e harness consumer (`testing-project`)

`testing-project` is the worked reference consumer of the hooks contract and is
**in-scope code to update, not merely a fixture.** Every in-tree consumer of the hooks
contract must stay consistent with the new `runCtx.skipped` field; `testing-project`'s
hooks are the one in-tree reader, so they are updated here. The e2e harness launches
Playwright as a **separate child process**, so the surviving agent set must be
*forwarded* into that child.

### 10.1 A deterministically-misconfigurable test agent

Add an `openai-api`-backed test agent to `testing-project` that is misconfigured
exactly when `OPENAI_API_KEY` is unset. This exercises the real classifier predicate
end to end without any real credential:

- With the key **unset**, the agent is skipped — no Playwright project, no plugin build,
  no spec runs against it — verifiable with no model call (the classifier decides
  pre-invoke).
- With the key **present**, the agent is runnable and IS included (the "both
  directions" check); only this direction would attempt a real call, which the e2e test
  gates on the key being set.

The same env-keyed-unset seam is the right one for unit/integration fixtures that must
be exercisable without credentials: prefer an `openai-api`-unset fixture (which
exercises the real `requiredEnv` predicate) over teaching `mock` a misconfigurable
mode. `mock` stays "not statically misconfigurable," unchanged.

### 10.2 Forwarding the runnable set to the Playwright child

The `afterAllScenarios` hook (the only caller of the e2e verification) reads the
skipped set from its hook context (`ctx.skipped`, §4.2), derives the runnable test-agent
ids, and passes them as a **new third parameter** (`runnableAgentIds: string[]`) to
`runE2eVerification`. That function appends `--project <id>` per runnable agent to the
spawned `playwright test` command. Playwright's `--project` flag restricts the run to
**exactly** the named projects; forwarding only the runnable subset of the configured
project ids means a skipped agent is absent from the child's project set, so **no e2e
spec runs against it** (R10.2), and the merged report attributes no e2e failure to it.

This is the in-run mechanism — it depends on the forwarded `--project` selectors, not on
the standalone predicate (which cannot observe a future runtime-detected skip). Because
only ids that are *defined projects* are forwarded (the runnable subset of the same ids
the config derives its projects from), an "unknown project" error cannot arise;
forwarding the intersection of runnable ids and configured project names is the
defensive form.

### 10.3 No build-side filter is needed

A skipped agent never enters the agent loop, so its workspace / `plugin-*` directory is
never created (the dead lane, §5 / R3.1). The e2e plugin-build scan therefore finds
nothing for it naturally; a separate build-side filter would be redundant.

### 10.4 Fix the `playwright.config.ts` project-name bug

`playwright.config.ts` currently builds its projects with
`config.roles.test.agents.map((agentId) => ({ name: agentId, ... }))` — but
`config.roles.test.agents` is an array of agent *definition objects*, so each project's
`name` is set to the **object**, not the id string. This is a real pre-existing bug.
Fix it to `name: agent.id` (a string).

This is **required and in-scope** because the forwarded `--project <id>` selectors must
bind to project names that equal the agent-id strings, and the report's
project-name → agent attribution likewise depends on it. The standalone project list
should remain *all* configured test agents (so a bare `npx playwright test` still has
every project defined); the in-run restriction is purely via the forwarded `--project`
selectors. This satisfies R10.3 (the pure predicate MAY also feed a standalone list)
without making the in-run path depend on it.

## 11. Changed files and why

New:

- **A new classifier module under `src/`** — the isolated component: pure
  `classifyRunnability(config, env)` and the `decide(roles) → Consequence` policy seam
  (§3). Imports only `getProvider`/types.

Modified (each is a localized, additive edit):

- **`src/providers/types.ts`** — add `Provider.requiredEnv?: string` (§4.1).
- **`src/providers/openai-api.ts`, `anthropic-api.ts`, `gemini-api.ts`** — set
  `requiredEnv` to the respective var; `claude-code.ts`, `mock.ts`, `codex.ts` are left
  unchanged (they omit it) (§4.1).
- **`src/config/types.ts`** — add the readonly `RunContext.skipped` field (§4.2).
- **`src/reports/iteration-report.ts`** — `writeRunReport` gains the `skipped` array as
  a passthrough so it appears top-level in `report.json` (§4.3).
- **`src/reports/summary.ts`** — `prepareSummary` reads the report's `skipped`, applies
  the `skipped.length>0 ? 2 : (allPass ? 0 : 1)` rule, and appends the once-per-run skip
  block to `consoleLines` (§7).
- **`src/pipeline/pipeline.ts`** — run the classifier up front; judge-stop
  print + `return 2` before any hook/report; put `skipped` on `runCtx`; restrict tracker
  columns + `runAgents` to the runnable set via the `agentIdFilter` pattern; gate the
  in-loop improver branch and the final-pass sweep on "improver runnable"; pass `skipped`
  through `writeRunReport` (§5, §6, §7).
- **`testing-project/skillsmith.config.ts`** — add the `openai-api`-backed test agent
  (§10.1); `afterAllScenarios` reads `ctx.skipped` and forwards runnable ids (§10.2).
- **`testing-project/eval/utils/verify-e2e.ts`** — `runE2eVerification` gains the
  `runnableAgentIds` third parameter and forwards `--project <id>` per runnable agent to
  the spawned child (§10.2).
- **`testing-project/playwright.config.ts`** — fix the project name to `agent.id` (§10.4).

The agent loop's existing per-scenario `agentIdFilter` is *reused*, not modified; the
provider `invoke` paths and the closed `Cell` set are untouched.

## 12. Constraints honored

- **Self-contained policy component (R12.1)** — all policy lives in the new classifier
  module (the reason logic and the `decide` seam); the provider field is passive data;
  the pipeline switches on the `Consequence`, never on the policy.
- **Minimal change (R12.2)** — only additive fields/parameters; no existing internal
  signature changes; the `agentIdFilter` pattern and the runner are reused unchanged; no
  gratuitous refactors.
- **Comment sparingly (R12.3)** — only the non-obvious gets a comment; comments on
  unchanged code are not touched.
- **No internal-process vocabulary (R12.4)** — produced code, comments, tests, and docs
  carry no phase names, spec/design/plan references, or acceptance-criteria/task
  identifiers. The classifier module, the report key, and the `RunContext` field are
  named in plain domain terms (e.g. "skipped," "runnable").

## 13. Requirement and acceptance-criteria coverage

### 13.1 Requirements → design

| Req | Realized by |
|-----|-------------|
| R1 (what counts as misconfigured) | Classifier scope §3; transient/input-specific and present-but-invalid keys stay on the untouched invoke path as ordinary `FAIL` |
| R2 (detection timing / shipped scope) | `requiredEnv` §4.1; pre-invoke pure predicate §3.1; claude-code/mock/codex omit the field |
| R3 (dead lane) | Test-agent exclusion via `agentIdFilter` §5 — no execution/provisioning/accounting/re-selection; R3.4 invariant holds trivially (setup-only) |
| R4 (surfacing) | Top-level `skipped` array §4.3/§4.4; once-per-run distinct block §7.2 |
| R5 (exit code) | `skipped.length>0 ? 2 : (allPass ? 0 : 1)` §7.1; precedence, anti-regression, all-misconfigured all covered |
| R6 (role-aware) | Judge `STOP_RUN`/return 2/no-report §6.1; improver `HALT_AFTER_ITERATION` + final-pass suppression §6.2; test `EXCLUDE_LANE` §6.3; multi-role most-severe §3.3 |
| R7 (unknown provider) | Unchanged hard abort §9; explicitly not a skip |
| R8 (policy seam) | `decide` seam §3.2 — warn only; fail/skip localized future additions |
| R9 (error containment) | Already structural §6.5; no new uncontained throw |
| R10 (hooks/e2e) | `RunContext.skipped` §4.2; `--project` forwarding §10.2; misconfigurable agent §10.1; playwright.config fix §10.4; `classifyRunnability` is the standalone predicate §3.1 |
| R11 (back-compat / CLI) | Inert empty-skip path §8; tracker re-render untouched |
| R12 (code constraints) | §12 |

### 13.2 Acceptance criteria → mechanism

| AC | Mechanism |
|----|-----------|
| AC1 (pre-invoke missing-credential detection) | `classifyRunnability` reads `requiredEnv` vs env §3.1 |
| AC2 (one misconfigured among several) | Dead-lane exclusion §5; non-empty `skipped` → exit 2 §7.1 |
| AC3 (no work/provisioning for skip) | Never enters agent loop §5/R3.1 |
| AC4 (announced once, distinct, both in report) | Once-per-run block §7.2 + top-level array §4.3/§4.4 |
| AC5 (all misconfigured ≠ vacuous pass) | Empty runnable set §6.4 + exit-2 rule §7.1 |
| AC6 (transient/input-specific/invalid-key are ordinary failures) | Invoke path untouched §4.1/§9 |
| AC7 (judge stops the run) | Judge-stop print + return 2 before any hook/report §6.1 |
| AC8 (improver finishes iteration, then halts) | Improver gate + final-pass suppression §6.2 |
| AC9 (hooks read skipped set) | `RunContext.skipped` set before `beforeAll` §4.2 |
| AC10 (e2e excludes misconfigured agent, both directions) | Misconfigurable agent §10.1 + `--project` forwarding §10.2 + no build-side dir §10.3 + config fix §10.4 |
| AC11 (multi-role, most-severe wins) | `decide` max over roles, judge dominates §3.3 |
| AC12 (exit-code precedence) | Non-empty `skipped` → 2 regardless of matrix §7.1 |
| AC13 (no misconfig is unchanged) | Inert empty-skip path §8/R11.1 |
