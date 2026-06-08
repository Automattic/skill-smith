---
"@automattic/skillsmith": minor
---

Skip a misconfigured agent instead of failing the whole run. An agent whose provider credential is missing is removed from the run, announced once with its id and reason, and recorded in `report.json`'s new top-level `skipped` array.

The run now exits `2` for a configuration error, distinct from `1` for an evaluation failure and `0` for a clean pass; a skip never lets the run exit `0`.

Add the optional `Provider.requiredEnv` field naming the credential env var a provider needs, and expose the skipped set to hooks as the additive `RunContext.skipped` field.
