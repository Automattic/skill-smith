import type { ScenarioRunRecord } from "./pipeline";

export interface AggregateRunReportParams {
	runDirectory: string;
	runId: string;
	scenarios: ScenarioRunRecord[];
}

/**
 * Mechanical aggregation of `${runDirectory}*\/report.yaml` into
 * `${runDirectory}report.yaml` (V24). T13 implements; this stub keeps
 * the pipeline scaffold compilable.
 */
export async function aggregateRunReport(
	_params: AggregateRunReportParams,
): Promise<void> {
	// implementation in T13
}
