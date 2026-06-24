# Design Research: claude-code provider authenticates via the Claude Code subscription, not a stray API key

This design realizes `1-spec/spec.md`. The spec-research (`1-spec/spec-research.md`) already converges on a concrete direction:

- **Scrub** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment handed to the Claude Code SDK `query()`, preserving everything else (`CLAUDE_CODE_OAUTH_TOKEN`, `PATH`, `HOME`, ...).
- **Refactor** the `claude-code` provider from a module-level singleton into a `createClaudeCodeProvider(queryFn)` factory, mirroring `createCodexProvider(CodexCtor)`, so an offline test can inject a fake `query` and assert on the env handed to it.

The analyst treats that as a hypothesis to validate/refine. Open questions to settle: exact env-construction mechanism and where it lives; the injection seam shape for offline testability; how the factory is wired into existing provider construction; and the test strategy mirroring the codex env test. The design must stay proportional to a focused bugfix.

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### SDK env semantics: `options.env` replaces `process.env` wholesale, `undefined` values are dropped

From the design-doc-researcher (docs + `sdk.mjs` source + empirical Node spawn test):

- The SDK's `Options.env` is documented as "Environment variables to pass to the Claude Code process. Defaults to `process.env`" — `sdk.d.ts:1239-1253`. Type is `{ [envVar: string]: string | undefined }`.
- **Supplying `options.env` replaces the inherited environment wholesale.** `sdk.mjs` (v0.2.141) builds the child env as `J = {...$.env ?? process.env}` (only adding `CLAUDE_CODE_ENTRYPOINT` and OTEL traceparent keys), then `spawnLocalProcess` calls Node's `child_process.spawn(cmd, args, { ..., env: J })`. There is no merge with `process.env` once you supply `env`. **Implication: the provider must spread the full `process.env` and delete only the two auth keys — it cannot pass a partial env.**
- The Claude Code credential lookup depends on a broad env: macOS Keychain / `~/.claude/.credentials.json` via `HOME` (and `CLAUDE_CONFIG_DIR` when set); the launcher reads ~30 `CLAUDE_CODE_*` knobs, `USER`, cloud switches directly; the opaque native binary additionally reads locale (`LANG`/`LC_*`), proxy (`HTTP(S)_PROXY`/`NO_PROXY`), `SSL_CERT_FILE`, `XDG_*`, `TERM`. This is why an allowlist (codex's approach) is the wrong tool here — you'd have to enumerate everything the opaque binary might read and re-enumerate on every SDK bump.
- **`delete key` vs `key: undefined` are equivalent for the spawned child.** Empirically (Node v20.20.1 `spawnSync`): `env: { FOO: undefined }` and omitting `FOO` both make the child see `FOO` ABSENT; only `env: { FOO: "" }` makes it PRESENT-but-empty. The SDK does a shallow spread that preserves `undefined`, then hands it to `spawn`. So both `delete env.ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY: undefined` work; **setting them to `""` is the one thing to avoid** (leaves the var set-but-empty, which the binary could read as "present").

### Authentication precedence — scrubbing exactly two keys guarantees subscription selection (non-cloud case)

From the design-doc-researcher (Anthropic auth + env-vars docs, fetched 2026-06-17):

Precedence highest→lowest: (1) cloud creds `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` — **out of scope per spec**; (2) `ANTHROPIC_AUTH_TOKEN` — **scrub**; (3) `ANTHROPIC_API_KEY` — **scrub** ("in non-interactive `-p` mode the key is always used when present" — the silent-billing path; the SDK drives the CLI non-interactively); (4) `apiKeyHelper` — **settings.json only, NO env var**, so env-scrubbing cannot and should not touch it; (5) `CLAUDE_CODE_OAUTH_TOKEN` — **preserve** (legitimate subscription credential); (6) `/login` subscription OAuth — default fallthrough.

Once levels 1-3 are excluded (1 by spec assumption, 2-3 by the scrub), the next env-driven selector is level 5 (`CLAUDE_CODE_OAUTH_TOKEN`, preserved) then `/login`. So scrubbing the two guarantees the subscription/OAuth path wins. Other `*_API_KEY`/`*_BEARER` vars (`ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_FOUNDRY_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`) only take effect under a `CLAUDE_CODE_USE_*` switch (level 1, out of scope). `ANTHROPIC_BASE_URL` is endpoint-redirect only, not a credential selector. `ANTHROPIC_CUSTOM_HEADERS` is not in the precedence chain — leaving it is correct; scrubbing would be speculative over-reach. **Net: in the in-scope non-cloud case, the scrub set is exactly `{ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN}`.**

Sources: `sdk.d.ts:1239-1253`; `sdk.mjs` v0.2.141 (`J={...$.env??process.env}`, `spawnLocalProcess`→`spawn(...,{env:X})`); `src/providers/claude-code.ts:24-34`; `src/providers/codex.ts:172-184`; `src/__tests__/providers.test.ts:354`; Node v20.20.1 `spawnSync` empirical; Anthropic docs https://code.claude.com/docs/en/authentication and https://code.claude.com/docs/en/env-vars. Not verified: byte-level precedence in the compiled native binary (docs treated as authoritative).

## Topics

### Topic: Approach — the end-to-end mental model

- **Spec link:** Overview + all requirements.
- **Decision:** The `claude-code` provider hands the Claude Code SDK an explicit environment that is a copy of the user's `process.env` with exactly the two pay-as-you-go credential variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`) removed. Because the SDK forwards `options.env` wholesale to the spawned `claude` binary, and the binary selects a credential strictly by what is present in its environment, removing those two keys makes the binary fall through the documented precedence chain to the Claude Code subscription (`CLAUDE_CODE_OAUTH_TOKEN` if set, else `/login` OAuth). The scrub operates on a *copy*, so `process.env` itself is untouched and the `anthropic-api` provider — which reads `process.env.ANTHROPIC_API_KEY` directly — is unaffected in the same run.
- **The mental model in one line:** *"Give the Claude Code process the user's real environment, minus the pay-as-you-go keys, so it authenticates with the subscription instead."* To make that observable offline, the provider is refactored into a `createClaudeCodeProvider(queryFn)` factory (mirroring `createCodexProvider`) so a test can inject a fake `query` and assert on the env it receives — no real credentials or network.
- **Rationale:** This is the minimal, mechanism-faithful realization of the spec. It changes one option on one SDK call and adds a thin injectable seam; it introduces no new dependency, no new error path, and no behavior change for any other provider or for the already-correct (no key exported) case.

### Topic: Env-construction mechanism — denylist vs. allowlist

- **Spec link:** Requirements 1, 2, 3, 4, 7; Acceptance criteria 1-4, 7. The provider must hand `query()` an env that omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` while retaining `CLAUDE_CODE_OAUTH_TOKEN`, `PATH`, `HOME`, and the rest of the user's environment, with no regression in the already-correct case.
- **Options:**
  1. **Denylist (chosen).** Spread the full `process.env` into a copy, delete `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, pass the copy as `options.env` to `query()`.
  2. **Allowlist (codex's `codexEnv` pattern).** Build a fresh env containing only an explicit set of keys. Rejected for claude-code.
- **Trade-offs:** The Claude Code SDK replaces the inherited environment *wholesale* when `options.env` is supplied (`sdk.mjs`: `J = {...$.env ?? process.env}` → `spawn(..., {env: J})`), and the (opaque) native binary reads a broad, unenumerable swath of env (Keychain access via `HOME`/`CLAUDE_CONFIG_DIR`, ~30 `CLAUDE_CODE_*` knobs, locale, proxy, TLS, `XDG_*`, `TERM`). An allowlist would have to enumerate all of that and be re-audited on every SDK bump — fragile and prone to silently breaking subscription auth or agent behavior. A denylist removes exactly the two offending keys and preserves the SDK's "give me the real environment" contract — the minimum change. Codex can use an allowlist because the Codex SDK's env needs are narrow and it's a different binary.
- **Decision:** **Denylist.** Construct the child env as a shallow copy of `process.env` with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed; pass it as `options.env` to `query()`. Scrub set is exactly those two keys (see precedence research). Either `delete` or `= undefined` is acceptable for removal — both yield a child that does not see the var; **`""` must be avoided**. Recommendation: use `delete` on a spread copy for a clean object (no `undefined`-valued keys), but the test asserts `env.KEY === undefined` which holds for both conventions.
- **Rationale:** Smallest change that guarantees subscription selection without risking the SDK's broad env dependency; mirrors the spec's explicit scope (don't touch cloud switches or base-URL overrides); directly serves Requirements 1-4 and the no-regression Requirement 7. The `anthropic-api` provider reads `process.env.ANTHROPIC_API_KEY` directly and is untouched because the scrub operates on a *copy* (Requirement 6).

### Topic: Injection seam — factory shape, the `QueryFn` type, and where env-construction lives

- **Spec link:** Requirement 9 / final acceptance criterion (offline, deterministic, credential-free test that observes the env handed to the SDK invocation). The seam is what makes that test possible.
- **Decision (factory):** Refactor `claude-code.ts` from a module-level `claudeCodeProvider` singleton to a `createClaudeCodeProvider(queryFn: QueryFn): Provider` factory, mirroring `createCodexProvider(CodexCtor)`. Production wires the real SDK `query` in `registry.ts` (`createClaudeCodeProvider(query)`, replacing the current `import { claudeCodeProvider }`). Tests pass a capturing fake.
- **Decision (`QueryFn` type):** Export a structural type that narrows the *return* to the slice the provider consumes:
  ```ts
  import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
  export type QueryFn = (args: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }) => AsyncIterable<SDKMessage>;
  ```
  This is the function-return analog of codex's constructor narrowing `Pick<Codex, "startThread">`.
- **Why narrow the return to `AsyncIterable<SDKMessage>`:** The real `query` returns `Query` (`sdk.d.ts:2023`, `Query extends AsyncGenerator<SDKMessage, void>`) which carries ~12 streaming-only control methods (`interrupt`, `setModel`, `initializationResult`, ...). The provider uses NONE of them — `claude-code.ts:24,36` only does `const stream = query({...})` then `for await (const message of stream)` (grep confirmed zero control-method calls). Narrowing the return means: (a) the real `query` stays assignable (covariant return: `Query` → `AsyncIterable<SDKMessage>`), so `createClaudeCodeProvider(query)` compiles; (b) a hand-written fake can be a one-line `async function*` without implementing `Query`. **Verified by a live `tsc --noEmit` under the project's strict tsconfig: the real `query`, a bare `async function*` fake, and a fn-returning-generator are all assignable to this `QueryFn` with zero errors.**
- **Decision (where env-construction lives):** A module-private helper `claudeCodeEnv(env: NodeJS.ProcessEnv)` inside `claude-code.ts`, called as `options.env: claudeCodeEnv(process.env)` — one-for-one with codex's `codexEnv(process.env)` (`codex.ts:66,172-184`). Shape:
  ```ts
  const CLAUDE_CODE_SCRUBBED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
  function claudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const out = { ...env };
    for (const key of CLAUDE_CODE_SCRUBBED_ENV_KEYS) delete out[key];
    return out;
  }
  ```
  `NodeJS.ProcessEnv` (= `{ [k: string]: string | undefined }`) is structurally exactly the SDK's `Options.env` type — no cast needed.
- **Alternatives considered:**
  - `QueryFn` returning `Query` — rejected: forces fakes to implement/cast the full control surface.
  - Env-construction inline in `invoke` — works, but loses codex-parity testability/readability for a ~6-line helper.
  - A shared env-util in `src/providers/lib/` — rejected: `lib/` holds only `fs-tools.ts` and `vercel-runner.ts` (no env util); env handling is per-provider today, and codex (allowlist) vs claude-code (denylist) are *opposite* strategies — a shared abstraction would be a false unification.
- **Rationale:** Mirrors the only existing in-repo precedent for an injectable, env-shaping coding-agent provider (codex), so the change is idiomatic and the test reuses an established template. The factory is the minimal seam that makes Requirement 9's offline test possible; the narrowed `QueryFn` keeps fakes trivial; the private helper keeps the scrub self-documenting and unit-testable.

### Topic: Test strategy — the offline scrub assertion

- **Spec link:** Requirement 9 / final acceptance criterion — the measurable success criterion for Requirements 1-4. An offline, deterministic, credential-free test must observe the env handed to the SDK invocation and assert it omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` while retaining `CLAUDE_CODE_OAUTH_TOKEN` and `PATH`.
- **Decision:** Add a test in `src/__tests__/providers.test.ts` directly mirroring the existing "codex provider passes only allowlisted env to constructor" test (`providers.test.ts:324-356`). Shape:
  1. Save prior values of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `PATH`; set them to known sentinels on `process.env`.
  2. Build a capturing fake `QueryFn` that records `args.options` and yields a canned message stream (e.g. one `result`/`success` message so `invoke` returns cleanly), via `makeFakeQuery`.
  3. `await createClaudeCodeProvider(fakeQuery).invoke(baseParams(...))`.
  4. In a `finally`, restore the saved env values (delete if previously unset) — exactly as the codex test does.
  5. Assert on the captured `options.env`: `ANTHROPIC_API_KEY === undefined`, `ANTHROPIC_AUTH_TOKEN === undefined`, `CLAUDE_CODE_OAUTH_TOKEN === "<sentinel>"`, `PATH === "<sentinel>"`.
- **Key choices / rationale:**
  - **Assert `env.KEY === undefined`, not `'KEY' in env`** — convention-agnostic: passes whether the helper uses `delete` (key absent) or `= undefined` (key present, value undefined). Matches the codex template's `=== undefined` assertion (`providers.test.ts:354`).
  - **Save/restore `process.env`** — the test mutates real `process.env` (the helper reads `process.env`), so it must restore prior values in a `finally` to avoid cross-test contamination; the codex test (`providers.test.ts:325-352`) is the exact precedent for this dance.
  - **No real credentials or network** — the fake `query` never reaches the SDK/binary; the test asserts purely on the in-memory `options.env` object handed to the seam. This is what makes it offline and deterministic. Per Topic 1's research, a scrubbed env yields subscription auth (docs-established), so the test need not (and cannot offline) verify the binary's auth selection — asserting on `options.env` is the correct and sufficient proxy.
  - **`baseParams` reuse** — the existing `baseParams()` helper in `providers.test.ts` supplies `agent`/`systemPrompt`/`prompt`/`cwd`/`role`; reuse it (overriding `provider`/`model` as needed) so the new test stays consistent with the file.
- **Optional companion test (nice-to-have, not load-bearing):** a direct unit test of `claudeCodeEnv` (given an env with the keys + `PATH`/`CLAUDE_CODE_OAUTH_TOKEN`, returns the keys removed and the rest intact). The factory-level test above already covers the requirement end-to-end; a helper-level test is a small readability bonus. Leave the count/placement to the implementation phase.

### Topic: Components and wiring — what changes, what stays

- **Spec link:** Requirements 6, 9 (scoped to `claude-code`; no other provider changes); supports all requirements as the structural change that carries the fix.
- **Decision — exactly three references change, all confirmed by full-repo grep:**
  - `src/providers/claude-code.ts` (modified): change `export const claudeCodeProvider: Provider` → `export function createClaudeCodeProvider(queryFn: QueryFn): Provider`; add `export type QueryFn`; add the module-private `claudeCodeEnv` helper + `CLAUDE_CODE_SCRUBBED_ENV_KEYS`; insert `env: claudeCodeEnv(process.env)` into the `query()` options. **Remove** the top-level `import { query } from "@anthropic-ai/claude-agent-sdk"` (the concrete `query` no longer lives here); **add** type-only imports `Options`, `SDKMessage`, `SDKUserMessage` for the `QueryFn` signature. This mirrors codex, which imports only `@openai/codex-sdk` types and lets `registry.ts` import the concrete class.
  - `src/providers/registry.ts` (modified): replace `import { claudeCodeProvider } from "./claude-code"` with `import { createClaudeCodeProvider } from "./claude-code"` and `import { query } from "@anthropic-ai/claude-agent-sdk"`; add `const claudeCodeProvider = createClaudeCodeProvider(query)` (local const, exactly mirroring the existing `const codexProvider = createCodexProvider(Codex)` at `registry.ts:1,10`); the `PROVIDERS` map entry `"claude-code": claudeCodeProvider` is unchanged in shape.
  - `src/__tests__/providers.test.ts` (modified): add the new offline scrub test + fake-query helper. No existing test breaks.
- **Untouched but relevant:**
  - `getProvider("claude-code")` / `PROVIDERS["claude-code"]` consumers — `testing-agent.ts:67-68`, `judge-agent.ts:60-61`, `improver.ts:148-149` — depend only on the `Provider` interface (`.invoke`), never on object identity. The factory returns a fresh object implementing `Provider`, satisfying all of them. `providers.test.ts:17,30` assert only `.id` / `isProviderId` (registry-level) and keep passing.
  - All other providers (`anthropic-api`, `openai-api`, `gemini-api`, `codex`, `mock`) — unchanged (Requirement 6, out-of-scope list).
  - `src/providers/lib/fs-tools.ts:11` has a stale doc comment referencing `claude-code.ts:5` (`TOOLS_BY_ROLE`). Non-forcing; optionally refresh the line number if the refactor shifts it. Logged under Open Questions as a cosmetic follow-up.
- **Rationale:** The change is structurally identical to the existing codex factory pattern, so the blast radius is minimal and idiomatic. The refactor also closes a real gap — claude-code is currently unit-untested — which is what makes Requirement 9 satisfiable.

### Topic: Failure modes and observability

- **Spec link:** Requirement 8 / corresponding acceptance criterion (no-credential run fails visibly through the existing failure channel; no silent hang or false success); Requirement 7 (no regression).
- **Decision:** Preserve the existing failure-surfacing path verbatim. The entire `invoke` body — message loop (`claude-code.ts:36-65`), usage accounting (`:52-63`), `finalText`/`toolUseCount` extraction (`:37-41`), result-error-subtype handling (`:42-44` → `error = \`result.${subtype}\``), catch handling (`:66-68` → `error = err.message`), and result assembly (`:70-73`) — moves unchanged into the factory closure. The **only** behavioral delta is inserting `env: claudeCodeEnv(process.env)` into the `query()` options object.
- **Why this satisfies Requirement 8:** Scrubbing the two keys only removes a *credential*; it does not change *how* the SDK signals an outcome. The SDK still spawns the same binary, still streams the same `SDKMessage` types, and a no-credential run still surfaces either as a `result` message with an error subtype (→ `error`) or as a throw (→ catch → `error`). Whenever `error` is set, `InvokeResult.error` is populated and the harness records a failed run (`testing-agent.ts:86,95`; `agent-loop.ts:191,209,221`; `judge-agent.ts:69-72`; `pipeline.ts:306-307,360`). There is no code path where "key absent" yields a hang or a false success — absence just falls through to OAuth/`/login`, and if that also fails it errors like any other auth failure.
- **Observability:** Failures surface as the existing free-form `InvokeResult.error` string (e.g. `result.error_during_execution` or a process-exit message). Producing an auth-*specific*, more legible message is explicitly out of scope (spec "Out of Scope" §1) — no clean in-process subscription precheck exists, and the SDK has no auth-specific result subtype. The design deliberately does not add one.
- **Rationale:** Requirement 8 asks only that the failure surface through the *existing* channel, which both error paths already do, regardless of which way the native binary signals the failure. Keeping the body unchanged also directly delivers Requirement 7's no-regression guarantee for the already-correct (no key exported) case.

### Topic: Interfaces and data flow

- **Spec link:** Requirements 4, 9 (env contents; observable seam).
- **Public/internal interfaces introduced or changed:**
  - `export type QueryFn = (args: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => AsyncIterable<SDKMessage>` — the injection seam (new export from `claude-code.ts`).
  - `export function createClaudeCodeProvider(queryFn: QueryFn): Provider` — replaces the `claudeCodeProvider` const export.
  - Module-private: `claudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` and `const CLAUDE_CODE_SCRUBBED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]`.
  - The `Provider` interface (`types.ts:50-53`) is unchanged; `invoke(params): Promise<InvokeResult>` signature is unchanged.
- **Data flow:** `registry.ts` binds the real SDK `query` into the factory once at module load → `getProvider("claude-code")` returns that `Provider` → a consumer calls `provider.invoke(params)` → `invoke` builds `options.env = claudeCodeEnv(process.env)` (full env minus the two keys) and calls `queryFn({ prompt, options })` → the SDK spreads `options.env` into the spawned `claude` process env → the binary selects the subscription credential → messages stream back through the unchanged loop → `InvokeResult { finalText, toolUseCount, error?, usage? }`. The scrub reads `process.env` but mutates only a copy, so no global state changes.
- **Rationale:** The seam exposes exactly the slice the provider consumes (a stream of `SDKMessage`), matching the minimal-contract approach proven for codex; the data path is otherwise identical to today.

### Topic: Dependencies

- **Spec link:** Implicit (feasibility) — no new dependency is desired for a focused bugfix.
- **Decision / findings:** **No new runtime or dev dependency.** The design uses only what is already present:
  - `@anthropic-ai/claude-agent-sdk` (already a dependency) — the `query` function and the `Options`/`SDKMessage`/`SDKUserMessage` types. Pinned SDK v0.2.141 / bundled CLI 2.1.141 at time of research.
  - Node's `child_process.spawn` env semantics — used *by* the SDK, not called directly by the provider.
  - The existing `node:test` + `node:assert/strict` harness and the `providers.test.ts` scaffolding for the new test.
- **External systems the design depends on (unchanged):** the user's Claude Code subscription credential store (macOS Keychain / `~/.claude/.credentials.json`, reached via `HOME`/`CLAUDE_CONFIG_DIR`), and the documented SDK authentication precedence order. The design depends on the *documented* precedence (treated as authoritative); the compiled native binary's byte-level behavior is not independently verified (see Risks).
- **Rationale:** Proportional to a bugfix — the change is internal to one provider file plus its registry wiring and one test.

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- **`delete` vs `= undefined` in `claudeCodeEnv`** — both are correct for the spawned child and for the `=== undefined` test assertion. Recommendation is `delete` (clean object), but the implementation phase may choose either; not load-bearing.
- **Companion helper-level unit test** — whether to add a direct `claudeCodeEnv` unit test in addition to the factory-level scrub test. The factory test fully covers Requirement 9; the helper test is an optional readability bonus. Leave to the implementation phase.
- **Stale doc comment** — `src/providers/lib/fs-tools.ts:11` references `claude-code.ts:5` for `TOOLS_BY_ROLE` (the constant is actually at `claude-code.ts:10-13`, already slightly stale). Non-forcing; optionally refresh the line number if the refactor shifts it. Cosmetic.
- **Changeset** — per `AGENTS.md`/`CONTRIBUTING.md`, a release-relevant change needs a committed `.changeset/*.md`. This is a user-facing bugfix to the `claude-code` provider, so it likely warrants a `patch` (or pre-1.0 `minor`) changeset. Flag for the implementation/docs phase to author; not a design decision.

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **Native-binary precedence is doc-derived, not byte-verified.** The guarantee that scrubbing `{ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN}` forces subscription selection rests on Anthropic's documented precedence order (fetched 2026-06-17), not on reading the compiled `claude` binary (unreadable). Likelihood of being wrong: low (docs are authoritative and the precedence is explicit). Mitigation if ever in doubt: the SDK exposes `apiKeySource` (`'user'|'project'|'org'|'temporary'|'oauth'`) on the `system/init` message — a future smoke test could assert `oauth` — but reading it is out of scope here and would need real credentials, defeating the offline test goal.
- **Exact no-subscription failure surface is unverified.** Whether a no-credential run throws vs. yields a `result` error subtype, and the literal message text, comes from the native binary and was not empirically confirmed. This does NOT threaten Requirement 8: both code paths populate `InvokeResult.error`, and the spec explicitly puts auth-specific messaging out of scope. So the run fails visibly regardless; only the message's legibility (already out of scope) is affected. The researcher offered a throwaway-`CLAUDE_CONFIG_DIR` no-auth simulation if a future requirement ever hinges on the exact surface.
- **SDK env contract could change across versions.** The design relies on `options.env` being forwarded wholesale to the spawned process (verified for SDK v0.2.141). A future SDK that merges or filters env differently could change behavior, but the offline scrub test asserts on the `options.env` object the provider *constructs*, so it would still pass; a behavior change would be caught by integration/real-run testing, not this unit test. Low likelihood; noted for awareness.
- **Wholesale env replacement is intentional, not a regression.** Supplying `options.env` replaces the default `process.env` inheritance. The design preserves equivalence by spreading the *entire* `process.env` and deleting only two keys, so PATH/HOME/etc. are retained (Requirement 4). The risk would only materialize if the spread were partial — the design explicitly forbids that (denylist, not allowlist).
