export interface AggregateScenarioReportParams {
	scenarioDirectory: string;
	scenarioName: string;
	scenarioError?: string;
}

/**
 * Mechanical aggregation of `${scenarioDirectory}*\/judge-review.yaml`
 * into `${scenarioDirectory}report.yaml` (V23). T12 implements; this
 * stub keeps the pipeline scaffold compilable.
 */
export async function aggregateScenarioReport(
	_params: AggregateScenarioReportParams,
): Promise<void> {
	// implementation in T12
}
