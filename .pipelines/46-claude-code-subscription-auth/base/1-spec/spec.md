# Spec: claude-code provider authenticates via the Claude Code subscription, not a stray API key

## Overview

Skillsmith's `claude-code` provider runs coding agents through the Claude Code subscription login. Today, however, whenever an Anthropic pay-as-you-go credential (`ANTHROPIC_API_KEY`, or the higher-precedence `ANTHROPIC_AUTH_TOKEN`) happens to be present in the environment, the underlying Claude Code process silently prefers that credential over the subscription. A user who exports `ANTHROPIC_API_KEY` for the separate `anthropic-api` provider — or for any other reason — is therefore billed against, or blocked by, their pay-as-you-go API account when running `claude-code`. When that API account is out of credit, every `claude-code` agent fails with a credit-balance error even though the user has a working subscription.

This bugfix makes the `claude-code` provider authenticate through the user's Claude Code subscription regardless of whether a pay-as-you-go credential is exported. It does so by ensuring the pay-as-you-go credentials never reach the Claude Code process, while leaving legitimate subscription credentials and the rest of the environment intact. The change is scoped strictly to the `claude-code` provider; the `anthropic-api` provider — which legitimately depends on `ANTHROPIC_API_KEY` — and all other providers are unaffected within the same run.

## Requirements

1. When the user runs the `claude-code` provider with `ANTHROPIC_API_KEY` exported, the provider does not authenticate against the pay-as-you-go API account on the basis of that key; instead it uses the user's Claude Code subscription credentials.

2. When `ANTHROPIC_AUTH_TOKEN` is exported, the `claude-code` provider likewise does not authenticate using that token. (This token has higher authentication precedence than `ANTHROPIC_API_KEY`, so excluding only the API key would leave this override path open; both must be excluded to guarantee subscription authentication.)

3. When the user has set `CLAUDE_CODE_OAUTH_TOKEN` (the long-lived Claude Code subscription token used in CI/headless contexts), the `claude-code` provider still authenticates using it. The fix removes only pay-as-you-go credentials, never legitimate subscription credentials.

4. The `claude-code` provider runs with the remainder of the user's environment intact (for example `PATH`, `HOME`, and other non-authentication variables). The change removes only the specific pay-as-you-go authentication variables, not the broader environment.

5. When the API account tied to an exported `ANTHROPIC_API_KEY` is out of credit, `claude-code` agents no longer fail with a credit-balance error solely because that key was present in the environment. The run proceeds on the subscription instead.

6. In the same process or run, the `anthropic-api` provider continues to read and use `ANTHROPIC_API_KEY` exactly as it does today, including its existing "ANTHROPIC_API_KEY is not set" guard. The `claude-code` authentication change does not remove, alter, or block the key for any other provider.

7. When neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, the `claude-code` provider behaves exactly as it does today: it authenticates via the subscription login and produces equivalent results. The fix introduces no regression in the already-correct case.

8. When the user has neither a usable pay-as-you-go key (now excluded) nor any usable subscription credential (no active `/login` session and no `CLAUDE_CODE_OAUTH_TOKEN`), the `claude-code` run fails visibly: the harness records it as a failed run with an error surfaced through the existing failure channel. The run does not hang silently or appear to succeed.

9. The exclusion behavior is observable by an automated test that runs offline, deterministically, and without real credentials or network access — confirming that the environment handed to the Claude Code invocation omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` while retaining `CLAUDE_CODE_OAUTH_TOKEN` and other non-authentication variables such as `PATH`. This is the measurable success criterion for Requirements 1–4.

## Out of Scope

- **Auth-specific or more legible error messaging.** Improving the `claude-code` failure string into a curated, authentication-specific message (for example "not authenticated — run `/login`") is a separable enhancement. Requirement 8 only requires that the failure surface through the existing failure channel, not that the message be authentication-specific.

- **Upfront subscription precheck.** A proactive guard analogous to `anthropic-api`'s check for a missing key is not in scope. The subscription credential is not a cheaply readable environment variable (it lives in the OS keychain / `~/.claude/.credentials.json`), so any precheck would be brittle or would falsely report failure for the common interactive-login user.

- **Scrubbing cloud-backend switches.** `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, and their dependent cloud authentication variables are not removed. Assumption: a user who set these deliberately chose a cloud backend, and the provider should not silently override that choice; these are realistically unset in the common Skillsmith case.

- **Endpoint / base-URL overrides.** `ANTHROPIC_BASE_URL` and other `*_BASE_URL` variables are not removed. They redirect the request endpoint (for example a corporate proxy), not which credential is selected, and the subscription credential can legitimately be used through them.

- **Changes to other providers' behavior.** Only the `claude-code` provider's authentication behavior changes. `anthropic-api`, `openai-api`, `gemini-api`, `codex`, and `mock` are unchanged in behavior.

## Acceptance Criteria

- Given `ANTHROPIC_API_KEY` is exported in the environment, when the `claude-code` provider invokes a Claude Code agent, then the agent authenticates via the Claude Code subscription and not against the pay-as-you-go API account.

- Given `ANTHROPIC_AUTH_TOKEN` is exported in the environment, when the `claude-code` provider invokes a Claude Code agent, then the agent does not authenticate using that token and instead uses the subscription.

- Given `CLAUDE_CODE_OAUTH_TOKEN` is set, when the `claude-code` provider invokes a Claude Code agent, then the agent still authenticates using that subscription token.

- Given a typical environment containing non-authentication variables such as `PATH` and `HOME`, when the `claude-code` provider invokes a Claude Code agent, then those variables are still available to the agent process and the agent runs normally.

- Given the API account tied to an exported `ANTHROPIC_API_KEY` is out of credit but the user has a working subscription, when a `claude-code` agent runs, then it completes on the subscription rather than failing with a credit-balance error.

- Given the `anthropic-api` provider runs in the same process, when it is invoked with `ANTHROPIC_API_KEY` set, then it uses that key exactly as before; and when `ANTHROPIC_API_KEY` is not set, then it returns its existing "ANTHROPIC_API_KEY is not set" error.

- Given neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, when a `claude-code` agent runs, then it authenticates via the subscription login and produces equivalent results to today, with no regression.

- Given no usable pay-as-you-go key and no usable subscription credential are available, when a `claude-code` agent runs, then the run fails visibly — recorded as a failed run with an error surfaced through the existing failure channel — rather than hanging silently or appearing to succeed.

- Given an offline, deterministic test with no real credentials and `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and `PATH` all set, when the `claude-code` provider invokes the Claude Code SDK, then the environment passed to that invocation omits `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` and retains `CLAUDE_CODE_OAUTH_TOKEN` and `PATH`.
