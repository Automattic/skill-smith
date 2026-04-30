import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Paths, Scenario } from "../config/types";

export interface EnumeratedScenario {
	scenario: Scenario;
	dirName: string;
	error?: string;
}

/**
 * Walk `paths.scenarios/*\/scenario.yaml`, parse, and validate
 * `skills[*]` and `rubrics[*]` references resolve under `paths.skills/`
 * and `paths.rubrics/` respectively. Bad refs → fail that scenario
 * with `error: "unresolved reference"`, others continue (V11).
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
		let isDir = false;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) continue;
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

		const scenario = normalizeScenario(parsed, entry);

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

function normalizeScenario(raw: unknown, dirName: string): Scenario {
	if (raw === null || typeof raw !== "object") return stubScenario(dirName);
	const r = raw as Record<string, unknown>;
	return {
		...r,
		name: typeof r.name === "string" && r.name.length > 0 ? r.name : dirName,
		description: typeof r.description === "string" ? r.description : "",
		skills: Array.isArray(r.skills)
			? r.skills.filter((x): x is string => typeof x === "string")
			: [],
		prompt: typeof r.prompt === "string" ? r.prompt : "",
		acceptance: Array.isArray(r.acceptance)
			? r.acceptance.filter((x): x is string => typeof x === "string")
			: [],
		rubrics: Array.isArray(r.rubrics)
			? r.rubrics.filter((x): x is string => typeof x === "string")
			: [],
	};
}
