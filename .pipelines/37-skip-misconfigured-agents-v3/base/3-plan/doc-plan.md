# Documentation Plan: Skip misconfigured agents across all phases of a run

This plan covers the documentation impact of **this feature only**: a misconfigured
agent (one that cannot run for an agent-local reason knowable without invoking it —
shipped scope is a missing provider credential env var) is removed from everything
that executes, surfaced once with its id and reason, and forces a non-zero exit; the
handling is role-aware (test agent → dropped lane, judge → run stops, improver →
current iteration finishes then the loop halts); and the e2e harness no longer tests a
skipped agent.

Docs describe **only shipped behavior**. The "fail" and "skip" policies, a CLI flag to
skip named agents, and deep runtime error classification are NOT built — they MUST NOT
appear in any shipped doc. No internal-process vocabulary anywhere (no phase / spec /
plan / acceptance-criteria / task-id tags).

## Documentation surfaces this feature touches

| Surface | File | Audience | Why it changes |
|---|---|---|---|
| Usage / lifecycle / config reference | `README.md` | Skillsmith users & config authors | New exit-code contract; skip surfacing in the CLI and `report.json`; role-aware behavior; `RunContext.skipped` on the hook context; e2e harness excludes skipped agents |
| Public reference config | `examples/skillsmith.config.ts` | Config authors copying the reference | The shipped per-provider credential env gate makes the existing `gemini-api` comment wrong (`GEMINI_API_KEY` → the actual `GOOGLE_GENERATIVE_AI_API_KEY`); a one-line note that each API provider is skipped when its key is unset |
| Contributor / provider-author reference | `CONTRIBUTING.md` | Contributors & provider authors | The new public `Provider.requiredEnv?: string` field (what a provider author sets, and that credential-free providers omit it); the additive `RunContext.skipped` field and the top-level `report.json` `skipped` array as changeset-relevant public-surface additions |
| Release note | `.changeset/*.md` (new) | Consumers reading the changelog | A `minor` entry (pre-1.0) describing the consumer-visible change; `CHANGELOG.md` is generated from this and is NOT hand-edited |

The `docs/` landing page (HTML) is out of scope (it is the marketing page, explicitly
excluded from the changeset gate and not a behavior reference). Test fixtures and
`testing-project/` source are code, updated by the build, not documentation targets —
except where `README.md` describes the reference project's hook behavior (Task 4).

---

## Task D1 — Document the exit-code contract and skip surfacing in `README.md`

**Goal.** Tell a user (and a CI / autonomous consumer) what the run's exit code means
now that a configuration error is distinct from an evaluation failure, and that a
skipped agent is announced once with its id and reason and recorded in `report.json` —
visibly distinct from an agent that ran and failed.

**Audience.** Skillsmith users running the CLI; CI pipelines and autonomous tools that
branch on the process exit code and/or parse `report.json`.

**Files.** `README.md`.

**Sections-scope.**
- Add a short **exit codes** subsection under "How the Skill Tester works" → "Usage"
  (near the existing CLI usage text, before "Lifecycle"). State the three codes
  exactly as shipped:
  - `0` — every executed evaluation passed and no declared agent was skipped.
  - `1` — a surviving agent genuinely failed its evaluation (and nothing was skipped).
  - `2` — a configuration error: one or more declared agents could not run (a required
    provider credential was missing). `2` takes precedence over `1` when a run has
    both a skip and a genuine failure.
  - Note that a skipped agent NEVER lets the run exit `0`, even if every agent that
    did run passed.
- Add a brief **"When an agent can't run"** explanation (a paragraph, can live in the
  same subsection): an agent backed by an API provider whose credential env var is
  unset is detected before it is invoked, removed from the run (no work, no workspace,
  no pass/fail accounting, not re-selected in later iterations), announced **once** in
  the CLI with its **id and reason** (e.g. `OPENAI_API_KEY is not set`) in a section
  visually distinct from a failing agent, and recorded in `report.json` (Task D2
  covers the report shape).
- Touch only these additions; do not rewrite the surrounding usage/lifecycle prose.

**Depends on.** Nothing. (First README task; D2/D3/D4 extend other README sections and
can land after.)

**Traces to.** Spec R4.1–R4.4, R5.1–R5.5; design §7.1, §7.2.

**Acceptance.**
- README has a clearly-labelled place documenting exit codes `0`, `1`, and `2` with
  the meaning above and the precedence rule, and states a skipped agent forces non-zero.
- README explains, in user terms, that a missing-credential agent is detected before
  invocation, removed from the run, and announced once with id + reason, distinct from
  a genuine failure.
- No mention of any unbuilt "fail"/"skip" policy or a skip-named-agents CLI flag.
- No internal-process vocabulary. Prose matches the surrounding README register.

---

## Task D2 — Document the top-level `skipped` array in `report.json` (`README.md`)

**Goal.** Document the machine-readable surface: `report.json` gains a top-level
`skipped` array (a sibling of `scenarios`), one entry per skipped agent carrying its
id, the role(s) it fills, and the reason — distinguishable from a per-cell grading
failure, which stays inside `scenarios`.

**Audience.** Users and tools that parse `${runDirectory}/report.json`.

**Files.** `README.md`.

**Sections-scope.**
- In the run-layout / reports area (the "Lifecycle" step describing
  `${runDirectory}/report.json` as the merged matrix, and/or the "Per-iteration
  reports" section), document that `report.json` now also carries a **top-level**
  `skipped: [{ id, roles, reason }]` array alongside `scenarios`. Show the shape with
  a tiny JSON snippet, e.g.:
  ```json
  {
    "runId": "...",
    "pass": false,
    "scenarios": { },
    "skipped": [
      { "id": "gpt", "roles": ["test"], "reason": "OPENAI_API_KEY is not set" }
    ]
  }
  ```
- State that a skipped agent has **no row in the matrix** (it is not a cell), which is
  what distinguishes it from a graded failure or the existing per-cell `SKIPPED`
  marker; an empty/absent `skipped` (or no skips) reads exactly as today.
- Do not alter the existing per-agent `review`/`testing` report examples.

**Depends on.** Task D1 (the skip concept is introduced there; this documents its
machine-readable form). Same file — sequence after D1.

**Traces to.** Spec R4.3, R4.4; design §4.3, §4.4, §7.3.

**Acceptance.**
- README documents `report.json`'s top-level `skipped` array with the
  `{ id, roles, reason }` shape and a snippet, as a sibling of `scenarios`.
- README states the skipped agent is not a matrix cell and is distinguishable from a
  graded failure, and that a run with no skips is unchanged.
- No internal-process vocabulary.

---

## Task D3 — Document role-aware skip behavior in `README.md`

**Goal.** Document how a missing-credential agent is handled per role: a **test** agent
is dropped (run continues over the survivors); a **judge** stops the run up front
(clear single message naming the judge and reason, exit `2`, no graded matrix and no
`report.json`); an **improver** lets the current iteration finish (a complete, valid
matrix) then halts the loop with no further iterations and no skill edits, exit `2`.
A single id filling more than one role is handled by the most-severe consequence
(a misconfigured judge stops the run regardless of its other roles).

**Audience.** Users configuring `roles.test` / `roles.judge` / `roles.improver`,
especially self-improvement-mode users.

**Files.** `README.md`.

**Sections-scope.**
- Extend the per-role / config narrative. The test-agent case is the user's default
  mental model (covered by D1's "removed from the run" prose — reference it, don't
  duplicate). Add the **judge** and **improver** cases:
  - In or near "How the Self-Improvement works" (which already explains the improver
    and `afterAllScenarios`), add that a misconfigured **improver** finishes the
    current iteration (the matrix and verdict still stand), then the loop halts with no
    further iterations and no skill edits — surfaced with id + reason, exit `2`.
  - In the judge area (the "Rubrics and the judge" section explains the judge; the
    lifecycle references `config.roles.judge`), add that a misconfigured **judge**
    stops the run up front with a single clear message naming the judge and the reason,
    exit `2`, and produces no graded matrix and no `report.json`.
  - One sentence on multi-role: when one id fills several roles, the most-severe
    consequence applies (judge stops the run regardless of the id's other roles).
- Keep additions tight; do not restructure the self-improvement or judge sections.

**Depends on.** Task D1 (introduces the skip concept and exit `2`). Same file —
sequence after D1; independent of D2.

**Traces to.** Spec R6.1–R6.4; design §6.1, §6.2, §3.3.

**Acceptance.**
- README documents the judge-stops-the-run behavior (single message, exit `2`, no
  matrix / no report) and the improver-finishes-then-halts behavior (valid matrix
  stands, no further iterations, no edits, exit `2`).
- README states that for an id in multiple roles the most-severe consequence applies.
- No mention of unbuilt policies. No internal-process vocabulary.

---

## Task D4 — Document `RunContext.skipped` and the e2e exclusion for hook authors (`README.md`)

**Goal.** Tell hook authors that the run exposes the skipped set as passive data on the
hook context — `RunContext.skipped` (readable from `beforeAll` onward) — keyed by agent
id with the role(s) each fills and the reason; and show how the reference project's
`afterAllScenarios` uses it to exclude skipped agents from the Playwright e2e run
(no project, no plugin, no spec for a skipped agent).

**Audience.** Hook authors writing project hooks (especially `afterAllScenarios` /
provisioning hooks); maintainers of the reference WordPress project's e2e harness.

**Files.** `README.md`.

**Sections-scope.**
- In the hooks documentation (the "Hooks" table and/or the hook-context description in
  "How the Skill Tester works"), document the new readonly `RunContext.skipped` field:
  shape `ReadonlyArray<{ id, roles, reason }>`, present on every hook context from
  `beforeAll` onward, no new mandatory callback (hooks that don't need it ignore it).
  Note it carries the same data as `report.json`'s `skipped` array.
- In the `afterAllScenarios` / e2e example prose (the "`afterTestAgent` — scaffold…"
  and "`afterAllScenarios` — run e2e…" examples, and the verification-gate section),
  add that the reference project reads `ctx.skipped`, derives the runnable test-agent
  ids, and runs Playwright only against those — so a skipped agent gets no Playwright
  project, no plugin build, and no spec, and the report attributes no e2e failure to
  it. Keep it to the behavior; do not paste the implementation.
- Do not document any standalone Playwright runnability predicate as a required path —
  the in-run exclusion is via the runnable-id forwarding only (mention the standalone
  use only if a one-liner clarifies, but it is optional and not the mechanism).

**Depends on.** Task D1 (skip concept). Same file — sequence after D1; independent of
D2/D3. Logically last of the README tasks since it touches the most existing sections.

**Traces to.** Spec R10.1, R10.2, R10.5, AC9, AC10; design §4.2, §10.1, §10.2.

**Acceptance.**
- README documents `RunContext.skipped` (shape, readable from `beforeAll`, optional to
  consume, same data as the report) on the hook context.
- README explains that the reference project's `afterAllScenarios` excludes skipped
  agents from the Playwright run (no project / plugin / spec) using `ctx.skipped`.
- No internal-process vocabulary; matches the existing hooks-doc register.

---

## Task D5 — Document `Provider.requiredEnv` for provider authors and correct the example config

**Goal.** Tell a provider author (and any consumer reading the reference config) about
the new public `Provider.requiredEnv?: string` field: an API provider sets it to the
name of the environment variable its credential requires, so the harness can detect a
missing credential before invoking the provider; a provider with no env-readable
credential gate omits it. Correct the one stale env-var name in the reference config
that the shipped behavior now contradicts.

**Audience.** Provider authors / contributors; config authors copying
`examples/skillsmith.config.ts`.

**Files.** `CONTRIBUTING.md`, `examples/skillsmith.config.ts`.

**Sections-scope.**
- `CONTRIBUTING.md`: in the "Adding a changeset" → "When a changeset is required"
  provider-support context (and/or wherever provider support is described), add a brief
  note that a provider exported from the public surface MAY carry an optional readonly
  `requiredEnv` naming the environment variable its credential needs; the shipped
  providers set it as `openai-api → OPENAI_API_KEY`, `anthropic-api → ANTHROPIC_API_KEY`,
  `gemini-api → GOOGLE_GENERATIVE_AI_API_KEY`, and credential-free providers
  (`claude-code`, `mock`, `codex`) omit it. State that adding or changing `requiredEnv`,
  the additive `RunContext.skipped` field, and the new top-level `report.json` `skipped`
  array are all consumer-visible additive changes — each a `minor` bump (pre-1.0). Keep
  this inside the existing provider/report/hook-contract guidance; do not restructure
  the changeset tables.
- `examples/skillsmith.config.ts`: fix the `gemini-api` comment (currently
  `"Google Gemini via the public API (uses GEMINI_API_KEY)."`) to name the actual env
  var the provider reads and that `requiredEnv` declares — `GOOGLE_GENERATIVE_AI_API_KEY`.
  Optionally add a one-line note on the API-provider entries that the agent is skipped
  (not failed) when its credential env var is unset. Do not change config behavior or
  add fields the config doesn't support.

**Depends on.** Nothing in this plan (different files from D1–D4). Can run in parallel
with the README tasks; sequence anywhere.

**Traces to.** Spec R2.2, R2.3; design §4.1; CONTRIBUTING provider-support / changeset
policy.

**Acceptance.**
- `CONTRIBUTING.md` documents `Provider.requiredEnv?: string` (what an author sets,
  the three shipped values, that credential-free providers omit it) and that the
  `requiredEnv` / `RunContext.skipped` / `report.json` `skipped` additions are `minor`
  changeset-relevant changes.
- `examples/skillsmith.config.ts` no longer names `GEMINI_API_KEY`; it names
  `GOOGLE_GENERATIVE_AI_API_KEY`, matching the shipped provider.
- No `requiredEnv` value is invented beyond the three shipped ones; no unbuilt policy
  is described. No internal-process vocabulary.

---

## Task D6 — Add the release changeset

**Goal.** Record the consumer-visible change as a `minor` (pre-1.0) changeset so the
release automation appends it to `CHANGELOG.md`. `CHANGELOG.md` itself is generated and
is NOT hand-edited.

**Audience.** Consumers reading the changelog / release notes.

**Files.** `.changeset/<short-name>.md` (new).

**Sections-scope.**
- One changeset file, front-matter `"@automattic/skillsmith": minor`, body in
  imperative present (no conventional-commits prefix, no PR/author reference). Summarize
  the consumer-visible surface in their terms: a misconfigured agent (missing provider
  credential) is now skipped — removed from the run, surfaced once with its id and
  reason, recorded in `report.json`'s new top-level `skipped` array, and the run exits
  `2` for a configuration error (distinct from `1` for an evaluation failure, `0` for a
  clean pass); the public `Provider.requiredEnv` field and the additive
  `RunContext.skipped` hook-context field are the new surface. Follow the summary
  conventions in `CONTRIBUTING.md#summary-format-conventions`.
- Do not prepend `BREAKING:` — this is purely additive (no removed/renamed/changed
  field), so it is a plain `minor`.

**Depends on.** Conceptually after D1–D5 (so the summary reflects the documented
surface), but the file is independent. Sequence last.

**Traces to.** CONTRIBUTING changeset policy (additive new `report.json` field, new
public field on a hook-context struct, new public provider field → `minor`); design
§4.1, §4.2, §4.3.

**Acceptance.**
- A new `.changeset/*.md` exists with `"@automattic/skillsmith": minor` and a non-empty
  imperative-present body describing the skip behavior, the exit codes, and the new
  public fields in consumer terms.
- The body carries no conventional-commits prefix, no PR/author reference, and no
  `BREAKING:` prefix (the change is additive).
- No internal-process vocabulary; no unbuilt policy mentioned.

---

## Dependency summary

```
D1 (README: exit codes + skip surfacing)
   ├─> D2 (README: report.json skipped array)
   ├─> D3 (README: role-aware behavior)
   └─> D4 (README: RunContext.skipped + e2e exclusion)
D5 (CONTRIBUTING: Provider.requiredEnv + examples gemini fix)   [independent]
D6 (changeset)                                                  [sequence last]
```

D2, D3, D4 all extend `README.md` after D1 introduces the skip concept; keep them in
that order so each builds on a coherent README. D5 touches different files and can land
any time. D6 is the release entry — sequence it last so its summary reflects the
documented surface.

## Cross-cutting checks (every task)

- Docs describe ONLY shipped behavior. No "fail"/"skip" policy, no skip-named-agents
  CLI flag, no deep runtime error classifier.
- No internal-process vocabulary anywhere: no phase names, no spec/design/plan
  references, no acceptance-criteria or task-id tags.
- Each addition matches the register and density of the surrounding doc; do not rewrite
  unrelated prose or restructure sections.
- Exit codes are stated consistently across every doc that mentions them: `0` clean,
  `1` an evaluation failure, `2` a configuration error (precedence to `2`).
- The credential env-var names are stated consistently and match the shipped providers:
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.
