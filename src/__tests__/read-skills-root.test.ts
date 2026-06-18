import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSkillsRoot } from "../improvement/read-skills-root";

function snapshotTree(root: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const rel = entry.name;
		if (entry.isDirectory()) {
			for (const child of readdirSync(join(root, rel), { withFileTypes: true }))
				out.push(`${rel}/${child.name}`);
		} else {
			out.push(rel);
		}
	}
	return out.sort();
}

test("reads every skill, follows md-links, skips non-skill dirs", () => {
	const root = mkdtempSync(join(tmpdir(), "skills-root-"));

	// Skill `alpha`: SKILL.md links a reference file under the skill dir.
	mkdirSync(join(root, "alpha", "references"), { recursive: true });
	writeFileSync(
		join(root, "alpha", "SKILL.md"),
		"alpha body see [refs](references/directives.md)\n",
	);
	writeFileSync(
		join(root, "alpha", "references", "directives.md"),
		"alpha linked directive content\n",
	);

	// Skill `beta`: plain SKILL.md.
	mkdirSync(join(root, "beta"));
	writeFileSync(join(root, "beta", "SKILL.md"), "beta body\n");

	// Non-skill dir `_assets`: no SKILL.md — must be skipped, not crash.
	mkdirSync(join(root, "_assets"));
	writeFileSync(join(root, "_assets", "logo.png"), "not a skill\n");

	const before = snapshotTree(root);

	const blob = readSkillsRoot(root);

	// Both skills present, including the md-linked reference file.
	assert.match(blob, /=== alpha\/SKILL\.md ===/);
	assert.match(blob, /alpha body/);
	assert.match(blob, /=== alpha\/references\/directives\.md ===/);
	assert.match(blob, /alpha linked directive content/);
	assert.match(blob, /=== beta\/SKILL\.md ===/);
	assert.match(blob, /beta body/);

	// The non-skill dir contributes nothing.
	assert.doesNotMatch(blob, /_assets/);

	// Reader writes nothing — the tree is unchanged.
	assert.deepEqual(snapshotTree(root), before);
});
