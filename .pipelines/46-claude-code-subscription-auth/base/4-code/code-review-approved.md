# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- **Task 1:** Refactor `claude-code.ts` to `createClaudeCodeProvider(queryFn)` with a `claudeCodeEnv` env scrub.
- **Task 2:** Wire `registry.ts` to construct the provider via `createClaudeCodeProvider(query)`.
- **Task 3:** Add the offline scrub + copy-not-mutate test in `providers.test.ts`.
- **Task 4:** Verify all guardrails pass.

Code under review (diff `9541456 → HEAD`, `src/` only): `src/providers/claude-code.ts`, `src/providers/registry.ts`, `src/__tests__/providers.test.ts` (commits `ca4bd6f`, `b01a1b9`, `c2fa29a`).

## Summary

The batch faithfully implements the design and plan with no scope creep. `claude-code.ts` is refactored from the `claudeCodeProvider` singleton into a `createClaudeCodeProvider(queryFn): Provider` factory mirroring `createCodexProvider`; the entire `invoke` body — message loop, usage/cache-fold accounting, error handling, and result assembly — is carried over verbatim (byte-for-byte against the base ref), with the only behavioral delta being the injected `env: claudeCodeEnv(process.env)`. The scrub is a denylist of exactly `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, applied to a fresh spread copy (`const out = { ...env }`) so `process.env` is never mutated, satisfying the copy-not-mutate safeguard that keeps `anthropic-api` working in the same run. `registry.ts` moves the concrete `query` import in and constructs `createClaudeCodeProvider(query)`, leaving the six-key `PROVIDERS` map and all other entries unchanged. The new offline test injects a capturing fake `QueryFn`, asserts the captured `options.env` omits both pay-as-you-go keys while retaining `CLAUDE_CODE_OAUTH_TOKEN` and `PATH`, and asserts copy-not-mutate inside the `try` before the `finally` restore — exactly as the design specifies. Every public symbol added (`QueryFn`, `createClaudeCodeProvider`, plus the module-private helper and constant) carries JSDoc consistent with the file's convention. All five guardrails in this review's declared scope run and pass.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Tests | `npm test` | pass (148 pass, 2 pre-existing skips, 0 fail; new scrub test `ok 76`) |
| Config load | `npm --prefix testing-project run check:config` | pass |
| Changeset validation | `npx tsx scripts/validate-changesets.ts` | pass |
| Smoke (out of declared scope) | `npm run smoke` | environmental precondition failure — not a regression (see note) |

**Smoke note:** `npm run smoke` exits non-zero with `precondition failed — Ambiguous: multiple children contain skillsmith.config.ts (examples, testing-project)`. This is a working-directory config-discovery precondition that aborts before any provider code is constructed; the binary itself loads and parses args correctly. It is caused by the worktree-root layout (two `skillsmith.config.ts` files), is independent of the `src/` diff under review (which touches no `bin/`, config-loader, or fixture-config files), and is not in this review's declared guardrail set. It is recorded for transparency, not attributed to any task in the batch.

## Behavior verification

The user-observable behavior this change affects is which credential the spawned `claude` binary selects — which, per the design (Req 5 verification chain and the "native-binary precedence is doc-derived" risk), cannot be exercised end-to-end offline without real credentials and a real out-of-credit API account; the design defers live confirmation to credentialed real-run testing. The offline-observable proxy the design commits to is the constructed `options.env` handed to the SDK. That proxy was verified by running `npm test`: the new test `claude-code provider scrubs pay-as-you-go keys from the env passed to query` passed (`ok 76`), confirming the captured `options.env` has `ANTHROPIC_API_KEY === undefined`, `ANTHROPIC_AUTH_TOKEN === undefined`, `CLAUDE_CODE_OAUTH_TOKEN === "test-oauth-token"`, and `PATH === "/test/bin"`, and that `process.env` retained both pay-as-you-go sentinels after `invoke()` (copy-not-mutate). All 150 tests, including every pre-existing provider/registry test, pass unchanged.
