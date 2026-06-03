# PR #41 description — Change 3 (prettier:false) trade-off note

> **Changesets formatting (`prettier: false`) — a deliberate decoupling trade-off, not a bug fix.**
> `.changeset/config.json` now sets `"prettier": false`. This is the **recommended default**: it is the single switch that disables Prettier across both Changesets paths that use it (`changeset version` and `changeset add`), removing this repo's tacit dependence on the undeclared transitive `prettier@2.8.8` (pulled in via `@changesets/cli`) so the changelog tooling no longer couples to a formatter the Biome-only toolchain does not use.
>
> The cost is **purely cosmetic** — `CHANGELOG.md` spacing only, on a file Biome cannot format anyway (Biome 2.4.x does not format Markdown). Exact before/after for a minor bump:
> - `prettier: true` → `## 0.2.0` · blank line · `### Minor Changes` · blank line · `- <entry>` (normalized).
> - `prettier: false` → `## 0.2.0` · `### Minor Changes` (no blank line) then the entry with tighter spacing.
>
> Both render correctly. `package.json` is unaffected either way (`changeset version` preserves its tabs via `detect-indent`).
>
> **Owner-selectable alternative:** keep `prettier: true` for normalized changelog spacing — but then the repo should honestly declare Prettier as an explicit `devDependency`, which reintroduces a second formatter alongside Biome (the dual-formatter coupling this change set out to remove). Recommendation remains `prettier: false`.
