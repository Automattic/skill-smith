# Docs Summary

## What

Three consumer-facing documentation surfaces for the `claude-code` subscription-auth bugfix:

- **`.changeset/claude-code-subscription-auth.md`** (new) — a `patch` release entry for `@automattic/skillsmith` describing the fix in consumer/symptom terms.
- **`.env.example`** — a clarifying note under `ANTHROPIC_API_KEY` explaining that `claude-code` does not use it and authenticates via the Claude Code subscription instead.
- **`examples/skillsmith.config.ts`** — a sharpened inline comment on the `claude-code` agents replacing the vague "uses your local CC auth" with an accurate auth-model statement.

## Why

The shipped code makes the `claude-code` provider scrub `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment it hands the Claude Code SDK, so the provider authenticates through the user's Claude Code subscription even when those pay-as-you-go credentials are exported (previously it could silently bill or block on the API account, failing with a credit-balance error when out of credit). This is a release-relevant, user-facing behavior change, so it requires the mandatory changeset, and the two prose surfaces that describe how `claude-code` authenticates would otherwise go stale and mislead users into thinking `ANTHROPIC_API_KEY` powers `claude-code`.

## How

Each surface was written against the shipped provider code as the accuracy oracle (`src/providers/claude-code.ts`, `src/providers/registry.ts`): the exact two scrubbed keys, the copy-not-mutate helper that leaves `process.env` intact for `anthropic-api`, and the retained `CLAUDE_CODE_OAUTH_TOKEN` subscription path. The changeset follows the direct-write shape in `CONTRIBUTING.md` (single front-matter key equal to `package.json:name`, mapped to `patch`, non-empty body, imperative present tense, no conventional-commit or `BREAKING:` prefix). The `.env.example` note and config comment stay proportional — a clarifying note and a one-to-two-sentence comment, not an auth tutorial — and leave all other provider entries/comments verbatim. The four docs-phase guardrails (`validate-changesets`, `changeset status`, `lint`, `typecheck`) were run on review and all pass.

## Key decisions

- **`patch`, not `minor`.** Per the `CONTRIBUTING.md` bump-type table, a bug fix to existing provider behaviour is a `patch`; the change adds no provider and does not widen/narrow `ProviderId`. As a non-breaking change pre-1.0, the `minor`-with-`BREAKING:` rule does not apply.
- **No second changeset for the comment edit.** `CONTRIBUTING.md` requires a changeset for `examples/skillsmith.config.ts` only when the change exercises a new public API; this edit is comment-only, so it rides under the single Task 1 changeset.
- **No `CLAUDE_CODE_OAUTH_TOKEN=` placeholder added to `.env.example`.** The token is mentioned in prose as the headless/CI subscription path, but no `=` entry line was added, keeping the note a clarification rather than implying a required key.
- **Seven surfaces deliberately left unchanged.** `README.md`, `CHANGELOG.md` (Changesets-automated), `CONTRIBUTING.md`, `docs/index.html`, `AGENTS.md`, the `testing-project/` fixture, and the internal `src/` implementation files were swept and given no doc task, because none describes per-provider auth that the fix makes stale. All remain untouched in the diff.

## Known limitations

- The "subscription wins when the pay-as-you-go keys are absent" behavior documented in the prose rests on the Claude Code binary's documented authentication precedence (doc-derived, not byte-verified), as recorded in the design doc's risks. The docs describe the intended and code-supported behavior; end-to-end confirmation against a live out-of-credit account is deferred to credentialed integration testing.
