---
"@automattic/skillsmith": minor
---

Isolate the judge from the canonical workspace and add a judge-concurrency knob. Before grading, the harness copies each agent's `workspace/` to a sibling `judge-workspace/` and runs the judge against the copy, and it snapshots the canonical `workspace/` around the judge phase: if anything mutates the canonical artifact during grading, the pair is marked FAIL with a loud warning. The `beforeJudgeAgent`/`afterJudgeAgent` hooks receive the new `judgeWorkspace` path so projects can build and tear down the judge's environment from the copy. A new optional `roles.judge.concurrency` (`'serial' | 'parallel'`, default `'parallel'`) serializes the whole `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket under a single run-wide lock when set to `'serial'`, so concurrent grades never collide on a shared, non-reentrant environment; the testing phase stays fully parallel regardless.
