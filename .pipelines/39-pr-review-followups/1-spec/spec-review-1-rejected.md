# Spec review 1 — REJECTED

Adversarial review of `1-spec/spec.md` (committed at `30907c7`) against `1-spec/requirements.md`,
`0-prompt/prompt.md`, and the live repo state on branch `worktree-39-changelog-and-versioning`
(= PR #41).

**Verdict: REJECTED** for one concrete, actionable factual defect (Issue 1) that would lead an
implementer who follows the spec literally to ship a broken anchor link in a deliverable the spec
directly specifies. The defect is narrow and the fix is a one-token correction in three places. Two
minor observations (non-blocking) are recorded after it.

The spec is otherwise excellent: faithful to the resolved requirements, internally consistent on
every other point, and unusually well-grounded. I independently re-ran the empirical claims and they
reproduced exactly (see "Empirical verification" at the end). All of the team-lead's "be especially
rigorous" points are honored correctly. The rejection is targeted, not a teardown.

---

## Issue 1 (BLOCKING) — The spec asserts a `CONTRIBUTING.md` anchor that does not exist (`#pre-1.0-policy`); the real slug is `#pre-10-policy`

**Where:**
- `spec.md:43` (Working context): "Confirmed `CONTRIBUTING.md` anchors: `#adding-a-changeset`,
  `#bump-types`, **`#pre-1.0-policy`**."
- `spec.md:104` (R1.6 d): "a pointer to `CONTRIBUTING.md` (**`#pre-1.0-policy`** or
  `#adding-a-changeset`)."
- `spec.md:356` (AC4): restates R1.6(d); does not name the bad anchor itself, but inherits the
  recommendation by reference.

**The problem.** There is no heading in `CONTRIBUTING.md` whose GitHub auto-slug is `pre-1.0-policy`.
The only candidate is `### Pre-1.0 policy` (`CONTRIBUTING.md:48`), whose GitHub-Markdown slug is
**`pre-10-policy`** — GitHub lowercases, then strips every character that is not alphanumeric or a
hyphen (the `.` is deleted, leaving `pre-1` + `0` → `pre-10-policy`). So `CONTRIBUTING.md#pre-1.0-policy`
resolves to nothing (anchor 404 on GitHub's rendered Markdown).

**This is not my inference — it is already settled in-repo, twice:**
- `scripts/validate-changesets.ts:149` emits the canonical pointer as the literal substring
  `CONTRIBUTING.md#pre-10-policy` (verified by reading the file).
- The prior pipeline's own approved docs review
  (`.pipelines/39-changelog-and-versioning/5-docs/docs-review-approved.md:27,40-44`) explicitly
  verified "GitHub auto-slugger on 'Pre-1.0 policy' → `pre-10-policy`" and that it matches both the
  heading and the validator string. That artifact is authoritative for this very PR.

**Why it is blocking, not cosmetic.** R1.6(d) lists `#pre-1.0-policy` as the **first** suggested
anchor for the pre-1.0 sub-clause — exactly the clause being authored, exactly on the pre-1.0 topic.
An implementer will naturally reach for `#pre-1.0-policy` (it reads as the precise, on-topic anchor)
and ship a dead link in the brand-new `AGENTS.md` — the canonical, always-loaded agent instruction
file this whole change exists to create. That is a correctness regression in a primary deliverable,
and it is precisely the class of latent error the spec phase exists to catch.

**Self-contradiction that makes the error sharper.** R1.6 (`spec.md:106-108`) instructs the clause to
"mirror the canonical wording at both enforcement points so it cannot drift," and quotes the validator
message as one of those two anchors to mirror. But that very validator message ends with
`see CONTRIBUTING.md#pre-10-policy.` — the *correct* slug. So the spec simultaneously (a) tells the
implementer to mirror the validator and (b) recommends an anchor the validator contradicts. The
canonical source the spec points at already carries the right answer.

**Severity downgrade that does NOT save it.** AC4(d) as worded only strictly requires "a pointer to
`CONTRIBUTING.md`," and `#adding-a-changeset` (offered as the alternative) IS a real, verified anchor
(`CONTRIBUTING.md:18` → `adding-a-changeset`), as is a bare `CONTRIBUTING.md` with no fragment. So a
*careful* implementer could pass AC4 without tripping the bug. But the spec does not merely permit the
bad anchor — it affirmatively labels `#pre-1.0-policy` a "Confirmed `CONTRIBUTING.md` anchor"
(`spec.md:43`). A spec that asserts a false, "confirmed" fact about a deliverable's link target has
drifted from the resolved requirements (which never claimed this slug — `requirements.md:149-151`
correctly offers "`#pre-1.0-policy` or `#adding-a-changeset`" only as candidate framing, and
`requirements.md:91` quotes the real validator slug `pre-10-policy`). The defect originates in the
spec's transcription, not the requirements.

**Required fix (one of, applied consistently in all three spots):**
1. **Preferred:** replace `#pre-1.0-policy` with **`#pre-10-policy`** everywhere it appears
   (`spec.md:43`, `:104`; and ensure AC4's inherited recommendation resolves to it). This makes the
   recommended pre-1.0 anchor a real, verified link that also exactly matches the validator string —
   satisfying R1.6's own "mirror the enforcement points" intent. `spec.md:43`'s "Confirmed … anchors"
   list must then read `#adding-a-changeset`, `#bump-types`, `#pre-10-policy`. (Also re-verify
   `#bump-types`: heading `### Bump types` at `CONTRIBUTING.md:40` → slug `bump-types` ✓ — that one is
   correct as written.)
2. **Acceptable alternative:** drop the deep anchor for the pre-1.0 clause and standardize on
   `CONTRIBUTING.md#adding-a-changeset` (the anchor `README.md:239` and `.changeset/README.md:5,10`
   already use, and which the spec already mandates for the main obligation at R1.5). Then remove
   `#pre-1.0-policy` from the `spec.md:43` "confirmed anchors" list entirely so no false claim remains.

Either way, the literal string `#pre-1.0-policy` must not survive in the spec, because it will
otherwise propagate verbatim into `AGENTS.md`.

---

## Minor observations (non-blocking — do not require a re-spin on their own; fold into the Issue 1 edit if convenient)

**M1 — AC16 is the one acceptance criterion that is not independently, mechanically testable.**
AC13-15 are crisp file/command checks. AC16 ("The Change 3 tradeoff is documented … in the
implementation's PR description and/or the change itself as appropriate") is a prose-judgment
criterion with an underspecified location ("PR description and/or the change itself"). The cross-cutting
constraint forbids editing any file other than the seven listed in AC19 — and a PR *description* is
not a file in the worktree, so AC16 cannot be satisfied by an in-tree artifact without colliding with
AC19 (it can't go in `CONTRIBUTING.md`/`README.md`, both excluded; `.changeset/config.json` is JSON
with no natural prose home; a code comment in `config.json` would make it non-JSON). In practice the
tradeoff lives in the PR description, which is fine and consistent with R3.1's "Record it as such" —
but the spec should say so unambiguously (e.g. "documented in the PR description" full stop) so the
implementer doesn't try to wedge prose into a JSON file or wrongly conclude a doc file must change.
This is a clarity nit, not a correctness defect; flagging because "independently testable acceptance
criteria" is part of the review mandate.

**M2 — `noControlCharactersInRegex` ignore-comment placement is empirically slightly off, and the
column count in AC9 needs a tolerance note.** The recommended posture (per-line `biome-ignore`) is
correct and well-justified. Two small things the planner/implementer should not be tripped by:
- For the *test* occurrence, both flagged control chars are on the **same physical line**
  (`progress-tracker.test.ts:141`, the two `\x1b` escapes in `/^\x1b\[(\d+)A\x1b\[0J/` — confirmed by
  re-running `biome lint`, reported at `141:31` and `141:43`). A single per-line
  `// biome-ignore lint/suspicious/noControlCharactersInRegex: …` on the line above 141 suppresses
  **both** — you cannot place two separate ignores for two columns of one line. AC9's phrase "on each
  of the 3 occurrences … The same technique is applied to all 3" is therefore technically imprecise:
  it is 3 *diagnostics* across **2 lines / 2 files**, satisfied by **2** ignore comments (one above
  `tracker.ts:358`, one above `progress-tracker.test.ts:141`). The spec should say "one ignore comment
  per offending line (2 comments total, covering all 3 diagnostics)" to avoid an implementer puzzling
  over how to annotate a single line twice. (The intent — narrow, per-line, justified, applied
  uniformly — is correct; only the "3 comments" arithmetic is wrong.)
- Minor: `spec.md:162` and AC9 cite the columns as "31 & 43"; current `biome lint` reports `141:31`
  and `141:43`. Matches. No change needed, just confirming the cited columns are still accurate.

---

## Empirical verification performed (all reproduced; these parts of the spec are sound)

Run on the live worktree, branch `worktree-39-changelog-and-versioning`, working tree clean before
and after (the gate control-test was done on a backup-and-restore and left no residue; confirmed
`git status` clean afterward).

- **`biome lint .` → 3 errors + 6 warnings**, exactly matching the spec's table (`spec.md:159-164`):
  1 `noControlCharactersInRegex` error at `tracker.ts:358`; 2 at `progress-tracker.test.ts:141`
  (cols 31 & 43); 4 `noAdjacentSpacesInRegex` warnings at `progress-render.test.ts:64,67,150,295`
  (all reported `FIXABLE`); 2 `noDescendingSpecificity` warnings at `docs/styles.css:596,605`. ✓
- **Source-line citations confirmed:** `tracker.ts:358` = `const ANSI_SGR = /\x1b\[[0-9;]*m/g;`;
  `progress-tracker.test.ts:141` = `second.match(/^\x1b\[(\d+)A\x1b\[0J/)`. ✓
- **CSS reorder targets confirmed** (R2.2b): `.terminal pre {}` block starts at `docs/styles.css:300`,
  `.note-card code {}` at `:429`, bare `pre {}` at `:596`, bare `code {}` at `:605`. Both bare rules
  are pure declaration blocks (a move, no declaration change) and the specificity argument holds
  ((0,1,1) vs (0,0,1) in both pairs → cascade order-independent). ✓
- **`biome format .` → exactly 1 failing file: `.changeset/config.json`** (R3.2), and Biome expands the
  `changelog` array onto multiple lines — confirming "accept the full Biome output; do NOT hand-preserve
  the inline array." On a temp copy, `biome format --write` produced valid JSON and was **idempotent**
  ("No fixes applied" on re-run). ✓
- **ZERO-changeset central claim (AC17) — reproduced the controlled test:** baseline (with
  `initial-scaffolding.md` present) → `validate-changesets.ts` exit 0 AND
  `changeset status --since=origin/trunk` exit 0 (green). Removing `initial-scaffolding.md` (control) →
  validator still exit 0 (shape-only), but `changeset status` exit 1 ("Some packages have been changed
  but no changesets were found"). Restored the file → green again, tree clean. This proves the existing
  `none` changeset is exactly what satisfies the per-package gate, and that no new changeset is needed.
  ✓ (Note: I did not need an uncommitted `tracker.ts` edit to red the gate — the committed branch diff
  vs `origin/trunk` already carries release-relevant changes, so the `none` changeset is load-bearing
  on its own. Consistent with the spec.)
- **Prettier transitivity (R3.1):** `npm ls prettier` → `prettier@2.8.8` via `@changesets/cli` →
  `@changesets/apply-release-plan` AND `@changesets/write` (deduped); no direct dep in `package.json`.
  Confirms the corrected premise (Prettier IS transitively installed) and that `prettier:false` is the
  single switch across both Prettier-using paths. ✓
- **radical-pipelines precedent (R1.x):** live `~/Desktop/Code/radical-pipelines/AGENTS.md` confirms the
  three things the spec forbids copying — (a) "See the README's changelog and versioning section",
  (b) "breaking change → major", (c) "the README.md must be updated …" docs-currency bullet. Its
  `CLAUDE.md` is exactly `@AGENTS.md\n` (11 bytes), matching AC2. The spec's "adapt, don't copy"
  direction is correct and necessary. ✓
- **README has no policy section** (`README.md:232-239` = `## Releases` + a one-line `## Contributing`
  deferring to `#adding-a-changeset`); `.changeset/README.md:5` is the in-repo defer-don't-restate
  precedent. `.rp.md` is pipeline-conventions-only and off-limits. All as the spec states. ✓
- **`release.yml` runs `npm run lint`** before publish (Change 2 premise) and the `push: [trunk]`
  trigger is commented out (D4 follow-up), consistent with `CONTRIBUTING.md`. `changeset-gate.yml` runs
  both gate steps. `package.json` version `0.1.0`, scripts exactly as cited. ✓

**On the team-lead's "be especially rigorous" checklist:** Change #1 correctly mandates root
`AGENTS.md` + required `CLAUDE.md`=`@AGENTS.md`, defers to `CONTRIBUTING.md#adding-a-changeset` (no
inlined mapping), action-frames the pre-1.0 clause, lives re-sync-safe outside `.rp.md`, and forbids
copying the README pointer / breaking→major mapping / docs-currency bullet. Change #2 sets the bar at
ZERO diagnostics from `biome lint .` (not `biome check`), source-only fixes. Change #3 frames
`prettier:false` as a documented owner-selectable default (tradeoff, not bug-fix), with the config.json
Biome-tab reformat as the hard AC and no release-flow post-step. The corrected premises are not
reintroduced. All honored. The sole drift is the anchor slug in Issue 1.
