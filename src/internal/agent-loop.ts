import type { Scenario, SkillsmithConfig } from "../config/types";
import type { RunLog } from "./run-log";

export interface RunAgentsParams {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
}

/**
 * Per-scenario agent loop. T7 fills in normalization + the per-agent
 * scaffold (mkdir workspace, fire 4 hooks). T10 plugs in the testing
 * agent dispatch and T11 the judge dispatch. Until then this is a
 * documented stub so the surrounding scenario loop typechecks.
 */
export async function runAgents(_params: RunAgentsParams): Promise<void> {
	// no-op: implementations land in T7+.
}
