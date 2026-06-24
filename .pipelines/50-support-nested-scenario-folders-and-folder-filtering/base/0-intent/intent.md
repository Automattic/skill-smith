# Support nested scenario folders and folder filtering

> Source: GitHub issue #50: https://github.com/Automattic/skillsmith/issues/50.
> This file is self-contained; agents do not need to open the source issue.

## Goal

Skillsmith consumers can organize scenarios in nested folders under `scenarios/`, and Skillsmith still discovers and runs them. Consumers can also filter runs to scenarios inside a specific folder, similar to Playwright's folder-based filtering.

## Assumptions / directions to explore

Treat the Playwright behavior as a useful model, but confirm during spec/design whether Skillsmith should match it exactly or only support the same core workflow.
