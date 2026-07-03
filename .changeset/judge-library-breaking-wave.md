---
"@automattic/skillsmith": minor
---

BREAKING: Retire the standalone judge prompt and rubric-paths config in favor of the judge library,
centralize the pass/fail decision rule in the harness, and drop the `dirName` alias from the
hook-visible scenario records.

`roles.judge.prompt` and `paths.rubrics` are removed. Both are now rejected at validation time with
a migration message rather than silently ignored, so a stale config fails fast instead of losing its
grading material. They are replaced by a single `roles.judge.library` directory. To migrate: move
the judge manual into that directory's `README.md` (it is inlined into the judge's system prompt as
the reusable environment manual), move the rubric files into the same directory, set
`roles.judge.library` to its project-relative path, and point each `JUDGE.md` brief at the material
by its `judge-library/<rel>` path (the directory is copied to `judge-library/` inside the judge's
working directory for every graded pair).

The all-must-pass decision rule is centralized into the harness's judge output instruction: the
judge is told to pass only when every check the brief asks for is satisfied. Brief authors should
drop the per-brief decision-rule opener — it is now supplied once by the harness. A brief that
states its own decision rule in prose still overrides the default.

`RunScenario`, `EnumeratedScenario`, and `ScenarioRunRecord` no longer carry a `dirName` field; use
`id` instead (the scenario directory path relative to the scenarios root, normalized to `/`
separators). Hook code that destructures `dirName` must be updated to read `id`.
