import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadSkill } from "../scenarios/skill-loader";
import { isDirectorySafe } from "../util/fs";

/** Read every skill under the skills root (whole-root; follows md-links
 *  per skill via loadSkill; skips dirs without SKILL.md). Materializes the
 *  validator's post-edit "after" state. In-process, ephemeral — writes
 *  nothing, touches no git. */
export function readSkillsRoot(skillsRoot: string): string {
	const sections: string[] = [];

	for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
		const dir = join(skillsRoot, entry.name);
		// Gate on a real dir holding a SKILL.md before loadSkill — it throws
		// on a missing SKILL.md (skill-loader.ts:15-17), so a non-skill dir
		// like `_assets/` must be skipped, not crash.
		if (!isDirectorySafe(dir)) continue;
		if (!existsSync(join(dir, "SKILL.md"))) continue;
		sections.push(loadSkill(entry.name, skillsRoot));
	}

	return sections.join("\n\n");
}
