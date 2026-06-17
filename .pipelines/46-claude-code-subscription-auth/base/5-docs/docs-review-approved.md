# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed (all tasks in `doc-plan.md`):

- **Doc Task 1:** Author the release changeset (`.changeset/claude-code-subscription-auth.md`).
- **Doc Task 2:** Update `.env.example` to clarify `claude-code` does not use the pay-as-you-go keys.
- **Doc Task 3:** Sharpen the `claude-code` auth comment in `examples/skillsmith.config.ts`.

Diff base ref: `9541456` → HEAD (`df4f83b`).

## Summary

All three doc tasks satisfy their per-task Acceptance criteria, accurately reflect the shipped code, and stay within the doc plan's deliberately minimal scope. The changeset is a single new `patch` file keyed to `@automattic/skillsmith` with a non-empty, consumer/symptom-framed body and no `BREAKING:` or conventional-commit prefix — correct for a bug fix to existing provider behaviour pre-1.0. The `.env.example` note and the `examples/skillsmith.config.ts` comment both accurately state that `claude-code` authenticates via the Claude Code subscription (interactive `/login` or `CLAUDE_CODE_OAUTH_TOKEN`), that `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are excluded from `claude-code`, and that `anthropic-api` still uses `ANTHROPIC_API_KEY` — matching `claude-code.ts` (the two scrubbed keys, the copy-not-mutate helper) and `registry.ts` (unchanged `anthropic-api` registration). No second changeset was added for the comment-only edit, as the plan required. The seven "Surfaces deliberately left unchanged" all remain untouched; no public surface introduced by the code lacks documentation. All four docs-phase guardrails were run and pass.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass (exit 0) |
| changeset-status | `npx changeset status --since=origin/trunk` | pass (exit 0; reports `@automattic/skillsmith` pending at `patch`) |
| lint | `npm run lint` | pass (exit 0; 96 files, no fixes) |
| typecheck | `npm run typecheck` | pass (exit 0; `tsc --noEmit` clean) |

## Accuracy spot-check

- **Doc Task 1 (changeset).** Claim: this is a `patch` bump for `@automattic/skillsmith`. Verified: `package.json:name` is `@automattic/skillsmith` (matches the front-matter key) and `version` is `0.1.0` (pre-1.0). Per the `CONTRIBUTING.md` bump-type table, "Bug fix to existing ... provider behaviour" is a `patch`; this fix changes no provider count and does not widen/narrow `ProviderId`, so `minor` does not apply, and as a non-breaking change the pre-1.0 `BREAKING:`/`minor` rule does not apply. The body's claim that "`anthropic-api` provider continues to use the API credential exactly as before" is verified by `registry.ts:17` (unchanged `anthropicApiProvider` registration) and `claude-code.ts:38-42` (scrub operates on a copy, never mutating `process.env`). `changeset status` confirms exactly one pending `patch`.
- **Doc Task 2 (`.env.example`).** Claim: "`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are excluded from `claude-code`." Verified against `claude-code.ts:24-27` — `CLAUDE_CODE_SCRUBBED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]` — exactly those two keys, no more, no fewer. Claim that they "still power `anthropic-api` as usual" matches the copy-not-mutate helper at `claude-code.ts:38-42`. The note stays scoped to the two pay-as-you-go keys and the subscription path; no out-of-scope variables (cloud-backend switches, base-URL overrides) appear. The existing `openai-api`/`gemini-api` entries are unchanged.
- **Doc Task 3 (`examples/skillsmith.config.ts`).** Claim: "It uses the subscription even when a pay-as-you-go Anthropic credential is also exported — that credential is ignored here." Verified: `claude-code.ts:87` injects `env: claudeCodeEnv(process.env)` into the query options, and `claudeCodeEnv` strips the two pay-as-you-go keys, so the spawned binary falls through to subscription auth even when those keys are exported — consistent with Spec Requirements 1-3 and the design's precedence chain. The adjacent `anthropic-api` comment ("uses ANTHROPIC_API_KEY") and all other provider comments/config entries are unchanged; only the `claude-code` comment changed (diff confirms).

## Drift sweep

- The "Surfaces deliberately left unchanged" list (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/index.html`, `AGENTS.md`, `testing-project/skillsmith.config.ts`, and the listed `src/` implementation files) is untouched in the diff; the justifications still hold (the fix does not add a provider or an auth/setup section that those surfaces describe).
- The code introduced no new public/consumer-facing surface that a doc task fails to cover: the refactor is an internal factory seam (`createClaudeCodeProvider`/`QueryFn`/`claudeCodeEnv`), the `Provider` interface and `invoke` signature are unchanged, and the user-observable behavior change (subscription auth) is documented across all three tasks.
- No scope creep: the only non-pipeline, non-shipped-code changes are the three planned doc surfaces; exactly one new changeset exists for this change, and none for the comment-only edit.
