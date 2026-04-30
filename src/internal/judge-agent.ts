import type { AgentConfig, Scenario, SkillsmithConfig } from "../config/types";
import type { TestingAgentResult } from "./agent-loop";
import type { RunLog } from "./run-log";

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judgeConfig: AgentConfig;
	agentDirectory: string;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
	testingResult: TestingAgentResult;
}

/**
 * Judge dispatch (T11). Builds the rubric+acceptance system prompt,
 * concatenates `agentWorkspace` files into the user message, runs
 * `query()` with `Read`-only tools, parses the YAML reply, and writes
 * `${agentDirectory}judge-review.yaml`.
 *
 * Stubbed in T7 so the agent-loop scaffold compiles. Filled in by T11.
 */
export async function runJudgeAgent(
	_params: RunJudgeAgentParams,
): Promise<void> {
	// implementation in T11
}
