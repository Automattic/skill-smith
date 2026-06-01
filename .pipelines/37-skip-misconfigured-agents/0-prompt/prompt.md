# Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37

## Goal

When `skillsmith` runs in a project whose `skillsmith.config.ts` defines agents, any agent that is misconfigured — e.g. an invalid API token, a provider that doesn't exist, or similar configuration errors — is skipped for the entire run rather than causing failures or being partially executed. A skipped agent does no work in any phase: testers don't generate code, judges don't review, and the agent is excluded from evaluation in subsequent iterations. In effect, misconfigured agents are ignored everywhere for that run.

## Constraints

- Hooks must be informed about misconfigured agents — either the set of agent definitions that failed, or the filtered list of agents that will actually run (whichever shape makes more sense; the exact contract is open for the design phase).

## Assumptions / directions to explore

- The CLI already announces failing agents today. *(Open — to be confirmed; the desired behavior is that failures continue to be surfaced in the CLI.)*
