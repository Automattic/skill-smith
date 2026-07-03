---
"@automattic/skillsmith": minor
---

BREAKING: Redefine scenarios as `TESTING-AGENT.md` + `JUDGE.md` and run the judge live against an
isolated workspace copy. A scenario is now a folder containing `TESTING-AGENT.md` (the testing
agent's instructions, which MUST include a `# Skills` section) and `JUDGE.md` (the judge's
instructions); the old `scenario.yaml` is gone. The `Scenario` type drops `description`, `prompt`,
and `acceptance`, and no longer carries a `rubrics` field. `JUDGE.md` is fully opaque prose: it has
no `# Rubrics` section, Skillsmith does no id-matching, and there is no enumeration-time rubric
validation. A scenario author names the material to grade against by relative path in the prose
inside `JUDGE.md`. Grading material lives in a single judge-scoped directory declared by the
optional `roles.judge.library` config key: its `README.md` is inlined into the judge's system
prompt as the reusable environment manual, and for each (scenario, agent) pair the whole directory
is copied to a `judge-library/` folder inside the judge's working directory. The judge is told the
copy's contents — as a manifest of `judge-library/<rel>` paths when it can read files, or with every
file body inlined under `=== judge-library/<rel> ===` labels when it cannot — and instructed to
apply only the items the scenario's brief names, treating the rest as reference-only material.
`roles.judge.library` stays optional — there is no default and no existence gate; the library is
prepared only when a project sets it. On every run the judge is auto-supplied the testing agent's task (the
`TESTING-AGENT.md` brief with its `# Skills` section removed), keeping the judge skill-agnostic. The
judge no longer returns a numeric/rubric score: its verdict is now `{ pass, notes }`, and reporting
and self-improvement are unchanged. Before grading, the harness copies each agent's `workspace/` to a
sibling `judge-workspace/` and runs the judge against that copy with the project-configured
`capabilities` (`tools` / `mcpServers` / `allowWrite` / `network`); the `beforeJudgeAgent` /
`afterJudgeAgent` hooks now receive a `judgeWorkspace` path so projects can build and tear down the
judge's environment from the copy. A new optional `roles.judge.concurrency`
(`'serial' | 'parallel'`, default `'parallel'`) serializes the whole
`beforeJudgeAgent` → judge → `afterJudgeAgent` bracket under a run-wide lock when set to `'serial'`,
so concurrent grades never collide on a shared, non-reentrant environment; the testing phase stays
fully parallel regardless. Projects now own their live environment — Skillsmith no longer ships the
e2e gate.

Migration: replace each `scenario.yaml` with a `TESTING-AGENT.md` (add a `# Skills` section) and a
`JUDGE.md`; collect the grading material (the environment manual as `README.md`, plus any rubric
files) into a single directory and point `roles.judge.library` at it, then have each `JUDGE.md` name
the items to grade against by their `judge-library/<rel>` path; update judge handling to read
`{ pass, notes }` instead of a score; declare the judge's
`capabilities` (and, if the judge environment is shared/non-reentrant, set
`roles.judge.concurrency: 'serial'`) in your project config; stand up your own live/e2e gate.
