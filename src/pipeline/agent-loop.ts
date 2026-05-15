import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type {
	AgentContext,
	AgentDefinition,
	RunScenario,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { ProgressTracker } from "../progress";
import { tryHook } from "../util/hooks";
import type { RunLog } from "../util/run-log";
import { runJudgeAgent } from "./judge-agent";
import { runTestingAgent } from "./testing-agent";

export interface RunAgentsParams {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
}

export interface TestingAgentResult {
	finalText: string;
	toolUseCount: number;
	filesWritten: string[];
	error?: string;
}

/**
 * Per-scenario agent loop. Mkdirs each `agentWorkspace`, fires the
 * four agent-scoped hooks, and dispatches testing + judge agents in
 * parallel across testing entries.
 */
export async function runAgents(params: RunAgentsParams): Promise<void> {
	const {
		scenario,
		scenarioDirectory,
		config,
		runId,
		projectRoot,
		log,
		tracker,
		scenarios,
	} = params;

	await Promise.all(
		config.agents.testing.map((agent) =>
			runAgentPair({
				agent,
				scenario,
				scenarioDirectory,
				config,
				runId,
				projectRoot,
				log,
				tracker,
				scenarios,
			}),
		),
	);
}

interface RunAgentPairParams {
	agent: AgentDefinition;
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
}

async function runAgentPair(params: RunAgentPairParams): Promise<void> {
	const {
		agent,
		scenario,
		scenarioDirectory,
		config,
		runId,
		projectRoot,
		log,
		tracker,
		scenarios,
	} = params;
	const agentDirectory = join(scenarioDirectory, agent.id);
	const agentWorkspace = join(agentDirectory, "workspace");

	mkdirSync(agentWorkspace, { recursive: true });

	const agentCtx: AgentContext = {
		runId,
		config,
		scenarios,
		scenario,
		agent,
		agentWorkspace,
	};

	const scope = `scenario:${scenario.name}/agent:${agent.id}`;

	await tryHook(
		"beforeTestAgent",
		scope,
		config.hooks?.beforeTestAgent,
		agentCtx,
		log,
	);

	tracker.phaseStarted(scenario.name, agent.id, "testing");
	const testingStart = Date.now();
	let testingResult: TestingAgentResult;
	try {
		testingResult = await runTestingAgent({
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config,
			log,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.info(`testing-agent failed (${scope}): ${msg}`);
		testingResult = {
			finalText: "",
			toolUseCount: 0,
			filesWritten: [],
			error: msg,
		};
	}
	tracker.phaseFinished(scenario.name, agent.id, "testing", {
		status: testingResult.error === undefined ? "passed" : "failed",
		durationMs: Date.now() - testingStart,
		detail: testingResult.error,
	});

	await tryHook(
		"afterTestAgent",
		scope,
		config.hooks?.afterTestAgent,
		agentCtx,
		log,
	);

	await tryHook(
		"beforeJudgeAgent",
		scope,
		config.hooks?.beforeJudgeAgent,
		agentCtx,
		log,
	);

	tracker.phaseStarted(scenario.name, agent.id, "judge");
	const judgeStart = Date.now();
	let judgeError: string | undefined;
	try {
		await runJudgeAgent({
			scenario,
			judges: config.agents.judge,
			agentDirectory,
			agentWorkspace,
			projectRoot,
			config,
			log,
			testingResult,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.info(`judge-agent failed (${scope}): ${msg}`);
		writeSkippedReview(agentDirectory, `judge dispatch failed: ${msg}`);
		judgeError = msg;
	}
	tracker.phaseFinished(scenario.name, agent.id, "judge", {
		status: judgeError === undefined ? "passed" : "failed",
		durationMs: Date.now() - judgeStart,
		detail: judgeError,
	});

	await tryHook(
		"afterJudgeAgent",
		scope,
		config.hooks?.afterJudgeAgent,
		agentCtx,
		log,
	);
}

function writeSkippedReview(agentDirectory: string, reason: string): void {
	mkdirSync(agentDirectory, { recursive: true });
	writeFileSync(
		join(agentDirectory, "judge-review.yaml"),
		stringifyYaml({ skipped: reason }),
	);
}
