import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { AgentContext, Scenario, SkillsmithConfig } from "../config/types";
import {
	type AgentAlias,
	type NormalizedEntry,
	normalizeAgentConfig,
} from "./agent-normalize";
import { tryHook } from "./hooks";
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
 * Per-scenario agent loop (parallel). Normalizes the testing matrix,
 * mkdirs each `agentWorkspace` (V4), fires the four agent-scoped
 * hooks, and dispatches testing + judge agents.
 *
 * Skipped entries (V12, V14, V15, V16) emit a stub `judge-review.yaml`
 * so the scenario aggregator (T12) can produce a complete report.
 */
export async function runAgents(params: RunAgentsParams): Promise<void> {
	const { scenario, scenarioDirectory, config, runId, projectRoot, log } =
		params;

	const testingNorm = normalizeAgentConfig(config.agents.testing);
	for (const sk of testingNorm.skipped) {
		log.info(
			`agents.testing entry "${sk.source}" skipped (scenario=${scenario.name}): ${sk.reason}`,
		);
		writeSkippedReview({
			scenarioDirectory,
			alias: sk.source,
			reason: sk.reason,
		});
	}

	if (testingNorm.entries.length === 0 && testingNorm.emptyReason) {
		log.info(
			`agents.testing empty for scenario ${scenario.name}: ${testingNorm.emptyReason}`,
		);
		writeSkippedReview({
			scenarioDirectory,
			alias: "empty",
			reason: testingNorm.emptyReason,
		});
		return;
	}

	await Promise.all(
		testingNorm.entries.map((entry) =>
			runAgentPair({
				entry,
				scenario,
				scenarioDirectory,
				config,
				runId,
				projectRoot,
				log,
			}),
		),
	);
}

interface RunAgentPairParams {
	entry: NormalizedEntry;
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
}

async function runAgentPair(params: RunAgentPairParams): Promise<void> {
	const {
		entry,
		scenario,
		scenarioDirectory,
		config,
		runId,
		projectRoot,
		log,
	} = params;
	const agentId: AgentAlias = entry.alias;
	const agentDirectory = join(scenarioDirectory, agentId);
	const agentWorkspace = join(agentDirectory, "workspace");

	mkdirSync(agentWorkspace, { recursive: true });

	const agentCtx: AgentContext = {
		runId,
		config,
		scenario,
		agentId,
		agentWorkspace,
	};

	const scope = `scenario:${scenario.name}/agent:${agentId}`;

	await tryHook(
		"beforeTestAgent",
		scope,
		config.hooks?.beforeTestAgent,
		agentCtx,
		log,
	);

	let testingResult: TestingAgentResult | undefined;
	try {
		const { runTestingAgent } = await import("./testing-agent");
		testingResult = await runTestingAgent({
			scenario,
			settings: entry.settings,
			alias: entry.alias,
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

	// V9: afterTestAgent always fires.
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

	try {
		const { runJudgeAgent } = await import("./judge-agent");
		await runJudgeAgent({
			scenario,
			judgeConfig: config.agents.judge,
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
		writeSkippedReview({
			scenarioDirectory,
			alias: agentId,
			reason: `judge dispatch failed: ${msg}`,
			agentDirectoryOverride: agentDirectory,
		});
	}

	// V9: afterJudgeAgent always fires.
	await tryHook(
		"afterJudgeAgent",
		scope,
		config.hooks?.afterJudgeAgent,
		agentCtx,
		log,
	);
}

export interface TestingAgentResult {
	finalText: string;
	toolUseCount: number;
	filesWritten: string[];
	error?: string;
}

interface WriteSkippedReviewParams {
	scenarioDirectory: string;
	alias: string;
	reason: string;
	agentDirectoryOverride?: string;
}

function writeSkippedReview(params: WriteSkippedReviewParams): void {
	const dir =
		params.agentDirectoryOverride ??
		join(params.scenarioDirectory, params.alias);
	mkdirSync(dir, { recursive: true });
	const yaml = stringifyYaml({ skipped: params.reason });
	writeFileSync(join(dir, "judge-review.yaml"), yaml);
}
