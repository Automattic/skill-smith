# Code Summary: claude-code provider authenticates via the Claude Code subscription

## What

The `claude-code` provider now hands the Claude Code SDK a copy of the user's environment with exactly the two pay-as-you-go credential variables — `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` — removed, so the underlying `claude` binary authenticates via the Claude Code subscription instead of silently billing a stray API key. Realized across three `src/` files:

- `src/providers/claude-code.ts` — replaced the `claudeCodeProvider` singleton with a `createClaudeCodeProvider(queryFn): Provider` factory; added the exported `QueryFn` injection-seam type, the module-private `claudeCodeEnv` scrub helper, and the `CLAUDE_CODE_SCRUBBED_ENV_KEYS` constant; injected `env: claudeCodeEnv(process.env)` into the SDK `query()` options. The rest of `invoke` is carried over verbatim.
- `src/providers/registry.ts` — moved the concrete `query` import in from `claude-code.ts` and built the provider via `const claudeCodeProvider = createClaudeCodeProvider(query)`, mirroring the existing `createCodexProvider(Codex)` wiring. The `PROVIDERS` map shape and all other entries are unchanged.
- `src/__tests__/providers.test.ts` — added one offline, deterministic, credential-free test plus a capturing fake `QueryFn` helper, mirroring the existing codex env test. No existing test changed.

## Why

The provider is meant to run agents through the user's subscription login, but it handed the SDK the full inherited environment, and the `claude` binary selects a credential by env precedence. When a pay-as-you-go credential was exported (commonly because the user also runs the separate `anthropic-api` provider), the binary preferred it over the subscription — billing or blocking against the pay-as-you-go account, and failing every run with a credit-balance error when that account was out of credit despite a working subscription. Removing exactly the two offending keys from the child env makes credential selection fall through to the subscription (`CLAUDE_CODE_OAUTH_TOKEN` if set, else interactive `/login`).

## How

The scrub is a **denylist** (remove two keys), not an allowlist, because the SDK forwards `options.env` to the spawned process wholesale and the opaque native binary reads a broad, unenumerable swath of environment (Keychain access via `HOME`, ~30 `CLAUDE_CODE_*` knobs, locale, proxy, TLS); enumerating an allowlist would be fragile and re-audited on every SDK bump. The helper builds a fresh spread copy (`const out = { ...env }`) and deletes the two keys from the copy, so `process.env` is never mutated — the single property that keeps the change scoped to the `claude-code` child and leaves `ANTHROPIC_API_KEY` intact for `anthropic-api` in the same run. The singleton-to-factory refactor exists to make the scrub observable offline: a test injects a fake `query` and asserts on the env it receives. The new test sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and `PATH` to sentinels, invokes the provider with the capturing fake, asserts copy-not-mutate (`process.env` sentinels survive) inside the `try` before the `finally` restore, then asserts the captured `options.env` omits the two keys and retains the subscription token and `PATH`. Guardrails in scope (`typecheck`, `lint`, `test`, `check:config`, changeset validation) all pass; the full suite is 148 pass / 2 pre-existing skips / 0 fail.

## Key decisions

- **Denylist of exactly two keys over an allowlist.** Preserves the SDK's "give me the real environment" contract while guaranteeing the subscription is selected; the allowlist pattern is reserved for codex, whose SDK env needs are narrow and whose binary is different.
- **`QueryFn` narrows the SDK `query` return to `AsyncIterable<SDKMessage>`.** The real `query` remains assignable (covariant return), so production wiring compiles, while a test fake can be a one-line `async function*` rather than a full `Query` with ~12 streaming control methods.
- **`invoke` body preserved verbatim.** The only behavioral delta is the injected `env`, delivering the no-regression guarantee for the already-correct case and keeping the failure-surfacing path unchanged.

## Known limitations

- **End-to-end out-of-credit behavior (Req 5) is verified only at the precondition level offline.** The offline test confirms the two keys are absent from the env handed to the SDK; confirming the binary actually authenticates against the subscription and bills nothing to the API account requires real credentials and a real out-of-credit account. Per the design's "native-binary precedence is doc-derived" risk, the guarantee rests on Anthropic's documented authentication precedence, and live confirmation is deferred to credentialed real-run / integration testing.
- **The changeset is docs-phase work.** This user-facing bugfix is release-relevant and requires a committed `.changeset/*.md` (a `patch`, recorded pre-1.0 as `minor` with a `BREAKING:`-free summary), but the code plan intentionally excludes it from the code phase and flags it for the docs phase to author. No claude-code changeset exists in this batch; the changeset validator passes against the current state.
