# Code Plan: claude-code provider authenticates via the Claude Code subscription, not a stray API key

## Overview

Skillsmith's `claude-code` provider hands the Claude Code SDK the full inherited environment. When a pay-as-you-go Anthropic credential (`ANTHROPIC_API_KEY`, or the higher-precedence `ANTHROPIC_AUTH_TOKEN`) is exported, the underlying `claude` binary silently prefers it over the user's subscription, so the run is billed against — or blocked by — the pay-as-you-go account. The fix gives the Claude Code process a *copy* of the real environment with exactly those two keys removed, so credential selection falls through to the subscription (`CLAUDE_CODE_OAUTH_TOKEN` if set, else interactive `/login`). The scrub operates on a copy, leaving `process.env` untouched so the separate `anthropic-api` provider still works in the same run.

To make this observable offline, the provider is refactored from a module-level singleton (`claudeCodeProvider`) into a `createClaudeCodeProvider(queryFn)` factory that mirrors the existing `createCodexProvider`, letting a test inject a fake `query` and assert on the environment it receives.

The work is three sequential code tasks plus a verification task:
1. Refactor `claude-code.ts` to the factory with the `claudeCodeEnv` scrub helper and the injected env.
2. Re-wire `registry.ts` to construct the provider from the factory, moving the concrete `query` import there.
3. Add the offline scrub + copy-not-mutate test in `providers.test.ts`.
4. Run all guardrails green.

All four files referenced are confirmed to exist with the shapes the design relies on: the SDK `query` signature is `(_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query` where `Query extends AsyncGenerator<SDKMessage, void>` (so it is covariantly assignable to the narrowed `QueryFn` return `AsyncIterable<SDKMessage>`); `Options`, `SDKMessage`, and `SDKUserMessage` are all exported from `@anthropic-ai/claude-agent-sdk`; the `Provider` interface and `InvokeParams`/`InvokeResult` are unchanged.

A changeset is required for this user-facing bugfix per `AGENTS.md` / `CONTRIBUTING.md` (a `patch`, recorded pre-1.0 as `minor`). **This is docs-phase work and is intentionally NOT included as a task below** — flag for the docs phase to author.

## Tasks

### Task 1: Refactor `claude-code.ts` to `createClaudeCodeProvider(queryFn)` with a `claudeCodeEnv` env scrub

- **Goal:** Replace the `claudeCodeProvider` singleton with a `createClaudeCodeProvider(queryFn: QueryFn)` factory (mirroring `createCodexProvider`), add the module-private `claudeCodeEnv` helper and the scrub-key constant, and inject `env: claudeCodeEnv(process.env)` into the `query()` options. The rest of the `invoke` body (message loop, usage accounting, error handling, result assembly) must be carried over verbatim.
- **Files to change:** `src/providers/claude-code.ts`
- **Changes:**
  - **Imports:**
    - Remove the top-level value import `import { query } from "@anthropic-ai/claude-agent-sdk"` — the concrete `query` moves to `registry.ts` (Task 2).
    - Add type-only imports from the SDK: `import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"`.
    - Keep the existing `import type { InvokeParams, InvokeResult, Provider, Role, TokenUsage } from "./types"`.
  - **Add the injection-seam type** `QueryFn`, narrowing the SDK `query` return to the slice the provider consumes:
    ```ts
    export type QueryFn = (args: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Options;
    }) => AsyncIterable<SDKMessage>;
    ```
    This must be `export`ed so the test (Task 3) can type its fake. (Mirrors `codex.ts` exporting `CodexCtor`.)
  - **Add the module-private scrub constant and helper** (place them near the top, beside `TOOLS_BY_ROLE`):
    ```ts
    const CLAUDE_CODE_SCRUBBED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
    function claudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
      const out = { ...env };
      for (const key of CLAUDE_CODE_SCRUBBED_ENV_KEYS) delete out[key];
      return out;
    }
    ```
    The helper must build the scrubbed copy with a spread (`const out = { ...env }`) and delete from the copy only — it must never mutate its `env` argument. Use `delete` (not `= ""`); `= undefined` is equivalent for the child but `delete` yields a cleaner object.
  - **Replace the `export const claudeCodeProvider: Provider = { ... }` declaration** with `export function createClaudeCodeProvider(queryFn: QueryFn): Provider { return { ... }; }`. Move the existing object body inside the returned object:
    - Keep `id: "claude-code"`.
    - In `invoke`, change `const stream = query({ ... })` to `const stream = queryFn({ ... })`.
    - Add `env: claudeCodeEnv(process.env)` to the `options` object passed to `queryFn`, alongside the existing `model`, `cwd`, `systemPrompt`, `tools`, `permissionMode`, and `allowDangerouslySkipPermissions` fields. (`NodeJS.ProcessEnv` is structurally identical to `Options.env`, so no cast is needed.)
  - **Do NOT change** the message loop, the `assistant`/`result` handling, the usage/token accounting (the cache-fold comment and arithmetic), the `catch (err)` handling, or the final `InvokeResult` assembly. The only behavioral delta is the injected `env`.
- **Depends on:** none
- **Traces to:** Spec Requirements 1, 2, 3, 4, 6, 7, 9; Acceptance criteria 1, 2, 3, 4, 6, 7, 9. Design "Decision: Scrub the environment via a denylist of exactly two keys", "Decision: Refactor to a `createClaudeCodeProvider(queryFn)` factory seam", "Decision: Place env construction in a module-private `claudeCodeEnv` helper", "Decision: Preserve the existing failure-surfacing path verbatim".
- **Acceptance:**
  - `claude-code.ts` exports a function `createClaudeCodeProvider(queryFn)` and no longer exports a `claudeCodeProvider` const.
  - `claude-code.ts` exports a `QueryFn` type.
  - The provider object returned by `createClaudeCodeProvider` has `id === "claude-code"` and an `async invoke(params)` method matching the `Provider` interface.
  - `invoke` calls the injected `queryFn` (not a module-level `query`); there is no top-level value import of `query` in `claude-code.ts`.
  - The `options` passed to `queryFn` include an `env` produced by `claudeCodeEnv(process.env)`, in addition to the existing `model`, `cwd`, `systemPrompt`, `tools`, `permissionMode`, and `allowDangerouslySkipPermissions`.
  - `claudeCodeEnv` returns an object that omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` (`=== undefined` for both) and preserves every other key from its input (e.g. `CLAUDE_CODE_OAUTH_TOKEN`, `PATH`) with its original value.
  - `claudeCodeEnv` does not mutate the object passed as its `env` argument: a key present on the input before the call (e.g. `ANTHROPIC_API_KEY`) is still present on that same input object after the call, and the returned object is a different reference (`!==`) from the input.
  - The message-loop, usage-accounting, error-handling, and result-assembly behavior is unchanged from the prior singleton (same `finalText`/`toolUseCount`/`usage`/`error` outputs for the same stream of messages).
  - `npm run typecheck` passes for this file (the narrowed `QueryFn` return is assignable from the real `query`, verified end-to-end after Task 2).

### Task 2: Wire `registry.ts` to construct the provider via `createClaudeCodeProvider(query)`

- **Goal:** Move the concrete SDK `query` import into `registry.ts` and build the `claude-code` provider from the factory, mirroring the existing `const codexProvider = createCodexProvider(Codex)` wiring. The `PROVIDERS` map shape stays identical.
- **Files to change:** `src/providers/registry.ts`
- **Changes:**
  - Replace `import { claudeCodeProvider } from "./claude-code"` with `import { createClaudeCodeProvider } from "./claude-code"`.
  - Add `import { query } from "@anthropic-ai/claude-agent-sdk"` (the concrete value import that was removed from `claude-code.ts` in Task 1).
  - Add `const claudeCodeProvider = createClaudeCodeProvider(query);` near the existing `const codexProvider = createCodexProvider(Codex);`.
  - Leave the `PROVIDERS` map entry `"claude-code": claudeCodeProvider` unchanged in shape, and leave `getProvider`, `isProviderId`, `PROVIDER_IDS`, and all other entries untouched.
- **Depends on:** Task 1
- **Traces to:** Spec Requirements 1, 2, 7, 9; Acceptance criteria 1, 2, 7, 9. Design "Components" table (`registry.ts` row), "Interfaces and Data Flow → `registry.ts` wiring delta", "Decision: Refactor to a `createClaudeCodeProvider(queryFn)` factory seam".
- **Acceptance:**
  - `registry.ts` imports `createClaudeCodeProvider` (not `claudeCodeProvider`) from `./claude-code` and imports `query` from `@anthropic-ai/claude-agent-sdk`.
  - `registry.ts` constructs `claudeCodeProvider` by calling `createClaudeCodeProvider(query)`.
  - The real SDK `query` is accepted as the `QueryFn` argument with no type error (`npm run typecheck` passes), confirming the narrowed return type is assignable from `Query`.
  - `getProvider("claude-code").id === "claude-code"` still holds, and `isProviderId("claude-code") === true` still holds (existing registry tests pass unchanged).
  - The `PROVIDERS` map still has exactly the same six keys (`claude-code`, `openai-api`, `anthropic-api`, `gemini-api`, `codex`, `mock`) and `PROVIDER_IDS` is unchanged.

### Task 3: Add the offline scrub + copy-not-mutate test in `providers.test.ts`

- **Goal:** Add one offline, deterministic, credential-free test (plus a small capturing fake `QueryFn` helper) that proves the env handed to the SDK omits the two pay-as-you-go keys while retaining the subscription token and `PATH`, AND that `process.env` is left untouched (the copy-not-mutate property). Mirror the existing codex env test at `providers.test.ts:324-356`. No existing test is modified.
- **Files to change:** `src/__tests__/providers.test.ts`
- **Changes:**
  - **Imports:** add `import { createClaudeCodeProvider, type QueryFn } from "../providers/claude-code"`. Add type-only imports as needed for the canned message — e.g. `import type { SDKMessage, Options } from "@anthropic-ai/claude-agent-sdk"` — to type the fake and the captured options.
  - **Add a capturing fake `QueryFn`** (mirroring `makeFake` for codex). It is an `async function*` (or returns one) that:
    - records the `args.options` it was called with into a captured holder (so the test can assert on `options.env`);
    - yields exactly one canned terminal `result` message with `subtype: "success"` and a `result` string, including a valid `usage` object so the unchanged usage-accounting path runs without error (mirror the field names the provider reads: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`).
    - Use a minimal cast to satisfy the SDK message type where convenient (the existing codex fake uses `as any as CodexCtor`; the equivalent localized cast for the canned `SDKMessage` is acceptable and consistent with the file's style).
  - **Add one test** (`test("claude-code provider scrubs pay-as-you-go keys from the env passed to query", ...)` or similar) that:
    1. Saves the prior values of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and `PATH` from `process.env` (so they can be restored).
    2. Sets all four on `process.env` to known sentinel strings.
    3. Builds the provider with `createClaudeCodeProvider(fake)` and a captured holder, then `await provider.invoke(baseParams())`.
    4. **Before** restoring env, asserts the copy-not-mutate property (assertion 2 below) inside the `try`.
    5. Restores the four env vars in a `finally` (delete if the prior value was `undefined`, else reassign) — exactly as the codex test's `finally` does.
  - **Assertion 1 — scrub (Req 1–4, 9):** on the captured `options.env`:
    - `env.ANTHROPIC_API_KEY === undefined`
    - `env.ANTHROPIC_AUTH_TOKEN === undefined`
    - `env.CLAUDE_CODE_OAUTH_TOKEN === "<oauth sentinel>"`
    - `env.PATH === "<path sentinel>"`
  - **Assertion 2 — copy-not-mutate (Req 6):** evaluated inside the `try`, *before* the `finally` restore, so the restore cannot mask an in-place mutation:
    - `process.env.ANTHROPIC_API_KEY === "<api-key sentinel>"`
    - `process.env.ANTHROPIC_AUTH_TOKEN === "<auth-token sentinel>"`
  - Use `assert.equal` against `=== undefined` for the scrubbed keys (do not use `'KEY' in env` — that couples the test to the `delete` vs `= undefined` convention).
  - Do not add a networked/credentialed path; the test must run with no real credentials and no network.
- **Depends on:** Task 1 (needs `createClaudeCodeProvider` and `QueryFn`); Task 2 is not required for this test (it builds the provider directly with the fake), but Task 2 must land for the full suite + typecheck to pass.
- **Traces to:** Spec Requirements 6, 9; Acceptance criteria 6, 9. Design "Decision: Offline scrub test mirroring the codex env test" (assertions 1 and 2), "Decision: Scrub the environment via a denylist of exactly two keys" (copy-not-mutate safeguard).
- **Acceptance:**
  - A new test exists in `providers.test.ts` that injects a capturing fake `QueryFn` into `createClaudeCodeProvider` and invokes the provider; no existing test in the file is changed.
  - The test asserts the captured `options.env` has `ANTHROPIC_API_KEY === undefined` and `ANTHROPIC_AUTH_TOKEN === undefined`.
  - The test asserts the captured `options.env` has `CLAUDE_CODE_OAUTH_TOKEN` and `PATH` equal to the sentinels that were set on `process.env`.
  - The test asserts, before any `finally` restore, that `process.env.ANTHROPIC_API_KEY` and `process.env.ANTHROPIC_AUTH_TOKEN` still equal their sentinels (proving the scrub copied rather than mutated in place). This assertion would fail if the implementation had done `delete process.env.ANTHROPIC_API_KEY` in place.
  - The test restores the four env vars in a `finally` so it does not contaminate other tests (re-running the suite leaves `process.env` for those keys as it was before the test).
  - The test runs offline and deterministically with no real credentials and no network access.
  - The test passes under `npm test` after Tasks 1 and 2 land.

### Task 4: Verify all guardrails pass

- **Goal:** Confirm the full change set passes every project guardrail with no regressions in existing providers or tests.
- **Files to change:** none (verification only; fix any guardrail failure within the scope of Tasks 1–3 if one surfaces).
- **Changes:** Run, from the repo root, and confirm each exits zero:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm --prefix testing-project run check:config`
  If any fails due to a change in Tasks 1–3, correct it within the design's scope (do not add new functionality, change other providers' behavior, or alter the unchanged `invoke` body beyond the injected `env`).
- **Depends on:** Task 1, Task 2, Task 3
- **Traces to:** Spec Requirements 7, 8 (no regression; failure path preserved verbatim) and the overall acceptance set (the guardrails are the executable proof the suite — including the new scrub test and all existing provider tests — is green). Design "Decision: Preserve the existing failure-surfacing path verbatim".
- **Acceptance:**
  - `npm run typecheck` exits zero.
  - `npm run lint` exits zero.
  - `npm test` exits zero, including the new scrub test and all pre-existing provider/registry tests (e.g. `getProvider("claude-code")`, the codex env test) passing unchanged.
  - `npm --prefix testing-project run check:config` exits zero.
