# Design Doc: claude-code provider authenticates via the Claude Code subscription, not a stray API key

## Overview

Skillsmith's `claude-code` provider is meant to run coding agents through the user's Claude Code subscription login. Today it does not reliably do so: the provider hands the Claude Code SDK the full inherited environment, and the underlying `claude` binary selects a credential strictly by what is present in that environment. When a pay-as-you-go Anthropic credential (`ANTHROPIC_API_KEY`, or the higher-precedence `ANTHROPIC_AUTH_TOKEN`) is exported — commonly because the user also uses the separate `anthropic-api` provider — the binary silently prefers it over the subscription. The user is then billed against, or blocked by, their pay-as-you-go account; when that account is out of credit, every `claude-code` agent fails with a credit-balance error despite a working subscription.

The fix is to give the Claude Code process a copy of the user's real environment with exactly the two pay-as-you-go credential variables removed, so the binary falls through the documented authentication precedence chain to the subscription (`CLAUDE_CODE_OAUTH_TOKEN` if set, else interactive `/login` OAuth). The scrub operates on a copy, so `process.env` is untouched and no other provider is affected. To make the behavior observable offline, the provider is refactored from a module-level singleton into a small `createClaudeCodeProvider(queryFn)` factory (mirroring the existing `createCodexProvider`), allowing a test to inject a fake `query` and assert on the environment it receives.

## Approach

The mental model in one line: **"Give the Claude Code process the user's real environment, minus the pay-as-you-go keys, so it authenticates with the subscription instead."**

End to end:

1. At module load, `registry.ts` binds the real SDK `query` function into the factory: `createClaudeCodeProvider(query)`. The resulting `Provider` object is registered under `"claude-code"` exactly as the singleton is today.
2. A consumer (`testing-agent`, `judge-agent`, `improver`) resolves the provider via `getProvider("claude-code")` and calls `provider.invoke(params)`. These consumers depend only on the `Provider` interface (`.invoke`), never on object identity, so the swap from a const to a factory-produced object is transparent.
3. Inside `invoke`, the provider builds the SDK options as it does today, with one addition: `options.env = claudeCodeEnv(process.env)`. `claudeCodeEnv` returns a shallow copy of `process.env` with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed and everything else (`CLAUDE_CODE_OAUTH_TOKEN`, `PATH`, `HOME`, locale, proxy, TLS, all `CLAUDE_CODE_*` knobs, ...) preserved.
4. The provider calls the injected `queryFn({ prompt, options })`. In production this is the real SDK `query`.
5. The Claude Code SDK forwards `options.env` **wholesale** to the spawned `claude` process (it does not merge with `process.env` once `env` is supplied). The binary therefore sees the user's full environment minus the two keys.
6. With the two pay-as-you-go keys absent, the binary's credential selection falls through to the next env-driven selector — `CLAUDE_CODE_OAUTH_TOKEN` if present, otherwise the `/login` subscription session. The subscription wins.
7. Messages stream back through the unchanged message loop, producing an `InvokeResult { finalText, toolUseCount, error?, usage? }`.

Why a denylist (remove two keys) rather than an allowlist (forward only known-good keys): the SDK replaces the inherited environment wholesale, and the opaque native binary reads a broad, unenumerable swath of environment (Keychain access via `HOME`/`CLAUDE_CONFIG_DIR`, ~30 `CLAUDE_CODE_*` knobs, locale `LANG`/`LC_*`, proxy `HTTP(S)_PROXY`/`NO_PROXY`, `SSL_CERT_FILE`, `XDG_*`, `TERM`). An allowlist would have to enumerate all of that and be re-audited on every SDK bump — fragile, and prone to silently breaking subscription auth or agent behavior. Removing exactly the two offending keys preserves the SDK's "give me the real environment" contract while guaranteeing the subscription is selected. (Codex can use an allowlist because the Codex SDK's env needs are narrow and it is a different binary.)

## Components

| Component | Change | Responsibility |
| --- | --- | --- |
| `src/providers/claude-code.ts` | Modified | Replace the `claudeCodeProvider` singleton with a `createClaudeCodeProvider(queryFn)` factory; add the `QueryFn` type, the module-private `claudeCodeEnv` helper, and the scrub-key constant; inject `env: claudeCodeEnv(process.env)` into the `query()` options. The `invoke` body (message loop, usage accounting, error handling) is otherwise unchanged. |
| `src/providers/registry.ts` | Modified | Import `createClaudeCodeProvider` and the concrete `query`; construct `const claudeCodeProvider = createClaudeCodeProvider(query)` (mirroring the existing `const codexProvider = createCodexProvider(Codex)`); register it under `"claude-code"` unchanged. |
| `src/__tests__/providers.test.ts` | Modified | Add one offline scrub test plus a capturing fake `QueryFn` helper, mirroring the existing codex env test. No existing test changes. |

**Untouched but relevant:**

- `getProvider("claude-code")` / `PROVIDERS["claude-code"]` consumers — `testing-agent.ts`, `judge-agent.ts`, `improver.ts` — depend only on the `Provider` interface, so the factory's fresh object satisfies them unchanged.
- All other providers — `anthropic-api`, `openai-api`, `gemini-api`, `codex`, `mock` — are unchanged. In particular `anthropic-api` reads `process.env.ANTHROPIC_API_KEY` directly; because the scrub builds and mutates only a *copy* and never touches `process.env` (the copy-not-mutate property owned by Decision 1 and verified by Decision 5's assertion 2), its behavior — including the existing "ANTHROPIC_API_KEY is not set" guard — is intact in the same run (Requirement 6 / acceptance criterion 6).
- The `Provider` interface (`types.ts`) and the `invoke(params): Promise<InvokeResult>` signature are unchanged.

## Interfaces and Data Flow

### New / changed interfaces (`claude-code.ts`)

```ts
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Injection seam: narrows the SDK query's return to the slice the provider consumes.
export type QueryFn = (args: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

// Replaces the `claudeCodeProvider` const export.
export function createClaudeCodeProvider(queryFn: QueryFn): Provider;

// Module-private.
const CLAUDE_CODE_SCRUBBED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function claudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of CLAUDE_CODE_SCRUBBED_ENV_KEYS) delete out[key];
  return out;
}
```

Notes:

- **Why `QueryFn` narrows the return to `AsyncIterable<SDKMessage>`:** the real `query` returns `Query` (`Query extends AsyncGenerator<SDKMessage, void>`), which carries ~12 streaming-only control methods (`interrupt`, `setModel`, `initializationResult`, ...). The provider uses none of them — it only does `const stream = query({...})` then `for await (const message of stream)`. Narrowing keeps the real `query` assignable to `QueryFn` (covariant return), so production wiring compiles, while letting a test's fake be a one-line `async function*` rather than a full `Query` implementation. This is the function-return analog of codex's constructor narrowing (`Pick<Codex, "startThread">`). Confirmed assignable under the project's strict `tsconfig` via `tsc --noEmit`.
- **`NodeJS.ProcessEnv` (`{ [k: string]: string | undefined }`) is structurally exactly the SDK's `Options.env` type**, so `claudeCodeEnv(process.env)` is passed to `options.env` with no cast.
- **Removal mechanism:** `delete` (recommended, yields a clean object) and `= undefined` are both correct — for a spawned child, a key with value `undefined` and an absent key are equivalent (the child does not see the var). The one value to avoid is `""`, which leaves the var set-but-empty and could be read as "present." The test asserts `env.KEY === undefined`, which holds for either removal convention.

### `claude-code.ts` import delta

- **Remove** the top-level `import { query } from "@anthropic-ai/claude-agent-sdk"` — the concrete `query` now lives in `registry.ts`.
- **Add** type-only imports `Options`, `SDKMessage`, `SDKUserMessage` for the `QueryFn` signature. This mirrors codex, which imports only `@openai/codex-sdk` types and lets `registry.ts` import the concrete class.

### `registry.ts` wiring delta

- Replace `import { claudeCodeProvider } from "./claude-code"` with `import { createClaudeCodeProvider } from "./claude-code"` plus `import { query } from "@anthropic-ai/claude-agent-sdk"`.
- Add `const claudeCodeProvider = createClaudeCodeProvider(query)`, mirroring the existing `const codexProvider = createCodexProvider(Codex)`.
- The `PROVIDERS` map entry `"claude-code": claudeCodeProvider` is unchanged in shape.

### Data flow

```
registry.ts: createClaudeCodeProvider(query)  ──┐  (once, at module load)
                                                ▼
getProvider("claude-code")  ──▶  Provider { invoke }
                                                │
consumer: provider.invoke(params)              ▼
  invoke builds options.env = claudeCodeEnv(process.env)   // full env − {ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN}
  invoke calls queryFn({ prompt, options })
                                                ▼
  SDK spreads options.env wholesale into spawned `claude` process env
                                                ▼
  binary selects subscription credential (CLAUDE_CODE_OAUTH_TOKEN or /login)
                                                ▼
  messages stream back through unchanged loop ──▶ InvokeResult { finalText, toolUseCount, error?, usage? }
```

The scrub reads `process.env` but mutates only a copy, so no global state changes during a run.

## Key Decisions

### Decision: Scrub the environment via a denylist of exactly two keys

- **Choice:** Construct the child env as a shallow *copy* of `process.env` (`const out = { ...env }`) with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed *from the copy*, passed as `options.env` to `query()`. The scrub set is exactly those two keys, and `process.env` itself is never mutated.
- **Alternatives:** (a) An allowlist (codex's `codexEnv` pattern) that forwards only an explicit set of keys — rejected for claude-code. (b) Scrubbing the keys *in place* on `process.env` (e.g. `delete process.env.ANTHROPIC_API_KEY` before constructing the env) — rejected because it would mutate global state and break `anthropic-api`, which reads `process.env.ANTHROPIC_API_KEY` directly (Requirement 6).
- **Trade-offs:** The SDK replaces the inherited environment wholesale when `options.env` is supplied (no merge with `process.env`), and the opaque native binary reads a broad, unenumerable swath of environment (Keychain via `HOME`/`CLAUDE_CONFIG_DIR`, ~30 `CLAUDE_CODE_*` knobs, locale, proxy, TLS, `XDG_*`, `TERM`). An allowlist would have to enumerate all of that and be re-audited on every SDK bump — fragile and prone to silently breaking subscription auth. The denylist removes exactly the offending keys and keeps the SDK's "real environment" contract. The two keys are sufficient and necessary: per the documented precedence (highest→lowest) of cloud creds → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` (settings-only, no env var) → `CLAUDE_CODE_OAUTH_TOKEN` → `/login`, removing levels 2 and 3 (cloud creds are out of scope) makes the next env-driven selector the subscription. Other `*_API_KEY`/`*_BEARER` vars only take effect under a `CLAUDE_CODE_USE_*` cloud switch (out of scope); `ANTHROPIC_BASE_URL` redirects the endpoint, not the credential.
- **Copy-not-mutate is the safeguard for Requirement 6.** Operating on a copy (rather than mutating `process.env` in place) is the single property that keeps the scrub scoped to the `claude-code` child process and leaves `ANTHROPIC_API_KEY` set in the parent `process.env` for the `anthropic-api` provider to read in the same run. This decision owns that property; its observable verification is specified in Decision 5.
- **Traces to:** Requirements 1, 2, 3, 4, 6, 7; Acceptance criteria 1–4, 6, 7. (Requirement 5 / acceptance criterion 5 are satisfied transitively — see the Requirement 5 note below.)

> **Requirement 5 (out-of-credit account) verification chain.** Req 5 — the headline symptom that motivated the spec — is satisfied *transitively*, not by a dedicated mechanism: once Requirements 1 and 2 hold (both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are absent from the child env), the documented authentication precedence (see Trade-offs above and the precedence Risk) guarantees the subscription is selected, so the out-of-credit pay-as-you-go account tied to `ANTHROPIC_API_KEY` is never consulted and its credit-balance error never fires. The offline test (Decision 5) covers only the *precondition* of this chain — that the key is absent from the env handed to the SDK — not a live billing scenario; it cannot, because confirming the binary actually authenticates against the subscription and bills nothing to the API account requires real credentials and a real out-of-credit account. End-to-end confirmation of Req 5 is therefore deferred to credentialed real-run / integration testing, under the documented "native-binary precedence is doc-derived" risk. **Traces to:** Requirement 5; Acceptance criterion 5.

### Decision: Refactor to a `createClaudeCodeProvider(queryFn)` factory seam

- **Choice:** Replace the module-level `claudeCodeProvider` singleton with a factory that takes the SDK `query` as an injectable `QueryFn`. Production wires the real `query` in `registry.ts`; tests pass a capturing fake.
- **Alternatives:** (a) Keep the singleton and the top-level `query` import — rejected because the env scrub would then be unobservable offline without mocking the SDK module. (b) A `QueryFn` typed to return the full `Query` — rejected because it would force fakes to implement or cast ~12 control methods the provider never uses.
- **Trade-offs:** The factory adds a thin seam and one line of registry wiring, at the cost of converting a const to a function. The benefit is that it makes the offline scrub test possible and closes a real gap — claude-code is currently unit-untested. The pattern is structurally identical to the existing codex factory, so the change is idiomatic and the blast radius is minimal.
- **Traces to:** Requirement 9 / acceptance criterion 9 (the observable, offline, credential-free test). The seam is also what makes the Requirement 6 / acceptance criterion 6 copy-not-mutate assertion observable (see Decision 5).

### Decision: Place env construction in a module-private `claudeCodeEnv` helper

- **Choice:** A `claudeCodeEnv(env: NodeJS.ProcessEnv)` helper inside `claude-code.ts`, called as `options.env: claudeCodeEnv(process.env)`, one-for-one with codex's `codexEnv(process.env)`.
- **Alternatives:** (a) Inline the scrub in `invoke` — works but loses codex-parity readability and a unit-testable boundary for ~6 lines. (b) A shared env util in `src/providers/lib/` — rejected: `lib/` holds only `fs-tools.ts` and `vercel-runner.ts`, env handling is per-provider today, and codex (allowlist) vs claude-code (denylist) are opposite strategies, so a shared abstraction would be a false unification.
- **Trade-offs:** A named helper keeps the scrub self-documenting and unit-testable at the cost of one extra function. Mirrors the only in-repo precedent for an injectable, env-shaping coding-agent provider. Because the helper builds and returns a fresh object (`const out = { ...env }`), it is also the structural locus of the copy-not-mutate property that Decision 1 owns for Requirement 6.
- **Traces to:** Requirements 1–4 / acceptance criteria 1–4; Requirement 6 / acceptance criterion 6 (the helper returns a copy, never mutating its input); Requirement 9 / acceptance criterion 9.

### Decision: Preserve the existing failure-surfacing path verbatim

- **Choice:** Move the entire `invoke` body — message loop, usage accounting, `finalText`/`toolUseCount` extraction, result-error-subtype handling (`error = \`result.${subtype}\``), `catch` handling (`error = err.message`), and result assembly — unchanged into the factory closure. The only behavioral delta is inserting `env: claudeCodeEnv(process.env)` into the `query()` options.
- **Alternatives:** Add an authentication-specific error message or an upfront subscription precheck — both explicitly out of scope per the spec (no cheaply readable subscription credential exists; the SDK has no auth-specific result subtype).
- **Trade-offs:** Keeping the body unchanged delivers Requirement 7's no-regression guarantee for the already-correct case and keeps the diff minimal, at the cost of not improving error legibility (which is out of scope by design).
- **Traces to:** Requirement 8 / acceptance criterion 8 (failure surfaces visibly through the existing channel — no silent hang or false success) and Requirement 7 / acceptance criterion 7 (no regression in the already-correct case).

### Decision: Offline scrub test mirroring the codex env test

- **Choice:** Add a test in `providers.test.ts` that sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and `PATH` to known sentinels on `process.env`; invokes `createClaudeCodeProvider(fakeQuery).invoke(baseParams(...))` with a capturing fake `QueryFn` that records `args.options` and yields one canned `result`/`success` message; restores prior env in a `finally`; then asserts **two** properties:
  1. **Scrub (Req 1–4, 9):** on the captured `options.env` — `ANTHROPIC_API_KEY === undefined`, `ANTHROPIC_AUTH_TOKEN === undefined`, `CLAUDE_CODE_OAUTH_TOKEN === "<sentinel>"`, `PATH === "<sentinel>"`.
  2. **Copy-not-mutate (Req 6):** *before* restoring in the `finally`, assert that the real `process.env` is untouched — `process.env.ANTHROPIC_API_KEY === "<sentinel>"` and `process.env.ANTHROPIC_AUTH_TOKEN === "<sentinel>"` still hold after `invoke()` returns. This proves the scrub operated on a copy and did not delete the keys in place. The assertion runs *inside* the `try` (before the `finally` restores anything), so the `finally`'s restore cannot mask an in-place mutation. (Equivalently / additionally, the design may assert that `claudeCodeEnv` returns a new object — `claudeCodeEnv(process.env) !== process.env` — and/or that a subsequent `anthropicApiProvider.invoke(...)` in the same test still sees `ANTHROPIC_API_KEY`. The post-invoke `process.env.ANTHROPIC_API_KEY === "<sentinel>"` assertion is the minimal sufficient observation and is the one the design commits to.)
- **Why assertion 2 is required:** without it, a Req-6-breaking implementation that did `delete process.env.ANTHROPIC_API_KEY` in place before constructing the env would produce an identical captured `options.env` (key absent) and the `finally` would silently restore the global mutation — so assertion 1 alone passes either way. Asserting the sentinel survives in `process.env` is what makes Requirement 6's copy-not-mutate safeguard *observable*, converting it from an unverifiable prose claim into the design's test coverage of Req 6.
- **Alternatives:** Assert `'KEY' in env` (rejected — couples the test to the `delete` vs `= undefined` convention; `=== undefined` is convention-agnostic). A real-credential or networked integration test (rejected — cannot be offline/deterministic; per the precedence research, a scrubbed env yields subscription auth, so asserting on the constructed `options.env` is the correct and sufficient proxy).
- **Trade-offs:** The test mutates real `process.env` (because the helper reads it), so it must save/restore in a `finally` to avoid cross-test contamination — exactly as the codex test does. Asserting the copy property *before* the restore is the cost of catching an in-place mutation. An optional companion unit test of `claudeCodeEnv` (asserting it returns a new object with the rest intact) is a readability bonus, not load-bearing; the factory-level test fully covers both requirements.
- **Traces to:** Requirement 9 / acceptance criterion 9 — the measurable success criterion for Requirements 1–4 (assertion 1); and Requirement 6 / acceptance criterion 6 — the observable copy-not-mutate safeguard owned by Decision 1 (assertion 2).

## Dependencies

**No new runtime or dev dependency.** The design uses only what is already present:

- `@anthropic-ai/claude-agent-sdk` (already a dependency) — the `query` function and the `Options` / `SDKMessage` / `SDKUserMessage` types. SDK v0.2.141 / bundled CLI 2.1.141 at time of research.
- Node's `child_process.spawn` env semantics — used *by* the SDK, not called directly by the provider.
- The existing `node:test` + `node:assert/strict` harness and the `providers.test.ts` scaffolding (`baseParams`, capture helpers) for the new test.

**External systems the design depends on (unchanged):** the user's Claude Code subscription credential store (macOS Keychain / `~/.claude/.credentials.json`, reached via `HOME` / `CLAUDE_CONFIG_DIR`), and the documented SDK authentication precedence order (treated as authoritative; see Risks for the unverified native-binary caveat).

## Failure Modes and Observability

The fix removes a *credential* from the child's environment; it does not change *how* the SDK signals an outcome. The SDK still spawns the same binary, still streams the same `SDKMessage` types, and the unchanged `invoke` body still converts outcomes into `InvokeResult`:

- A run that the binary reports as failed surfaces either as a `result` message with a non-`success` subtype (→ `error = \`result.${subtype}\``) or as a thrown error (→ `catch` → `error = err.message`).
- Whenever `error` is set, `InvokeResult.error` is populated, and the harness records a failed run (the `testing-agent`, `agent-loop`, `judge-agent`, and `pipeline` consumers all branch on `InvokeResult.error`).

There is no code path where "key absent" produces a silent hang or a false success: key absence simply falls through to the subscription/`/login` path, and if that *also* fails (no `/login` session and no `CLAUDE_CODE_OAUTH_TOKEN`), it errors like any other auth failure and surfaces through the same channel. This satisfies Requirement 8 / acceptance criterion 8.

**Observability:** failures surface as the existing free-form `InvokeResult.error` string (e.g. `result.error_during_execution` or a process-exit message). Producing an authentication-specific, more legible message is explicitly out of scope — no clean in-process subscription precheck exists, and the SDK has no auth-specific result subtype. The design deliberately does not add one. (The SDK does expose `apiKeySource` — `'user'|'project'|'org'|'temporary'|'oauth'` — on the `system/init` message; a future smoke test could assert `oauth`, but reading it needs real credentials and is out of scope for the offline test.)

## Risks and Open Questions

**Risks:**

- **Native-binary precedence is doc-derived, not byte-verified.** The guarantee that scrubbing `{ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN}` forces subscription selection rests on Anthropic's documented precedence order (fetched 2026-06-17), not on reading the compiled `claude` binary (unreadable). Likelihood of being wrong: low — the docs are authoritative and the precedence is explicit. If ever in doubt, the SDK's `apiKeySource` field on the init message could be asserted to equal `oauth` in a future credentialed smoke test.
- **Exact no-subscription failure surface is unverified.** Whether a no-credential run throws vs. yields a `result` error subtype, and the literal message text, comes from the native binary and was not empirically confirmed. This does **not** threaten Requirement 8: both code paths populate `InvokeResult.error`, and auth-specific messaging is out of scope. Only the message's legibility (already out of scope) is affected.
- **SDK env contract could change across versions.** The design relies on `options.env` being forwarded wholesale to the spawned process (verified for SDK v0.2.141). A future SDK that merges or filters env differently could change real-run behavior, but the offline scrub test asserts on the `options.env` object the provider *constructs*, so it would still pass; a behavior change would be caught by integration/real-run testing, not this unit test. Low likelihood; noted for awareness.

**Open questions (deferred to implementation/docs phases, none load-bearing):**

- **`delete` vs `= undefined` in `claudeCodeEnv`** — both are correct for the spawned child and for the `=== undefined` assertion; recommendation is `delete`. Implementation phase may choose either.
- **Companion helper-level unit test** — whether to add a direct `claudeCodeEnv` unit test in addition to the factory-level scrub test. The factory test fully covers Requirement 9; the helper test is an optional readability bonus.
- **Stale doc comment** — `src/providers/lib/fs-tools.ts:11` references `claude-code.ts:5` for `TOOLS_BY_ROLE` (already slightly stale; the constant is at `claude-code.ts:10-13`). Non-forcing; optionally refresh the line number if the refactor shifts it. Cosmetic.
- **Changeset required.** Per `AGENTS.md` / `CONTRIBUTING.md`, this user-facing bugfix to the `claude-code` provider is release-relevant and needs a committed `.changeset/*.md` (a `patch`, recorded pre-1.0 as `minor`). Flag for the implementation/docs phase to author; not a design decision.
