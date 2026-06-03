# Doc plan: skip misconfigured agents across a run

Documentation the shipped feature requires readers to know once it lands. This
is a PLAN, not the prose — it says **what** to write, **where** it goes, **who**
it is for, and **why** (the behavior it documents). The Why/Source trace lives
only in this plan; it must not appear in any shipped doc.

## Repo doc survey (homes to reuse)

- `README.md` — the single human-facing document. It already covers usage, the
  run lifecycle (Skill Tester + self-improvement), per-iteration reports, the
  config surface, and the WordPress reference project's e2e gate. Almost every
  doc item below is a **targeted edit to an existing README section**, not a new
  page.
- `examples/skillsmith.config.ts` — the reference config the README points to
  ("every provider … provider-specific options"). Already maps each provider to
  its credential env var inline (`openai-api` → `OPENAI_API_KEY`, etc.).
- `src/index.ts` — the package's public entry point (barrel). The new named
  exports land here; this is the source-of-truth for what "public API" means.
- `testing-project/` — the WordPress reference project. **No `README.md`** of its
  own; its behavior is documented from the main `README.md`. The harness config
  is `testing-project/skillsmith.config.ts`; the e2e wiring is
  `testing-project/playwright.config.ts`.

Constraints binding on every doc below: reflect **only shipped behavior** (no
"fail"/"skip" as if they exist); **no internal-process vocabulary** (no phase
names, no spec/design/plan, no acceptance-criteria/task tags); favor **minimal,
targeted** edits over new pages; keep prose product-facing.

---

## D1 — "Misconfigured agent" run behavior and the non-zero exit code

**What** — Add a short subsection to the README (under `### Usage`, after the
scenario-selection / "no CLI flags" paragraphs, or a new `### Misconfigured
agents` heading immediately after Usage) explaining:

- An agent is **misconfigured** when it cannot run for an environmental reason
  knowable before it is invoked — paradigmatically, a required provider
  credential is absent from the environment (e.g. `openai-api` needs
  `OPENAI_API_KEY`). State that this is detected up front, with no model call,
  purely from the agent's provider plus the environment.
- Distinguish **misconfigured** (never ran — environment problem) from a normal
  grading **failure** (ran and produced a non-passing result). They look
  different in the output.
- Under the default behavior, a misconfigured **test** agent is **excluded from
  the run**: it is not invoked, and its setup hooks (e.g. plugin scaffolding) do
  not fire — so no compute and no workspace artifacts are produced for it. The
  run proceeds with the test agents that can run.
- The exclusion is surfaced in **both** the end-of-run summary and the
  machine-readable report. In the summary it appears as a `SKIPPED` row whose
  reason reads `misconfigured: <VAR> is not set` (e.g. `misconfigured:
  OPENAI_API_KEY is not set`); in `report.json` the agent's row is
  `{ review: { skipped: "misconfigured: <VAR> is not set" } }`. Call out that the
  stable `misconfigured: ` reason prefix is what distinguishes it, by eye and by
  machine, from a normal failure (a `FAIL` has no `skipped` key) and from an
  unrelated skip (e.g. the testing-failure skip, `testing failed: …`).
- **Exit code (make this explicit for CI):** whenever one or more declared test
  agents were excluded as misconfigured, the run exits **non-zero — even if every
  test agent that actually ran passed.** A partial run never reports green, so CI
  catches it. State plainly that excluding a misconfigured agent does not quietly
  drop it: the run is not green just because the remaining rows passed.

**Where** — `README.md`, a new short subsection under `### Usage` (around the
existing lines 44-46), titled e.g. `### Misconfigured agents`.

**Who** — End-users running `skillsmith`; CI users (the exit-code paragraph is
for them specifically).

**Why/Source** — spec R1.1/R1.2 (pre-invoke, credential-based misconfiguration);
R3.1 (excluded from execution, hooks don't fire); R3.2 / design §6 (surfaced in
summary + report, distinguishable via the `misconfigured: ` prefix); **R3.3 (the
central anti-regression rule — non-zero exit on partial run, the CI-facing point)**.

---

## D2 — Role-aware handling (judge stops, improver degrades, test excluded)

**What** — Document that misconfiguration is handled differently per role,
because the README already frames the three roles (test agents, judge, improver).
State, in product terms:

- **Test agent** — excluded under the default behavior described in D1 (run
  proceeds, non-zero exit). Cross-reference D1 rather than repeating it.
- **Judge** — a misconfigured judge **stops the run** up front, before any test
  agent is invoked, with a single clear message (e.g. `judge cannot grade —
  <provider> credential <VAR> is not set`) and a non-zero exit. Nothing is
  graded; no result matrix is produced. Note this is visibly different from a
  matrix full of grading failures.
- **Improver** — a misconfigured improver **degrades the run to test-only**: the
  test agents and judge still run, but no improvement step runs. The degrade is
  announced in the output (a single line naming the missing credential). State
  the exit-code nuance explicitly: degrading does **not**, by itself, force a
  non-zero exit — the exit still derives from the test/judge result matrix, so a
  clean test-only run can legitimately exit zero. (Contrast with the test-agent
  rule in D1, where exclusion *does* force non-zero.)
- Note the degenerate case: if **all** declared test agents are misconfigured,
  the run is still a failure (non-zero), never a vacuous pass.

**Where** — `README.md`. Best as a continuation of the D1 subsection (a short
"By role" list within `### Misconfigured agents`), so all role behavior lives in
one place. The improver paragraph may also warrant a one-line note in
`## How the Self-Improvement works` (near line 90, where self-improvement mode is
introduced) saying a misconfigured improver falls back to test-only — but keep
the authoritative description in the single Misconfigured-agents subsection and
cross-reference, to avoid drift.

**Who** — End-users running `skillsmith` (all three roles); CI users (the
judge-stop and improver-degrade exit semantics).

**Why/Source** — spec R4.1 (judge stops, exits non-zero, no graded matrix) /
design §9; R4.2 (improver degrades to test-only, surfaced, exit derives from the
matrix) / design §8.3; R3.4 (all-test-agents-misconfigured is still a failure);
R4.3 (test agent follows D1).

---

## D3 — Public API: `agentRunnable` and `runnableTestAgentIds`

**What** — Document the two new named exports from the `skillsmith` package as a
public, supported API for outside consumers. For each, give the contract in prose
(this is a reference, not a tutorial):

- **`runnableTestAgentIds(config, env = process.env): string[]`** — given the raw
  config object (the value `defineConfig(...)` returns / the default export of
  `skillsmith.config.ts`) and an environment, returns the ids of the configured
  **test** agents that can run (i.e. are not misconfigured), preserving config
  order. Pure and synchronous — no async, no model call. State its primary
  consumer: the e2e harness uses it to build the Playwright `projects` array so a
  misconfigured agent gets no project (see D4).
- **`agentRunnable(config, agentId, env = process.env): boolean`** — given the
  raw config, an agent id, and an environment, returns whether that single agent
  can run. Pure and synchronous. **Document the throw-on-unknown-id contract:**
  `agentId` must name an agent declared in `config.agents`; an unknown id throws
  (it is not coerced to `false`), so a typo surfaces as an error rather than a
  silent exclusion.
- State the **runnability rule** both expose: an agent is runnable unless its
  provider has a known credential env var that is absent/empty. Spell out the
  mapping that is checkable up front — `openai-api` → `OPENAI_API_KEY`,
  `anthropic-api` → `ANTHROPIC_API_KEY`, `gemini-api` →
  `GOOGLE_GENERATIVE_AI_API_KEY` — and that providers with **no** environment
  credential gate (`claude-code`, `mock`, `codex`) are always reported runnable
  from this static view; any real misconfiguration for them still surfaces when
  the agent is invoked. (Note for `codex`: it reads `OPENAI_API_KEY` but is **not**
  pre-checked, because its CLI session auth means an absent `OPENAI_API_KEY` is
  not a reliable misconfiguration signal — so the API treats it as runnable.)
- Show a minimal usage snippet (raw config in, ids out) mirroring the e2e use.

**Where** — `README.md`, a new short subsection `### Public API` (or
`### Programmatic API`) placed after `### Configuration` / `### CLI flags`
(after line ~211), where the integrator-facing surface naturally lives. This is
the documented surface for the symbols added to `src/index.ts`. Do **not** add
narrative JSDoc beyond what the codebase already does; the README is the home for
the contract.

**Who** — Integrators consuming the public `skillsmith` package API (e.g. an e2e
harness or any external tool that needs to know which agents can run before a
run); also internal maintainers wiring the e2e harness.

**Why/Source** — spec R5.1 (named export from the public entry point; pure,
synchronous over config + env) / design §4; R5.2 (same API feeds both the runtime
exclusion and the e2e harness); R1.2/R1.3 (the provider→credential mapping and the
no-gate providers); code-plan Task 1 (`agentRunnable` throw-on-unknown-id
contract) and Task 2 (barrel exports); design §3.4 (why `codex` stays out).

---

## D4 — testing-project e2e: `openai-api-nano` agent + no-OpenAI-creds behavior

**What** — Update the README's description of the WordPress reference project so
it reflects the new e2e wiring and the second test agent:

- The reference project now declares a second test agent, `openai-api-nano`
  (`provider: openai-api`), alongside the existing `claude-code` agent (`haiku`).
  Because `openai-api-nano` needs `OPENAI_API_KEY`, running the reference project
  **without** OpenAI credentials makes exactly that agent misconfigured.
- In that no-OpenAI-creds run: the e2e specs run for the `claude-code` agent
  (`haiku`) only; **no Playwright project, no built plugin, and no workspace** are
  created for `openai-api-nano`; the run does **not** fail spuriously on
  `openai-api-nano` (there is no "e2e failed" attributed to it); and the run
  exits non-zero with `openai-api-nano` surfaced as misconfigured/excluded in the
  merged report — distinct from an e2e failure (per D1's reason-prefix rule).
- Explain *how* the exclusion reaches Playwright: the Playwright `projects` array
  is derived from `runnableTestAgentIds(config, process.env)` (D3), so the e2e
  project set and the runtime agree on which agents are runnable. With
  `OPENAI_API_KEY` present, `openai-api-nano` gets a Playwright project and joins
  the e2e set — the exclusion is conditioned on actual misconfiguration, not
  hard-coded.

**Where** — `README.md`. Two touch points, kept minimal:
1. The `### Hook examples` / `afterAllScenarios` e2e description (lines ~76-80 and
   the verification-gate section ~126-136), where the reference project's e2e run
   is already described — add that the e2e project set is now derived from the
   runnable test agents so misconfigured agents are excluded from the e2e set.
2. The D1/D2 Misconfigured-agents subsection may carry a one-line concrete
   example pointing at the reference project (`openai-api-nano` excluded when
   `OPENAI_API_KEY` is unset) to ground the abstract behavior.

   No `testing-project/README.md` exists; do **not** create one — keep the
   reference-project documentation in the main README, matching the current
   layout. If a code comment is warranted, a one-line note in
   `testing-project/playwright.config.ts` next to the `runnableTestAgentIds(...)`
   call is acceptable but optional (and must stay product-facing).

**Who** — End-users running the reference `testing-project` (especially without
OpenAI credentials); internal maintainers of the reference project.

**Why/Source** — spec R6.1 (e2e creates no Playwright project for a misconfigured
agent; `projects` derived from the runnable agents) / design §10.2; R6.2 (add the
`openai-api-nano` agent) / design §10.1; R5.2 (same API both sides);
acceptance criteria AC5.1/AC5.2 (the no-creds and with-creds behaviors) /
code-plan Tasks 6, 8, 9.

---

## D5 — Provider → credential env var reference (touch-up, not new)

**What** — Ensure the provider→credential-variable mapping is stated once,
clearly, where readers configure providers — so the misconfiguration behavior
(D1) is actionable ("set this variable to fix it"). The mapping:
`openai-api` → `OPENAI_API_KEY`, `anthropic-api` → `ANTHROPIC_API_KEY`,
`gemini-api` → `GOOGLE_GENERATIVE_AI_API_KEY`; `claude-code` uses local Claude
Code auth; `codex` uses Codex CLI session / `OPENAI_API_KEY`; `mock` needs none.

This is mostly **already present** as inline comments in
`examples/skillsmith.config.ts` (e.g. "uses OPENAI_API_KEY"). The doc work is a
small audit/touch-up:

- Verify the example file's per-provider credential comments are accurate and
  match the variable names the runnability check uses. **One correction is
  required:** the `gemini-flash` comment currently says "uses GEMINI_API_KEY",
  but the credential the check reads is **`GOOGLE_GENERATIVE_AI_API_KEY`** — fix
  the comment so the example agrees with the documented gate (otherwise a reader
  sets the wrong variable and the agent is misconfigured).
- D1 and D3 should reference these variable names; no need to duplicate a big
  table in the README if the example file is the canonical list — a one-line
  pointer ("each `*-api` provider reads its credential from an env var; see
  [`examples/skillsmith.config.ts`](./examples/skillsmith.config.ts)") suffices.

**Where** — `examples/skillsmith.config.ts` (fix the `gemini-flash` credential
comment; confirm the others). Optionally a one-line pointer from the README's
D1/D3 prose to the example file.

**Who** — End-users and integrators configuring providers (so they know which
variable to set to make an agent runnable).

**Why/Source** — spec R1.2 (the exact provider→variable mapping the static check
uses: `openai-api`/`anthropic-api`/`gemini-api`); design §3.1
(`PROVIDER_CREDENTIAL_ENV`, `gemini-api` → `GOOGLE_GENERATIVE_AI_API_KEY`); R1.3 /
design §3.4 (`claude-code`, `mock`, `codex` have no static gate). The
`GEMINI_API_KEY` vs `GOOGLE_GENERATIVE_AI_API_KEY` mismatch is a real doc bug the
feature surfaces.

---

## D6 — Extensibility note: the behavior is one of several possible policies

**What** — A brief, forward-looking note (one short paragraph, maintainer-facing)
that the misconfigured-agent handling described above is the **default and only
behavior today**, and that the decision is routed through a single extension point
so alternative behaviors can be added later as a localized change. **Do not name,
describe, or imply that "fail" / "skip" behaviors exist or are configurable** —
they are not shipped. Frame it strictly as "the handling lives behind one seam, so
future variants are a localized addition," at the level a future maintainer needs
to find the extension point — nothing user-configurable, no policy names, no
config key (there is none).

Keep it minimal: this is the only place the seam is mentioned, and it must not
read as a feature users can turn on. If it risks implying configurability, prefer
to **omit it from user docs entirely** and instead leave the seam self-documenting
in the code module's own (sparse) comment — i.e. this doc item is **optional** and
should be dropped rather than overstated.

**Where** — Either a single sentence at the end of the README's Misconfigured-
agents subsection ("This is the default handling; …") OR omitted from user docs
and left to a sparse code comment in `src/policy/runnability.ts`
(`decideRunnability`). Prefer the code-comment home if there is any doubt about
reading as user-configurable.

**Who** — Internal maintainers (future extension). Not end-users.

**Why/Source** — spec R2.1/R2.2/R2.3 (single policy seam; "warn" is the default
and only implemented behavior; "fail"/"skip" are out of scope but addable at the
seam) / design §5, §5.1; **Out of Scope** (do not document "fail"/"skip" as
existing). The "drop rather than overstate" guidance enforces the
shipped-behavior-only constraint.

---

## Summary

6 doc items (D1–D6). Five edit existing homes (README + `examples/`); none add a
new page. D6 is optional and may collapse into a code comment.

- **D1** — README `### Misconfigured agents`: misconfiguration vs failure,
  test-agent exclusion, surfacing, and the **non-zero exit for CI**. *(R1, R3.1–
  R3.3)*
- **D2** — README, same subsection: role-aware handling (judge stops, improver
  degrades to test-only, all-excluded still fails). *(R3.4, R4)*
- **D3** — README `### Public API`: `agentRunnable` / `runnableTestAgentIds`
  contract, signatures, throw-on-unknown-id, the credential mapping, e2e consumer.
  *(R5, R1.2/R1.3)*
- **D4** — README reference-project / e2e sections: `openai-api-nano` agent and
  the no-OpenAI-creds e2e behavior; `projects` derived from runnable agents.
  *(R6, AC5)*
- **D5** — `examples/skillsmith.config.ts`: provider→credential comment audit;
  fix `gemini-flash` to `GOOGLE_GENERATIVE_AI_API_KEY`. *(R1.2/R1.3)*
- **D6** *(optional)* — extensibility seam note for maintainers; drop rather than
  imply "fail"/"skip" exist. *(R2)*
