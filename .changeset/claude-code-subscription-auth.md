---
"@automattic/skillsmith": patch
---

Fix the `claude-code` provider authenticating against a pay-as-you-go Anthropic API account instead of your Claude Code subscription. The provider now always runs through the subscription login, even when an Anthropic API credential is present in the environment, so `claude-code` agents no longer fail with a credit-balance error when that account is out of credit. The `anthropic-api` provider continues to use the API credential exactly as before.
