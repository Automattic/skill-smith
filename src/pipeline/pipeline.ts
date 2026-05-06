import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config/load";
import { PreconditionError } from "../config/resolve-cwd";
import type {
	RunContext,
	ScenarioContext,
	SkillsmithConfig,
} from "../config/types";
import { ProgressTracker } from "../progress";
import { aggregateRunReport } from "../reports/run-report";
import { aggregateScenarioReport } from "../reports/scenario-report";
import { printSummary } from "../reports/summary";
import {
	type EnumeratedScenario,
	enumerateScenarios,
} from "../scenarios/enumerate";
import { tryHook } from "../util/hooks";
import { RunLog } from "../util/run-log";
import { runAgents } from "./agent-loop";

export interface PipelineParams {
	projectRoot: string;
	runId: string;
	verbose?: boolean;
}

export interface ScenarioRunRecord {
	scenarioName: string;
	dirName: string;
	scenarioDirectory: string;
	error?: string;
}

/**
 * Top-level pipeline: load config, validate preconditions, enumerate
 * scenarios, fan out the scenario loop in parallel, aggregate the run
 * report, then print the summary.
 */
export async function runPipeline(params: PipelineParams): Promise<number> {
	const { projectRoot, runId, verbose } = params;

	const config = await loadConfig(projectRoot);
	checkPaths(config, projectRoot);

	const runDirectory = resolve(projectRoot, config.paths.base, runId);

	const log = new RunLog({ mirrorStderr: verbose ?? false });
	log.header(`skillsmith run ${runId}`);
	log.info(`projectRoot=${projectRoot}`);
	log.info(`runDirectory=${runDirectory}`);
	log.info(
		`hooks defined: ${
			Object.entries(config.hooks ?? {})
				.filter(([, v]) => typeof v === "function")
				.map(([k]) => k)
				.join(", ") || "(none)"
		}`,
	);

	const runCtx: RunContext = { runId, config };
	await tryHook("beforeAll", "run", config.hooks?.beforeAll, runCtx, log);

	const scenarios = enumerateScenarios(config.paths, projectRoot);
	log.section("scenarios");
	for (const s of scenarios) {
		log.info(`  - ${s.scenario.name}${s.error ? ` [error: ${s.error}]` : ""}`);
	}

	const tracker = new ProgressTracker({
		runId,
		scenarios: scenarios.map((s) => ({
			name: s.scenario.name,
			agentIds: config.agents.testing.map((a) => a.id),
		})),
	});
	for (const s of scenarios) {
		if (s.error !== undefined) {
			tracker.scenarioSkipped(s.scenario.name, s.error);
		}
	}

	let scenarioRecords: ScenarioRunRecord[];
	try {
		scenarioRecords = await Promise.all(
			scenarios.map((s) =>
				runScenario(s, {
					runId,
					config,
					projectRoot,
					runDirectory,
					log,
					tracker,
				}),
			),
		);
	} finally {
		await tryHook("afterAll", "run", config.hooks?.afterAll, runCtx, log);
		tracker.finish();
	}

	aggregateRunReport({
		runDirectory,
		runId,
		scenarios: scenarioRecords,
	});

	log.dump(runDirectory);

	return printSummary({ runDirectory, runId });
}

interface ScenarioRunArgs {
	runId: string;
	config: SkillsmithConfig;
	projectRoot: string;
	runDirectory: string;
	log: RunLog;
	tracker: ProgressTracker;
}

async function runScenario(
	enumerated: EnumeratedScenario,
	args: ScenarioRunArgs,
): Promise<ScenarioRunRecord> {
	const { scenario, error } = enumerated;
	const scenarioDirectory = resolve(args.runDirectory, scenario.name);
	const scenarioCtx: ScenarioContext = {
		runId: args.runId,
		config: args.config,
		scenario,
	};

	args.log.section(`scenario: ${scenario.name}`);

	if (error !== undefined) {
		args.log.info(`scenario ${scenario.name} skipped: ${error}`);
	}

	await tryHook(
		"beforeScenario",
		`scenario:${scenario.name}`,
		args.config.hooks?.beforeScenario,
		scenarioCtx,
		args.log,
	);

	try {
		if (error === undefined) {
			await runAgents({
				scenario,
				scenarioDirectory,
				config: args.config,
				runId: args.runId,
				projectRoot: args.projectRoot,
				log: args.log,
				tracker: args.tracker,
			});
		}

		aggregateScenarioReport({
			scenarioDirectory,
			scenarioName: scenario.name,
			scenarioError: error,
		});
	} finally {
		await tryHook(
			"afterScenario",
			`scenario:${scenario.name}`,
			args.config.hooks?.afterScenario,
			scenarioCtx,
			args.log,
		);
	}

	return {
		scenarioName: scenario.name,
		dirName: enumerated.dirName,
		scenarioDirectory,
		error,
	};
}

function checkPaths(config: SkillsmithConfig, projectRoot: string): void {
	const missing: string[] = [];
	for (const key of ["skills", "scenarios", "rubrics"] as const) {
		const dir = resolve(projectRoot, config.paths[key]);
		if (!existsSync(dir)) {
			missing.push(`paths.${key} → ${dir} (does not exist)`);
			continue;
		}
		if (!statSync(dir).isDirectory()) {
			missing.push(`paths.${key} → ${dir} (not a directory)`);
		}
	}
	if (config.paths.base === undefined || config.paths.base === "") {
		missing.push("paths.base is empty");
	}
	if (missing.length > 0) {
		throw new PreconditionError(missing);
	}
}
