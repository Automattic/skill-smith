# Spec review — iteration 1 — REJECTED

Reviewing `spec.md` (commit `38c4a65`) against `requirements.md` and the actual source tree on the branch.

The spec is well-organised, faithful to the requirements doc, and tight on scope. Most of the structural decisions (nine files, anchor-heavy chapters, examples policy, six re-exports, type-stability constraints) carry over cleanly. The Acceptance Criteria are concrete and reviewer-actionable.

However, several requirements that the spec promises the reference must document **verbatim** are themselves stated incorrectly or incompletely in the spec — meaning the spec, used as written, would direct a code-writer to enshrine factual errors as the public contract. There are also a handful of missing surfaces and unclear ambiguities that the design doc and plan phases shouldn't have to invent answers for.

These are blocking. Listed by severity, with concrete fixes.

---

## Blocking issues — factual errors in normative text

### B1. Missing-rubric behaviour contradicts the code (§A.5.5, requirements §5)

The spec at §A.5.5 says, verbatim:

> Rubric files: `<rubricsRoot>/<id>.md`. Missing rubric files do **not** fail enumeration; the judge sees `TO BE FILLED` as the body.

This is wrong on the first half. In `src/scenarios/enumerate.ts:69-83` a missing rubric file is collected into `missing` and the scenario is emitted with `error: \`unresolved reference: rubric "${id}"\``. From `src/pipeline/pipeline.ts:526-540` and `agent-loop.ts`, a scenario with `error !== undefined` short-circuits the agent loop — neither the testing agent nor the judge runs. So **enumeration does fail** that scenario, and **the judge never actually reads `"TO BE FILLED"` on the missing-rubric path**.

The `"TO BE FILLED"` fallback in `src/pipeline/judge-agent.ts:98` is technically still in the source but is only reachable if a rubric file is deleted *between* enumeration and judge dispatch — i.e. effectively dead code under the normal flow.

The reference cannot ship the spec's current sentence; it would teach users a behaviour the harness does not exhibit.

**Fix.** Rewrite the bullet to match the code. Suggested wording:

> **Rubric files** at `<rubricsRoot>/<id>.md`. A rubric referenced by `scenario.yaml` but missing from disk fails enumeration for *that* scenario (the harness records it with `error: 'unresolved reference: rubric "<id>"'` and skips its testing/judge agents). The same is true of any referenced skill whose `<skillsRoot>/<id>/SKILL.md` is missing. The judge has an internal `"TO BE FILLED"` fallback if a rubric vanishes between enumeration and dispatch, but users should treat referenced rubric files as required.

Also drop or rephrase the §A.5.6 implication that a missing rubric is a soft failure.

### B2. Unknown-scenario error format is incomplete (§A.5.2 + Acceptance §4)

§A.5.2 specifies the unknown-scenario format as:

> `"Unknown scenarios: a, b\n\nAvailable scenarios:\n- x"`.

But `src/pipeline/pipeline.ts:472-478` branches on count:

```ts
const label =
    unknown.length === 1
        ? `Unknown scenario: ${unknown[0]}`
        : `Unknown scenarios: ${unknown.join(", ")}`;
```

The single-unknown case uses the singular `"Unknown scenario: <id>"`. Acceptance Criterion §4 promises the reference will document the unknown-scenario format **verbatim** — but the spec only gives the plural form, so a code-writer following it would either omit the singular case or paste an incorrect string.

**Fix.** Document both branches explicitly in §A.5.2 and in the relevant acceptance criterion. Suggested:

> **Unknown scenario(s):** `"Unknown scenario: <id>"` (singular) or `"Unknown scenarios: <id1>, <id2>, …"` (plural), followed by a blank line and `"Available scenarios:\n- <dir1>\n- <dir2>\n..."`.

Also note: the precondition-failure string in §A.5.2 is correct (`src/config/resolve-cwd.ts:61` confirms `\`skillsmith: precondition failed\n  - ${reasons.join("\n  - ")}\``), but is worth stating its source-of-truth file alongside the verbatim string so the docs author can keep them in sync.

### B3. CLI positional-arg trimming is undocumented (§A.5.2)

§A.5.2 says positional args are "matched against directory names under `paths.scenarios`". The actual behaviour at `src/pipeline/pipeline.ts:459` trims each positional arg before matching, and rejects empty strings via `UserFacingError("Scenario IDs must not be empty.")`. The README at `README.md:44` documents trimming and exact match explicitly; the spec should as well, since the reference must replace the README on this surface (per §F).

**Fix.** Add a bullet to §A.5.2:

> Positional args are trimmed before matching. An empty arg (or one that whitespace-trims to empty) fails the run with `"Scenario IDs must not be empty."`. Matching is exact against `paths.scenarios/<dir>` directory names, not against `scenario.name` inside `scenario.yaml`. Duplicate positionals are de-duplicated silently.

### B4. README sentence quoted for replacement is mis-quoted (§D.1 + Acceptance §18)

The spec says:

> **Delete the stale sentence at `README.md:46`** — *"No CLI flags are supported yet, such as `--scenario`, fail before a run starts."*

The actual text at `README.md:46` (verified in current tree) is:

> `No CLI flags are supported yet; option-like arguments such as \`--scenario\` fail before a run starts.`

(Semicolon, not comma; includes "option-like arguments such as".)

A code-writer doing a literal find-and-replace from the spec would not find the sentence and either skip the edit or hand-craft a different string. Since this is a one-line README change, exactness matters.

**Fix.** Quote the line verbatim from `README.md:46` in §D.1 (and the matching Acceptance §18 reference). Either re-quote it correctly or specify "delete the entire `README.md:46` line" without quoting.

### B5. `process.loadEnvFile` vs. "loader hook" wording (§A.5.2)

§A.5.2 says:

> Auto-loads `.env` from `process.cwd()` if present (shell env vars take precedence).
> `tsx/esm` is registered as a loader hook so `src/runner.ts` executes directly.

Two precision issues:

1. **`.env` loading.** The binary calls `process.loadEnvFile(envPath)` (`bin/skillsmith.mjs:7-10`) — Node's built-in `.env` loader, no `dotenv` dependency. Worth naming explicitly so the reader doesn't assume `dotenv` and look for a precedence flag that doesn't exist. The "shell env vars take precedence" claim should be tied to the Node loader's documented semantics, not invented.
2. **`tsx/esm`.** The binary does `import "tsx/esm"` (`bin/skillsmith.mjs:2`), a side-effect import that the `tsx` package registers as the active loader for the rest of the process. "Loader hook" is technically right but the spec should say "side-effect-imported as the loader" so a reader greping for `register('tsx/esm', …)` doesn't get confused.

**Fix.** Adjust the §A.5.2 wording to name `process.loadEnvFile` (Node built-in, Node `>=20.12`) and to say `tsx/esm` is `import`ed for side-effect to register the loader.

---

## Blocking issues — coverage gaps

### B6. CLI `--mode` / `--scope` validation strings are undocumented (§A.5.2 + Acceptance §4)

The CLI also produces user-visible error strings on enum-validation paths that the spec ignores. From `bin/skillsmith.mjs`:

- `--mode` outside `{test-only, self-improvement}` → `\`--mode must be one of "test-only", "self-improvement"\`` then exit 1 (lines 45-50).
- `--scope` outside `{failed-pairs, failed-scenarios, all}` → analogous (lines 62-67).
- `--iterations` not finite or `< 1` → `"--iterations must be an integer >= 1"` then exit 1 (lines 54-59).
- `parseArgs` errors get printed plus a `Usage: ...` line (lines 32-38).

§A.5.2 promises "every CLI flag, positional behaviour, env-var, exit-code path, and user-visible error format" gets documented in `cli.md` (Acceptance §4), but the spec only names the *runtime* errors (precondition, unknown-scenario, missing-key). It's silent on the *argv-parsing* errors above, even though they are also user-visible verbatim strings.

**Fix.** Add a §A.5.2 sub-bullet enumerating the four argv-parsing error strings and their exit code (1). Add to Acceptance §4 the requirement that these four argv-validation strings are documented in `cli.md`.

### B7. `InvokeResult.toolUseCount` and `usage` semantics on the testing report are partially specified (§A.5.6)

§A.5.6 documents `testing = { duration: number (ms), tokenUsage?: TokenUsage }`. Looking at `src/pipeline/agent-loop.ts:196-199`, that's right — the `testing` block persisted to the per-agent `report.json` is exactly those two fields. But the spec doesn't note three observable behaviours a reader will hit:

1. `tokenUsage` is **omitted** (not `null`) when the provider didn't report usage. Some providers always do (claude-code, vercel-runner, codex on success), one never does (mock for `mock-fail-testing`), and any provider error path may omit it. The spec just says "?", which is the right type but doesn't help a JSON-shape reader.
2. For the `mock` provider, `tokenUsage` carries deterministic test values (`mock.ts:34-39`). Worth a one-line aside in `providers.md` since users running smoke tests will see those exact numbers.
3. The `tokenUsage` constraint `totalTokens === inputTokens + outputTokens` and `cachedInputTokens <= inputTokens` is verified in code (`vercel-runner.ts:55-63`, `claude-code.ts:55-63`, `codex.ts:135-141`). The spec records the subset relationship in §A.5.6 but should also explicitly state the addition identity since users will be tempted to add cachedInputTokens themselves.

**Fix.** Tighten §A.5.6 to:

> `tokenUsage` is *omitted* (not present at all) when the provider didn't report usage — typically on testing-agent errors. Where present:
> - `totalTokens === inputTokens + outputTokens` (cache reads are *already inside* `inputTokens`).
> - `cachedInputTokens` is the subset of `inputTokens` served from the prompt cache; `inputTokens - cachedInputTokens` is the "new tokens" the model actually processed.

### B8. Two more `review`-shape failure paths are missing (§A.5.6)

§A.5.6 lists three `review` shapes the doc must illustrate:

- verbose `{ rubrics: {...}, acceptance: [...] }`
- simplified `{ pass, failures? }`
- `{ skipped: "<reason>" }`
- `{ error: "...", raw }`

Two more shapes the harness writes are missing:

1. **Judge dispatch error** (`agent-loop.ts:250`): `rawReview = { skipped: \`judge dispatch failed: ${msg}\` }`. This is a *separate* skipped-shape from the "testing failed: X is not set" one (different reason string, different cause). Users wanting to write `afterAllScenarios` that branches on judge-dispatch failure need to know about it.
2. **Judge JSON unparseable** (`judge-agent.ts:78-84`): `{ error: "unparseable", raw: <finalText> }`. The spec covers `{ error: "...", raw }` generically but the literal string `"unparseable"` is a stable contract the docs should call out (so users can pattern-match for it).

**Fix.** Add both to §A.5.6's enumeration and to Acceptance §8.

### B9. Default selfImprovement values are documented in `selfImprovement.ts`, not `validate.ts` (§A.5.3)

§A.5.3 says: "Defaults to document (validation lives in `src/config/validate.ts`; normalization in `src/config/normalize.ts`)". But the `selfImprovement` defaults (`maxIterations: 3`, `scope: "failed-scenarios"`, `finalPass: false`) live in **`src/config/self-improvement.ts:17-25`**, not in `normalize.ts`. The clamp-to-`>= 1` for `maxIterations` happens in `self-improvement.ts:46`, not in `validate.ts`. `validate.ts` does range-check `maxIterations` to integer `>= 1` (line 188-194), but the **clamp** happens after merge.

A docs author following the spec's pointer will look in `normalize.ts` for the defaults and not find them.

**Fix.** Add `self-improvement.ts` to the source-of-truth list in §A.5.3. Note explicitly:

> Defaults and CLI-override merging live in `src/config/self-improvement.ts`; validation lives in `src/config/validate.ts`; the rest of normalization lives in `src/config/normalize.ts`. Precedence: CLI override > config > defaults.

Also note that the `mode` default is `"test-only"` and comes from the same merge in `self-improvement.ts:21`, which is subtle: a config that omits `mode` typechecks (it's required in `SkillsmithConfigInput`), but if the resolver ever runs against a normalized config with `mode === undefined`, the fallback kicks in. Worth a half-sentence.

### B10. Reports' `error` aggregation strings are part of the contract (§A.5.6)

The merged scenario-row error string format is `\`${existing}; ${note}\`` (`src/improvement/verify.ts:142-145`) — verification details get **concatenated** onto the row's existing error with `"; "`. And the default note when no `details` is provided is `"verification gate reported failure"` (`verify.ts:9`).

The aggregator also produces three specific error strings under the `IterationReport.scenarios → { error: string }` branch (`src/reports/iteration-report.ts:38, 51, 58`):

- `"missing scenario report"`
- `"scenario report empty"`
- `\`scenario report unparseable: ${msg}\``

…and the scenario-report aggregator produces three more for `ScenarioAgentEntry.error` (`src/reports/scenario-report.ts:59, 67, 71`):

- `"missing agent report"`
- `\`agent report unparseable: ${msg}\``
- `"agent report empty"`

These are stable strings users will pattern-match in CI scripts. The spec calls out type stability (§A.6) for the `| { error: string }` union *shape* but doesn't say the *strings inside* are also part of the contract. Since the docs are about to become the source of truth, they need to either enumerate them or explicitly note them as non-contractual.

**Fix.** Add to §A.5.6:

> The harness writes three error strings for missing/unparseable per-scenario reports (`"missing scenario report"`, `"scenario report empty"`, `"scenario report unparseable: <msg>"`) and three for per-agent reports (`"missing agent report"`, `"agent report empty"`, `"agent report unparseable: <msg>"`). The verification gate appends its `details` (or `"verification gate reported failure"` if none given) to a scenario's `error` joined by `"; "`. Document all of these as stable.

Or, alternatively, explicitly mark them as non-contract and warn users not to pattern-match them. Either is fine, but the spec needs to pick.

### B11. `RunOptions.cwd` semantics are not documented (§A.5.1)

`RunOptions = { cwd?, verbose?, scenarios?, overrides? }` is listed but the spec doesn't say what `cwd` means or what it defaults to. From `runner.ts:31`: `options.cwd ?? process.cwd()` is fed to `resolveProjectRoot`, which then tries `${cwd}/skillsmith.config.ts` first, then walks one level. So `cwd` is the *search start*, not the project root.

For programmatic users this is subtle and a foot-gun: passing `cwd: "/path/to/my-project"` works if that directory contains `skillsmith.config.ts`; passing `cwd: "/path/to/parent-of-my-project"` works only if exactly one immediate child has it. The spec needs this in `programmatic.md` and the requirement should be added to §A.5.1.

**Fix.** Add to §A.5.1's "Runner: `RunOptions`" entry:

> `cwd` defaults to `process.cwd()` and is the **starting point for `resolveProjectRoot`**, not the project root. `resolveProjectRoot` first tries `${cwd}/skillsmith.config.ts`, then walks one level into immediate child directories.

### B12. `errorpath` for hooks: `tryHook` swallows non-`Error` throws (§A.5.4)

§A.5.4 says "Every fire-and-forget hook is wrapped in `tryHook` — hook errors are logged but **never abort the run**." Looking at `src/util/hooks.ts:21-27`, what gets logged is `err instanceof Error ? err.message : String(err)`. So a hook throwing a non-Error (e.g. `throw "boom"`, `throw { code: 1 }`) is also caught and logged, but as `String(err)` — that's worth saying. More importantly, the log line goes to the iteration-scoped `RunLog`, *not* to console — users debugging silent hook failures need to know to inspect `iteration-N/run.log` (or the run-root `run.log` for `beforeAll` / `afterAll`).

**Fix.** Add to §A.5.4:

> Hook errors are recorded in the iteration's `run.log` (the run-root `run.log` for `beforeAll` / `afterAll`) as `hook[<scope>] <name>: error — <message>`. The hook never gets re-fired; the next hook in the order still runs. Non-Error throws are coerced to `String(err)`.

This also unblocks a confusion about exactly *where* hook errors land — the spec mentions the log files in §A.5.6 but doesn't tie them to the hook-error story.

---

## Blocking issues — internal contradictions / ambiguities

### B13. "Self-contained per chapter" vs. "no inline excerpts of the canonical example" (§A.1 + §A.3)

§A.1 says each chapter is self-contained ("a reader who arrives via a deep link to one chapter must not need to read another page to use the surface that chapter documents"). §A.3 says each chapter ships fresh per-section snippets, with the closing callout pointing at `examples/skillsmith.config.ts`, "**No inline excerpts of the canonical example anywhere**".

These constraints are compatible *individually*, but together they imply:

- Every chapter must include enough self-contained TS/YAML/JSON to use the surface without bouncing.
- But chapters must not borrow from `examples/skillsmith.config.ts`.

That's fine, except the spec also requires `programmatic.md` to document `run(options)` with `RunOptions` — and a self-contained example of programmatic invocation typically wants a fuller config (because `run()` needs a project with a valid `skillsmith.config.ts` on disk). The spec doesn't say whether `programmatic.md` may include a minimal `defineConfig` snippet inline (and if so, how minimal) or whether it should redirect to `configuration.md` + `examples/`.

**Fix.** Add a one-paragraph clarification to §A.3:

> "Self-contained" does not mean "duplicate every prior chapter's content". A chapter may cross-link sister chapters (e.g. `programmatic.md` → `configuration.md` for the config shape) provided the deep-linked target satisfies the lookup without further reading. Per-section snippets in each chapter remain minimal and orthogonal: `programmatic.md` shows the smallest valid `run()` call shape and one `RunOptions` example, not a full `defineConfig` body.

### B14. Where the type-stability callout lives is ambiguous (§A.6 + Acceptance §12)

§A.6 says "most naturally a callout in `programmatic.md` or `run-artifacts.md`" — either is acceptable. Acceptance §12 then says "The two type-stability constraints from §A.6 appear in `docs/api/` as a callout, naming the fields and the reason each must not be tightened." That's two callouts (one for `ScenarioAgentEntry.testing`/`.review`, one for `IterationReport.scenarios`) but the spec is silent on whether they must live together, whether they can be split across chapters, or whether they're a single callout that names both.

A spec-writer would prefer not to invent this in the design doc.

**Fix.** Pick one. Suggested:

> Both constraints live in **one** callout, in `run-artifacts.md`, immediately after the JSON shape examples for the affected types. The callout names the fields, the reason each stays as-is, and links the corresponding TypeScript export.

### B15. Stability-and-extension-points note: which chapter? (§A.5.9)

§A.5.9 says "most naturally in `programmatic.md` or `run-artifacts.md`" — again either is acceptable. Acceptance §11 says "The 'Stability and extension points' note (§A.5.9) appears in `docs/api/` and states that the public surface is `src/index.ts`." This leaves the chapter unbound.

For deep-link addressability (which §A.1 cares about), this note has a discoverable home. Pick one.

**Fix.** Make `programmatic.md` the home — that's the chapter a user looking up "what can I import?" lands on. Update §A.5.9 and Acceptance §11.

### B16. Custom-providers wording in `providers.md` vs. requirements (§A.5.7 + Out-of-scope §3)

§A.5.7 closes with: "Custom providers section closes the chapter: states that the set of six built-in `ProviderId`s is fixed in this version, there is no `registerProvider()` API, and the `Provider` / `ProviderId` types remain useful for typing hook code that branches on `ctx.agent.provider`. No issue link required."

Requirements doc §"Reader" → "Explicit non-readers" → third bullet says the same thing but adds: "the `providers.md` chapter states this in a closing 'Custom providers' section and stops there." And Q3a confirms it.

The spec's §A.5.7 is correct but uses the word "Custom providers" as the section name. The actual hook-author use case it describes ("typing hook code that branches on `ctx.agent.provider`") is a programmatic-surface concern. Worth either renaming the section heading (e.g. "## Custom providers (not supported)") to avoid the appearance that custom providers *are* discussed, or being explicit that the section is a deliberate dead-end.

**Fix.** Add to §A.5.7:

> The "Custom providers" section heading is reserved deliberately; its body is the one-paragraph note. Do not expand it.

### B17. "Stale sentence at README.md:46" — what if the line moves? (§D.1)

§D.1 anchors on a line number. If a contributor edits the README between spec approval and code, the line number drifts. Better to anchor on content.

**Fix.** Re-cast §D.1 to anchor on content:

> Delete the sentence "No CLI flags are supported yet; option-like arguments such as `--scenario` fail before a run starts." from the README. It is currently at `README.md:46` but anchor on the sentence, not the line number. Replace it with a one-sentence pointer to `docs/api/cli.md` (or delete it; both acceptable).

Likewise re-quote the sentence verbatim from current source (see B4).

---

## Non-blocking observations (could be cleaned up in iteration 2 but not required for approval)

### N1. `providers.md` per-role tool surface — Vercel runner detail
§A.5.7 says "Vercel runner: `fs-tools` jailed to `cwd`, max 25 steps per invocation". From `src/providers/lib/vercel-runner.ts:23` the constant is `MAX_STEPS = 25` and the function is `stepCountIs(MAX_STEPS)`. The comment in source notes a soft warning ceiling (`TOOL_USE_WARNING_THRESHOLD`) in `testing-agent.ts:22` — worth mentioning since users hitting either ceiling will see different log lines.

### N2. `codex` provider — provider-specific knobs default
§A.5.7's table says codex knobs are `effort | network | webSearch`. The spec doesn't note that these are *optional* (omitting them falls through to the SDK's defaults — see `codex.ts:158-170`). The `examples/skillsmith.config.ts` `codex-gpt55` agent uses `effort: "xhigh"` to demonstrate. A one-line "all three optional" note in `providers.md` would prevent the question.

### N3. `mock` provider — special-case agent IDs
§A.5.7 says `mock` is "deterministic; writes test entries to `cwd`". From `src/providers/mock.ts:71-72` there's a special-case `mock-fail-testing` id that returns an error to exercise the testing-failed → judge-skipped branch. If users running smoke tests pattern this id, they should know it's a sentinel. Worth a one-line aside in `providers.md`.

### N4. Token-usage section in `run-artifacts.md` should cross-link `providers.md`
Each provider's token accounting is slightly different (claude-code sums new + creation + read into `inputTokens`; vercel-runner relies on the SDK's gross figure; codex matches; mock uses fixed values). The spec's §A.5.6 documents the normalised shape but doesn't say where the provider-specific accounting story lives. Suggest: `run-artifacts.md` documents the shape; `providers.md` documents the per-provider quirks.

### N5. Acceptance §1 — exact-file-count claim
Acceptance §1 says "`docs/api/` exists at the repo root and contains exactly nine files". The constraint is fine, but as written, the reviewer can fail the pipeline for any tenth file (e.g. an `.eslintignore` someone drops in). Soften to "contains the nine files listed above" or "contains exactly the nine Markdown files listed above" (so a `.gitkeep` or future image doesn't trip the check). Minor wording fix.

### N6. Reference to `testing-project/`
Requirements §9 names `testing-project/` as the "working WordPress reference project" and says "the docs should reference it as the end-to-end working example". The spec doesn't carry that forward — the only example reference in the spec is `examples/skillsmith.config.ts`. Decide whether `testing-project/` gets a one-line callout in the index (or in `scenarios-and-rubrics.md`) or whether it's deliberately omitted as fork-internal. The requirements doc lists it as in-scope reference material, so silence isn't great.

### N7. Acceptance §10 — `.env` precedence wording
Acceptance §10 mentions "`.env` precedence" — good. The actual precedence ("shell env wins over `.env`") follows Node's `process.loadEnvFile` semantics. Worth stating in the spec which side of the precedence is documented and pointing at the Node docs version (Node >= 20.12 for `loadEnvFile`).

### N8. `.env.example` note about `OPENAI_API_KEY` being used by `codex`
The `.env.example` file at the worktree root (`/.env.example:9`) comments: "Required for provider 'openai-api' (also used by the codex CLI)". §A.5.7's provider table correctly maps `codex` to `OPENAI_API_KEY`, but a docs reader looking at `providers.md` for codex should be told *why* it's that env var (because the codex SDK delegates to the OpenAI account). Trivia, but it's the kind of thing the reference is supposed to flatten.

### N9. Spec acceptance criteria §16 — "the existing test suite still passes"
Acceptance §16 says "the existing test suite still passes after the re-exports are added". Good defensive criterion. Worth also adding "and `tsc --noEmit` is clean" since the type-only re-exports could in principle trip a circular type reference. (Per `package.json` the typecheck command is exactly `tsc --noEmit`.)

### N10. Spec doesn't mention the smoke test
`package.json` has `"smoke": "node bin/skillsmith.mjs"`. After this pipeline, a docs author might want to run it. Worth one line in `cli.md` ("running `skillsmith` with no project root is the smoke test; the harness fails with a `PreconditionError`") — but optional.

### N11. Anchor naming convention
§A.1 requires "anchor-heavy" headings for deep links but doesn't standardise the anchor convention (kebab-case from heading? Markdown-default? Explicit `<a name="…">` anchors?). For a reference doc, this matters because users will share `#anchor-fragment` URLs. Recommend: use GitHub's auto-generated anchors and document one anchor per type/field/flag — but the spec should pick.

### N12. `examples/skillsmith.config.ts` top-comment exact text
§C says "A single top-comment line is added at the top of the file pointing at `docs/api/` as the canonical reference. All existing inline comments are left unchanged." The spec doesn't specify the exact text of that one comment. Suggest: `// Canonical reference: docs/api/. The docs win when they conflict with this example.` — or leave it to the code-writer with a one-line "wording at code-writer's discretion".

---

## Summary

The spec is solid in shape but contains specific factual errors (B1, B2, B4) in normative statements about behaviour the reference is supposed to *fix forever*. Those alone block approval.

The coverage gaps (B6–B12) are filler that a docs author would either miss or invent in inconsistent ways across chapters — the spec needs to pin them down once, in `requirements`-level detail, so the design doc can simply allocate them to chapters.

The ambiguity items (B13–B17) are small but real: each represents a decision a downstream phase shouldn't make unilaterally.

Address all B-numbered items above. N-numbered items are optional improvements; address them if convenient, skip otherwise.

— spec-reviewer (iteration 1)
