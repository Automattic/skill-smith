# claude-code provider authenticates with ANTHROPIC_API_KEY instead of the Claude Code subscription

> Source: GitHub issue [#46](https://github.com/Automattic/skillsmith/issues/46).
> This file is self-contained; agents do not need to open the source issue.

## Goal

When a user runs the `claude-code` provider, it authenticates through their Claude Code subscription login and does not rely on `ANTHROPIC_API_KEY`. A user who simply has the key exported in their environment (for the `anthropic-api` provider, or otherwise) is not silently billed against — or blocked by — their pay-as-you-go API account.

## Constraints

- The `anthropic-api` provider must keep using `ANTHROPIC_API_KEY` as it does today; this change is scoped to the `claude-code` provider's auth behavior.

## Context

- Today, when the API account tied to an exported `ANTHROPIC_API_KEY` is out of credit, every `claude-code` agent fails with: `Claude Code returned an error result: Credit balance is too low`.
- The `claude-code` provider runs through `@anthropic-ai/claude-agent-sdk`'s `query()` (`src/providers/claude-code.ts`) and does not read the key directly; `anthropic-api` explicitly reads `ANTHROPIC_API_KEY` (`src/providers/anthropic-api.ts`).

## Assumptions / directions to explore

_Open — the agents will confirm or revise these in later phases._

- The billing surprise is believed to come from the Claude Agent SDK preferring `ANTHROPIC_API_KEY` (pay-as-you-go) over the subscription login whenever the key is present in the environment.
