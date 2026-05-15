import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ScenarioRunRecord } from "../pipeline/pipeline";

export interface AggregateIterationReportParams {
	iterationDirectory: string;
	runId: string;
	iteration: number;
	scenarios: ScenarioRunRecord[];
}

/**
 * Aggregate every `${iterationDirectory}/<scenario>/report.yaml` into
 * `${iterationDirectory}/report.yaml`. A missing scenario report →
 * `error: "missing scenario report"` for that slot. Returns the
 * parsed iteration report so the pipeline can decide whether to stop
 * iterating.
 */
export interface IterationReport {
	runId: string;
	iteration: number;
	scenarios: Record<string, unknown>;
}

export function aggregateIterationReport(
	params: AggregateIterationReportParams,
): IterationReport {
	const { iterationDirectory, runId, iteration, scenarios } = params;

	const scenariosOut: Record<string, unknown> = {};

	for (const s of scenarios) {
		const reportPath = join(s.scenarioDirectory, "report.yaml");
		if (!existsSync(reportPath)) {
			scenariosOut[s.scenarioName] = { error: "missing scenario report" };
			continue;
		}
		try {
			const parsed = parseYaml(readFileSync(reportPath, "utf8"));
			scenariosOut[s.scenarioName] = parsed ?? {
				error: "scenario report empty",
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			scenariosOut[s.scenarioName] = {
				error: `scenario report unparseable: ${msg}`,
			};
		}
	}

	const report: IterationReport = {
		runId,
		iteration,
		scenarios: scenariosOut,
	};

	writeFileSync(join(iterationDirectory, "report.yaml"), stringifyYaml(report));

	return report;
}

export interface IterationSummaryEntry {
	number: number;
	directory: string;
}

export interface RunSummary {
	runId: string;
	iterations: IterationSummaryEntry[];
}

/**
 * Write the top-level `${runDirectory}/run.yaml` summarizing every
 * iteration the pipeline executed. This is the single artifact that
 * outlives the per-iteration directories — useful for `afterAll`
 * hooks that need to walk the whole run.
 */
export function writeRunSummary(
	runDirectory: string,
	summary: RunSummary,
): void {
	writeFileSync(join(runDirectory, "run.yaml"), stringifyYaml(summary));
}
