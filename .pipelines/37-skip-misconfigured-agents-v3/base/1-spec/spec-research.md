# Spec Research: Skip misconfigured agents across all phases of a run

> The phase-0 prompt, copied verbatim for standalone reference.

When `skillsmith` runs with an agent it cannot run because it is **misconfigured**
— a defect knowable independently of the agent's output, such as a missing or
invalid credential, an unknown provider, a non-existent model, or a missing local
tool — that agent is **removed from the run as if it had never been configured**,
while the fact that it was removed is **recorded loudly** so the run is never
mistaken for a clean one.

Two layers must both hold: **in the work, it's gone** (no phase, no accounting, no
re-selection, no provisioning); **in the outcome, it's present** (announced once
in the CLI with id + reason, visually distinct from a real failure; in the report;
and the run exits non-zero). The two outcomes are co-equal. Roles differ:
test agent → warn/skip; judge → stop the run; improver → finish the current
iteration then halt. The "all test agents misconfigured" guard must be preserved.

(Full prompt at `../0-prompt/prompt.md`.)

## Q&A

### Prior decisions (settled with the owner before the spec phase)

These were worked through directly with the owner across an extended requirements
discussion. Recorded here as settled inputs to the spec.

**D1 — Exit code is required, with distinct config-vs-eval codes.** A run with any
misconfigured *declared* agent must exit non-zero. Distinct codes so an
autonomous/CI consumer can tell apart "a declared agent couldn't run"
(configuration/environment problem) from "a skill genuinely failed evaluation."
Intended shape: `0` clean / `1` a surviving skill failed evaluation / `2` a
configuration error (an agent couldn't run). Exact integer values delegated to the
orchestrator at design time; the *guarantee* (skip ⇒ non-zero, config-distinguishable)
is the requirement.

**D2 — Detection timing: setup where cheap, runtime otherwise; minimal classifier
default.** Detect misconfiguration as early as cheaply knowable (ideally at setup,
before any phase). Ship a *minimal* classifier first: the setup-time / missing-
credential cases are skips; deeper runtime error-body introspection (e.g. routing a
present-but-invalid key or a 404 model-not-found into a skip) is deferred as a
future knob, not built now. A case only knowable at runtime that the minimal
classifier doesn't catch degrades to an ordinary test failure.

**D3 — "Dead lane" model (absent from matrix, present in report).** Two layers:
- *Execution/accounting layer* — the misconfigured agent's lane is fully removed:
  no test/judge/improve phase, absent from pass/fail numerator and denominator, not
  re-selected in later iterations, no per-agent provisioning hook fires. For
  everything that executes, the run behaves as if the agent were never configured.
- *Outcome layer* — the skip is recorded: announced once per run in the CLI with
  the agent **id + reason**, visually distinct from a genuine failure; present in
  the machine-readable report the same way; and forcing a non-zero exit.

**D4 — Retroactive purge for runtime-detected skips.** If an agent is found
unusable mid-run *after* it already recorded results (e.g. PASSed earlier
scenarios), those earlier results are purged from accounting too, so the final
result reads as if the agent were never configured. One invariant: a skipped lane
contributes nothing, anywhere, ever. (For setup-detected skips the lane never
starts, so this is moot.)

**D5 — Deterministic-vs-transient discriminator.** Skip the lane only for a defect
that is *agent-local and identical on every call this run* (config/credential/
provider/tool/quota). Leave *transient* (rate-limit 429, 5xx, network, timeout) and
*input-specific* (context-length-exceeded, content-filter, step-cap) failures as
ordinary test failures that stay in the matrix and count. **Quota/billing exhausted**
(`429 insufficient_quota`) is classed with the skip/exit-2 family for reasoning, but
under the minimal classifier (D2) it is only caught if cheaply knowable — otherwise
it falls through as an ordinary failure until the deferred full classifier lands.

**D6 — Role-aware behavior.**
- *Test agent* → skipped per D3 (the default "warn" behavior).
- *Judge* → stops the run; nothing can be graded.
- *Improver* → the current iteration completes (test + judge produce a valid
  matrix), then the loop halts with no further iterations; no skill edits are
  attempted. Detection timing converges to the same observable outcome (one
  complete iteration, then stop). Only changes behavior when iteration 1 had
  failures; an all-pass iteration 1 stops anyway.
- Improver misconfiguration is still a configuration error → exit 2 (it is *not* a
  skill failure / exit 1). Collapses into the uniform "declared agent couldn't run
  ⇒ surfaced + exit 2" rule.

**D7 — Per-agent error containment.** An error invoking one agent — including a
missing local tool throwing at spawn time — must be contained to that agent's lane
(become that agent's outcome) and must never crash the whole run. Missing-tool is
NOT given explicit detection; it falls through as an ordinary failure, guarded by
this containment.

**D8 — Hooks/e2e learn the skipped set by push (primary).** The runtime pushes the
skipped/runnable set (id + role(s) + reason) onto the hook context; in-process
hooks read it passively (no new mandatory callback). The e2e harness, which spawns
Playwright as a child process, has the hook forward the surviving agent ids to that
child (e.g. `--project` selectors) so a skipped agent gets no Playwright project and
no plugin build. A pure synchronous runnability predicate over config+env MAY be
exposed as a *secondary* convenience for a standalone `npx playwright test`, but it
is not the mechanism the run depends on (it cannot see runtime-detected skips).

**D9 — Policy seam (warn now; fail/skip future).** Route the "what to do about a
misconfigured agent" decision through one seam. Implement only "warn." Leave "fail"
(abort up front if any agent misconfigured) and "skip" (proceed, exit zero — the
opt-in escape hatch for intentional absence) as localized future additions, not
built now.

**D10 — Live CLI integrity.** The interface re-renders in place as the run updates;
skip surfacing must preserve that layout and text positioning.

### Remaining questions (spec phase)

**Q1 — Unknown provider: per-agent skip or hard up-front abort?**
Today a typo'd / nonexistent provider id aborts the whole run as a precondition
error (`getProvider` throws). The prompt lists "an unknown provider" as a
misconfiguration example. For a **test agent** naming a provider that doesn't
exist, should v3 treat it as a per-agent skip (drop that lane, run the rest, exit
with the config-error code) — consistent with the dead-lane model — or keep it a
hard up-front abort of the entire run (a nonexistent provider id is an author typo
to fix before anything runs)?
_Answer:_ **(b) Keep the hard up-front abort.** An unknown/nonexistent provider id
is a structural authoring error (wrong on every machine), so it remains a
precondition error that aborts the whole run, unchanged from today — on any role.
Only **credential/environment** defects get the dead-lane skip. (Resolves v1's
"Open Decision 1" toward fail-fast for invalid config.) A CLI argument to
*intentionally* skip named agents is a separate follow-up issue (see Out of Scope).

**Orchestrator decision (per owner's delegation of exit-code values).** When a
single run has both a misconfigured agent (config-error class) and a surviving
agent that genuinely failed evaluation (eval-failure class), the **config-error
code takes precedence** in the process exit status — a partial run is "invalid," so
the configuration problem dominates — while the report still carries both. (Owner
may veto at spec review.)

**Q2 — "Always print the report": does it hold for the judge-stop case?**
The owner's earlier list required "always print the report at the end of
execution." The hard case is a misconfigured **judge**: it stops the run before any
grading, so no matrix exists. Today that path prints a single error line (the abort)
and exits. Should the judge-stop case (a) still emit the normal end-of-run
report/summary — showing the judge as misconfigured with id + reason, just with no
graded rows — so the machine-readable report always exists and explains why the run
stopped; or (b) a clear single message (judge id + reason) suffices when nothing
could be graded, and the full report/summary is only produced when a matrix exists?
_Answer:_ **(b).** The judge-stop case prints a clear single message naming the
judge + reason and exits with the config-error code — no manufactured report. So
"always print the report" is scoped to runs that produce a matrix (test-agent
skips, improver-degrade); the hard-stop cases (judge misconfig; unknown-provider
abort) emit a clear message instead.

## Research

Findings from the current `trunk` codebase (this worktree), with sources.

- **Provider contract has no static runnability.** `Provider = { id, invoke }`
  (`src/providers/types.ts:50-53`). The credential check lives *inside* `invoke`:
  `src/providers/openai-api.ts:8` returns `{ error: "OPENAI_API_KEY is not set" }`
  (a result, not a throw) when the key is absent. So today a missing key becomes a
  per-call error → ordinary failure. Making misconfiguration *pre-invoke* requires
  surfacing the provider→credential requirement statically (extend the contract or
  a side map) — no such surface exists yet.
- **Provider→env mapping is hardcoded per provider.** `openai-api`→`OPENAI_API_KEY`,
  `anthropic-api`→`ANTHROPIC_API_KEY`, `gemini-api`→`GOOGLE_GENERATIVE_AI_API_KEY`
  (inside each provider's `invoke`). `claude-code` and `mock` have no env gate;
  `codex` (`@openai/codex-sdk`) reads `OPENAI_API_KEY` but does not pre-check it.
  Registry: `src/providers/registry.ts` (`PROVIDERS`, `PROVIDER_IDS`, `getProvider`).
- **Unknown provider is a hard throw.** `getProvider` throws `unknown provider: "<id>"`
  (`src/providers/registry.ts:23-29`); config validation lives in
  `src/config/validate.ts`. Today a typo'd provider id aborts the whole run as a
  precondition error, not a per-agent skip. (→ open question, see below.)
- **Status vocabulary is a closed set.** `Cell = PASS | FAIL | SKIPPED{reason}`
  (`src/reports/verdict.ts:9-12`). `SKIPPED` already exists (used when a judge
  verdict carries `{ skipped: string }`) and renders **yellow**, `FAIL` **red**
  (`src/reports/summary.ts:233-237`) — a visual-distinction mechanism already
  exists. A `SKIPPED` cell is *not* a PASS, so it already forces the row non-pass.
- **Exit-code chokepoint.** `prepareSummary` (`src/reports/summary.ts:52-77`) reads
  the merged `${runDirectory}/report.json`; `exitCode = allPass ? 0 : 1` where
  `allPass = rows.length > 0 && rows.every(isRowPass)` and `isRowPass` requires
  every agent cell to be `PASS`. Two consequences: (a) merely **dropping** a
  misconfigured agent's row leaves the rest all-PASS → **exit 0** (the regression to
  prevent); (b) `rows.length > 0` is the only current empty-set guard. Exit is
  binary 0/1 today.
- **Runner exit surface.** `run()` (`src/runner.ts:29-46`) returns `runPipeline`'s
  number; `PreconditionError`/`UserFacingError` are caught → `console.error` +
  return `1`. A distinct `2` would need `prepareSummary`/`runPipeline` to produce it
  and the runner to pass it through (it already returns the number).
  `UserFacingError`: `src/util/errors.ts`; `PreconditionError`: `src/config/resolve-cwd.ts`.
- **Hooks never crash the run.** `tryHook` (`src/util/hooks.ts`) records a throwing
  hook as `error` and continues. Hook context type is in `src/config/types.ts`
  (`HookFn<Ctx>`); observed hooks: `beforeAll`, `beforeTestAgent`,
  `afterAllScenarios`, `afterAll`.
- **e2e is launched from a hook, child-process Playwright.** Testing-project
  `afterAllScenarios` (`testing-project/skillsmith.config.ts:54`) calls
  `runE2eVerification` (`testing-project/eval/utils/verify-e2e.ts`), which scans the
  iteration's workspaces for built plugins and **spawns** Playwright
  (`verify-e2e.ts:129`). `testing-project/playwright.config.ts:23-26` builds
  `projects` from `config.roles.test.agents` — one project per *configured* agent,
  blind to runnability (the spurious-failure source). `beforeTestAgent`
  (`skillsmith.config.ts:46`) scaffolds a workspace *before* the agent runs.
- **Testing-project default agents are `claude-code`** (`haiku`, `opus`) — no env
  gate — so a deterministic missing-credential case needs a dedicated agent
  (v2 added `openai-api-nano`, `provider: openai-api`).
- **Pipeline loop.** `src/pipeline/pipeline.ts` writes the merged report and calls
  `prepareSummary` (line ~248); a comment at line ~401 notes the report drives "the
  matrix, exit code, re-selection." Re-selection: `src/pipeline/select-scenarios.ts`.
  Improver loop: `src/improvement/` (`improver.ts`, `verify.ts`, `context.ts`).

## Out of Scope

Candidates collected so far (to confirm at the out-of-scope step):

- Implementing the **"fail"** and **"skip"** policies (only "warn" ships; the seam
  makes them localized future additions). (D9)
- The **full runtime classifier** — deep error-body introspection to route a
  present-but-invalid key, 404 model-not-found, or quota into skips. Deferred. (D2/D5)
- Explicit **missing-tool detection** — handled only by error containment. (D7)
- **Transient/operational** failures (rate-limit, 5xx, network, timeout) and
  **input-specific** failures (context-length, content-filter, step-cap) — these
  stay ordinary failures, unchanged. (D5)
- Retrying or repairing a misconfigured agent (no auto-fixing of credentials).
- Adding providers or changing any provider's authentication mechanism.
- **Unknown/nonexistent provider id as a per-agent skip** — stays a hard
  precondition abort (Q1). Not in the skip set.
- **A CLI argument to intentionally skip named agents** — a separate follow-up
  issue; the user-facing home for intentional exclusion (and a natural surface for
  the future "skip" policy), distinct from runtime misconfiguration discovery.

## Consolidated Requirements

1. **Misconfigured** = an agent-local defect knowable independently of the agent's
   output and identical on every call this run (paradigmatically an absent required
   credential). Transient (rate-limit/5xx/timeout) and input-specific
   (context-length/content-filter/step-cap) failures are explicitly NOT
   misconfiguration.
2. **Detection** is at setup where cheaply knowable. The shipped (minimal)
   classifier checks providers whose credential is a plain env-var read
   (`openai-api`→`OPENAI_API_KEY`, `anthropic-api`→`ANTHROPIC_API_KEY`,
   `gemini-api`→`GOOGLE_GENERATIVE_AI_API_KEY`); an absent required var ⇒
   misconfigured, determined with no model call. `claude-code`/`mock`/`codex` are
   not statically misconfigurable. Deeper runtime error introspection is deferred.
3. **Dead lane (execution/accounting).** A misconfigured test agent runs no phase,
   is absent from every scenario's pass/fail numerator and denominator, is not
   re-selected in later iterations, and triggers no per-agent provisioning — as if
   it were never configured.
4. **Surfacing (outcome).** Each skipped agent is announced once per run in the CLI
   with its **id + reason**, visually distinct from a genuine `FAIL` and from an
   unrelated `SKIPPED`; it appears the same way in `${runDirectory}/report.json`.
5. **Exit code.** Non-zero whenever a declared agent could not run. Distinct codes:
   `0` clean, `1` a surviving skill failed evaluation, `2` a configuration error
   (an agent couldn't run). When both classes occur, `2` takes precedence. Merely
   dropping a skipped agent's row so the rest pass and the run exits `0` is
   forbidden; the skip must thread to the exit chokepoint. All test agents
   misconfigured ⇒ exit `2` (not a vacuous pass).
6. **Skipped-lane invariant.** A skipped lane contributes nothing, anywhere, ever —
   including any results it recorded before detection (retroactive purge). In v3,
   detection is setup-time only, so this is satisfied trivially (the lane never
   starts); it is stated so runtime detection can be added later without changing
   the accounting model.
7. **Roles.** Test agent → dead lane + surfacing (the default "warn"). Judge →
   stops the run with a clear single message naming judge + reason, exit `2`, no
   report. Improver → the current iteration completes (test+judge matrix stands),
   then the loop halts with no further iterations and no skill edits, exit `2`.
   Same agent id in multiple roles → detected once, most-severe consequence wins
   (judge-stop dominates).
8. **Unknown/nonexistent provider id** stays a hard precondition abort of the whole
   run (unchanged), not a per-agent skip.
9. **Error containment.** Any error invoking one agent (including a missing tool
   throwing at spawn) is contained to that agent's lane and never crashes the run.
10. **Hooks / e2e.** The runtime exposes the skipped set (id + role(s) + reason) on
    the hook context (push), readable passively from `beforeAll` onward. The e2e
    hook forwards the surviving agent ids to the spawned Playwright child so a
    skipped agent gets no Playwright project and no plugin build and does not fail
    spuriously. A pure synchronous runnability predicate over config+env MAY be
    exposed as a secondary convenience for standalone Playwright runs. Every in-tree
    consumer of the hooks contract must be kept consistent with the contract change;
    `testing-project`'s hooks (`afterAllScenarios`/`verify-e2e.ts`) are in-scope code
    to update, not just a fixture.
11. **Policy seam.** Only "warn" is implemented; the decision routes through one
    seam so "fail" and "skip" are localized future additions.
12. **Backward compatibility.** A run with no misconfigured agents behaves exactly
    as today (matrix, verdict, hook firing, CLI output, exit code). The live CLI
    re-render and text positioning are preserved.
13. **Deliverable constraints.** The policy logic is a self-contained, isolated
    component; minimal change to existing internal signatures; sparse comments
    only on non-obvious code; no internal-process vocabulary in any shipped code,
    comment, test, or doc.
