# Code plan: skip misconfigured agents across a run

Ordered, self-contained tasks for sequential code-writers sharing one working
tree. Each task is small enough for one focused commit. Execute in order; a task
may start only once every task in its **Depends on** list is complete.

Shared conventions (apply to every task):

- The shipped code, comments, tests, and docs MUST contain NO internal-process
  vocabulary (no phase names, no "spec"/"design"/"plan", no acceptance-criteria
  or task identifiers). Use only ordinary domain words.
- Comment sparingly — only what is not obvious from the code. Do not touch
  comments on code you did not change.
- Keep changes minimal: do not refactor unrelated code or change existing
  internal signatures unless a task explicitly says to.
- Validate your work with the repo scripts: `npm run typecheck`, `npm run lint`,
  and `npm test` (`node --import tsx --test src/__tests__/*.test.ts`).

The **Traces to** field exists only in this plan to keep coverage honest; it MUST
NOT appear in any shipped file.

---

## Task 1 — Create the isolated runnability/policy module

**Goal** — Add one self-contained module holding the static provider→credential
map, the shared runnability atom, the two public predicates, and the internal
policy seam, with no provider/SDK runtime imports.

**Files**

- `src/policy/runnability.ts` (new)

**Changes**

Create `src/policy/runnability.ts` with exactly these members and nothing else.
Runtime imports must be SDK-free; import `ProviderId` and the config types
**type-only**.

```ts
import type { ProviderId } from "../providers/types";
import type {
  AgentDefinition,
  SkillsmithConfig,
  SkillsmithConfigInput,
} from "../config/types";
```

- `PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId, string>>` — the static
  map `{ "openai-api": "OPENAI_API_KEY", "anthropic-api": "ANTHROPIC_API_KEY",
  "gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY" }`. `claude-code`, `mock`, and
  `codex` are intentionally absent (never statically misconfigured). A short
  comment may note that absence-from-map ⇒ always runnable.
- `MISCONFIGURED_REASON_PREFIX = "misconfigured: "` — a single exported const,
  reused by the marker-writer (Task 4) and the tests (Task 7) so the prefix never
  drifts.
- `providerRunnable(provider: ProviderId, env: NodeJS.ProcessEnv): boolean` —
  `const required = PROVIDER_CREDENTIAL_ENV[provider]; return required ===
  undefined || Boolean(env[required]);`. This atom is the single source of truth.
- `agentRunnable(config: SkillsmithConfigInput, agentId: string, env:
  NodeJS.ProcessEnv = process.env): boolean` — looks up
  `config.agents[agentId].provider` and returns `providerRunnable(provider,
  env)`. (Public.) Its contract is that `agentId` must name a declared agent: an
  id absent from `config.agents` makes the `.provider` access throw. Internal
  callers only ever pass ids drawn from `config.roles.test.agents`, which config
  validation (`src/config/validate.ts:130-132`) guarantees reference real agents,
  so they are safe; the throw-on-unknown-id behavior is the documented contract for
  third-party callers. A one-line comment may state this; do not silently coerce an
  unknown id to `false` (that would mask a config error).
- `runnableTestAgentIds(config: SkillsmithConfigInput, env: NodeJS.ProcessEnv =
  process.env): string[]` — `config.roles.test.agents.filter((id) =>
  agentRunnable(config, id, env))`. (Public.) Note `roles.test.agents` is a list
  of **string ids** on the raw `SkillsmithConfigInput`.
- A helper that builds the reason string for a missing credential, e.g.
  `function missingCredentialReason(provider: ProviderId): string` returning
  `` `${MISCONFIGURED_REASON_PREFIX}${PROVIDER_CREDENTIAL_ENV[provider]} is not set` ``
  (e.g. `"misconfigured: OPENAI_API_KEY is not set"`). Used by the seam below and
  by the judge-stop message (Task 5). Keep it internal to the module.
- `interface RunnabilityPlan` exactly as the design states:
  ```ts
  interface RunnabilityPlan {
    testAgents: {
      run: AgentDefinition[];
      excluded: { agent: AgentDefinition; reason: string }[];
    };
    judge: { stop: boolean; reason?: string };
    improver: { degrade: boolean; reason?: string };
  }
  ```
- `decideRunnability(config: SkillsmithConfig, env: NodeJS.ProcessEnv =
  process.env): RunnabilityPlan` — the single policy seam. Its body is the only
  policy implemented now:
  - Partition `config.roles.test.agents` (which are `AgentDefinition` objects on
    the **normalized** `SkillsmithConfig`) into `run` / `excluded` by
    `providerRunnable(agent.provider, env)`. Each excluded entry carries `reason
    = missingCredentialReason(agent.provider)`.
  - `judge.stop = !providerRunnable(config.roles.judge.agent.provider, env)`; set
    `judge.reason` to the missing-credential reason when stopping.
  - `improver.degrade = !providerRunnable(config.roles.improver.agent.provider,
    env)`; set `improver.reason` when degrading.

Export `MISCONFIGURED_REASON_PREFIX`, `agentRunnable`, `runnableTestAgentIds`,
`decideRunnability`, and the `RunnabilityPlan` type from this module (the barrel
in Task 2 re-exports the two public predicates). `providerRunnable` and
`missingCredentialReason` may stay module-internal but `providerRunnable` should
be exported within the module if Task 7's unit tests assert on it directly.

A short comment may explain the seam shape: future "fail"/"skip" policies are
localized edits to `decideRunnability`'s body, not to its callers. Do NOT
implement "fail" or "skip". Do NOT introduce a `"warn"` string literal anywhere.

**Depends on** — none.

**Traces to** — R1.1, R1.2, R1.3, R2.1, R2.2, R2.3, R5.1, R7.1.

**Acceptance**

- `npm run typecheck` and `npm run lint` pass.
- The module imports nothing from `../providers/registry`, no provider object, and
  no SDK; `ProviderId` and config types are `import type` only (grep the file:
  the only `../providers` import line is `import type`).
- `decideRunnability` contains no policy-name string and no `if (policy === …)`
  branching; the single behavior is implemented directly.
- `agentRunnable` throws (does not return a value) when given an `agentId` that is
  not present in `config.agents` — the public contract is that the id must name a
  declared agent.

---

## Task 2 — Export the public predicates from the package barrel

**Goal** — Expose `agentRunnable` and `runnableTestAgentIds` as named value
exports from the package entry point so the testing-project can import them.

**Files**

- `src/index.ts`

**Changes**

Add a value re-export of the two public predicates from
`./policy/runnability`, placed alongside the existing exports (e.g. near
`export { run } from "./runner";`):

```ts
export { agentRunnable, runnableTestAgentIds } from "./policy/runnability";
```

Do not export `decideRunnability`, `providerRunnable`, `PROVIDER_CREDENTIAL_ENV`,
or `MISCONFIGURED_REASON_PREFIX` — they are internal. Do not reorder or alter the
existing exports.

**Depends on** — Task 1.

**Traces to** — R5.1, R5.2.

**Acceptance**

- `npm run typecheck` passes.
- A throwaway check resolves the symbols, e.g.
  `node --import tsx -e "import('./src/index.ts').then(m => { if (typeof m.agentRunnable !== 'function' || typeof m.runnableTestAgentIds !== 'function') process.exit(1); })"`
  exits 0.

---

## Task 3 — Unit tests for the runnability atom and public predicates

**Goal** — Lock the pre-invoke determination behavior with deterministic unit
tests that scrub the relevant credential env vars (no model invocation).

**Files**

- `src/__tests__/runnability.test.ts` (new)

**Changes**

Add a `node:test` suite (mirror the style of existing
`src/__tests__/*.test.ts`: `import { test } from "node:test";` +
`node:assert/strict`). Import `agentRunnable` and `runnableTestAgentIds` from
`../index` (and `decideRunnability` from `../policy/runnability` if you also unit
test the seam here). Use the established save → `delete process.env[VAR]` →
restore-in-`finally` pattern (see `src/__tests__/providers.test.ts:262-288`) to
control credential presence; pass an explicit `env` object where convenient
instead of mutating `process.env` so tests stay isolated.

Build small in-test `SkillsmithConfigInput` literals (raw shape: `roles.test.agents`
is string ids, `agents` keyed by id) and assert:

- `openai-api` agent with `OPENAI_API_KEY` unset ⇒ `agentRunnable` false; set ⇒
  true. Analogous pairs for `anthropic-api`/`ANTHROPIC_API_KEY` and
  `gemini-api`/`GOOGLE_GENERATIVE_AI_API_KEY`.
- `claude-code` and `mock` agents ⇒ `agentRunnable` true regardless of env.
- `runnableTestAgentIds` drops exactly the misconfigured ids and preserves order
  of the remaining ids.

Assert WITHOUT invoking any model (the functions are pure/sync; there is no
network). Do not reference any process/phase vocabulary in test names or strings.

**Depends on** — Task 1, Task 2.

**Traces to** — AC1.1, AC1.2, R4.4.

**Acceptance**

- `npm test` runs and the new suite passes.
- The test file contains no real API key and performs no network call.

---

## Task 4 — Exclude misconfigured test agents in `runAgents` and write the marker row

**Goal** — Inside the per-scenario agent loop, partition test agents into
runnable/excluded via the seam, run only the runnable ones, and persist a non-PASS
`SKIPPED` marker report for each excluded agent so the existing scoring chain forces
exit 1 — without invoking the agent or firing its hooks.

**Files**

- `src/pipeline/agent-loop.ts`

**Changes**

In `runAgents` (`src/pipeline/agent-loop.ts:66`), after the existing
`agentIdFilter` narrowing produces `agents` (line ~83-86) and before the
`Promise.all(agents.map(...runAgentPair...))` block:

1. Call `decideRunnability(config, process.env)` (import from
   `../policy/runnability`; `MISCONFIGURED_REASON_PREFIX` is already embedded in
   the plan's `reason` strings, so import only what you use). The plan partitions
   the FULL declared test set; intersect its `testAgents.run` /
   `testAgents.excluded` with the already-narrowed `agents` set by `agent.id`
   (filter first, then runnability — both are set-membership and
   order-independent) so an active `agentIdFilter` is still respected.
2. Run the runnable subset through the unchanged `runAgentPair` path (replace
   `agents` in the existing `Promise.all` with the runnable subset).
3. For each excluded agent in the active set: build its `agentDirectory =
   join(scenarioDirectory, agent.id)`, `mkdirSync(agentDirectory, { recursive:
   true })`, and call the existing `writeAgentReport(agentDirectory, { duration:
   0 }, { skipped: reason })` where `reason` is the excluded entry's reason string
   (already prefixed `"misconfigured: "`). Preserve the existing argument order:
   the signature is `writeAgentReport(agentDirectory, testing, review)` and it
   persists `{ testing, review }` (`src/pipeline/agent-loop.ts:298-308`), so the
   second arg is the `testing` block `{ duration: 0 }` and the third is the
   `review` block `{ skipped: reason }` — do NOT swap them (swapping would produce
   the wrong marker shape and break Task 9's assertion). Do NOT create the
   `workspace` subdirectory, do NOT call `runTestingAgent`/`runJudgeAgent`, and do
   NOT fire `beforeTestAgent`/`afterTestAgent`/judge hooks for it. `writeAgentReport`
   is already defined in this file (line ~298) — reuse it as-is; do not change its
   signature.
4. Exclusion and marker-write happen TOGETHER inside this per-scenario call, so a
   re-selected misconfigured agent (in `failed-pairs`/`failed-scenarios`/`all`
   topologies) is harmlessly re-excluded and re-marked every iteration it is in
   the active selection — never re-invoked.

Optionally emit a display-only tracker event for each excluded agent
(`tracker.phaseFinished(scenario.name, agent.id, "testing", { status: "skipped",
detail: "misconfigured" })` or the nearest existing tracker call) so the dashboard
stays tidy; this must not feed the exit code. Skip this if it complicates the
tracker's known-agent guard — it is cosmetic. The tracker roster seeding in
`pipeline.ts:108-117` stays UNTOUCHED.

Do NOT change `writeAgentReport`, `classifyVerdict`, `prepareSummary`,
`isRowPass`, or the report-merge logic.

**Depends on** — Task 1.

**Traces to** — R3.1, R3.2, R3.3, R3.4, R4.3, AC2.1, AC2.2, AC2.3, AC2.4, R7.2.

**Acceptance**

- `npm run typecheck` and `npm run lint` pass.
- The excluded agent's persisted `report.json` is
  `{ testing: { duration: 0 }, review: { skipped: "misconfigured: <VAR> is not set" } }`
  and no `workspace` directory is created for it (verified by Task 8's run test).
- No call to `runTestingAgent`/`runJudgeAgent` or `beforeTestAgent` occurs for an
  excluded agent (verified by Task 8).

---

## Task 5 — Judge-stop and improver-degrade pre-flight in `runPipeline`

**Goal** — Add a pre-flight, before the iteration loop, that stops the run on a
misconfigured judge and degrades to test-only on a misconfigured improver, reading
only the seam's plan.

**Files**

- `src/pipeline/pipeline.ts`

**Changes**

In `runPipeline` (`src/pipeline/pipeline.ts:79`), insert a pre-flight block
**after** `const selfImprovement = resolveSelfImprovement(...)` (line 84) and
**before** the iteration `for` loop — critically, **before the outer `try`** at
line 141 (so a judge-stop throw is outside the `try`/`finally`, fires no
`afterAll`, writes no report, and never reaches `prepareSummary`).

```ts
const plan = decideRunnability(config, process.env);
```
(import `decideRunnability` from `../policy/runnability`).

- **Judge stop** — if `plan.judge.stop`, throw the already-imported
  `UserFacingError` (`pipeline.ts:40`) with a clear single message, e.g.
  `` `judge cannot grade — ${plan.judge.reason ?? "provider credential is not set"}` ``.
  Prefer a message that names the missing variable (the plan's `reason` already
  contains `"misconfigured: <VAR> is not set"`); compose a single readable line.
  Do NOT add a new error type and do NOT export `UserFacingError`. `run()` already
  catches `UserFacingError`, prints the message, and returns 1.
- **Improver degrade** — if `plan.improver.degrade`, set the run to test-only by
  overriding the resolved mode once. Because `selfImprovement` is a local
  `ResolvedSelfImprovement`, reassign its mode (e.g. build a new object
  `selfImprovement = { ...selfImprovement, mode: "test-only" }` immediately after
  `resolveSelfImprovement`, or mutate the field if the binding allows). This one
  change propagates to `maxIterations` (line 118-119 collapses to 1), the
  per-iteration improvement guard (line 188-192), and the final-sweep guard (line
  215-220). It MUST NOT force a non-zero exit — the exit still derives from the
  test/judge matrix via `prepareSummary`.
  - **Surface the degrade observably (required).** When `plan.improver.degrade`,
    emit a single `console.log` line that announces the improver was degraded and
    names the missing credential — write `plan.improver.reason` verbatim into the
    line (it already carries `MISCONFIGURED_REASON_PREFIX` + the variable name,
    e.g. `"misconfigured: OPENAI_API_KEY is not set"`). Example:
    `` console.log(`improver degraded to test-only — ${plan.improver.reason}`); ``.
    This line is the only signal that distinguishes a degraded all-pass run from a
    non-degraded all-pass run (both stop at one iteration via the `mergedPass`
    break), so it MUST be present and MUST contain the missing-variable text.
    Task 7's improver-degrade case asserts on exactly this line; without it AC3.2
    is untestable. Use the existing logging idiom in this file (plain `console.log`
    as elsewhere in the pipeline); do not add a new logger or dependency.

Both branches only READ fields the seam computed; no policy branching appears at
the call site. Do not move or restructure the iteration loop, the outer `try`, or
`prepareSummary`.

Note on ordering with `maxIterations`: `maxIterations` is derived from
`selfImprovement.mode` at line 118-119, so the degrade reassignment must happen
before that line. Place the pre-flight right after `resolveSelfImprovement` (line
84) to satisfy this.

**Depends on** — Task 1.

**Traces to** — R4.1, R4.2, AC3.1, AC3.2, R7.2.

**Acceptance**

- `npm run typecheck` and `npm run lint` pass.
- A misconfigured judge aborts before any iteration runs: no run `report.json` is
  written and the process returns non-zero (verified by Task 7's judge-stop test).
- A misconfigured improver leaves the exit code to the matrix and runs no
  improvement step (verified by Task 7's improver-degrade test).
- A misconfigured improver emits exactly one `console.log` degrade line on stdout
  that contains the missing-credential text from `plan.improver.reason` (the
  `"misconfigured: <VAR> is not set"` string). This line is the observable signal
  Task 7 asserts on; if the degrade path is removed, the line disappears and that
  assertion fails.

---

## Task 6 — `testing-project` config: add the `openai-api-nano` test agent

**Goal** — Add an `openai-api` test agent to the testing-project so that an absent
`OPENAI_API_KEY` makes exactly that agent misconfigured while `haiku` keeps
running.

**Files**

- `testing-project/skillsmith.config.ts`

**Changes**

Two edits, nothing else:

1. In `agents`, add:
   `"openai-api-nano": { provider: "openai-api", model: "gpt-4.1-nano" }`.
2. Change `roles.test.agents` from `["haiku"]` to `["haiku", "openai-api-nano"]`.

Leave `opus` (judge/improver), the prompts, `selfImprovement`, and `hooks`
unchanged. The model id `gpt-4.1-nano` is free-form (config validation requires
only a non-empty model string plus a known provider) and is never reached when
`OPENAI_API_KEY` is unset.

**Depends on** — none (independent of code tasks; sequence after Task 1 to keep
the shared tree coherent).

**Traces to** — R6.2, AC5.1, AC5.2.

**Acceptance**

- `testing-project/skillsmith.config.ts` parses (`npm run typecheck` passes if it
  participates in the build; otherwise it is plain TS and must remain valid).
- `roles.test.agents` is `["haiku", "openai-api-nano"]` and the `agents` map
  contains the new `openai-api-nano` entry.

---

## Task 7 — Deterministic role-behavior unit tests (test agent, all-excluded, judge stop, improver degrade)

**Goal** — Drive each of the three role behaviors end-to-end through `run()`
against fixture projects, deterministically and with no real credentials, by
pairing a credential-scrubbed `openai-api` agent with runnable `mock` agents.

**Files**

- `src/__tests__/runnability-roles.test.ts` (new)
- `src/__tests__/fixtures/misconfigured-test-agent/skillsmith.config.ts` (new) +
  the minimal `skills`/`scenarios`/`rubrics` dirs it needs
- `src/__tests__/fixtures/misconfigured-all-test-agents/...` (new)
- `src/__tests__/fixtures/misconfigured-judge/...` (new)
- `src/__tests__/fixtures/misconfigured-improver/...` (new)

**Changes**

Follow the deterministic pattern of `src/__tests__/agent-loop.test.ts`: each test
`rmSync`es the fixture `.skillsmith` base dir, replaces `console.log` with a
capture (push each call's joined arguments into a local `string[]`, restore the
original in `finally` — see `src/__tests__/self-improvement-loop.test.ts:40-47` for
the save/restore idiom), calls `exitCode = await run({ cwd: fixtureRoot })`, then
asserts on the exit code, the captured stdout lines, and the persisted reports.
Capturing (not merely silencing) stdout is required for the improver-degrade case,
which asserts on the degrade line; the other cases may capture or silence as
convenient. Reuse the existing minimal fixture skill/scenario/rubric layout (copy
from `judge-skip-project` or `smoke-project`). In every test, save → `delete
process.env.OPENAI_API_KEY` → restore in `finally` so the `openai-api` agent is
genuinely misconfigured regardless of CI env (pattern at
`providers.test.ts:286-288`). Import `MISCONFIGURED_REASON_PREFIX` from
`../policy/runnability` to assert the reason prefix without hard-coding the literal
twice.

Fixtures and assertions:

- **Misconfigured test agent** (`misconfigured-test-agent`): two test agents — one
  `openai-api` (scrubbed key, excluded) and one `mock` (runs, PASS); judge +
  improver `mock`. Assert `exitCode === 1`; the excluded agent's
  `…/<openai-agent-id>/report.json` `review.skipped` matches
  `^misconfigured: OPENAI_API_KEY is not set`; the mock agent's row classifies as
  PASS; and the excluded agent has NO `workspace` directory.
- **All test agents misconfigured** (`misconfigured-all-test-agents`): every test
  agent `openai-api` (scrubbed). Assert `exitCode === 1` (no vacuous pass) and
  that every agent row is the misconfigured marker.
- **Misconfigured judge** (`misconfigured-judge`): judge `openai-api` (scrubbed);
  test + improver `mock`. Assert `exitCode === 1`, and that NO graded matrix was
  produced — assert the run `report.json` was not written
  (`existsSync(join(base, runId, "report.json")) === false`), distinguishing the
  judge stop from a matrix of FAILs.
- **Misconfigured improver** (`misconfigured-improver`): set the fixture
  `selfImprovement` to `{ mode: "self-improvement", maxIterations: 3 }` (any value
  `> 1`) with the improver `openai-api` (scrubbed); test + judge `mock` and PASS.
  Assert, in this order:
  1. **The degrade is surfaced (the discriminating assertion).** The captured
     stdout contains a line that starts with `MISCONFIGURED_REASON_PREFIX` /
     names `OPENAI_API_KEY` — i.e. assert at least one captured line matches
     `/misconfigured: OPENAI_API_KEY is not set/` (build the needle from the
     imported `MISCONFIGURED_REASON_PREFIX` plus `OPENAI_API_KEY`). This is the
     only signal that differs between the degraded and non-degraded worlds for an
     all-pass matrix; if Task 5's degrade path were removed this assertion fails.
  2. **No improvement step ran (the improver-ran signal is absent).** Assert
     `existsSync(join(iter1, "improvement.md")) === false`, where `iter1` is the
     `iteration-1` dir — `improvement.md` is the on-disk artifact the improver
     writes when it runs (see `src/__tests__/self-improvement-loop.test.ts:81-84`).
  3. **`maxIterations` collapsed to one as a consequence of the degrade.** Assert
     the run completed in a single iteration *despite* the fixture's
     `maxIterations: 3`: a single `iteration-1` dir and no `iteration-2`, and
     `run.json`'s `iterations` array has length 1 (read `run.json` as in
     `self-improvement-loop.test.ts:59-66`). Because the fixture set
     `maxIterations > 1`, "one iteration" is a real consequence of the test-only
     collapse at `pipeline.ts:118-119`, not the default.
  4. `exitCode === 0` — the clean test/judge matrix governs the exit; the degrade
     does not force non-zero.
  Note on discrimination: with an all-pass matrix the iteration loop also stops at
  one iteration via the `mergedPass` break (`pipeline.ts:212`), so the
  single-iteration count alone is not sufficient proof of degrade — assertion (1)
  (the surfaced degrade line) and assertion (2) (no `improvement.md`) are what make
  this case fail if Task 5's degrade logic is removed. Keep all three.

Keep fixture configs and test strings free of process/phase vocabulary; name
fixtures by behavior (e.g. `misconfigured-test-agent`).

**Depends on** — Task 1, Task 4, Task 5. (Task 2/3 not strictly required but will
already be done.)

**Traces to** — R3.3, R3.4, R4.1, R4.2, R4.4, AC2.1, AC2.2, AC2.3, AC3.1, AC3.2,
AC3.3.

**Acceptance**

- `npm test` runs all four cases and they pass deterministically with no network
  and with `OPENAI_API_KEY` scrubbed inside each test.
- The judge-stop case proves no run `report.json` exists.
- The improver-degrade case is discriminating: it asserts (a) a captured stdout
  line matching `misconfigured: OPENAI_API_KEY is not set`, (b) no
  `iteration-1/improvement.md`, and (c) a single iteration despite a fixture
  `maxIterations > 1`, with `exitCode === 0`. Removing Task 5's improver-degrade
  branch makes assertion (a) (and (c)) fail — confirm by reasoning that without the
  degrade the run would honor `mode: "self-improvement"` and `maxIterations > 1`.

---

## Task 8 — `testing-project` Playwright config: derive `projects` from `runnableTestAgentIds`

**Goal** — Make the Playwright `projects` array reflect only runnable test agents
via the public API, so a misconfigured agent gets no Playwright project and runs no
e2e spec.

**Files**

- `testing-project/playwright.config.ts`

**Changes**

In `testing-project/playwright.config.ts`:

1. Add `import { runnableTestAgentIds } from "skillsmith";` (the package barrel,
   alongside the existing `import config from "./skillsmith.config";`).
2. Replace the `projects` array
   (`config.roles.test.agents.map((agentId) => ({ name: agentId, metadata: {
   agentId } }))`, line 23-26) with:
   ```ts
   projects: runnableTestAgentIds(config, process.env).map((agentId) => ({
     name: agentId,
     metadata: { agentId },
   })),
   ```
   `config` here is the raw `SkillsmithConfigInput` (identity `defineConfig`),
   which `runnableTestAgentIds` accepts. Leave `testDir`, `testMatch`,
   `globalSetup`, `reporter`, `workers`, `fullyParallel`, and `use` unchanged.

No second filter site is needed: e2e specs self-activate by `projectName` and the
verification step only builds plugins from workspaces that exist, so a
never-scaffolded excluded agent self-excludes from verification.

**Depends on** — Task 2, Task 6.

**Traces to** — R5.2, R6.1, AC5.1, AC5.2.

**Acceptance**

- `testing-project/playwright.config.ts` type-checks/imports cleanly.
- With `OPENAI_API_KEY` unset, `runnableTestAgentIds(config, process.env)` returns
  `["haiku"]` (no `openai-api-nano` project); with it set, it returns `["haiku",
  "openai-api-nano"]`. Spot-check via
  `node --import tsx -e "import('./testing-project/playwright.config.ts')"` after
  the build, or a small inline import of the config + predicate.

---

## Task 9 — End-to-end verification of the testing-project behavior

**Goal** — Confirm, in the real testing-project, that with no OpenAI credentials a
run executes e2e only for the configured `claude-code` agent, builds/scaffolds
nothing for `openai-api-nano`, does not fail spuriously on it, and exits non-zero
with `openai-api-nano` surfaced as misconfigured.

**Files**

- none (verification task; do not write a report file — report results in the
  final message). If a fix is needed, amend the relevant task's files.

**Changes**

From the testing-project, with `OPENAI_API_KEY` (and any other OpenAI credential)
ensured unset in the invoking shell, run `npx skillsmith counter` (the `counter`
scenario). Observe and confirm:

- The Playwright report (`${iterationDir}/tests-report.json`) contains results
  keyed by `projectName` for `haiku` and NONE for `openai-api-nano`.
- No plugin is built and no `workspace` is scaffolded for `openai-api-nano`; no
  Playwright project is created for it.
- The merged `${runDirectory}/report.json` carries NO "e2e failed" failure
  attributed to `openai-api-nano`; its row is
  `{ review: { skipped: "misconfigured: OPENAI_API_KEY is not set" } }`,
  machine-distinguishable from an e2e failure (no `skipped` key on a FAIL; the
  `"misconfigured: "` prefix separates it from the `"testing failed: "` skip).
- The overall run exits NON-ZERO.

If the environment cannot run the full WordPress e2e harness here, fall back to
the deterministic equivalent: confirm via the unit suites (Tasks 3 and 7) plus a
direct check that `runnableTestAgentIds(testingProjectConfig, { /* no
OPENAI_API_KEY */ })` excludes `openai-api-nano` and includes `haiku`, and that it
includes `openai-api-nano` when `OPENAI_API_KEY` is present (AC5.2). Report which
path was used and the observed outcomes in the final message.

**Depends on** — Task 4, Task 5, Task 6, Task 8.

**Traces to** — R6.1, AC5.1, AC5.2.

**Acceptance**

- The observed run (or the documented deterministic fallback) shows: e2e for
  `haiku` only, no project/plugin/workspace for `openai-api-nano`, no e2e-failure
  attributed to `openai-api-nano`, the misconfigured/excluded surfacing in the
  merged report, and a non-zero exit. With `OPENAI_API_KEY` present,
  `openai-api-nano` is included.
- `npm run typecheck`, `npm run lint`, and `npm test` all pass on the final tree.

---

## Coverage map (requirements → tasks)

- R1 (pre-invoke misconfiguration): Task 1; tested Task 3.
- R2 (single seam, extensibility): Task 1; structural — no scattered branching.
- R3 (warn for test agent: exclude, surface, non-zero, all-excluded guard): Task
  4; tested Task 7.
- R4 (role-aware: judge stop, improver degrade): Task 5; tested Task 7.
- R5 (public API): Tasks 1, 2; consumed by Tasks 8 and the runtime via Task 4.
- R6 (e2e excludes misconfigured): Tasks 6, 8; verified Task 9.
- R7 (constraints: isolation, minimal change, sparse comments, no process
  vocabulary): honored across all tasks; reviewable in the diff.
