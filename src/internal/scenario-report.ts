import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { isDirectorySafe } from "./fs-util";

export interface AggregateScenarioReportParams {
	scenarioDirectory: string;
	scenarioName: string;
	scenarioError?: string;
}

interface AgentVerdict {
	[key: string]: unknown;
}

/**
 * Aggregate `${scenarioDirectory}*\/judge-review.yaml` into
 * `${scenarioDirectory}report.yaml` (V23). Missing review →
 * `error: "missing judge-review"` for that agent.
 */
export function aggregateScenarioReport(
	params: AggregateScenarioReportParams,
): void {
	const { scenarioDirectory, scenarioName, scenarioError } = params;

	const agents: Record<string, AgentVerdict | { error: string }> = {};

	if (isDirectorySafe(scenarioDirectory)) {
		for (const entry of readdirSync(scenarioDirectory)) {
			const full = join(scenarioDirectory, entry);
			if (!isDirectorySafe(full)) continue;
			const reviewPath = join(full, "judge-review.yaml");
			if (!existsSync(reviewPath)) {
				agents[entry] = { error: "missing judge-review" };
				continue;
			}
			let parsed: unknown;
			try {
				parsed = parseYaml(readFileSync(reviewPath, "utf8"));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				agents[entry] = { error: `judge-review unparseable: ${msg}` };
				continue;
			}
			agents[entry] = (parsed ?? {
				error: "judge-review empty",
			}) as AgentVerdict;
		}
	}

	const body: Record<string, unknown> = {
		scenario: scenarioName,
		agents,
	};
	if (scenarioError !== undefined) body.error = scenarioError;

	const target = join(scenarioDirectory, "report.yaml");
	writeFileSync(target, stringifyYaml(body));
}
