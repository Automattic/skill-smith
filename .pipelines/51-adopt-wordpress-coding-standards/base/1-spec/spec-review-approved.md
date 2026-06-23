# Spec Review

## Verdict: approved

## Summary

The spec has converged. The iteration-2 gap is genuinely closed: the reformatted `testing-project/` source — which the repo's own `typecheck`/`test` deliberately do not exercise — now carries an observable behavior-preservation criterion, stated in Requirement 8 (line 35) and as a Given-When-Then acceptance criterion (line 76): "Given the reformatted tree, when `npm --prefix testing-project run check:config` is run, then it succeeds." I verified against the codebase that this is a meaningful guarantee, not a token one: `testing-project/check:config` is `node --import tsx -e "await import('./skillsmith.config.ts')"`, and `skillsmith.config.ts` transitively imports `./eval/utils/scaffold-plugin.ts` and `./eval/utils/verify-e2e.ts` — both `.ts` files Biome reformats — so the check exercises exactly the reformatted surface the spec chose to bring in-scope, catching any reformat that broke the config or its import graph. The three iteration-1 fixes did not regress: the verify-only check is pinned to `biome format .` without `--write` with no new artifact required (Req 7; lines 61-63); the reformatted lockfiles carry an `npm ci` install-equivalence guarantee (Req 5 and Req 8; line 65); and the changeset-gate consequence is addressed via a dedicated Out-of-Scope bullet plus an acceptance criterion (line 48; line 78). A final adversarial pass found no genuine, blocking defect in testability, completeness, consistency, spec altitude, or alignment with the intent's full-adoption goal.

I re-verified every load-bearing premise directly against the repo:

- `biome.json` matches the described baseline: `$schema` pinned to `2.4.12`, `formatter.indentStyle: "tab"` (no `indentWidth`/`lineWidth`), `javascript.formatter.quoteStyle: "double"`, `linter.rules.recommended: true`, `assist.organizeImports: "on"`, VCS with `useIgnoreFile: true`.
- `package.json` confirms the `@biomejs/biome` `2.4.12` pin and the exact script names (`lint`, `format`, `typecheck`, `test`, `smoke`).
- `docs/index.html:83` carries the `<div class="visual" aria-label="Skillsmith run preview">` (roleless `<div>` with `aria-label`) that triggers `useAriaPropsSupportedByRole` — Req 9's premise is accurate.
- `.changeset/config.json` `changedFilePatterns` covers `src/**`, `bin/**`, and `package.json`, so the gate fires mechanically for this change exactly as the spec states; the `none`-bump precedent (`.changeset/initial-scaffolding.md`) exists verbatim.
- `changeset-gate.yml` fires on PRs to `trunk` and runs `changeset status`.
- `CONTRIBUTING.md:13` documents `npm --prefix testing-project run check:config` as the check that catches config-load and import regressions the other checks miss — confirming the iteration-2 criterion uses a real, documented check.

## Notes (non-blocking, for downstream awareness)

- The root `tsconfig.json` `include` is `["src/**/*", "skillsmith.config.ts", "examples/**/*"]`, so `npm run typecheck` does not cover `bin/skillsmith.mjs` or `testing-project/`. The `testing-project/` surface is now covered by the `check:config` criterion. `bin/skillsmith.mjs` is a thin entry that delegates to `src/runner.ts` (which is in typecheck scope) and is exercised end-to-end by `npm run smoke`; its `.mjs` reformatting is mechanically inert (whitespace/quote/comma/delimiter tokens only), so it falls safely under Req 8's "repo's own source files" guarantee. This is not a gap that warrants rejection — flagging only so later phases keep it in view.
