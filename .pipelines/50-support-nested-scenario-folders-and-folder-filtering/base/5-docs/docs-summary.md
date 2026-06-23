# What

The docs phase updated Skillsmith documentation and comments for nested scenario folders, normalized scenario IDs, exact/folder filters, hook-visible scenario identity, preserved name-keyed outputs, e2e helper identity mapping, and the release changeset.

# Why

This gives users and maintainers an accurate guide to the new selection behavior while preserving the compatibility boundary around `scenario.name`-based reports, progress, self-improvement scopes, and artifact directories.

# How

README usage and lifecycle docs now explain normalized IDs relative to `config.paths.scenarios`, CLI/API scenario-or-folder filters, normalization/de-dupe/error behavior, and the `scenario.name` non-filtering rule. The docs landing page shows concise nested and folder-filter examples. Public type and helper comments describe `RunScenario.id`, the `dirName` alias, and e2e name/source-ID mapping. The changeset records the consumer-visible minor feature without claiming output layout changes.

# Key decisions

- Keep user-facing selection identity (`id`/`dirName`) distinct from display/report/artifact identity (`scenario.name`).
- Document exact and folder filters, not glob, regex, absolute path, file/line, or scenario-name filtering.
- Treat release documentation as consumer-facing: recursive discovery, shared CLI/API filters, and hook-visible normalized IDs are called out; generated changelog files are not edited.
