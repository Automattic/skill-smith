import type { EvaluationMode } from "../config/types";
import type { ScenarioReport } from "../reports/scenario-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import { isAgentVerdictPass } from "../reports/agent-verdict";
import type { AgentVerdict } from "../reports/agent-verdict";

export interface ScenarioSelection {
	scenarios: EnumeratedScenario[];
	/**
	 * Optional per-scenario agent filter. Present only for
	 * `failed-pairs` mode — keys are scenario names, values are the
	 * agent ids to re-run. Scenarios absent from the map run their full
	 * configured agent matrix.
	 */
	agentFilter?: Record<string, string[]>;
}

/**
 * Decide which (scenario, agent) pairs to evaluate in iteration N
 * given the previous iteration's scenario reports and the configured
 * mode. Iteration 1 always runs everything; later iterations narrow:
 *
 *   - `all` — keep the full matrix.
 *   - `failed-scenarios` — keep scenarios where at least one agent
 *     failed, but re-run every agent for those scenarios so the
 *     re-evaluation sees the same matrix as before.
 *   - `failed-pairs` — keep only the exact (scenario, agent) pairs
 *     that failed. Scenarios where every agent passed drop out.
 *
 * Scenarios that have a pre-run `error` (enumeration failure, e.g.
 * malformed scenario.yaml) always stay in selection so the harness
 * keeps surfacing them.
 */
export function selectScenarios(
	iteration: number,
	allScenarios: EnumeratedScenario[],
	prevScenarioReports: Record<string, ScenarioReport | { error: string }>,
	mode: EvaluationMode,
): ScenarioSelection {
	if (iteration <= 1 || mode === "all") {
		return { scenarios: allScenarios };
	}

	const failingAgentsByScenario = collectFailingAgents(prevScenarioReports);

	const filtered = allScenarios.filter((s) => {
		if (s.error !== undefined) return true;
		return failingAgentsByScenario.has(s.scenario.name);
	});

	if (mode === "failed-scenarios") {
		return { scenarios: filtered };
	}

	const agentFilter: Record<string, string[]> = {};
	for (const s of filtered) {
		if (s.error !== undefined) continue;
		const set = failingAgentsByScenario.get(s.scenario.name);
		if (set !== undefined) agentFilter[s.scenario.name] = [...set];
	}
	return { scenarios: filtered, agentFilter };
}

function collectFailingAgents(
	scenarios: Record<string, ScenarioReport | { error: string }>,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [name, body] of Object.entries(scenarios)) {
		if (!("agents" in body)) {
			// Scenario-level error → re-evaluate every agent next iteration.
			out.set(name, new Set());
			continue;
		}
		const failed = new Set<string>();
		for (const [agentId, entry] of Object.entries(body.agents)) {
			if (entry.error !== undefined) {
				failed.add(agentId);
				continue;
			}
			const review = entry.review as AgentVerdict | undefined;
			if (review === undefined) {
				failed.add(agentId);
				continue;
			}
			if (!isAgentVerdictPass(review)) failed.add(agentId);
		}
		if (failed.size > 0) out.set(name, failed);
	}
	return out;
}
