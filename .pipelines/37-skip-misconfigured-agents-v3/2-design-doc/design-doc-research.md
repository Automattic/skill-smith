# Design Research: Skip misconfigured agents across all phases of a run

> The design Q&A record. Each entry is a HOW question the spec deferred, the
> evidence gathered (codebase / web / experiment), and the settled decision.
> The design-doc writer synthesizes `design-doc.md` from the spec + this record.
> This file does NOT restate the spec's WHAT; it settles the HOW.

Authoritative inputs:
- Spec (the WHAT): `../1-spec/spec.md`
- Spec research (settled decisions D1–D13, codebase findings, open HOW): `../1-spec/spec-research.md`

## Open HOW items the design must settle (from the team-lead brief)

- **H1 — Static runnability surface.** How a provider's credential requirement
  becomes statically inspectable: extend the `Provider` contract in
  `src/providers/types.ts` vs a separate provider→env map; whether `codex` opts
  into the `OPENAI_API_KEY` check or stays not-statically-misconfigurable.
- **H2 — Skip representation in cells/report.** Reuse the existing `SKIPPED`
  `Cell` kind in `src/reports/verdict.ts` vs a new kind, staying distinguishable
  from a genuine `FAIL` and from an unrelated skip, carrying id + reason.
- **H3 — Exit-code threading.** How the "an agent was excluded" signal threads to
  the single exit-code chokepoint (`prepareSummary` in `src/reports/summary.ts`)
  so a partial run cannot exit 0 (R5.4); how exit codes 0/1/2 with config-error
  precedence (R5.2–R5.3) are produced and passed through `src/runner.ts`.
- **H4 — The policy seam.** Where the single seam lives and its shape (only "warn"
  implemented; "fail"/"skip" localized future additions — R8).
- **H5 — Hook context push + e2e forwarding.** How the skipped set (id + role(s) +
  reason) is pushed onto the hook context (R10.1); how `testing-project`'s
  `afterAllScenarios` / `eval/utils/verify-e2e.ts` forwards the runnable set to the
  spawned Playwright child (R10.2/R10.5); the deterministically-misconfigurable
  testing-project agent (R10.4).
- **H6 — Role-aware mechanics.** How judge-stop (R6.2), improver-halt-after-
  iteration (R6.3), multi-role most-severe (R6.4), and per-agent error containment
  (R9) are realized.

Scope guardrails honored throughout: minimal classifier, setup-only detection;
retroactive purge (R3.4) is a stated invariant, NOT v3 machinery — do not design
runtime-result purging.

## Q&A

### Analyst's own codebase reading (pre-Q&A grounding)

Confirmed directly while preparing the questions (cited so the writer can trust them):

- **The exit-code chokepoint is binary 0/1 today and reads ONLY the merged report.**
  `prepareSummary` (`src/reports/summary.ts:52-77`): `allPass = rows.length > 0 &&
  rows.every(isRowPass)`, `exitCode = allPass ? 0 : 1`. It takes only
  `{ runDirectory, runId }` — it derives everything from `${runDirectory}/report.json`.
  `run()` (`src/runner.ts:29-46`) returns that number; catches
  `PreconditionError`/`UserFacingError` → prints + returns `1`. So a third code (`2`)
  must be produced where the report is decided and threaded out through the number
  `run()` already returns.
- **The existing `SKIPPED` cell is a per-cell, review-level marker — NOT the same as a
  misconfigured-agent skip.** `Cell = PASS | FAIL | SKIPPED{reason}`
  (`src/reports/verdict.ts:9-12`). A `{ skipped: string }` review classifies to
  `SKIPPED` (`verdict.ts:26-28`); the agent-loop writes `{ skipped: "testing failed: …" }`
  when testing errors (`src/pipeline/agent-loop.ts:218-222`). The summary test
  `"SKIPPED cells render with reason"` (`summary.test.ts:179-199`) shows a `SKIPPED`
  cell renders yellow AND yields `exitCode 1`. Two consequences: (1) the misconfigured
  skip must be distinguishable from this existing per-cell SKIPPED (R4.2 "distinct from
  an unrelated skip"); (2) a misconfigured agent has NO cell at all in the matrix
  (dead lane — absent from numerator and denominator, R3.2), so it is not naturally a
  `Cell` — it is a separate top-level signal in the report.
- **`isRowPass` requires every agent's cell to be PASS** (`summary.ts:309-317`) and
  `collectAgentIds` derives columns from whatever cells exist in the rows
  (`summary.ts:115-121`). So if a misconfigured agent simply never produces cells, it
  silently vanishes and the remaining rows can be all-PASS → exit 0. That is exactly
  the forbidden R5.4 regression; the skip signal must reach `prepareSummary`
  out-of-band from the per-cell matrix.
- **`getProvider` is the single dispatch point and throws on unknown id**
  (`src/providers/registry.ts:23-29`), called from `runTestingAgent`
  (`testing-agent.ts:67`), `runJudgeAgent`, and `runImprovement` (`improver.ts:148`).
  Unknown-provider stays a hard abort (R7) — already a throw; we keep it.
- **Per-agent error containment already half-exists.** `runAgentPair` wraps the
  testing invoke in try/catch and turns a throw into that agent's `error` outcome
  (`agent-loop.ts:179-188`); the judge invoke likewise (`agent-loop.ts:247-252`).
  `tryHook` never lets a hook crash the run (`src/util/hooks.ts:21-27`). R9 is largely
  satisfied by existing structure; the design must confirm the skip path doesn't open
  a new uncontained throw.
- **e2e Playwright project list is derived blind to runnability AND has a latent bug.**
  `testing-project/playwright.config.ts:23-26` does
  `config.roles.test.agents.map((agentId) => ({ name: agentId, … }))` — but
  `config.roles.test.agents` is `AgentDefinition[]` (objects), so `name: agentId` is an
  object, not a string id. The in-run path (`verify-e2e.ts`) is what actually drives
  Playwright via a spawned child (`verify-e2e.ts:129`), and Playwright projects are
  keyed by agent id there. R10.2/R10.5 make `verify-e2e.ts` + the e2e hook in-scope to
  update so the child's project set excludes skipped agents.

### Q&A entries

#### H1 — Where the static credential requirement lives

**Question.** The minimal classifier (R2.2) must decide runnability from provider +
env with no model call. Where does the per-provider "which env var gates me"
datum live? (A) an optional static field/predicate on the `Provider` contract
(`src/providers/types.ts`) that env-keyed providers set and others omit, read by a
classifier module; or (B) a separate provider-id→env-var map inside the classifier,
`Provider` untouched.

**Evidence (gathered by analyst from the codebase; researcher asked to corroborate).**
- `Provider = { readonly id; invoke }` (`src/providers/types.ts:50-53`). `Provider`
  is re-exported as a PUBLIC type (`src/index.ts:32`). An *optional* added field is
  therefore backward-compatible for both in-tree literals and external consumers
  (R12.2).
- All `Provider` literals live only in `src/providers/*` (6 of them:
  `mock.ts:47`, `claude-code.ts:15`, `anthropic-api.ts:5`, `gemini-api.ts:5`,
  `openai-api.ts:5`, `codex.ts` via `createCodexProvider` at `:46`). No `Provider`
  literal is constructed outside that folder or in tests — tests only call
  `.invoke` (`providers.test.ts:255-256`, `:266`). So an optional field rides free;
  no test construction breaks.
- Each env-var string is referenced in exactly one runtime place — its own
  provider's `invoke`: `openai-api.ts:8`, `anthropic-api.ts:8`, `gemini-api.ts:8`.
  `codex.ts:65` reads `OPENAI_API_KEY` as the SDK `apiKey` but does NOT pre-check.
- The in-`invoke` key checks are PINNED by tests asserting the exact error strings
  with the key unset (`vercel-providers.test.ts:67-94`, via a `withEnv` helper).
  Those must keep passing (R11.1; R2.3/AC6 require the invoke-time error to remain
  the ordinary-failure fallback for a present-but-invalid or runtime defect). So the
  classifier is **purely additive and pre-invoke**; it does NOT replace the in-invoke
  checks. The env-var literal will appear in two places by necessity (the runtime
  guard inside `invoke`, and the static descriptor) regardless of A vs B — option A
  does not actually de-duplicate the string out of `invoke`.

**Decision — Option A: an optional static descriptor on the `Provider` contract,
read by an isolated classifier module.** Specifically, add an optional field to
`Provider` naming the required env var (e.g. `requiredEnv?: string`). The three
env-keyed providers set it (`openai-api`→`OPENAI_API_KEY`,
`anthropic-api`→`ANTHROPIC_API_KEY`, `gemini-api`→`GOOGLE_GENERATIVE_AI_API_KEY`);
`claude-code`, `mock`, and `codex` omit it and are thus "not statically
misconfigurable" (R2.3). A standalone classifier module owns the POLICY ("an absent
required env var ⇒ misconfigured, with reason `"<VAR> is not set"`") and the pure,
synchronous predicate over (agent, env); it reads `getProvider(agent.provider).requiredEnv`.

**Why A over B.**
1. *Locality of the datum.* The fact "openai-api needs OPENAI_API_KEY" already lives
   on the provider (its `invoke` enforces it). Co-locating the static *declaration*
   there keeps the one fact about a provider in the provider file; a new provider
   added later declares its gate in one place and the classifier needs no edit. With
   B, every new env-keyed provider must also be remembered in a second, distant map —
   a drift hazard.
2. *Isolation (R12.1) is preserved either way and is about POLICY, not the datum.*
   The classifier module owns the decision logic (what "misconfigured" means, the
   reason string, the predicate). `requiredEnv` on a provider is passive data — a
   string — not policy; it does not import or know about the classifier. So A does
   not entangle provider files with policy.
3. *Minimal change (R12.2).* Adding one optional readonly field touches
   `types.ts` once and three one-line provider additions; no signature changes, no
   test breakage.

**Open sub-point deferred to H1a (asked of researcher): `requiredEnv?: string`
(plain var name) vs `runnability?(env) => Runnable | Misconfigured` (a predicate).**
The string is enough for the three shipped providers and is the most minimal. A
predicate would generalize to non-env gates, but R2.2's shipped scope is exactly a
plain env read and R2.4 says deeper checks attach at the policy seam later — so a
predicate on the provider would be speculative generality the spec defers. Leaning
`requiredEnv?: string`. Pending researcher's check that no provider's real gate is
anything other than a single-env-var presence today.

#### H2 — How a skip is represented in the cells/report

**Question.** Reuse the existing `SKIPPED` `Cell` (`src/reports/verdict.ts:9-12`) for a
misconfigured agent, or a new representation? It must stay distinguishable from a
genuine `FAIL`, from an unrelated per-cell `SKIPPED`, and carry id + reason (R4.2,
R4.3).

**Evidence (analyst, from codebase).**
- The existing `SKIPPED` `Cell` is a PER-CELL, review-level marker: a judge verdict
  `{ skipped: string }` (`verdict.ts:26-28`) or the agent-loop's "testing failed →
  judge skipped" path writing `{ skipped: "testing failed: …" }`
  (`agent-loop.ts:218-222`). It occupies a (scenario, agent) slot in the matrix and
  yields `exitCode 1` (`summary.test.ts:179-199`). It renders yellow vs FAIL red
  (`summary.ts:233-237`).
- A MISCONFIGURED agent has **no cell anywhere** — the dead lane means it is absent
  from every scenario's numerator and denominator (R3.2/R3.3); `beforeTestAgent`
  never fires (R3.1). It never enters `runAgents` (`agent-loop.ts:83-86` iterates
  `config.roles.test.agents`), so it produces no per-agent `report.json`, so it has
  no `Cell`. Forcing it into a `Cell` would contradict the dead-lane model and would
  require manufacturing a phantom row per scenario (the opposite of "absent from the
  matrix").
- The merged report is `{ runId, pass, scenarios }` (`iteration-report.ts:153-164`);
  `prepareSummary`/`loadRows` reads ONLY `parsed.scenarios` (`summary.ts:90`).

**Decision — the skip is a NEW top-level report signal, NOT a `Cell`.** The merged
`${runDirectory}/report.json` gains a new top-level array — provisionally
`skipped: [{ id, roles: Role-or-string[], reason }]` (final key name deferred to the
writer; it MUST avoid internal-process vocabulary, R12.4). Each entry carries the
agent id, the role(s) it filled, and the reason (e.g. `"OPENAI_API_KEY is not set"`).
- *Matrix stays clean.* The `scenarios` matrix contains only runnable agents; the
  existing `Cell` set (`PASS | FAIL | SKIPPED`) is UNCHANGED (R12.2). A misconfigured
  agent is therefore inherently distinguishable from a `FAIL` (it is not in the
  matrix at all) and from the per-cell `SKIPPED` (which remains a graded-skip marker
  in a cell). This directly satisfies R4.2 ("distinct from a real failure AND from an
  unrelated skip") by construction, not by color alone.
- *Surfacing.* `prepareSummary` reads the new top-level array and renders ONE block
  per skipped agent (id + reason), visually distinct (its own labelled section /
  color), printed once per run (R4.1). Because it is top-level (not per scenario), it
  is naturally "once per run," replacing today's repeated identical per-scenario
  failure rows.
- *Machine-readable (R4.3).* The same array IS the machine-readable surface in
  `report.json`, distinguishable from a grading failure by being a sibling of
  `scenarios` rather than a cell within it.

This keeps `verdict.ts`'s closed `Cell` set untouched (no new `Cell` kind), which is
the most minimal change and avoids overloading the per-cell renderer with a concept
that is not per-cell.

#### H3 — Threading the skip signal to the single exit-code chokepoint (R5.1–R5.5)

**Question.** How does "an agent was excluded" reach the sole exit-code producer so a
partial run cannot exit 0 (R5.4); and how are codes 0/1/2 with config-error
precedence (R5.2–R5.3) produced and passed through `runner.ts`?

**Evidence (analyst, from codebase).**
- `prepareSummary` is the SOLE exit-code producer for matrix-producing runs: called
  once (`pipeline.ts:248`), reads only `${runDirectory}/report.json`, returns
  `{ consoleLines, exitCode }`; `emitSummary` returns the code (`pipeline.ts:265`);
  `run()` returns that number (`runner.ts:32`); `bin/skillsmith.mjs` does
  `process.exit(await run(...))`. The number threads through unchanged — a `2` needs
  only to be PRODUCED, not plumbed.
- Today `exitCode = allPass ? 0 : 1`, `allPass = rows.length > 0 && rows.every(isRowPass)`
  (`summary.ts:66-67,76`). `isRowPass` requires every cell PASS (`summary.ts:309-317`);
  `rows.length > 0` is the only empty-matrix guard.
- The merged report is the documented carrier for the exit decision
  (`pipeline.ts:401` comment: the report "drives the matrix, exit code, re-selection").

**Decision — write the skip set into the merged `report.json`; `prepareSummary` reads
it and produces 0/1/2 with config-error precedence. The judge-stop is the one path
that bypasses the report and returns 2 directly.**

Mechanics:
1. *Carrier.* The same top-level `skipped` array from H2 IS the exit-code signal —
   one mechanism serves R4.3 (machine-readable) and R5.4 (exit threading), exactly as
   R5.4 frames it ("thread a signal to the … point that decides the code from the
   merged report"). `writeRunReport` (`iteration-report.ts:153`) gains the array as a
   passthrough field; the pipeline supplies it from the classifier's result.
2. *Code production in `prepareSummary` (config-error precedence, R5.2–R5.3).*
   - `skipped` non-empty ⇒ **exit 2** (configuration error), regardless of whether the
     surviving matrix passed or failed. This makes R5.3 precedence fall out for free:
     a run with both a skip and a genuine eval failure still exits 2.
   - else surviving matrix not all-pass ⇒ **exit 1** (genuine eval failure).
   - else ⇒ **exit 0**.
   So the decision becomes: `skipped.length > 0 ? 2 : (allPass ? 0 : 1)`.
3. *R5.4 anti-regression.* Because the skipped agents are simply NOT in `scenarios`,
   the surviving rows can be all-PASS — but the non-empty `skipped` array forces 2.
   Merely dropping the row can no longer yield 0; the array is the thread that
   prevents it.
4. *R5.5 all-misconfigured.* If every test agent is misconfigured, `scenarios` has no
   runnable cells. Two guards combine: `skipped` non-empty ⇒ exit 2 (dominant), and
   the existing `rows.length > 0` / empty-matrix path must NOT report a pass. Design
   note: ensure the "no rows" branch does not print `RUN RESULT: PASS`; today
   `allPass` is already false when `rows.length === 0`, and the new rule returns 2
   first. The skipped agents are still surfaced (R5.5 "surfaced").
5. *Runner passthrough (R5.2 distinct codes).* No change to `run()`'s control flow for
   the matrix path — it already returns the number. The `2` originates in
   `prepareSummary`.
6. *Judge-stop exception (R6.2 / H6).* A misconfigured judge produces NO report, so it
   cannot route through `prepareSummary`. It is raised as a config-error abort BEFORE
   the iteration loop and surfaces a single message naming judge + reason, mapping to
   exit 2. See H6 for the exact carrier (a typed error vs a direct return) — that is
   where the `2` for the no-report cases is decided. The unknown-provider hard abort
   (R7) likewise stays a precondition error; today it maps to 1 via `runner.ts:40-43`,
   so producing `2` for the misconfig-class hard stops requires the runner's catch (or
   the thrown error type) to distinguish config-error aborts from other
   precondition/user errors — flagged as a sub-decision for H6.

#### H4 — The single policy seam (R8)

**Question.** Where does the seam live, and what shape lets "fail"/"skip" be added
later by a localized change (only "warn" built now)?

**Evidence (analyst, from codebase).** The two decision points where the consequence
of a misconfigured agent is consumed are both in `runPipeline`
(`src/pipeline/pipeline.ts`): (1) building the runnable test-agent set before the
iteration loop, and (2) the judge/improver role handling. There is no existing seam;
the classifier is new. R12.1 demands the policy logic be a self-contained component.

**Decision — one pure function in the classifier component, keyed by role, returns a
typed consequence; the pipeline switches on the consequence, not on the policy.**

Shape:
- The classifier component exposes (a) `classifyRunnability(config, env) → { runnable
  agents; skipped: SkippedAgent[] }` (pure, synchronous — also reused by R10.3's
  standalone convenience), and (b) the POLICY seam: a single function
  `decide(misconfig, role) → Consequence` where `Consequence` is a small closed union
  — for "warn" the values are exactly: `EXCLUDE_LANE` (test), `STOP_RUN` (judge),
  `HALT_AFTER_ITERATION` (improver). The mapping role→consequence is the ONLY place
  policy lives.
- "warn" is the only implemented policy and the default. Adding "fail" later is a
  localized change INSIDE `decide`: return a `STOP_RUN`-like consequence for every
  role when policy==="fail". Adding "skip" is likewise inside `decide` plus the
  exit-code rule (skip ⇒ proceed and exit 0) — but BOTH are out of scope now (R8.2)
  and not wired; only the seam's shape admits them. No policy branches are scattered
  in the runtime: the pipeline reads the consequence and acts; it never asks "which
  policy is this."
- Where it sits: a new isolated module under `src/` (name deferred to writer; must
  avoid process vocabulary). It imports only `getProvider`/types — not pipeline
  internals — so it stays a self-contained component (R12.1) the pipeline calls into.

#### H6 — Role-aware mechanics, classifier placement, multi-role, error containment

**Question.** How are judge-stop (R6.2), improver-halt-after-iteration (R6.3),
multi-role most-severe (R6.4), and per-agent error containment (R9) realized against
the real `runPipeline` control flow?

**Evidence (analyst, from codebase — `src/pipeline/pipeline.ts`).**
- `runPipeline` does `loadConfig` → `checkPaths` → `resolveSelfImprovement` →
  enumerate scenarios → build `runCtx` (`:82-106`) → iteration loop (`:142-213`) →
  optional final pass → `prepareSummary` (`:248`) → `afterAll` in `finally`
  (`:252-262`).
- The improver runs INSIDE the loop, gated by
  `!mergedPass && i < maxIterations && mode === "self-improvement"` (`:188-208`), via
  `runImprovement`. The loop also `break`s on `mergedPass` (`:212`).
- Test agents are read from `config.roles.test.agents` inside `runAgents`
  (`agent-loop.ts:83-86`); the per-scenario `agentFilter` already demonstrates a
  filtered subset path (`agent-loop.ts:81-92`), so running over a survivor subset is
  an established pattern.
- Roles resolve to `AgentDefinition`s in `NormalizedRoles` (`config/types.ts:69-73`);
  an agent id's role membership is derivable by scanning `roles.test.agents[*].id`,
  `roles.judge.agent.id`, `roles.improver.agent.id`.
- Per-agent invoke throws are already contained: testing
  (`agent-loop.ts:179-188`) and judge (`:247-252`) turn a throw into that agent's
  `error` outcome; `tryHook` never crashes the run (`hooks.ts:21-27`). The improver
  swallows its own error (`improver.ts:159-168`).
- The improver-halt must also account for the extra final sweep
  (`pipeline.ts:215-246`), which re-evaluates after improver edits.

**Decision.** Run the classifier ONCE, up front, right after `checkPaths` /
`resolveSelfImprovement` and before the iteration loop, over EVERY declared agent id
across all three roles (detection is per id — R6.4). It returns the runnable set, the
skipped set (id + roles + reason), and — via the H4 seam — the consequence per
skipped id. Then:

- **R6.4 most-severe ordering.** A single id is classified once. If it fills multiple
  roles, the consequence is the most severe across the roles it fills, with judge's
  `STOP_RUN` dominating (`STOP_RUN` > `HALT_AFTER_ITERATION` > `EXCLUDE_LANE`). The
  seam computes the max over the id's roles.

- **R6.2 judge-stop (most severe; before any phase).** If the judge id is
  misconfigured (consequence `STOP_RUN`), `runPipeline` aborts BEFORE the iteration
  loop: emit a single clear message naming the judge agent + reason, produce NO graded
  matrix and NO run report, and exit 2. Realization: because `runner.ts:40-43` maps
  `PreconditionError`/`UserFacingError` → return 1, producing 2 needs one of: (i) a new
  error subtype the runner's catch maps to 2; or (ii) `runPipeline` returns 2 directly
  without throwing. **Lean (ii):** `runPipeline` already returns a number and owns the
  orchestration; have it print the judge message and `return 2` directly for the
  no-report hard stops, keeping `runner.ts` untouched (R12.2) and the unknown-provider
  abort (R7) on its existing `PreconditionError`→1 path unchanged. (Resolves the H3 #6
  sub-decision toward a direct `return 2` from the pipeline for judge-stop. Researcher
  to sanity-check no code depends on judge-stop throwing, and whether `beforeAll`/
  `afterAll` should fire at all when the run stops before the loop — today `afterAll`
  is in a `finally`. Flagged H6c.)

- **R6.1 test-agent exclusion.** The runnable test-agent subset replaces
  `config.roles.test.agents` for the ENTIRE run — both the tracker init
  (`pipeline.ts:111-114` builds columns from the test agents) and `runAgents` see only
  survivors, so the misconfigured agent is invoked in no scenario, gets no
  `beforeTestAgent` (R3.1), and is absent from numerator/denominator (R3.2) and
  re-selection (R3.3 — `selectScenarios` only ever narrows the survivor set). The
  skipped test agents go into the `skipped` array (H2/H3). Minimal-change option:
  derive the survivor list once and thread it where `config.roles.test.agents` is read
  (tracker init + `runAgents`), rather than mutating `config`. Researcher to confirm
  the cleanest threading (carry a `runnableTestAgents` alongside, vs a shallow-cloned
  config) — flagged H6a.

- **R6.3 improver-halt-after-iteration.** If the improver id is misconfigured
  (consequence `HALT_AFTER_ITERATION`): the current iteration runs to completion
  normally (test + judge produce a valid matrix — R6.3 / D6), then the loop halts with
  NO improver call and NO further iterations. Realization: gate the existing improver
  branch (`pipeline.ts:188`) additionally on "improver runnable," and when the improver
  is misconfigured, `break` after the iteration completes (equivalently cap the loop at
  the current iteration). No skill edit is attempted. The improver id goes into the
  `skipped` array → exit 2 (config error, not exit 1 — D6). The matrix and its verdict
  still stand and are reported. Interaction with `finalPass`: a misconfigured improver
  must also suppress the extra final sweep (`pipeline.ts:215-246`), since that sweep
  exists to re-evaluate after improver edits that will never happen. Researcher to
  confirm finalPass suppression is needed and has no other dependency — flagged H6b.

- **R9 per-agent error containment.** Already structurally satisfied (see evidence).
  The design adds no new uncontained throw: the classifier is pure/synchronous and its
  only "failure" is a declared-misconfig (data, not a throw); unknown provider stays
  the existing hard abort (R7). The one new throw/return site is judge-stop, an
  intentional whole-run abort, not a per-agent error — consistent with R6.2.

#### H5a — Pushing the skipped set onto the hook context (R10.1) [analyst-decided part]

**Question.** How is the skipped set (id + role(s) + reason) exposed as passive data
on the existing hook context, readable from `beforeAll` onward, with no new mandatory
callback (R10.1, AC9)? (The e2e `--project` forwarding is H5b, pending researcher.)

**Evidence (analyst, from codebase).**
- `RunContext` (`config/types.ts:144-150`) is built ONCE in `runPipeline`
  (`pipeline.ts:100-106`) and is the base every hook context extends —
  `ScenarioContext`, `AgentContext`, `IterationHookContext`,
  `IterationCompleteHookContext`, `ImproveHookContext` all `extends RunContext`
  (`config/types.ts:157-224`). So a field added to `RunContext` is visible to EVERY
  hook, including `beforeAll` which receives `runCtx` directly
  (`pipeline.ts:328-336`).
- Hooks are fire-and-forget except `afterAllScenarios`; all are OPTIONAL
  (`Hooks` — `config/types.ts:256-287`). Adding a readable field requires no new
  callback (AC9 "no new mandatory callback").
- `RunContext` is a PUBLIC exported type (`src/index.ts:18`). Adding a field is
  additive; consumers that ignore it are unaffected (R11.1). Every in-tree consumer of
  the contract must stay consistent (R10.5) — the only in-tree reader is
  `testing-project`'s hooks, handled in H5b.

**Decision — add a readonly field to `RunContext` carrying the skipped set, populated
once before `beforeAll` fires.** Provisionally `skipped: ReadonlyArray<{ id; roles;
reason }>` (final name to the writer; must be consistent with the report key from
H2/H3 and avoid process vocabulary). It is set on `runCtx` at construction
(`pipeline.ts:100-106`), so it is already present when `beforeAll` runs
(`pipeline.ts:328`) and on every derived context thereafter (R10.1 "readable from the
earliest run-scoped hook onward"). Because v3 detection is setup-only, this set is
fully known before `beforeAll` and never mutates mid-run — consistent with the
dead-lane model; R3.4's later runtime detection would append to the same field without
changing its shape. This is the SAME data the `skipped` report array carries (H2/H3)
and the same data the e2e hook forwards (H5b), so there is one source of truth threaded
three ways (report, hook context, e2e child).

#### H5c — The deterministically-misconfigurable testing-project agent (R10.4) [analyst-decided]

**Evidence.** `testing-project`'s default agents are both `claude-code` (`haiku`,
`opus`) with no env gate (`testing-project/skillsmith.config.ts:20-30`). The spec
research notes v2 added an `openai-api`-backed agent for this purpose
(`spec-research.md:196`). All unit fixtures use `provider: "mock"` (e.g.
`fixtures/judge-skip-project/skillsmith.config.ts`), which is not statically
misconfigurable.

**Decision — add an `openai-api`-backed test agent to `testing-project` that is
misconfigured exactly when `OPENAI_API_KEY` is unset.** This exercises the real
classifier path end to end (AC1, AC10) without any real credential: with the key
unset the agent is skipped (no Playwright project, no plugin build); with the key
present it runs and IS included (AC10's both-directions check). It needs no real model
call to verify the SKIP direction (the classifier decides pre-invoke); only the
"present ⇒ included" direction would attempt a real call, which the e2e test gates on
the key being set. The same env-keyed-unset seam is the right one for unit/integration
fixtures that must be exercisable without credentials (Acceptance Criteria preamble) —
flagged to researcher as H5d: confirm whether unit tests should prefer an
`openai-api`-unset fixture over teaching `mock` a misconfigurable mode (I lean
env-keyed-unset because it tests the real predicate, not a test-only branch).

#### H7 — Live-CLI integrity for skip surfacing (R11.2 / D10) [analyst-decided]

**Evidence (analyst, from codebase).** The live, in-place re-render is owned by
`ProgressTracker` (`progress/tracker.ts`), whose columns come from the test-agent ids
at init (`pipeline.ts:111-114`). The final static summary is a separate one-shot
print: `prepared = prepareSummary(...)` (`pipeline.ts:248`), then `tracker.finish()`
in the `finally` (`pipeline.ts:262`), then `return emitSummary(prepared)`
(`pipeline.ts:265`) prints the summary lines AFTER the dashboard's final paint.

**Decision — skip surfacing lives only in the final static summary; the live tracker
never sees skipped agents.** Because misconfigured test agents are filtered out
BEFORE `ProgressTracker` is constructed (H6 R6.1), they never become tracker columns,
so the in-place re-render math (`tracker.ts:244-254`) is unchanged and R11.2 holds by
construction. The per-skip block (id + reason) is appended to `prepareSummary`'s
returned `consoleLines`, printed once by `emitSummary` after the dashboard — a static
print that does not interact with the cursor re-render. R11.1 (no-misconfig runs
identical) holds because with an empty skipped set the new branch is inert: no extra
lines, exit code reverts to `allPass ? 0 : 1`, tracker columns unchanged.

#### Open sub-questions parked for the researcher (tracking list)

These are the precise, evidence-needing points the analyst flagged while settling the
decisions above. Each must be closed (confirmed or corrected) before the design is
final.

- **H1a** — `requiredEnv?: string` vs a `runnability?(env)` predicate on `Provider`.
  Confirm every real provider gate today is a single-env-var presence (or nothing), so
  the plain string suffices and a predicate would be deferred generality.
- **H5b** — Playwright `--project` semantics (@playwright/test ^1.59.1): does repeating
  `--project=<id>` restrict to exactly those projects, and does an unknown `--project`
  error or no-op? This decides whether forwarding the runnable set as `--project`
  selectors is sufficient and safe in both the key-unset and key-present directions.
- **H5b (build side)** — Confirm a skipped agent never gets a `workspace/plugin-*`
  directory (because it never enters `runAgents`/`beforeTestAgent`), so the e2e
  plugin-build scan (`verify-e2e.ts:45-67`) naturally skips it and a build-side filter
  is redundant. Find any other path that could materialize a skipped agent's directory.
- **H5b (playwright.config.ts:23 bug)** — Confirm `config.roles.test.agents.map((agentId)
  => ({ name: agentId }))` is a real pre-existing bug (objects, not ids), and decide
  whether fixing it (so project NAMES equal agent ids) is required for `--project`
  selectors to bind, hence in-scope under R10.5.
- **H5d** — Unit/integration fixtures: prefer an `openai-api`-unset fixture (exercises
  the real predicate) over teaching `mock` a misconfigurable mode.
- **H6a** — Cleanest way to thread the runnable test-agent survivor set (carry a
  `runnableTestAgents` list alongside config vs a shallow-cloned config) into tracker
  init + `runAgents` without mutating shared `config`.
- **H6b** — Confirm a misconfigured improver must also suppress the `finalPass` extra
  sweep (`pipeline.ts:215-246`) and that doing so has no other dependency.
- **H6c** — For judge-stop returning 2 directly from `runPipeline`: should
  `beforeAll`/`afterAll` fire when the run stops before the loop? Confirm no code
  depends on judge-stop throwing.
- **H6d** — All-test-agents-misconfigured (R5.5): short-circuit the iteration loop
  (skip running empty scenarios) vs let scenarios run empty. Either exits 2 and
  surfaces; question is hook-firing/behavioral cleanliness and whether running empty
  scenarios risks a vacuous-pass edge. Analyst trace: empty survivor set ⇒ each
  scenario yields `agents: {}` ⇒ `aggregateScenarioReport` allPass=false
  (`scenario-report.ts:83-86`) ⇒ summary `allPass` false ⇒ skip rule returns 2. No
  vacuous pass either way; decision is about wasted work + hook firings.

#### H5b — e2e `--project` forwarding (analyst web-verified; researcher corroboration still welcome)

**Question.** Forward the runnable set into the spawned Playwright child so a skipped
agent gets no project/spec; do `--project` selectors achieve this, and what binds the
selector to a project?

**Evidence.**
- *Playwright `--project` semantics (web-verified, official docs).* The CLI flag is
  `--project <project-name...>` — "Only run tests from the specified list of projects,
  supports '*' wildcard (default: run all projects)." It accepts multiple values
  (repeat the flag or space-separated), restricting the run to EXACTLY those projects.
  Sources: Playwright Command line docs (https://playwright.dev/docs/test-cli) and
  Running tests docs (https://playwright.dev/docs/running-tests). testing-project pins
  `@playwright/test ^1.59.1` (`testing-project/package.json:16`), well within the
  stable `--project` behavior.
- *Unknown project behavior (NOT in docs; analyst note).* Playwright errors and exits
  non-zero when `--project` names a project absent from the config (message: "Project(s)
  '<name>' not found"). This is a SAFETY constraint, not a blocker: we must only forward
  ids that EXIST as configured projects. Residual uncertainty (exact message/exit) is
  low-risk because the design forwards exactly the runnable subset of the SAME ids the
  config derives its projects from — every forwarded id is, by construction, a defined
  project. Researcher/implementer should confirm with a tiny local `npx playwright test
  --project nonexistent` if cheap.
- *Spawn site.* `runE2eVerification` spawns `npm run test:e2e -- <specs>`
  (`verify-e2e.ts:129`) → `playwright test` (`testing-project/package.json:9`). Appending
  `--project <id>` per runnable agent to that arg list restricts the child. Only caller
  of `runE2eVerification` is the `afterAllScenarios` hook
  (`testing-project/skillsmith.config.ts:54-57`) — so adding a third parameter
  (`runnableAgentIds`) is contained.
- *playwright.config.ts:23 bug.* `config.roles.test.agents.map((agentId) => ({ name:
  agentId, metadata: { agentId } }))` maps over `AgentDefinition[]` but names each
  project with the OBJECT, not the id string — a real pre-existing bug. Project NAMES
  must equal the agent-id strings for the forwarded `--project <id>` selectors to bind
  (and for the report's `projectName`→agent attribution in `parsePlaywrightReport`,
  `verify-e2e.ts:198-207`, to work).

**Decision.**
1. Forward the runnable set as repeated `--project <id>` args to the spawned Playwright
   command in `runE2eVerification`. Source of the set: the hook reads it from the
   pushed hook context (H5a) and passes it as a new third parameter
   `runnableAgentIds: string[]` to `runE2eVerification` (the only caller, so contained —
   R10.5). A skipped agent is thus absent from the child's project set ⇒ no spec runs
   against it (R10.2), and AC10's "And" clause is met (no hand-edit of the project list).
2. NO build-side filter is needed: a skipped agent never enters `runAgents`/
   `runAgentPair`, so its `agentWorkspace`/`plugin-*` dir is never created
   (`agent-loop.ts:144,303` are the only creation sites), so the plugin-build scan
   (`verify-e2e.ts:45-67`) finds nothing for it. The dead-lane (no provisioning, R3.1)
   guarantees this. **H5b-build closed.**
3. FIX `playwright.config.ts:23` to derive `name: agent.id` (string) — required so
   project names equal agent ids, which both the `--project` forwarding and the
   report-attribution depend on. In-scope under R10.5 (keep every hooks-contract
   consumer consistent; testing-project hooks are in-scope code). The map should also
   ideally derive its project list from the runnable set when invoked standalone (R10.3
   secondary convenience) — but the in-run path does NOT depend on that; it depends on
   the `--project` selectors from the spawned child. Researcher/writer: keep
   playwright.config.ts's standalone project list = all configured test agents (so a
   bare `npx playwright test` still has all projects defined); the in-run restriction is
   purely via forwarded `--project`. This satisfies R10.3 (the pure predicate MAY also be
   used standalone) without making the in-run path depend on it.

#### Closed sub-questions (resolved by analyst evidence)

- **H1a → RESOLVED: `requiredEnv?: string`.** `vercel-runner.ts` has NO auth gate of
  its own (shared, key-agnostic — header comment + body); the only credential gate is
  each provider's single env-var check in `invoke`. Every real gate is a single-env-var
  presence or nothing. A predicate would be deferred generality; the string suffices and
  is the minimal change.
- **H5b-build → RESOLVED: no build filter** (see H5b #2 above).
- **playwright.config.ts:23 bug → RESOLVED: fix to `name: agent.id`, in-scope** (H5b #3).

- **H6a → RESOLVED: filter via the existing `agentIdFilter` pattern, do not mutate
  `config`.** The runnable test-agent id set is threaded the SAME way the existing
  `failed-pairs` re-selection already threads a per-scenario subset: `runAgents` filters
  `config.roles.test.agents` by an id set (`agent-loop.ts:81-92`). The classifier's
  runnable set becomes a run-scoped allowlist applied at the two read sites —
  `ProgressTracker` init (`pipeline.ts:111-114`, build columns from runnable ids only)
  and `runAgents` (intersect with runnable before/alongside the existing `agentIdFilter`).
  Carry the runnable id list on the run/iteration params (mirroring `agentFilter`), NOT
  by mutating the shared `config` object. This reuses an established pattern (R12.2,
  R12.1) and leaves `config` immutable for all other readers.

- **H6b → RESOLVED: suppress the finalPass sweep when the improver is misconfigured.**
  The extra sweep (`pipeline.ts:215-220`) runs only on
  `finalPass && lastWasSubset && mode==="self-improvement" && !mergedPass`; its purpose
  is to re-evaluate after improver edits. A misconfigured improver makes no edits, so the
  sweep would re-run an unchanged failing matrix — and R6.3 forbids "further iterations."
  Localized change: additionally gate the sweep (and the in-loop improver branch,
  `pipeline.ts:188`) on "improver runnable." When the improver is misconfigured, the loop
  halts after the current iteration and the final sweep does not run.

- **H6c → RESOLVED: judge-stop returns 2 before any hook fires; no beforeAll/afterAll.**
  The classifier runs before the iteration loop; if the judge id is misconfigured,
  `runPipeline` prints the single judge+reason message and `return 2` BEFORE entering the
  main try block (so `beforeAll` — which fires inside `runOneIteration`,
  `pipeline.ts:328` — and `afterAll` — in the try's `finally`, `pipeline.ts:252` — never
  fire) and BEFORE any report is written. This matches R6.2 ("no graded matrix and no run
  report", "aborts up front") and AC7. The tracker is also not constructed/finished for
  this path (or is constructed-then-finished with nothing — writer's call; simplest is to
  return before constructing it). No code depends on judge-stop throwing (today there is
  no judge-stop concept; this is new). R11.1 is unaffected (only triggers when judge is
  misconfigured).

- **H6d → RESOLVED: let the loop run with the empty runnable test set (no bespoke
  short-circuit).** When every test agent is misconfigured, the runnable set is empty;
  `runAgents` becomes a no-op (`Promise.all([])`), each scenario yields `agents: {}` ⇒
  `aggregateScenarioReport` allPass=false (`scenario-report.ts:83-86`) ⇒ summary
  `allPass` false; the non-empty `skipped` array forces exit 2 and surfaces the ids
  (R5.5). No vacuous pass arises and no special-case branch is needed (R12.2). Wasted work
  is negligible (zero-agent scenarios do almost nothing). Hook firings for the empty case
  are unchanged from "a normal run that happens to have no test agents to run per
  scenario" — acceptable since R11.1 only pins the NO-misconfig case. (If the writer
  prefers, an early surface is possible, but the analyst's decision is to avoid the extra
  branch.)

- **H5d → RESOLVED: unit/integration fixtures use an `openai-api`-unset agent, not a new
  mock mode.** The Acceptance Criteria preamble requires each AC be exercisable without
  real credentials "via a provider that can be made misconfigured on demand." An
  `openai-api` agent with `OPENAI_API_KEY` unset is exactly that and exercises the REAL
  classifier predicate (`requiredEnv` read), not a test-only branch — higher-fidelity than
  adding a misconfigurable mode to `mock`. Existing tests already toggle these env vars
  with a `withEnv` helper (`vercel-providers.test.ts:54-65`), so the fixture + test seam
  exists. `mock` stays "not statically misconfigurable" (R2.3), unchanged.

## Consolidated design (synthesis target for the writer)

One new self-contained classifier component plus a handful of localized wiring edits.
No existing internal signature changes except additive params; the `Cell` set and the
provider `invoke` paths are untouched.

**New component (isolated — R12.1):** a classifier module exposing
1. a pure, synchronous `classifyRunnability(config, env)` → `{ runnableTestAgents,
   skipped: [{ id, roles, reason }], judge runnability, improver runnability }` —
   reused as the R10.3 standalone convenience; and
2. the single POLICY seam `decide(role) → Consequence` (`EXCLUDE_LANE` | `STOP_RUN` |
   `HALT_AFTER_ITERATION`); only "warn" wired; most-severe across an id's roles (R6.4).
   It reads `getProvider(provider).requiredEnv` (the new optional field) and the env.

**Contract additions (additive, backward-compatible):**
- `Provider.requiredEnv?: string` (`src/providers/types.ts`); set on
  openai-api/anthropic-api/gemini-api; omitted on claude-code/mock/codex (R2.2/R2.3).
- `RunContext.skipped` readonly array (`src/config/types.ts`), populated on `runCtx`
  before `beforeAll` (R10.1, AC9).
- Top-level `skipped` array in `${runDirectory}/report.json` via a 4th param to
  `writeRunReport` (`src/reports/iteration-report.ts:153`) (R4.3).

**Wiring edits in `runPipeline` (`src/pipeline/pipeline.ts`):**
- Run the classifier after `checkPaths`/`resolveSelfImprovement`, before the loop.
- Judge misconfigured ⇒ print message + `return 2` before any hook/report (R6.2/AC7).
- Put the skipped set on `runCtx`; restrict tracker columns + `runAgents` to the
  runnable test set via the existing filter pattern (R3.1–R3.3, H6a).
- Gate the in-loop improver branch and the finalPass sweep on "improver runnable";
  halt after the current iteration if misconfigured (R6.3/AC8, H6b).
- Pass the skipped set through `writeRunReport`.

**Exit code (`src/reports/summary.ts` `prepareSummary`):** read the report's `skipped`;
`exitCode = skipped.length > 0 ? 2 : (allPass ? 0 : 1)` (R5.2/R5.3/R5.4/R5.5); render a
once-per-run skip block (id + reason) distinct from FAIL/SKIPPED, appended to
`consoleLines` (R4.1/R4.2). Live tracker unaffected (H7/R11.2).

**testing-project (in-scope consumer — R10.5):**
- Add an `openai-api`-backed test agent, misconfigured when `OPENAI_API_KEY` unset
  (R10.4).
- `afterAllScenarios` reads `ctx.skipped`, passes runnable ids to `runE2eVerification`,
  which forwards `--project <id>` per runnable agent to the spawned Playwright child
  (R10.2/AC10). No build-side filter needed (dead lane ⇒ no workspace).
- Fix `playwright.config.ts:23` to `name: agent.id` so project names = ids (required
  for `--project` binding and report attribution).

## Requirement → decision coverage map

- R1 (what counts) → H1 classifier scope; transient/input-specific stay in invoke path
  (untouched), surfacing as ordinary FAIL (AC6).
- R2 (detection/scope) → H1 (`requiredEnv`, pre-invoke, env-keyed only;
  claude-code/mock/codex not statically misconfigurable).
- R3 (dead lane) → H6 R6.1 (filter test set; no provisioning, no accounting, no
  re-selection). R3.4 invariant holds trivially (setup-only).
- R4 (surfacing) → H2 (top-level `skipped`, distinct from Cell) + H7 (once-per-run block).
- R5 (exit code) → H3 (`skipped.length>0?2:allPass?0:1`; precedence; anti-regression;
  all-misconfigured) + H6d.
- R6 (roles) → H6 (judge STOP_RUN/2/no-report; improver HALT_AFTER_ITERATION + finalPass
  suppression; test EXCLUDE_LANE; multi-role most-severe).
- R7 (unknown provider) → unchanged hard abort (`getProvider` throw → PreconditionError
  → existing path); explicitly NOT a skip.
- R8 (policy seam) → H4 (`decide` seam; warn only; fail/skip localized future).
- R9 (containment) → H6 (already structural; no new uncontained throw).
- R10 (hooks/e2e) → H5a (RunContext push), H5b (--project forward), H5c (R10.4 agent),
  H5b#3 (playwright.config fix); R10.3 standalone predicate = `classifyRunnability`.
- R11 (back-compat/CLI) → H7 (empty skipped ⇒ inert; tracker re-render untouched).
- R12 (constraints) → isolated component (H4), minimal additive changes, no process
  vocabulary (writer enforces naming).

## AC → mechanism map

AC1→H1 predicate. AC2/AC3→H6 R6.1 dead lane. AC4→H2/H7 surfacing + report. AC5→H3#4/H6d.
AC6→invoke path untouched. AC7→H6 R6.2 judge-stop. AC8→H6 R6.3 improver halt + H6b.
AC9→H5a RunContext push. AC10→H5b --project forward + H5c agent + config fix.
AC11→H6 R6.4 most-severe. AC12→H3#2 precedence. AC13→H7/R11.1 inert path.

## Status

All HOW items (H1–H7) and sub-questions (H1a, H5b, H5d, H6a–H6d, playwright.config bug)
are settled with cited evidence. The design is ready for the writer to synthesize
`design-doc.md`. NOTE: the partner `design-doc-researcher` did not respond during this
session; the analyst gathered the primary codebase evidence directly (every claim is
file:line-cited and independently verifiable) and web-verified the one external fact
(Playwright `--project` semantics). If the researcher later surfaces a contradiction,
the affected entry should be revisited.
