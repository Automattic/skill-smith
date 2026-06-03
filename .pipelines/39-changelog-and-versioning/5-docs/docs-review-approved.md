# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- Doc Task 1: Write `CONTRIBUTING.md` (commit `fb42b68`, 183 lines)
- Doc Task 2: Write `.changeset/README.md` (commit `443faea`, 31 lines)
- Doc Task 3: Add `## Installation`, `## Releases`, `## Contributing` to `README.md` (commit `bf38a4a`, +15 lines)

Base ref: `trunk`.

## Summary

All three doc surfaces ship per the approved doc-plan. `CONTRIBUTING.md` covers every R6.2 sub-bullet, reproduces the R3.1 bump-type table verbatim against the spec, and pins both contract anchors (`#adding-a-changeset` and `#pre-10-policy`) at slugs the GitHub auto-slugger emits — `pre-10-policy` matches the literal string the shipped validator (`scripts/validate-changesets.ts:149`) prints. `.changeset/README.md` is a thin pointer (31 lines) that replaces the upstream Changesets boilerplate, cross-links the full policy at the exact relative anchor, and does not duplicate any policy content. `README.md` gains the three pointer sections in the required order, appended without modifying any of the original 224 lines, with install command and Node floor that match the shipped `package.json`. Voice and convention match the rest of the project (sentence-case headings, no emojis, imperative prose).

## Checks

The host project's verification convention enumerates no documentation gates, so the accuracy spot-check below is the sole gate, per the workflow.

| Check | Command | Result |
| ----- | ------- | ------ |
| Bump-type table reproduced verbatim | `diff <(awk 'NR>=90 && NR<=94' .pipelines/.../spec.md) <(awk 'NR>=42 && NR<=46' CONTRIBUTING.md)` | empty diff (identical) |
| `#adding-a-changeset` slug | GitHub auto-slugger on "Adding a changeset" → `adding-a-changeset` | matches heading at `CONTRIBUTING.md:18` |
| `#pre-10-policy` slug | GitHub auto-slugger on "Pre-1.0 policy" → `pre-10-policy` | matches heading at `CONTRIBUTING.md:48` AND matches the literal `CONTRIBUTING.md#pre-10-policy` substring at `scripts/validate-changesets.ts:149` |
| `.changeset/README.md` link target | Grep `CONTRIBUTING.md#adding-a-changeset` in `.changeset/README.md` | found at lines 5 and 10, exact relative path `../CONTRIBUTING.md#adding-a-changeset` |
| Upstream boilerplate replaced | Grep "Hello and welcome" in `.changeset/README.md` | no matches |
| Install command matches package name | Grep `@automattic/skillsmith` install line in `README.md` against `package.json:name` | both `@automattic/skillsmith` |
| Node floor matches engines | "Requires Node.js ≥ 20.17" in `README.md` vs `package.json:engines.node = ">=20.17"` | matches |
| Original README unmodified | `git diff trunk -- README.md` → count removed lines | 0 removed |
| `npx changeset --empty` works as documented | Spawned the changeset CLI with no subcommand in a tmpdir | Wrote `---\n---\n` to `.changeset/<random>.md`, as the doc claims |
| `infoAllow404` exists in changeset CLI source | Grep in `node_modules/@changesets/cli/dist/changesets-cli.cjs.js` | found at line 848 (definition) and line 1081 (use) |

## Accuracy spot-check

### Task 1 — `CONTRIBUTING.md`

Claim verified: the validator's pre-1.0 error message contains the literal substring `CONTRIBUTING.md#pre-10-policy`.

- Doc claim (CONTRIBUTING.md line 50): "The local validator rejects `major` bumps with a message pointing back here." with the heading `### Pre-1.0 policy` (line 48) → slug `pre-10-policy`.
- Code: `scripts/validate-changesets.ts:149` emits `'major' is forbidden while pre-1.0 (version=${version}). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.`
- Slugs match; the doc's anchor is the one the validator points to.

Bonus spot-check: the four scripts named in the "Running tests and checks locally" section (`npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`) all exist in `package.json:scripts` (verified).

### Task 2 — `.changeset/README.md`

Claim verified: the cross-link `[\`../CONTRIBUTING.md#adding-a-changeset\`](../CONTRIBUTING.md#adding-a-changeset)` at lines 5 and 10 resolves to the heading `## Adding a changeset` in the sibling `CONTRIBUTING.md` (line 18), whose slug under GitHub Markdown is `adding-a-changeset`. The relative path `../CONTRIBUTING.md` resolves because `.changeset/` and `CONTRIBUTING.md` are sibling-and-parent at the repo root (confirmed by `ls`).

Bonus spot-check: the front-matter line `"@automattic/skillsmith": minor` in the anatomy example (line 18) matches `package.json:name` at `package.json:2`.

### Task 3 — `README.md` updates

Claim verified: `npm install -D @automattic/skillsmith` in the Installation section matches the shipped `package.json:name` exactly. `Requires Node.js ≥ 20.17` matches `package.json:engines.node = ">=20.17"`. The Releases section's link to `https://github.com/Automattic/skillsmith/releases` is the canonical GitHub URL for the repo named in `package.json:repository.url` (`git+https://github.com/Automattic/skillsmith.git`).

Drift sweep: the 224-line original `README.md` is appended-to only (`git diff trunk -- README.md` shows zero removals); no stale references introduced.

## Issues

None — approved.
