import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Paths, Scenario } from "../config/types";
import { isDirectorySafe } from "../util/fs";

/**
 * Provenance for an enumerated scenario's `scenario.name` value.
 * Configured names come from a valid `scenario.yaml`; synthetic names are
 * generated from the scenario id when the file cannot provide a valid name.
 */
export type EnumeratedScenarioNameSource = "configured" | "synthetic";

/**
 * Scenario record produced by filesystem enumeration before run selection.
 */
export interface EnumeratedScenario {
	/** Parsed scenario definition, or a minimal placeholder for invalid YAML. */
	scenario: Scenario;
	/**
	 * Stable scenario directory identifier, relative to `paths.scenarios` and
	 * normalized to use `/` separators.
	 *
	 * @example "counter"
	 */
	id: string;
	/** Compatibility alias for `id`. This value must always equal `id`. */
	dirName: string;
	/** Indicates whether `scenario.name` came from YAML or from the scenario id. */
	nameSource: EnumeratedScenarioNameSource;
	/** Enumeration-time validation error, if the scenario cannot run as-is. */
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
				id: entry,
				dirName: entry,
				nameSource: "synthetic",
				error: `scenario.yaml parse error: ${msg}`,
			});
			continue;
		}

		if (!isScenarioShape(parsed)) {
			out.push({
				scenario: stubScenario(entry),
				id: entry,
				dirName: entry,
				nameSource: "synthetic",
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
				id: entry,
				dirName: entry,
				nameSource: "configured",
				error: `unresolved reference: ${missing.join(", ")}`,
			});
		} else {
			out.push({ scenario, id: entry, dirName: entry, nameSource: "configured" });
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
