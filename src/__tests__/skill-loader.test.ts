import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSkill } from "../scenarios/skill-loader";

const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = join(here, "fixtures", "skills");

test("loads SKILL.md and follows md-links inside the skill dir", () => {
	const blob = loadSkill("multi", skillsRoot);

	assert.match(blob, /=== multi\/SKILL\.md ===/);
	assert.match(blob, /=== multi\/sub\/helper\.md ===/);

	const skillHeaderCount = blob.match(/=== multi\/SKILL\.md ===/g)?.length ?? 0;
	assert.equal(skillHeaderCount, 1, "no cycles");
});

test("ignores external URLs and out-of-skill paths", () => {
	const blob = loadSkill("multi", skillsRoot);

	const sections = blob.match(/===.*?===/g) ?? [];
	const allowed = new Set([
		"=== multi/SKILL.md ===",
		"=== multi/sub/helper.md ===",
	]);
	for (const s of sections)
		assert.ok(allowed.has(s), `unexpected section: ${s}`);
});
