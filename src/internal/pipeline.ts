import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
	RunContext,
	ScenarioContext,
	SkillsmithConfig,
} from "../config/types";
import { runAgents } from "./agent-loop";
import { loadConfig } from "./config-loader";
import { PreconditionError } from "./cwd";
import { tryHook } from "./hooks";
import { RunLog } from "./run-log";
import { aggregateRunReport } from "./run-report";
import { aggregateScenarioReport } from "./scenario-report";
import { type EnumeratedScenario, enumerateScenarios } from "./scenarios";
import { printSummary } from "./summary";

export interface PipelineParams {
	projectRoot: string;
	runId: string;
}

export interface ScenarioRunRecord {
	scenarioName: string;
	dirName: string;
	scenarioDirectory: string;
	error?: string;
}

/**
 * Top-level pipeline: load config, validate preconditions, enumerate
 * scenarios, fan out the scenario loop in parallel (T6/V7), aggregate
 * the run report (T13), then print the summary (T14).
 *
 * T6 wires only the scenario-loop scaffold — agent dispatch + report
 * aggregation are filled in by T7–T14 in their own modules.
 */
export async function runPipeline(params: PipelineParams): Promise<number> {
	const { projectRoot, runId } = params;

	const config = await loadConfig(projectRoot);
	checkPaths(config, projectRoot);

	const runDirectory = resolve(projectRoot, config.paths.base, runId);

	const log = new RunLog();
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

	let scenarioRecords: ScenarioRunRecord[];
	try {
		scenarioRecords = await Promise.all(
			scenarios.map((s) =>
				runScenario(s, { runId, config, projectRoot, runDirectory, log }),
			),
		);
	} finally {
		await tryHook("afterAll", "run", config.hooks?.afterAll, runCtx, log);
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
