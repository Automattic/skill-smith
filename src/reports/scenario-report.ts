import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDirectorySafe } from "../util/fs";

export interface AggregateScenarioReportParams {
	scenarioDirectory: string;
	scenarioName: string;
	scenarioError?: string;
}

interface AgentVerdict {
	[key: string]: unknown;
}

/**
 * Aggregate `${scenarioDirectory}/<agent>/report.json` into
 * `${scenarioDirectory}/report.json`. Missing report →
 * `error: "missing agent report"` for that agent. Each agent report
 * carries a `testing` block and a `review` block verbatim.
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
			const reportPath = join(full, "report.json");
			if (!existsSync(reportPath)) {
				agents[entry] = { error: "missing agent report" };
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(readFileSync(reportPath, "utf8"));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				agents[entry] = { error: `agent report unparseable: ${msg}` };
				continue;
			}
			agents[entry] = (parsed ?? {
				error: "agent report empty",
			}) as AgentVerdict;
		}
	}

	const body: Record<string, unknown> = {
		scenario: scenarioName,
		agents,
	};
	if (scenarioError !== undefined) body.error = scenarioError;

	mkdirSync(scenarioDirectory, { recursive: true });
	const target = join(scenarioDirectory, "report.json");
	writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
}
