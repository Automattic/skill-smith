# Doc Plan: claude-code provider authenticates via the Claude Code subscription, not a stray API key

## Overview

The shipped code makes the `claude-code` provider scrub the two pay-as-you-go Anthropic credentials (`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`) from the environment it hands the Claude Code SDK, so the provider authenticates through the user's Claude Code subscription (interactive `/login` OAuth, or `CLAUDE_CODE_OAUTH_TOKEN`) even when those keys are exported. The separate `anthropic-api` provider is unaffected and still uses `ANTHROPIC_API_KEY`. This is a user-facing behavior change to provider authentication, so it is release-relevant and gated by the project's changeset guardrails. This plan covers the two consumer-facing prose surfaces that describe how `claude-code` authenticates and would otherwise go stale (`.env.example` and the comment in `examples/skillsmith.config.ts`), plus the mandatory changeset. Surfaces that were swept and deliberately need no change are listed under "Surfaces deliberately left unchanged" so the next phase does not re-litigate them. This is a small internal bugfix; the plan is intentionally minimal and avoids over-documenting.

## Tasks

### Task 1: Author the release changeset

- **Goal:** Add a committed `.changeset/*.md` file recording this release-relevant bugfix to `claude-code` provider authentication, written from the consumer's perspective, so the changeset guardrails pass and the change appears in `CHANGELOG.md` on release.
- **Audience:** Consumers of `@automattic/skillsmith` reading the changelog / release notes, and maintainers reviewing the release.
- **Files to change:** A new file under `.changeset/` (e.g. `.changeset/<short-descriptive-name>.md`). Do not edit `CHANGELOG.md` directly — Changesets automation appends to it on release.
- **Sections / scope:**
  - Use the **direct-write** changeset shape documented in `CONTRIBUTING.md#how-to-add-a-changeset`: YAML front matter with the single key equal to `package.json:name` (`"@automattic/skillsmith"`) mapped to the bump type, then a non-empty body.
  - **Bump type: `patch`.** Rationale: per the bump-type table in `CONTRIBUTING.md`, a "Bug fix to existing ... provider behaviour" is a `patch`. This change corrects which credential the existing `claude-code` provider authenticates with; it adds no new provider, no new option, and does not widen or narrow `ProviderId`, so it is not `minor`. It is not a breaking change, so the pre-1.0 `minor`-with-`BREAKING:` rule (for breaking changes only) does not apply, and `patch` is permitted pre-1.0.
  - Write the summary following the `CONTRIBUTING.md#summary-format-conventions`: imperative present tense, no conventional-commit prefix, framed in user-observable symptom terms (the consumer-perspective writing guidance treats a bug fix the user may not have observed as deserving a symptom-framed entry). The body should make clear, in consumer terms, that the `claude-code` provider now authenticates via the Claude Code subscription even when a pay-as-you-go Anthropic credential is present in the environment, and that the `anthropic-api` provider is unaffected. Do not lock to exact env-var spellings or code identifiers beyond what a consumer needs; the doc-writer confirms the precise behavior against the shipped code.
- **Depends on:** none
- **Traces to:** Spec Overview and Requirements 1–7 (the user-facing behavior change being released); the project's mandatory-changeset requirement in `AGENTS.md` / `CONTRIBUTING.md`; the docs-phase `changeset-format` and `changeset-status` guardrails. (Code plan flags the changeset as docs-phase work explicitly excluded from `code-plan.md`.)
- **Acceptance:**
  - A reader of the changeset understands, in consumer terms, that `claude-code` now authenticates via the Claude Code subscription rather than a stray pay-as-you-go API credential, and that `anthropic-api` is unchanged.
  - The changeset is a single new file under `.changeset/` whose front matter maps `"@automattic/skillsmith"` to `patch` and whose body is non-empty, matching the direct-write shape in `CONTRIBUTING.md`.
  - The bump type is `patch` with no `BREAKING:` prefix; the summary uses imperative present tense and carries no conventional-commit prefix.
  - `npx tsx scripts/validate-changesets.ts` passes (the `changeset-format` guardrail).
  - `npx changeset status --since=origin/trunk` reports the pending change (the `changeset-status` guardrail).

### Task 2: Update `.env.example` to clarify `claude-code` does not use the pay-as-you-go keys

- **Goal:** Make the project's primary "which env vars do I need" reference accurately reflect that the `claude-code` provider authenticates via the Claude Code subscription and that exporting `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) does not route `claude-code` through the pay-as-you-go API account. Keep the existing per-provider key guidance for `anthropic-api`, `openai-api`, and `gemini-api` intact.
- **Audience:** New and existing users setting up their environment before running Skillsmith — people who copy `.env.example` to `.env` and decide which keys to fill in.
- **Files to change:** `.env.example`
- **Sections / scope:**
  - Add a short comment that tells the reader the `claude-code` provider authenticates through the Claude Code subscription (interactive `/login`, or the `CLAUDE_CODE_OAUTH_TOKEN` headless/CI token) and that the pay-as-you-go Anthropic credentials listed for `anthropic-api` are not used by — and are actively excluded from — `claude-code`. This corrects the current omission, where a reader could reasonably assume the `ANTHROPIC_API_KEY` entry also powers `claude-code`.
  - Keep this guidance proportional: it is a clarifying note, not a full auth guide. Do not turn `.env.example` into a tutorial; do not add placeholder `=` lines for subscription tokens unless the doc-writer confirms against the shipped code that listing `CLAUDE_CODE_OAUTH_TOKEN` as an optional entry is warranted and consistent with how the provider reads it. Preserve the file's existing comment style and the existing entries verbatim except for the added clarification.
  - The doc-writer must read the shipped provider code to confirm the exact scrubbed keys and the subscription-credential mechanism before wording the note; do not restate the design's internal identifiers (helper/constant names) here.
- **Sections / scope — explicit non-goal:** Do not document cloud-backend switches, base-URL overrides, or any variable outside the two scrubbed pay-as-you-go keys (all out of scope per the spec).
- **Depends on:** none (can land independently; no ordering dependency on Task 1)
- **Traces to:** Spec Requirements 1, 2, 3, 6 (claude-code excludes the pay-as-you-go keys and uses the subscription; `CLAUDE_CODE_OAUTH_TOKEN` still works; `anthropic-api` still uses `ANTHROPIC_API_KEY`); Spec Overview. Code plan Task 1 (the env scrub of `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`).
- **Acceptance:**
  - After reading `.env.example`, a user knows that filling in `ANTHROPIC_API_KEY` powers the `anthropic-api` provider but does not make `claude-code` authenticate against the pay-as-you-go API account, and that `claude-code` instead uses the Claude Code subscription.
  - The file still documents the existing `anthropic-api`, `openai-api`, and `gemini-api` key requirements unchanged.
  - The added note is accurate against the shipped provider behavior (the doc-writer verified it against the code) and does not contradict Spec Requirement 6 (it must not imply `anthropic-api` loses access to `ANTHROPIC_API_KEY`).
  - The note stays scoped to the two pay-as-you-go keys and the subscription path; it does not introduce out-of-scope variables (cloud-backend switches, base-URL overrides).

### Task 3: Sharpen the `claude-code` auth comment in `examples/skillsmith.config.ts`

- **Goal:** Replace the vague "uses your local CC auth" comment on the `claude-code` agents with an accurate statement of the provider's authentication model, so the canonical reference config does not understate or misdescribe how `claude-code` authenticates after the fix.
- **Audience:** Consumers reading the reference config (`examples/skillsmith.config.ts`) to understand how to wire up each provider — the file `README.md` points to as "a reference config showing every provider."
- **Files to change:** `examples/skillsmith.config.ts` (the inline comment introducing the `claude-code` agents, currently around the "Anthropic via Claude Code CLI (uses your local CC auth)" line).
- **Sections / scope:**
  - Update the comment so it conveys that `claude-code` authenticates via the Claude Code subscription (interactive `/login`, or `CLAUDE_CODE_OAUTH_TOKEN`) and, when a pay-as-you-go Anthropic credential is also present in the environment, the provider still uses the subscription rather than that credential. Keep it to a comment — a sentence or two — consistent with the surrounding comment style.
  - Leave the adjacent `anthropic-api` comment ("uses `ANTHROPIC_API_KEY`") and all other provider comments and config entries unchanged; only the `claude-code` auth comment is in scope.
  - The doc-writer must confirm the wording against the shipped provider code rather than copying design-internal identifiers.
  - Note on changeset interaction: `CONTRIBUTING.md` states that a change to `examples/skillsmith.config.ts` requires a changeset only when it "exercises a new public API." This task changes a comment only and exercises no new API, so it does not by itself trigger a separate changeset; it rides under the Task 1 changeset for the overall behavior change. The doc-writer should not add a second changeset for this comment edit.
- **Depends on:** none
- **Traces to:** Spec Requirements 1, 2, 3 (subscription auth despite an exported pay-as-you-go key; `CLAUDE_CODE_OAUTH_TOKEN` still works); Spec Overview. Code plan Task 1 (the env scrub). README line that designates `examples/skillsmith.config.ts` the per-provider reference config.
- **Acceptance:**
  - After reading the comment, a consumer understands that the `claude-code` provider authenticates with the Claude Code subscription and will do so even if a pay-as-you-go Anthropic credential is exported in their environment.
  - The comment is accurate against the shipped provider behavior (verified against the code) and does not contradict Spec Requirement 6 (it must not imply the `anthropic-api` provider stops using `ANTHROPIC_API_KEY`).
  - Only the `claude-code` auth comment changes; the `anthropic-api`/`openai-api`/`gemini-api` comments and all config code remain unchanged.

## Surfaces deliberately left unchanged

These surfaces were swept and are intentionally NOT given a doc task, to avoid over-documenting a small internal bugfix. Recorded explicitly so the docs phase does not re-open them:

- **`README.md`** — The config snippet (lines ~175–176) and the reference-config pointer (line ~202) list `claude-code` as a provider but do not describe its authentication mechanism, so the fix does not make them stale. README has no provider-auth/setup section to update. No change needed.
- **`CHANGELOG.md`** — Maintained by Changesets automation on release; the human-authored entry is delivered via Task 1's changeset, not by editing this file. No direct edit.
- **`CONTRIBUTING.md`** — The provider/versioning policy lines are about changeset rules for adding/removing providers, not about per-provider auth; this bugfix adds no provider. No change needed.
- **`docs/index.html`** — Marketing/landing prose; does not describe providers or their auth. Also exempt from the changeset gate per `CONTRIBUTING.md`. No change needed.
- **`AGENTS.md`** — Project metadata about the changeset requirement; does not describe provider auth. No change needed.
- **`testing-project/skillsmith.config.ts`** — A test fixture (explicitly excluded from the changeset gate); it shows `claude-code` usage with no auth comment, and the spec does not ask for fixture documentation. No change needed.
- **`src/providers/types.ts`, `src/providers/anthropic-api.ts`, `src/providers/lib/vercel-runner.ts`, `src/providers/lib/fs-tools.ts`** — Implementation files. Code-level comments and the refactor itself are the code phase's responsibility (`code-plan.md`), not doc-plan work. In particular, the stale `fs-tools.ts:11` line-number comment is already noted in the design's open questions as a non-forcing cosmetic item for the implementation phase; it is not an auth doc surface. No doc task here.
