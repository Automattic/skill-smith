import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ScenarioRunRecord } from "../pipeline/pipeline";
import type { ScenarioReport } from "./scenario-report";

export interface AggregateIterationReportParams {
	iterationDirectory: string;
	runId: string;
	iteration: number;
	scenarios: ScenarioRunRecord[];
}

export interface IterationReport {
	runId: string;
	iteration: number;
	pass: boolean;
	scenarios: Record<string, ScenarioReport | { error: string }>;
}

/**
 * Aggregate every `${iterationDirectory}/<scenario>/report.yaml` into
 * `${iterationDirectory}/report.yaml`. Includes an iteration-level
 * `pass` flag (every scenario must pass) so the pipeline loop can
 * decide whether to stop iterating without re-parsing the per-agent
 * tree. Missing scenario report → `{ error: ... }` for that slot.
 */
export function aggregateIterationReport(
	params: AggregateIterationReportParams,
): IterationReport {
	const { iterationDirectory, runId, iteration, scenarios } = params;

	const scenariosOut: Record<string, ScenarioReport | { error: string }> = {};

	for (const s of scenarios) {
		const reportPath = join(s.scenarioDirectory, "report.yaml");
		if (!existsSync(reportPath)) {
			scenariosOut[s.scenarioName] = { error: "missing scenario report" };
			continue;
		}
		try {
			const parsed = parseYaml(readFileSync(reportPath, "utf8")) as
				| ScenarioReport
				| null
				| undefined;
			if (parsed === null || parsed === undefined || typeof parsed !== "object") {
				scenariosOut[s.scenarioName] = { error: "scenario report empty" };
				continue;
			}
			scenariosOut[s.scenarioName] = parsed;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			scenariosOut[s.scenarioName] = {
				error: `scenario report unparseable: ${msg}`,
			};
		}
	}

	const entries = Object.values(scenariosOut);
	const allPass =
		entries.length > 0 &&
		entries.every((entry): entry is ScenarioReport => {
			return (
				"pass" in entry &&
				entry.pass === true &&
				!("error" in entry && entry.error !== undefined)
			);
		});

	const report: IterationReport = {
		runId,
		iteration,
		pass: allPass,
		scenarios: scenariosOut,
	};

	writeFileSync(join(iterationDirectory, "report.yaml"), stringifyYaml(report));

	return report;
}

export interface IterationSummaryEntry {
	number: number;
	directory: string;
	pass: boolean;
}

export interface RunSummary {
	runId: string;
	pass: boolean;
	iterations: IterationSummaryEntry[];
}

/**
 * Write the top-level `${runDirectory}/run.yaml` summarizing every
 * iteration the pipeline executed and the final pass verdict. This
 * is the artifact that outlives the per-iteration directories.
 */
export function writeRunSummary(
	runDirectory: string,
	summary: RunSummary,
): void {
	writeFileSync(join(runDirectory, "run.yaml"), stringifyYaml(summary));
}
