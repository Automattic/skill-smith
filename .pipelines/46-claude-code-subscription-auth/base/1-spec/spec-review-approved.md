# Spec Review

## Verdict: approved

## Summary

The spec is faithful to the intent, tightly scoped to the confirmed auth-behavior bugfix, and grounded in research that I verified against the live codebase. Every consolidated requirement maps cleanly to a numbered requirement and a Given-When-Then acceptance criterion; every out-of-scope exclusion from the research is carried over with its rationale. The spec stays at the WHAT altitude — it describes observable provider behavior (which credentials reach the underlying process, which are preserved, how a no-credential run surfaces) without prescribing the implementation mechanism (no mention of `options.env`, the factory refactor, or the scrub data structure leaks into the requirements). The single measurable success criterion (Requirement 9 / its acceptance criterion) is concrete, offline, deterministic, and demonstrably implementable given the existing codex env-filtering precedent. I found no rejectable gap, ambiguity, contradiction, or scope leak.

## Review notes

The following were checked adversarially and passed:

- **Faithfulness to intent.** The intent's goal (the `claude-code` provider authenticates via the subscription, not a stray `ANTHROPIC_API_KEY`) and its sole constraint (`anthropic-api` keeps using the key) are captured in Requirements 1, 2, and 6. The intent's confirmed assumption (the SDK prefers the key when present) is reflected without overreach.

- **Completeness.** All nine consolidated requirements appear as spec Requirements 1–9 and each has a matching acceptance criterion. The higher-precedence `ANTHROPIC_AUTH_TOKEN` is correctly included (Requirement 2) with justification for why scrubbing the key alone is insufficient.

- **Feasibility (verified against source).** `src/providers/claude-code.ts` calls `query()` with no `env` option (the bug mechanism). `src/providers/anthropic-api.ts:8` reads `process.env.ANTHROPIC_API_KEY` directly, so a `claude-code`-scoped env change cannot affect it — Requirement 6 is satisfiable. `src/providers/codex.ts` is already a factory (`createCodexProvider`) that filters the child env and is wired in `src/providers/registry.ts:10`, and `src/__tests__/providers.test.ts:324` is a direct, reusable template for the Requirement 9 test. Nothing the spec requires is infeasible.

- **Testability / observability.** Requirement 9 and its acceptance criterion pin a concrete observable (the environment handed to the SDK invocation omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, retains `CLAUDE_CODE_OAUTH_TOKEN` and `PATH`) and explicitly require it to run offline, deterministically, without real credentials. This is the right measurable criterion for Requirements 1–4, which are otherwise only observable against the real binary.

- **Consistency.** Requirements, Out of Scope, and Acceptance Criteria agree. Requirement 8 ("fails visibly through the existing failure channel") is consistent with the Out-of-Scope exclusion of auth-specific error messaging; the spec does not promise a curated auth message anywhere.

- **Scope / altitude.** The spec describes behavior, not design. The Overview's "ensuring the pay-as-you-go credentials never reach the Claude Code process" is a behavioral outcome, not a mechanism. The four out-of-scope carve-outs (auth-specific messaging, upfront subscription precheck, cloud-backend switches, base-URL overrides) are explicit and each carries a defensible rationale, preventing scope creep. The change is correctly confined to the `claude-code` provider.
