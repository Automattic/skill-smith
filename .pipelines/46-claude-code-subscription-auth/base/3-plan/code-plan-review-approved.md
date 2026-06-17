# Code Plan Review

## Verdict: approved

## Summary

The plan is complete, feasible, correctly ordered, and faithful to both the spec and the approved design. Every spec acceptance criterion maps to at least one task: criteria 1–4 to the env scrub (Task 1) and its offline assertion (Task 3); criterion 6 to the copy-not-mutate property (Task 1) and its observable assertion (Task 3); criteria 7 and 8 to the verbatim-preserved `invoke` body (Task 1) and the green guardrail suite (Task 4); criterion 9 to the offline scrub test (Task 3). Criterion 5 is correctly handled as satisfied transitively (once criteria 1 and 2 hold, precedence falls through to the subscription) — matching the design's explicit Requirement 5 verification chain — and is rightly not given a dedicated task or a live billing test. All five design decisions (two-key denylist, `createClaudeCodeProvider(queryFn)` factory seam, module-private `claudeCodeEnv` helper, verbatim failure path, offline mirror test) are executed, with no scope creep into auth-specific messaging, prechecks, cloud-switch scrubbing, or base-URL handling. The guardrail set (`typecheck`, `lint`, `test`, `check:config`) is the right one, and the changeset is correctly deferred to the docs phase rather than included as a code task.

I verified every codebase assumption the plan relies on:

- `src/providers/claude-code.ts` is the module-level `claudeCodeProvider` singleton with a top-level `import { query }`, and the `invoke` body reads exactly `message.type`, `message.subtype`, `message.result`, and `message.usage.{input_tokens,cache_creation_input_tokens,cache_read_input_tokens,output_tokens}` — so the Task 3 fake's canned `result`/`success` message with those usage fields drives the unchanged accounting path without error.
- `src/providers/codex.ts` exports `createCodexProvider(CodexCtor)` and the `codexEnv(process.env)` helper exactly as the plan mirrors, and `registry.ts` wires `const codexProvider = createCodexProvider(Codex)` — the structural precedent the plan follows for both the factory and the registry wiring.
- The codex env test at `src/__tests__/providers.test.ts:324-356` is the save/set/invoke/`finally`-restore pattern Task 3 mirrors, including the `delete`-if-`undefined`-else-reassign restore loop.
- The SDK `query` signature is `(_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query`, with `Query extends AsyncGenerator<SDKMessage, void>` (`sdk.d.ts:2252`, `:2023`), so the narrowed `QueryFn` return `AsyncIterable<SDKMessage>` is assignable from the real `query` (covariant return); `Options`, `SDKMessage`, `SDKUserMessage` are all exported.
- `Options.env` is `{ [envVar: string]: string | undefined }` (`sdk.d.ts:1251-1253`), structurally identical to `NodeJS.ProcessEnv`, confirming the "no cast needed" claim.
- `tsconfig` has `strict: true` and `noUncheckedIndexedAccess: true` but not `exactOptionalPropertyTypes`, so `const out = { ...env }; delete out[key]` on a `NodeJS.ProcessEnv`-typed object typechecks.
- No file outside `registry.ts`/`claude-code.ts` imports `claudeCodeProvider`, and `claude-code.ts` is the only SDK importer today — so removing the const export (Task 1) and moving the `query` value import to `registry.ts` (Task 2) is fully contained and introduces no duplicate or dangling import.
- All four guardrail commands exist: root `typecheck`/`lint`/`test` and `testing-project`'s `check:config`.

Task ordering (1 → 2 → 3, with 4 gating on all three) is sound, dependencies are stated correctly, each task block is self-contained (Goal/Files/Changes/Depends on/Traces to/Acceptance), and the acceptance criteria are concrete and verifiable (`=== undefined` checks, reference-inequality for copy-not-mutate, the pre-`finally` assertion that catches an in-place mutation, and exit-zero guardrails). No unresolved design choice is left to the code-writer; the open questions from the design (`delete` vs `= undefined`, optional companion helper test) are resolved or correctly marked non-load-bearing.

## Issues

None.
