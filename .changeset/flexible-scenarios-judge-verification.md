---
"@automattic/skillsmith": minor
---

BREAKING: Redefine scenarios as `TESTING-AGENT.md` + `JUDGE.md` and run the judge live against an
isolated workspace copy. A scenario is now a folder containing `TESTING-AGENT.md` (the testing
agent's instructions, which MUST include a `# Skills` section) and `JUDGE.md` (the judge's
instructions); the old `scenario.yaml` is gone. The `Scenario` type drops `description`, `prompt`,
and `acceptance`, and regains an optional `rubrics` field (a list of rubric ids referenced from
`JUDGE.md`); the `Paths` type drops then restores `paths.rubrics` as an optional location. A
`JUDGE.md` may reference reusable rubrics by id under a `# Rubrics` section: each id is resolved from
the optional `paths.rubrics` location and the rubric body is injected into the judge's grading
material (the `{ pass, notes }` verdict is unchanged). The judge no longer returns
a numeric/rubric score: its verdict is now `{ pass, notes }`. Before grading, the harness copies each
agent's `workspace/` to a sibling `judge-workspace/` and runs the judge against that copy with the
project-configured `capabilities` (`tools` / `mcpServers` / `allowWrite` / `network`); the
`beforeJudgeAgent` / `afterJudgeAgent` hooks now receive a `judgeWorkspace` path so projects can
build and tear down the judge's environment from the copy. A new optional
`roles.judge.concurrency` (`'serial' | 'parallel'`, default `'parallel'`) serializes the whole
`beforeJudgeAgent` → judge → `afterJudgeAgent` bracket under a run-wide lock when set to `'serial'`,
so concurrent grades never collide on a shared, non-reentrant environment; the testing phase stays
fully parallel regardless. Projects now own their live environment — Skillsmith no longer ships the
e2e gate.

Migration: replace each `scenario.yaml` with a `TESTING-AGENT.md` (add a `# Skills` section) and a
`JUDGE.md`; update judge handling to read `{ pass, notes }` instead of a score; declare the judge's
`capabilities` (and, if the judge environment is shared/non-reentrant, set
`roles.judge.concurrency: 'serial'`) in your project config; stand up your own live/e2e gate.
