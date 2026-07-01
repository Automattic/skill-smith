---
"@automattic/skillsmith": minor
---

BREAKING: Redefine scenarios as `TESTING-AGENT.md` + `JUDGE.md` and run the judge live against an
isolated workspace copy. A scenario is now a folder containing `TESTING-AGENT.md` (the testing
agent's instructions, which MUST include a `# Skills` section) and `JUDGE.md` (the judge's
instructions); the old `scenario.yaml` is gone. The `Scenario` type drops `description`, `prompt`,
and `acceptance`, and no longer carries a `rubrics` field. `JUDGE.md` is fully opaque prose: it has
no `# Rubrics` section, Skillsmith does no id-matching, and there is no enumeration-time rubric
validation. A scenario author names the rubric to grade against in natural-language prose inside
`JUDGE.md`. Skillsmith loads **all** rubrics from the optional `paths.rubrics` location and injects
every one of them into the judge's prompt; the judge's prose selects which of the injected rubrics
apply. `paths.rubrics` stays optional — there is no default and no existence gate; it is loaded only
when a project sets it. On every run the judge is auto-supplied the testing agent's task (the
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
`JUDGE.md`; describe in `JUDGE.md` prose which rubric to grade against instead of listing rubric
ids; update judge handling to read `{ pass, notes }` instead of a score; declare the judge's
`capabilities` (and, if the judge environment is shared/non-reentrant, set
`roles.judge.concurrency: 'serial'`) in your project config; stand up your own live/e2e gate.
