# Doc Plan: Nested scenario folders and folder filtering

## Overview

Update Skillsmith's user-facing and maintainer-facing documentation so users understand that scenarios can live in nested folders, that selectable scenario IDs are normalized paths relative to `config.paths.scenarios`, and that CLI/API filters can target either exact scenario IDs or parent folders. The docs phase should update the README, the docs landing page, public type/comment surfaces, and the release changeset while preserving the documented distinction between source-folder IDs used for discovery/selection and `scenario.name` values used for reports, progress, self-improvement, and artifact layout.

## Tasks

### Task 1: Update README usage for nested scenario IDs and scenario-or-folder filters

- **ID:** DP1
- **Goal:** Teach package users how nested scenario discovery and filtering work from the primary README usage section.
- **Audience:** Skillsmith users running the CLI or calling the public API, including users migrating from flat scenario folders.
- **Files:**
  - `README.md`
- **Sections-scope:**
  - In `How the Skill Tester works` → `Usage`, revise the targeted-run examples and explanatory prose.
  - Cover all shipped selection semantics at a user level: scenario IDs as `/`-separated paths relative to `config.paths.scenarios`; flat IDs continuing to work; exact scenario filters; parent folder filters; `.`/root selection if documented by the final implementation; trimming and harmless normalization; duplicate/overlap de-duping; unknown and empty-filter failures; and the fact that filters do not match `scenario.name`.
  - Keep examples concise and implementation-accurate by reading the final CLI/API behavior before writing; do not document glob, regex, file/line, absolute-path, traversal, or title/name filtering.
- **Depends on:** none
- **Traces to:** Spec requirements 1-4, 10-28, 32-34; acceptance criteria for flat and nested discovery, exact filters, folder filters, normalization, duplicate/overlap handling, empty/unknown errors, `scenario.name` non-filtering, and user docs; Code tasks T2, T3, T4, T5.
- **Acceptance:**
  - Readers can identify the scenario ID for both a flat scenario and a nested scenario by looking at its path under `config.paths.scenarios`.
  - Readers can run one exact nested scenario or all scenarios under a parent folder from either CLI positionals or API `run({ scenarios })` filters.
  - Readers understand which common spelling variations are normalized, that overlapping filters do not run a scenario twice, and that unsafe/empty/unknown filters fail before work starts.
  - Readers understand that `scenario.name` is not a filter key.

### Task 2: Update README lifecycle, hooks, and output identity documentation

- **ID:** DP2
- **Goal:** Keep the README's runtime-contract documentation accurate now that selected scenarios expose normalized IDs while reports and artifacts remain name-keyed.
- **Audience:** Hook authors, self-improvement users, and maintainers who rely on report JSON, progress output, or artifact paths.
- **Files:**
  - `README.md`
- **Sections-scope:**
  - In `Lifecycle`, update the initialization and `beforeAll` descriptions so filters are described as scenario-or-folder filters and selected entries are described as scenario records with normalized source IDs and parsed scenario bodies.
  - In `Hook examples`, `How the Self-Improvement works`, the run-directory tree, and `afterAllScenarios` guidance, clarify only where needed that reports, progress, self-improvement scopes, verification failures, and iteration artifact directories remain keyed by `scenario.name` rather than nested source paths.
  - Mention the hook-visible identity fields added by the implementation at a conceptual level: the normalized scenario ID and the compatibility directory-name alias. Avoid prescribing exact TypeScript signatures beyond what the final public types expose.
  - If the final implementation's output tree or hook contract differs from the design, document the shipped behavior and flag any contradiction to the lead before writing beyond the code/spec boundary.
- **Depends on:** DP1
- **Traces to:** Spec requirements 28-31; acceptance criteria for `scenario.name` non-filtering, duplicate-name failures, preserved name-based outputs, and hook-visible scenario identity; Design decisions “Add canonical scenario IDs while preserving `dirName`” and “Keep public outputs keyed by `scenario.name`”; Code tasks T1 and T4.
- **Acceptance:**
  - Hook authors know where to read the normalized source identity for a selected scenario and that the legacy directory-name alias remains available as shipped.
  - Readers do not come away expecting report JSON keys, progress labels, self-improvement identity, or artifact directories to be based on nested source paths.
  - Readers understand why duplicate configured scenario names are rejected before agent work.
  - Existing README examples that use `scenario.name` for artifact naming remain accurate or are updated to explain the compatibility boundary.

### Task 3: Refresh the docs landing page usage examples

- **ID:** DP3
- **Goal:** Ensure the hosted docs site's concise “Use it” section reflects nested scenario folders and folder filtering without becoming a full reference duplicate of the README.
- **Audience:** Prospective and new Skillsmith users reading the docs landing page.
- **Files:**
  - `docs/index.html`
- **Sections-scope:**
  - In the `Use it` section, update the heading/body copy and terminal examples that currently refer to simple scenario directories and targeting one scenario by directory ID.
  - Include at least one nested scenario ID example and one parent-folder filter example, using terminology consistent with the README and shipped CLI usage.
  - Keep the landing page brief; link or point readers to the README if the final docs site already has a pattern for deeper reference material.
- **Depends on:** DP1
- **Traces to:** Spec requirements 32-34; acceptance criterion that users can identify normalized relative scenario IDs and parent folder filters from documentation; Design component “Documentation surfaces”; Code task T5.
- **Acceptance:**
  - A landing-page reader can tell that nested scenarios are supported and that a parent folder can target multiple scenarios.
  - The examples are consistent with the README and final CLI usage wording.
  - The docs site does not imply filtering by `scenario.name`, glob syntax, regex syntax, or absolute paths.

### Task 4: Audit public comments and examples for identity terminology drift

- **ID:** DP4
- **Goal:** Update lightweight documentation embedded in public types, examples, and project helper comments so maintainers do not confuse normalized IDs with name-keyed outputs.
- **Audience:** TypeScript consumers, example readers, and maintainers of project hooks or verification helpers.
- **Files:**
  - `src/config/types.ts`
  - `examples/skillsmith.config.ts` if the final implementation or examples mention scenario filtering, scenario directories, or hook-visible scenario identity
  - `testing-project/eval/utils/verify-e2e.ts` if its comments still explain scenario directory mapping in terms that are inaccurate for nested IDs
  - Any adjacent source comments introduced by the implementation that describe `RunScenario.id`, `dirName`, scenario directory IDs, or name-keyed artifact/report behavior
- **Sections-scope:**
  - Review public type comments for `RunScenario` and hook context structures, documenting the normalized scenario ID and compatibility alias at a high level.
  - Review example and fixture comments that mention scenario directories, e2e spec paths, artifact directories, or `dirName`/`scenario.name` mappings; adjust only comments/docs, not behavior.
  - Do not document internal-only implementation details such as selection helper names, private provenance markers, or test-only stub naming unless those details appear in public docs by mistake and need removal.
- **Depends on:** DP2
- **Traces to:** Spec requirements 28-31; acceptance criteria for `RunScenario.id`/`dirName` hook-visible identity and preserved name-based reports/artifacts; Code tasks T1, T4, and T7.
- **Acceptance:**
  - Public type comments give TypeScript consumers enough context to distinguish source-selection identity from display/report identity.
  - Example and fixture comments remain true when `dirName`/the compatibility alias contains a nested `/`-separated path.
  - No docs or comments expose internal-only fields or imply that artifacts were redesigned around nested paths.

### Task 5: Validate and align release documentation

- **ID:** DP5
- **Goal:** Ensure the release note artifacts describe the consumer-visible documentation-relevant behavior and pass repository changeset guardrails.
- **Audience:** Maintainers reviewing the PR and package consumers reading the generated changelog/release notes.
- **Files:**
  - `.changeset/*.md` file added for this feature
  - `CONTRIBUTING.md` only if the shipped changes reveal an actual repo-policy documentation gap; otherwise leave it unchanged
  - Do not edit `CHANGELOG.md` directly in this PR; it is generated by Changesets during release
- **Sections-scope:**
  - Review the feature changeset created by the code phase for a minor bump on `@automattic/skillsmith` and consumer-facing language covering recursive discovery, scenario-or-folder filters, and the new normalized hook/API-visible scenario ID with the compatibility alias.
  - Confirm the changeset does not claim report JSON keys, progress identity, self-improvement identity, or artifact directories moved to nested source paths.
  - Run the changeset/documentation guardrails after any docs edits: `npx tsx scripts/validate-changesets.ts` and `npx changeset status --since=origin/trunk`. Also run any repository docs formatting/check command if one exists in `package.json` after reading the final scripts.
- **Depends on:** DP1, DP2, DP3, DP4
- **Traces to:** Repository changeset convention in `AGENTS.md` and `CONTRIBUTING.md`; Spec requirements 32-34; Design decision “Update existing docs and record a minor changeset”; Code tasks T6 and T7.
- **Acceptance:**
  - The changeset is release-note ready from a consumer perspective and matches the documented shipped behavior.
  - Required changeset validation commands pass, or any failure is reported with the command output and root cause.
  - The docs phase does not hand-edit generated changelog content or duplicate implementation work.
