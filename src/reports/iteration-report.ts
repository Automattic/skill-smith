import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ScenarioRunRecord } from "../pipeline/pipeline";
import { isAgentVerdictPass } from "./agent-verdict";
import type { AgentVerdict } from "./agent-verdict";
import type { ScenarioAgentEntry, ScenarioReport } from "./scenario-report";

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
 * `${iterationDirectory}/report.yaml`. The iteration-level `pass`
 * flag reflects only the scenarios that ran this iteration (`true`
 * iff every one passed). Missing scenario report →
 * `{ error: ... }` for that slot.
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

	const allPass = scenariosAllPass(scenariosOut);

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

/**
 * Merge a later iteration's scenarios into the running merged view.
 * Scenarios re-evaluated in the new iteration replace the previous
 * entry; scenarios absent from the new iteration retain their last
 * known verdict. When a scenario re-ran with a subset of agents
 * (failed-pairs mode), agent rows merge instead of replace: new
 * agents win, untouched agents inherit their previous row.
 */
export function mergeIntoRunningReport(
	prev: Record<string, ScenarioReport | { error: string }>,
	curr: Record<string, ScenarioReport | { error: string }>,
): Record<string, ScenarioReport | { error: string }> {
	const out: Record<string, ScenarioReport | { error: string }> = { ...prev };
	for (const [name, body] of Object.entries(curr)) {
		if (!("agents" in body)) {
			out[name] = body;
			continue;
		}
		const prevBody = out[name];
		if (prevBody === undefined || !("agents" in prevBody)) {
			out[name] = body;
			continue;
		}
		const mergedAgents: Record<string, ScenarioAgentEntry> = {
			...prevBody.agents,
		};
		for (const [agentId, entry] of Object.entries(body.agents)) {
			mergedAgents[agentId] = entry;
		}
		const merged: ScenarioReport = {
			...body,
			agents: mergedAgents,
			pass: agentsAllPass(mergedAgents),
		};
		if (body.error !== undefined) merged.error = body.error;
		else delete merged.error;
		out[name] = merged;
	}
	return out;
}

/**
 * Write `${runDirectory}/report.yaml` — the merged matrix across every
 * iteration the pipeline ran. This is the canonical "final" report
 * the console summary renders.
 */
export function writeRunReport(
	runDirectory: string,
	runId: string,
	scenarios: Record<string, ScenarioReport | { error: string }>,
): boolean {
	const pass = scenariosAllPass(scenarios);
	writeFileSync(
		join(runDirectory, "report.yaml"),
		stringifyYaml({ runId, pass, scenarios }),
	);
	return pass;
}

function scenariosAllPass(
	scenarios: Record<string, ScenarioReport | { error: string }>,
): boolean {
	const entries = Object.values(scenarios);
	if (entries.length === 0) return false;
	return entries.every((entry): entry is ScenarioReport => {
		if (!("pass" in entry)) return false;
		if (entry.pass !== true) return false;
		if ("error" in entry && entry.error !== undefined) return false;
		return true;
	});
}

function agentsAllPass(agents: Record<string, ScenarioAgentEntry>): boolean {
	const entries = Object.values(agents);
	if (entries.length === 0) return false;
	for (const entry of entries) {
		if (entry.error !== undefined) return false;
		const review = entry.review as AgentVerdict | undefined;
		if (review === undefined) return false;
		if (!isAgentVerdictPass(review)) return false;
	}
	return true;
}
