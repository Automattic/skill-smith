# DP5 release documentation validation

Validated `.changeset/nested-scenario-folders.md` against the shipped nested scenario folder implementation and the user-facing docs updated in DP1-DP4.

- The changeset uses a `minor` bump for `@automattic/skillsmith`.
- The release-note text covers recursive discovery, CLI/API scenario-or-folder filters, the new normalized hook/API-visible `RunScenario.id`, and the retained `dirName` alias.
- The changeset does not claim that report JSON keys, progress identity, self-improvement identity, or artifact directories moved from `scenario.name` to nested source paths.
- `CONTRIBUTING.md` already documents the repository changeset policy; no policy gap was found.
- `CHANGELOG.md` was not edited.

`package.json` has no docs-specific formatting/check script. Required changeset guardrails were run after this validation note was added.
