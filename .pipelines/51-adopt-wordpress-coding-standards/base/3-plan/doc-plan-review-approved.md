# Doc Plan Review

## Verdict: approved

## Summary

The revised doc plan resolves the single issue from iteration 1 and survives a
full adversarial re-read. The plan converges on one correctly-scoped,
genuinely-warranted task: `CONTRIBUTING.md`'s "Running tests and checks locally"
section lists the local checks but is silent on code formatting, and a `format`
script already exists in `package.json` (`biome format --write .`, verified) and
is unmentioned anywhere in prose — so adopting a visible WordPress code style
does create a real contributor-docs sync gap, and Task 1 closes exactly that gap
and nothing more. I independently swept the repo for any documentation prose
describing skillsmith's own code style (double/single quotes, prettier, coding
standard, indentation, delimiter spacing) and found none outside the README's
references to the reference *project under test* (wp-env, Playwright, plugins),
confirming the "surfaces deliberately not changed" list is sound and complete:
the README carries no formatting guidance, `AGENTS.md`/`CLAUDE.md` carry no style
content, the `.rp.md` (line 92) and `release.yml` (line 37) `npm run lint`
references keep working unchanged, no `format:check` script exists (so the plan's
instruction not to invent one is correct), and the changeset/CHANGELOG work is
correctly left to the code phase. The task is drift-resistant (no hardcoded Biome
version, no config-key restatement, draftable in phase 5 against the shipped
`biome.json`), traceable (Spec Req 1/4/7; design Approach steps 2–3 + Config B;
code-plan Tasks 2 and 4), audience-explicit (skillsmith contributors/maintainers,
not package consumers), and carries the two owner-approved authoritative design
corrections (lockfiles not reformatted; multiline imports get an `es5` trailing
comma) as guardrails on any prose. No code is planned. The plan is sound.

## Iteration-1 issue: resolved

The iteration-1 rejection found that Task 1's acceptance criterion #3 enumerated
the preserved local checks **without `npm run smoke`**, contradicting both the
task's own "Files to change" bullet and the actual `CONTRIBUTING.md` (which lists
five checks at lines 9–13, `npm run smoke` on line 12).

The revised criterion #3 (doc-plan.md lines 96–101) now reads: "Every local
check the 'Running tests and checks locally' section listed before this change —
`npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`, and the
`testing-project` `check:config` command — remains present and accurate; nothing
that still works is described as removed, including if the doc-writer
restructures the bullet list into a code-style subsection."

This (a) explicitly enumerates all five checks including `npm run smoke`,
matching the "Files to change" bullet and the real file; (b) adds the
drift-proof "every local check the section listed before this change" framing the
prior review suggested, so the criterion no longer depends on a hand-maintained
list; and (c) preserves the restructure-aware catch-all. The inconsistency is
gone and the criterion is now both complete and drift-resistant. Confirmed
resolved.
