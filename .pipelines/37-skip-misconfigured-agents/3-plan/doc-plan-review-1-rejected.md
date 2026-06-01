# Doc Plan Review

## Verdict: rejected

## Summary

The plan is structurally strong: it independently-verifiable surfaces are all
real, traceability is clean, acceptance is framed as reader-capability, and the
plan is correctly drift-resistant (it explicitly defers exact field names,
exit-code integers, rendered strings, and env-var names to the phase-5 reading
of shipped code). I confirmed the surface inventory end-to-end against the repo:

- `README.md` is the only narrative doc; it has the Lifecycle (both), the
  `report.json` shape, the Configuration block, the Hooks table, and the
  hook examples the plan names. It has **no** existing verdict / `RUN RESULT` /
  exit-code subsection — D3 correctly indicates one may be created.
- `examples/skillsmith.config.ts` is the annotated reference config with
  per-provider credential comments and the `beforeTestAgent`/`afterAllScenarios`
  hook examples — the surface D6 targets.
- `docs/index.html` shows the illustrative `RUN RESULT: PASS` (line 96) and a
  sample matrix at marketing altitude, with no verdict enumeration or credential
  detail — matching D8's verify-only framing.
- `src/config/types.ts` carries JSDoc on `RunContext` (and the lifecycle ASCII
  diagram on `Hooks`); every hook context extends `RunContext` — supporting
  D5/D7.
- There is **no** CHANGELOG, CONTRIBUTING, nested README, or separate
  hooks/CLI/dashboard doc. `testing-project/skillsmith.config.ts` is a
  hook-focused, `claude-code`-only sample (no credential comments), correctly
  excluded as a non-annotated config. The other `*.md` files are test fixtures
  and skill/rubric content. `assets/` holds only PNG diagrams. **No surface is
  missed and none is left stale after phase 4.**

One issue blocks approval: a task hard-codes a credential env-var literal that
both violates the plan's own drift-resistance convention and is factually wrong
against the code it points the writer to. Because that task's entire purpose is
"which credential each provider uses," the error could be preserved or
reintroduced into the example config. Fixing it is a one-line correction to the
plan; everything else is approvable.

## Issues

### Issue 1 — D6 hard-codes a credential literal that is wrong and contradicts the plan's own convention

**What's wrong.** The plan asserts the Gemini credential is `GEMINI_API_KEY` in
two places: the surfaces-found overview (line 60: "`GEMINI_API_KEY`") and Task
D6's "Files to change" (the `GEMINI_API_KEY` line in the per-provider credential
list). The actual provider reads `GOOGLE_GENERATIVE_AI_API_KEY`
(`src/providers/gemini-api.ts:8,12`), and the code plan's Task 1 correctly uses
`GOOGLE_GENERATIVE_AI_API_KEY`. The existing example comment
(`examples/skillsmith.config.ts:75`, "uses GEMINI_API_KEY") is already stale
against the code — and D6 is the task meant to make the credential comments
accurate, yet it restates the wrong literal as if authoritative.

This also contradicts the plan's own stated convention in "Conventions for the
doc-writer" (lines 81-83): "Read the shipped code for ... the exact env-var
names. This plan deliberately does not fix those." D6's body breaks that rule by
naming a specific (and incorrect) env var.

**Where in plan.** Task D6 ("Files to change" — the per-provider credential
comment list naming `GEMINI_API_KEY`), and the surfaces-found overview at line
60. The drift-resistance convention it violates is at lines 81-83.

**Suggestion.** Remove the hard-coded env-var literals from D6's body (and from
the line-60 parenthetical) and instead instruct the writer to source the exact
env-var name for each env-var provider from the shipped classifier's
`CREDENTIAL_ENV_VAR` map / the provider modules (code task 1), explicitly noting
that the Gemini comment in `examples/skillsmith.config.ts:75` is currently stale
and must be corrected to match the code. Keep D6's acceptance ("understands
which credential each provider uses") — just stop the plan from pinning a
specific, wrong literal.

**Why it matters.** D6's sole purpose is making the per-provider credential
comments correct. A doc-writer who trusts the plan's literal will leave (or
re-introduce) `GEMINI_API_KEY` in the example, shipping a comment that names a
credential the harness never reads — the precise defect this task exists to
fix. It also undermines the plan's drift-resistance discipline, which is
otherwise consistently applied.
