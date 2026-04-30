import type {
	AgentSettings,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { TestingAgentResult } from "./agent-loop";
import type { AgentAlias } from "./agent-normalize";
import type { RunLog } from "./run-log";

export interface RunTestingAgentParams {
	scenario: Scenario;
	settings: AgentSettings;
	alias: AgentAlias;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
}

/**
 * Testing-agent dispatch (T10). Loads the SKILL.md blob (T8), maps
 * settings to SDK options (T9), spawns `query()` with the testing tool
 * set, and returns the final text + files written + tool-use count.
 *
 * Stubbed in T7 so the agent-loop scaffold compiles. Filled in by T10.
 */
export async function runTestingAgent(
	_params: RunTestingAgentParams,
): Promise<TestingAgentResult> {
	return { finalText: "", toolUseCount: 0, filesWritten: [] };
}
