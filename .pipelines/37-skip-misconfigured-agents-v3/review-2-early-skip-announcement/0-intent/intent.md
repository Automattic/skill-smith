# Surface misconfigured-agent skips early in the run

## Origin

PR #45 review by the owner, 2026-06-16 — <https://github.com/Automattic/skillsmith/pull/45#pullrequestreview-4507823218>.

This file is self-contained; agents do not need to open the source.

The owner tested the v3 changes locally and reported:

> I tested it locally, and I think something needs to be fixed here.
>
> Users running `skillsmith` would want to know early in execution that a configured model is unavailable and why. With the current changes, the announcement informing about a skipped agent appears at the end, when the command exits. This should happen at the moment this circumstance is known, similar to other errors.
>
> As a reminder, when this info/warning message is printed, it should respect the logic that updates the printed output so the text is not pushed down in the terminal.

## Goal

A user running `skillsmith` learns that a configured agent/model is unavailable — and why — **early in execution, at the moment the misconfiguration is detected**, rather than only at the end when the command exits. The skip is surfaced at detection time, consistent with how other errors are already surfaced to the user.

## Constraints

- The skip announcement must respect the existing live-output update logic, so it integrates with the dynamically-updating terminal output and does not push the updating text down or corrupt the rendering.
- Misconfigured agents must remain skipped across all phases of the run (the v3 behavior). This review changes **when and how** the skip is announced, not the skip behavior itself.

## Assumptions / directions to explore

- The current code emits the skip announcement at command exit; the fix is to emit it at detection time. *(Open — agents to confirm where detection occurs and where the announcement is currently produced.)*
- "Similar to other errors" implies there is an existing early-error-surfacing pattern this change should follow and reuse. *(Open.)*
