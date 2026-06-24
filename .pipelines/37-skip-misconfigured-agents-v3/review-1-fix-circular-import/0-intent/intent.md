# Fix the testing-project circular import in v3

## Origin

Owner request (2026-06-15), during a Radical Pipelines review of pipeline `37-skip-misconfigured-agents-v3`: fix the circular import this pipeline introduced. This is the defect GitHub issue [#43](https://github.com/Automattic/skillsmith/issues/43) ("Adopt Radical Pipelines guardrails") explicitly deferred to the issue-#37 pipeline. As part of #43 the project added a `config-smoke` guardrail — `npm --prefix testing-project run check:config`, now declared in `.rp.md` — specifically to catch this class of defect, and trunk has since been merged into this branch so the guardrail is present here. This review run is the place that fix lands.

This file is self-contained; agents do not need to open the source issue.

## Goal

Running `skillsmith` against `testing-project` loads `testing-project/skillsmith.config.ts` and its full import graph cleanly — the import cycle between `skillsmith.config.ts` and `eval/utils/verify-e2e.ts` no longer breaks module initialization — so the `config-smoke` guardrail exits 0, while the skip-misconfigured-agents behavior this pipeline's base run already delivered is preserved unchanged.

## Constraints

- Do not regress the skip-misconfigured-agents feature delivered by this pipeline's base run.
- Keep the fix inside `testing-project`. Do not neutralize the problem by weakening the `config-smoke` guardrail or by changing the `@automattic/skillsmith` package's public API.

## Context

The base run (`base/`) implemented skip-misconfigured-agents and shipped through docs, but left an import cycle. Observed today, `config-smoke` aborts at `testing-project/eval/utils/verify-e2e.ts:24` with `TypeError: Cannot read properties of undefined (reading 'roles')`: `verify-e2e.ts` reads `config.roles.test.agents` at module-initialization time, but `config` (the default export of `skillsmith.config.ts`) is still `undefined` partway through the cycle. The review run is gated by the `code`/`docs` guardrails now declared in `.rp.md`, `config-smoke` among them.

## Assumptions / directions to explore (open)

- The cycle, as it stands: `skillsmith.config.ts` imports `runE2eVerification` from `eval/utils/verify-e2e.ts`, and `verify-e2e.ts` imports the default `config` back from `skillsmith.config.ts` and dereferences it at module top level. Breaking it most likely means `verify-e2e.ts` must not read `config` at import time — e.g. compute the configured project names lazily inside `runE2eVerification`, or receive them as a parameter. The spec/design phases own the final decision.
- A regression test that fails before the fix and passes after it — for instance asserting that the config module loads and `config-smoke` exits 0 — is likely warranted; the spec phase sets its exact shape and scope.
