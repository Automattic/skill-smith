import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Paths, Scenario } from "../config/types";
import { isDirectorySafe } from "../util/fs";

export interface EnumeratedScenario {
	scenario: Scenario;
	dirName: string;
	error?: string;
}

/**
 * Walk `paths.scenarios/*\/scenario.yaml`, parse, and validate that
 * `skills[*]` and `rubrics[*]` references resolve under
 * `paths.skills/` and `paths.rubrics/` respectively.
 *
 * Bad refs or malformed YAML → fail that scenario with an `error`,
 * others continue.
 */
export function enumerateScenarios(
	paths: Paths,
	projectRoot: string,
): EnumeratedScenario[] {
	const scenariosRoot = join(projectRoot, paths.scenarios);
	const skillsRoot = join(projectRoot, paths.skills);
	const rubricsRoot = join(projectRoot, paths.rubrics);

	const out: EnumeratedScenario[] = [];

	if (!existsSync(scenariosRoot)) return out;

	for (const entry of readdirSync(scenariosRoot)) {
		const dir = join(scenariosRoot, entry);
		if (!isDirectorySafe(dir)) continue;
		const yamlPath = join(dir, "scenario.yaml");
		if (!existsSync(yamlPath)) continue;

		let parsed: unknown;
		try {
			parsed = parseYaml(readFileSync(yamlPath, "utf8"));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			out.push({
				scenario: stubScenario(entry),
				dirName: entry,
				error: `scenario.yaml parse error: ${msg}`,
			});
			continue;
		}

		if (!isScenarioShape(parsed)) {
			out.push({
				scenario: stubScenario(entry),
				dirName: entry,
				error:
					"scenario.yaml malformed: expected name/description/skills/prompt/acceptance/rubrics",
			});
			continue;
		}

		const scenario = parsed;
		const missing: string[] = [];
		for (const id of scenario.skills) {
			if (!existsSync(join(skillsRoot, id, "SKILL.md"))) {
				missing.push(`skill "${id}"`);
			}
		}
		for (const id of scenario.rubrics) {
			if (!existsSync(join(rubricsRoot, `${id}.md`))) {
				missing.push(`rubric "${id}"`);
			}
		}

		if (missing.length > 0) {
			out.push({
				scenario,
				dirName: entry,
				error: `unresolved reference: ${missing.join(", ")}`,
			});
		} else {
			out.push({ scenario, dirName: entry });
		}
	}

	return out;
}

function stubScenario(dirName: string): Scenario {
	return {
		name: dirName,
		description: "",
		skills: [],
		prompt: "",
		acceptance: [],
		rubrics: [],
	};
}

function isScenarioShape(raw: unknown): raw is Scenario {
	if (raw === null || typeof raw !== "object") return false;
	const r = raw as Record<string, unknown>;
	return (
		typeof r.name === "string" &&
		r.name.length > 0 &&
		typeof r.description === "string" &&
		Array.isArray(r.skills) &&
		r.skills.every((s) => typeof s === "string") &&
		typeof r.prompt === "string" &&
		Array.isArray(r.acceptance) &&
		r.acceptance.every((s) => typeof s === "string") &&
		Array.isArray(r.rubrics) &&
		r.rubrics.every((s) => typeof s === "string")
	);
}
