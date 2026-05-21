import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioRunRecord } from "../pipeline/pipeline";

export interface AggregateRunReportParams {
	runDirectory: string;
	runId: string;
	scenarios: ScenarioRunRecord[];
}

/**
 * Aggregate every `${runDirectory}/<scenario>/report.json` into
 * `${runDirectory}/report.json`. A missing scenario report →
 * `error: "missing scenario report"` for that slot.
 */
export function aggregateRunReport(params: AggregateRunReportParams): void {
	const { runDirectory, runId, scenarios } = params;

	const out: Record<string, unknown> = { runId, scenarios: {} };
	const scenariosOut: Record<string, unknown> = {};

	for (const s of scenarios) {
		const reportPath = join(s.scenarioDirectory, "report.json");
		if (!existsSync(reportPath)) {
			scenariosOut[s.scenarioName] = { error: "missing scenario report" };
			continue;
		}
		try {
			const parsed = JSON.parse(readFileSync(reportPath, "utf8"));
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

	out.scenarios = scenariosOut;
	writeFileSync(
		join(runDirectory, "report.json"),
		`${JSON.stringify(out, null, 2)}\n`,
	);
}
