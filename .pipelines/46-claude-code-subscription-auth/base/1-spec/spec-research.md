# Spec Research

## Rough Idea

> Source: GitHub issue [#46](https://github.com/Automattic/skillsmith/issues/46).

**Goal:** When a user runs the `claude-code` provider, it authenticates through their Claude Code subscription login and does not rely on `ANTHROPIC_API_KEY`. A user who simply has the key exported in their environment (for the `anthropic-api` provider, or otherwise) is not silently billed against — or blocked by — their pay-as-you-go API account.

**Constraints:**

- The `anthropic-api` provider must keep using `ANTHROPIC_API_KEY` as it does today; this change is scoped to the `claude-code` provider's auth behavior.

**Context:**

- Today, when the API account tied to an exported `ANTHROPIC_API_KEY` is out of credit, every `claude-code` agent fails with: `Claude Code returned an error result: Credit balance is too low`.
- The `claude-code` provider runs through `@anthropic-ai/claude-agent-sdk`'s `query()` (`src/providers/claude-code.ts`) and does not read the key directly; `anthropic-api` explicitly reads `ANTHROPIC_API_KEY` (`src/providers/anthropic-api.ts`).

**Assumptions / directions to explore:**

- The billing surprise is believed to come from the Claude Agent SDK preferring `ANTHROPIC_API_KEY` (pay-as-you-go) over the subscription login whenever the key is present in the environment.

## Q&A

### Q1: How does `@anthropic-ai/claude-agent-sdk`'s `query()` decide between `ANTHROPIC_API_KEY` (pay-as-you-go) and the Claude Code subscription login, and what mechanism (env var, query option, etc.) can force it to use the subscription login even when `ANTHROPIC_API_KEY` is exported?

**A:** Confirmed — when `ANTHROPIC_API_KEY` is present in the environment, Claude Code prefers it over the subscription login. The intent's core assumption is correct. The concrete lever: pass an explicit `env` option to `query()` that excludes `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`). The SDK spawns the bundled `claude` binary with `{...options.env ?? process.env}`, so handing it a copy of `process.env` with those keys deleted means the binary never sees the key and falls through to the subscription OAuth credentials from `/login`. No process-wide `unset` is needed, so the `anthropic-api` provider keeps its key.

**Reasoning:**
- **Documented precedence order** (Anthropic auth docs): (1) cloud provider creds (Bedrock/Vertex/Foundry), (2) `ANTHROPIC_AUTH_TOKEN`, (3) `ANTHROPIC_API_KEY`, (4) `apiKeyHelper`, (5) `CLAUDE_CODE_OAUTH_TOKEN`, (6) subscription OAuth from `/login`. So `ANTHROPIC_API_KEY` (3) beats both the OAuth token (5) and the `/login` subscription (6).
- **The "approve once" prompt does NOT protect SDK use:** docs state that in non-interactive mode (`-p`), the key is always used when present — no approve/decline gate. The SDK's `query()` drives the CLI non-interactively, so a present key is always used. This is exactly the silent-billing path in the intent.
- **SDK forwards the key verbatim but lets us override it:** `sdk.mjs` builds the child env as `{...options.env ?? process.env}` with no scrubbing of `ANTHROPIC_API_KEY`. The `options.env` field (documented in `sdk.d.ts:1240-1253`) lets the provider supply its own env map. Real precedence logic lives in the compiled native `claude` binary (not human-readable), but per docs it only consults what's in the env it's handed.
- **The key is currently inherited:** `claude-code.ts:24-34` calls `query()` with NO `env` option, so the child inherits the full `process.env` including any exported `ANTHROPIC_API_KEY`. That is the bug's mechanism.

**Candidate levers / trade-offs:**
- **Best fit — scrub the key in `options.env`:** build `env` from `process.env` minus `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`, which outranks the key at level 2), pass to `query()`. Scoped to `claude-code` only; `anthropic-api` (reads `process.env.ANTHROPIC_API_KEY` directly) is untouched. **Caveat:** passing `options.env` replaces the default `process.env` entirely, so you must spread the rest of `process.env` (PATH, HOME, etc.) and only delete the auth keys.
- **Set `CLAUDE_CODE_OAUTH_TOKEN` (level 5):** enables headless/CI subscription auth without a browser, but still LOSES to a present `ANTHROPIC_API_KEY` (3) / `ANTHROPIC_AUTH_TOKEN` (2) — does NOT fix the bug on its own. Complementary at best.
- **Process-wide `unset ANTHROPIC_API_KEY`:** would break the `anthropic-api` provider in the same run — violates the intent constraint. Rejected.

**Not yet verified:** byte-level precedence inside the native `claude` binary (compiled, unreadable). Order taken from official docs (treated as authoritative). No live experiment yet confirming auth selection via `system/init`'s `apiKeySource` field (`'user' | 'project' | 'org' | 'temporary' | 'oauth'`, `sdk.d.ts:116, 3532`); researcher offered to run one.

**Sources:** `src/providers/claude-code.ts:24-34`; `src/providers/anthropic-api.ts:5-16`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:116, 1240-1253, 3532`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (spawn env `{...$.env ?? process.env}`); SDK version 0.2.141, bundled CLI 2.1.141; Anthropic docs "Authentication → Authentication precedence" https://code.claude.com/docs/en/authentication; `.env.example`.

### Q2: After the fix scrubs `ANTHROPIC_API_KEY` from the `claude-code` child env, what should the observable behavior be when the user has NO usable subscription credential available (not logged in via `/login`, no `CLAUDE_CODE_OAUTH_TOKEN`)? Today the exported key is the silent fallback; once scrubbed, that fallback disappears. Does the `claude-code` provider then surface a clear auth error (and what does the user currently see in that situation)? Is there any existing error-handling or auth-precheck pattern in the providers/harness this should match?

**A:**
- **(a) No-credential behavior:** the run does NOT hang silently — it fails, and the harness records a failure. But whether the user sees a *clear, distinguishable* "not authenticated / run /login" message vs. an opaque generic string is the weak spot. The failure surfaces through one of two channels the provider already handles: (1) the stream throws → caught at `claude-code.ts:66-68`, yielding a process-exit message like `Claude Code process exited with code ...`; or (2) a `result` message with an error subtype → mapped to the opaque string `result.${subtype}` at `claude-code.ts:42-44`. The SDK's `SDKResultError` subtypes are only `error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries` — **no auth-specific subtype** — so an auth failure arriving this way reads as the generic `result.error_during_execution`. Richer detail (`SDKResultError.errors: string[]`, `SDKResultSuccess.api_error_status`) exists in the SDK but is NOT read by the current provider. The exact runtime surface (thrown vs. result, and the binary's message text) comes from the compiled native `claude` binary and was not empirically confirmed. Note: the intent's quoted `Claude Code returned an error result: Credit balance is too low` is NOT produced by current `src/` code; treat it as illustrative/paraphrased, not literal current output.
- **(b) Error-surfacing convention exists:** `InvokeResult.error?: string` is a free-form human-readable string; when set, the harness marks the run failed and embeds the string verbatim in operator output (`testing-agent.ts:86,95`; `agent-loop.ts:191,209,221` → `testing failed: ${error}`; `judge-agent.ts:69-72`; `pipeline.ts:306-307,360`). So the display *plumbing* for a clear auth error already exists; what's missing is that `claude-code` currently puts a low-information string there. "Surface a clear auth error" is therefore **partially covered** (channel exists) but **not fully covered** (no auth-specific string today).
- **(c) Precheck pattern fit:** all three Vercel-backed providers use an upfront env guard returning a clear `error` and skipping the SDK call (`anthropic-api.ts:8-14` "ANTHROPIC_API_KEY is not set"; `openai-api.ts`, `gemini-api.ts` analogous), each with a dedicated test (`vercel-providers.test.ts:67-94`). **But this pattern does NOT cleanly fit `claude-code`:** its subscription credential is not an env var the provider can cheaply read — it lives in the macOS Keychain / `~/.claude/.credentials.json`, with no clean public SDK API to ask "is a usable subscription credential present?" before invoking. Checking only `CLAUDE_CODE_OAUTH_TOKEN` would false-negative for the common interactive (`/login`) user. Researcher's read: a true upfront precheck is not a clean fit; the more robust path is to let the SDK attempt auth and ensure the failure surfaces as a clear `error` string — but that's a design call.

**Reasoning:** the harness faithfully renders whatever string the provider sets in `error`, so legibility is entirely a function of what `claude-code` chooses to put there. No auth-specific SDK subtype exists, so distinguishing "auth failure" from other failures requires extra work (reading `errors`/`api_error_status` or pattern-matching) that is not present today.

**Not yet verified:** whether a missing-subscription failure arrives via throw vs. result, and the exact text the native binary emits. Researcher offered to simulate "no auth" (throwaway `CLAUDE_CONFIG_DIR` with no creds + scrubbed key) and report the exact subtype/text if a requirement hinges on it.

**Sources:** `src/providers/claude-code.ts:42-44,66-68`; `src/providers/types.ts:43-48`; `src/pipeline/testing-agent.ts:86,95`; `src/pipeline/agent-loop.ts:191,209,221`; `src/pipeline/judge-agent.ts:69-72`; `src/pipeline/pipeline.ts:306-307,360`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3292-3310, 3313-3338`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`; `src/providers/anthropic-api.ts:8-14`, `openai-api.ts:8-14`, `gemini-api.ts:8-14`; `src/__tests__/vercel-providers.test.ts:67-94`; Anthropic auth docs https://code.claude.com/docs/en/authentication.

## Research

### Existing precedent: child-process env control in providers

(spec-analyst direct review of source, to inform later questions)

- **`InvokeResult` shape** (`src/providers/types.ts:43-48`): `{ finalText, toolUseCount, error?, usage? }`. `error` is an optional human-readable string — the established convention for a provider to surface a failure to the harness.
- **`anthropic-api` precheck** (`src/providers/anthropic-api.ts:8-14`): returns `{ finalText: "", toolUseCount: 0, error: "ANTHROPIC_API_KEY is not set" }` when the key is missing — an upfront, proactive auth guard.
- **`codex` provider already filters the child env** (`src/providers/codex.ts:64-66, 172-184`): it constructs the Codex SDK with `env: codexEnv(process.env)`, where `codexEnv()` builds the child env from an **allowlist** — `CODEX_ENV_KEYS = ["PATH","HOME","SHELL","USER","LOGNAME","TMPDIR"]` plus prefix `CODEX_`. Any key not on the allowlist (including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) is dropped from the child. This is a direct, in-repo precedent for controlling exactly which env vars a spawned coding-agent process sees. (Note: codex uses an allowlist; the `claude-code` SDK needs a broad env — PATH/HOME/etc. — so a denylist that removes only the auth keys, or an allowlist broad enough for the SDK, is a design-phase choice.)
- **`.env` loading** (`.env.example`): "Skillsmith loads `.env` from the directory you invoke it from. Shell env vars take precedence over `.env`." So `ANTHROPIC_API_KEY` can enter `process.env` either from the shell or from a loaded `.env` — the fix must cover the value as it appears in `process.env` regardless of origin.

### Test seam for the scrub (spec-analyst direct review)

- **`claude-code` is currently a singleton, not injectable.** `claude-code.ts` does `import { query } from "@anthropic-ai/claude-agent-sdk"` at module top and exports `claudeCodeProvider` as a plain object that calls `query()` directly. The `codex` provider, by contrast, is a **factory** — `createCodexProvider(CodexCtor)` (`codex.ts:46`) — so tests can inject a fake and capture the options. To get a credential-free, observable test of the scrub, the `claude-code` provider likely needs an analogous injectable seam for `query` (mirroring `CodexCtor`).
- **Exact precedent test already exists:** `src/__tests__/providers.test.ts:324-355` ("codex provider passes only allowlisted env to constructor") sets fake env vars (incl. a secret `SKILLSMITH_SECRET` and `OPENAI_API_KEY`), injects a fake `CodexCtor` that captures `codexOpts`, and asserts `captured.codexOpts?.env?.OPENAI_API_KEY === undefined` and `...SKILLSMITH_SECRET === undefined`. This is the directly reusable template for asserting `ANTHROPIC_API_KEY` is absent from the env handed to `claude-code`'s `query()` — no real login or network required, given an injectable `query`.

### Q3: Exact env keys to scrub, and testability

**A:**
- **(a) Scrub set.** Removing `ANTHROPIC_API_KEY` alone fixes the intent's *reported* case but is NOT strictly sufficient to *guarantee* subscription auth, because `ANTHROPIC_AUTH_TOKEN` outranks it (precedence level 2 vs 3) and also overrides the subscription.
  - **Tier 1 — must scrub:** `ANTHROPIC_API_KEY` (the intent's target; docs: "used instead of your ... subscription even if you are logged in"; realistically set per `.env.example`) and `ANTHROPIC_AUTH_TOKEN` (level 2, outranks the key; small justified addition that turns "fixes the reported case" into "guarantees subscription"; no realistic downside in this harness).
  - **Tier 2 — out of scope (cloud switches, level 1):** `CLAUDE_CODE_USE_BEDROCK` / `_USE_VERTEX` / `_USE_FOUNDRY`. If a user deliberately configured a cloud backend, `claude-code` was never going to use a Claude.ai subscription for them; scrubbing these would silently change their intended backend. Realistically not set in the common Skillsmith case. **Do NOT scrub** unless the spec explicitly says "force first-party subscription regardless of cloud config." Noted as a stated assumption.
  - **Tier 3 — do NOT scrub:** `ANTHROPIC_BASE_URL` / `*_BASE_URL` redirect the *endpoint* (proxy/gateway), not which *credential* is selected; subscription OAuth can legitimately run through a proxy. Other cloud auth vars (`ANTHROPIC_FOUNDRY_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_AWS_API_KEY`) only matter when a `CLAUDE_CODE_USE_*` switch is on — covered by Tier 2; scrubbing standalone is speculative.
  - **Must PRESERVE:** `CLAUDE_CODE_OAUTH_TOKEN` (level 5) — a *legitimate* subscription credential (long-lived token from `claude setup-token`) that a CI/headless user may rely on; removing it would break the very audience the fix helps. Also preserve everything else in `process.env` (PATH, HOME, etc.) — the SDK passes `{...options.env ?? process.env}` wholesale, so when supplying `options.env` you must spread the rest of `process.env` and delete only the Tier-1 keys.
  - **Recommended minimal, defensible scrub set: `{ ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN }`** — delete from a copy of `process.env`, preserve everything else (including `CLAUDE_CODE_OAUTH_TOKEN`).
- **(b) Credential-free test seam.** Yes — clean, established, no login or network needed. Blocker today: `claude-code.ts:1` imports `query` as a static top-level binding and exports a module-level const, so there is no injection seam (unlike `codex.ts`). The fix-shaped seam: mirror `codex.ts` — refactor to a `createClaudeCodeProvider(queryFn)` factory, wire the real `query` in `registry.ts`, and let a test pass a fake `query` that records `options.env` and yields a canned stream. Near-exact precedent assertion: `providers.test.ts:324-356` ("codex provider passes only allowlisted env to constructor"). The `claude-code` scrub test is the same shape: set `process.env.ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, a preserved `CLAUDE_CODE_OAUTH_TOKEN`, and `PATH`; invoke with a capturing fake `query`; assert the captured `options.env` has `ANTHROPIC_API_KEY === undefined` and `ANTHROPIC_AUTH_TOKEN === undefined`, AND `CLAUDE_CODE_OAUTH_TOKEN`/`PATH` still present. Fully observable, deterministic, offline, credential-free — it asserts on the env object handed to the SDK without reaching the real binary. Note: a testable success criterion effectively *requires* (or strongly motivates) the factory-injection seam, since the codebase avoids module mocking and uses DI/fakes; the test asserts on `options.env` (documented field `sdk.d.ts:1240-1253`) and does NOT need to verify the binary's behavior — Q1's docs already establish that a scrubbed env yields subscription auth.

**Reasoning:** precedence order from Q1 (level 2 `ANTHROPIC_AUTH_TOKEN` > level 3 `ANTHROPIC_API_KEY` > level 5 `CLAUDE_CODE_OAUTH_TOKEN` > level 6 `/login`); per-var effects from the env-vars docs distinguish credential-selecting vars (scrub) from endpoint-redirecting vars (leave) and legitimate subscription credentials (preserve). The test seam reasoning follows the existing codex DI precedent.

**Sources:** Anthropic auth docs https://code.claude.com/docs/en/authentication; Anthropic env-vars docs https://code.claude.com/docs/en/env-vars; `src/providers/claude-code.ts:1,15`; `src/providers/codex.ts:46`; `src/providers/registry.ts:10`; `src/__tests__/providers.test.ts:51-73, 105, 324-356`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1240-1253`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`; `.env.example`.

## Consolidated Requirements

Each requirement is phrased as an observable outcome of the running `claude-code` provider.

1. **The `claude-code` provider does not authenticate via `ANTHROPIC_API_KEY`.** When a user runs the `claude-code` provider with `ANTHROPIC_API_KEY` exported in their environment, the provider's underlying Claude Code process does not receive that key and therefore does not authenticate against the pay-as-you-go API account; it falls through to the user's Claude Code subscription credentials.

2. **The `claude-code` provider does not authenticate via `ANTHROPIC_AUTH_TOKEN` either.** When `ANTHROPIC_AUTH_TOKEN` is exported, the provider's underlying process does not receive it, so this higher-precedence token cannot override the subscription. (Removing only `ANTHROPIC_API_KEY` would leave this override path open; both must be excluded to guarantee subscription auth.)

3. **A legitimate subscription credential is preserved.** When the user has set `CLAUDE_CODE_OAUTH_TOKEN` (the long-lived subscription token), the provider's underlying process still receives it, so a CI/headless user who relies on that token continues to authenticate via their subscription. The fix only removes the pay-as-you-go credentials (Requirements 1–2), never legitimate subscription ones.

4. **The rest of the environment is intact.** The Claude Code process still receives the remainder of the user's environment (e.g. `PATH`, `HOME`, and other non-auth variables) and runs normally; the change removes only the specific pay-as-you-go auth variables, not the whole environment.

5. **Out-of-credit no longer blocks `claude-code` runs caused by a stray key.** When the API account tied to an exported `ANTHROPIC_API_KEY` is out of credit, `claude-code` agents no longer fail with the credit-balance error solely because that key was present in the environment; the run proceeds on the subscription instead. (Pre-fix, the exported key was used and the run failed.)

6. **The `anthropic-api` provider is unchanged.** In the same process/run, the `anthropic-api` provider continues to read and use `ANTHROPIC_API_KEY` exactly as it does today (including its existing "ANTHROPIC_API_KEY is not set" guard). The `claude-code` auth change does not remove, alter, or block the key for any other provider.

7. **Behavior is unchanged when no pay-as-you-go key is exported.** When neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, the `claude-code` provider behaves exactly as before — it uses the subscription login and produces identical results; the fix introduces no regression in the already-correct case.

8. **A run with no usable credential still fails visibly, not silently.** When the user has neither a pay-as-you-go key (now excluded) nor any usable subscription credential (no `/login`, no `CLAUDE_CODE_OAUTH_TOKEN`), the `claude-code` run fails and the harness records it as a failed run with an `error` populated via the existing `InvokeResult.error` channel — it does not hang silently or appear to succeed. (Producing an auth-*specific*, more legible error string is **out of scope** — see Out of Scope below.)

9. **The exclusion behavior is verifiable without real credentials or network.** The provider exposes a seam such that an automated, offline, deterministic test can observe the environment handed to the Claude Code SDK invocation and assert that it omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` while retaining `CLAUDE_CODE_OAUTH_TOKEN` and other non-auth variables (e.g. `PATH`) — mirroring the existing codex env-allowlist test (`providers.test.ts:324-356`). This is the measurable success criterion for Requirements 1–4.

### Out of Scope (exclusions)

- **Auth-specific / more legible error messaging.** Improving the `claude-code` failure string to a curated "not authenticated — run `/login`" message (by reading `SDKResultError.errors` / `api_error_status` or pattern-matching) is a separable enhancement. Requirement 8 only requires that the failure surface through the existing `error` channel, not that it be auth-specific. (Rationale: no clean in-process precheck exists for "subscription available," the exact native-binary error surface is unverified, and the intent is a focused auth-behavior bugfix.)
- **Upfront subscription precheck.** A guard mirroring `anthropic-api`'s `if (!process.env.ANTHROPIC_API_KEY)` is not in scope — the subscription credential is not a cheaply readable env var (it lives in the OS keychain / `~/.claude/.credentials.json`), and any precheck would be brittle or false-negative for the common interactive-login user.
- **Scrubbing cloud-backend switches.** `CLAUDE_CODE_USE_BEDROCK` / `_USE_VERTEX` / `_USE_FOUNDRY` (and their dependent cloud auth vars) are NOT removed. **Assumption:** a user who set these deliberately chose a cloud backend, and the provider should not silently override that choice; these are realistically unset in the common Skillsmith case.
- **Endpoint/base-URL overrides.** `ANTHROPIC_BASE_URL` and `*_BASE_URL` are NOT removed — they redirect the endpoint (e.g. a corporate proxy), not which credential is selected, and the subscription credential can legitimately be used through them.
- **Changes to other providers.** Only the `claude-code` provider's auth behavior changes (a small injectable-seam refactor to enable Requirement 9 is permitted/expected); `anthropic-api`, `openai-api`, `gemini-api`, `codex`, and `mock` are untouched in behavior.
