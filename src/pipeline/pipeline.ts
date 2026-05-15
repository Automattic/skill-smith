import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config/load";
import { PreconditionError } from "../config/resolve-cwd";
import type {
	IterationInfo,
	RunContext,
	RunScenario,
	ScenarioContext,
	SkillsmithConfig,
} from "../config/types";
import { ProgressTracker } from "../progress";
import {
	aggregateIterationReport,
	writeRunSummary,
} from "../reports/iteration-report";
import { aggregateScenarioReport } from "../reports/scenario-report";
import { printSummary } from "../reports/summary";
import {
	type EnumeratedScenario,
	enumerateScenarios,
} from "../scenarios/enumerate";
import { UserFacingError } from "../util/errors";
import { tryHook } from "../util/hooks";
import { RunLog } from "../util/run-log";
import { runAgents } from "./agent-loop";

export interface PipelineParams {
	projectRoot: string;
	runId: string;
	verbose?: boolean;
	scenarios?: string[];
}

export interface ScenarioRunRecord {
	scenarioName: string;
	dirName: string;
	scenarioDirectory: string;
	error?: string;
}

/**
 * Top-level pipeline: load config, validate preconditions, enumerate
 * scenarios, run one iteration (Phase 1 fixes this at 1; loop mode
 * adds more), aggregate reports, then print the summary.
 *
 * Layout: `${runDirectory}/iteration-N/<scenario>/<agent>/...`. Each
 * iteration writes its own `report.yaml`, `summary.txt`, `run.log`.
 * The top-level `${runDirectory}/run.yaml` lists every iteration the
 * harness executed.
 */
export async function runPipeline(params: PipelineParams): Promise<number> {
	const { projectRoot, runId, verbose } = params;

	const config = await loadConfig(projectRoot);
	checkPaths(config, projectRoot);
	const scenarios = filterScenarios(
		enumerateScenarios(config.paths, projectRoot),
		params.scenarios,
	);

	const runDirectory = resolve(projectRoot, config.paths.base, runId);
	mkdirSync(runDirectory, { recursive: true });

	const iterationNumber = 1;
	const iterationDirectory = resolve(
		runDirectory,
		`iteration-${iterationNumber}`,
	);
	mkdirSync(iterationDirectory, { recursive: true });

	const iterations: IterationInfo[] = [];

	const log = new RunLog({ mirrorStderr: verbose ?? false });
	log.header(`skillsmith run ${runId}`);
	log.info(`projectRoot=${projectRoot}`);
	log.info(`runDirectory=${runDirectory}`);
	log.info(`iteration=${iterationNumber}`);
	log.info(`iterationDirectory=${iterationDirectory}`);
	log.info(
		`hooks defined: ${
			Object.entries(config.hooks ?? {})
				.filter(([, v]) => typeof v === "function")
				.map(([k]) => k)
				.join(", ") || "(none)"
		}`,
	);

	const runCtx: RunContext = {
		runId,
		config,
		runDirectory,
		iterations,
		scenarios: scenarios.map(({ dirName, scenario }) => ({
			dirName,
			scenario,
		})),
	};
	await tryHook("beforeAll", "run", config.hooks?.beforeAll, runCtx, log);

	log.section("scenarios");
	for (const s of scenarios) {
		log.info(`  - ${s.scenario.name}${s.error ? ` [error: ${s.error}]` : ""}`);
	}

	const tracker = new ProgressTracker(
		{
			runId,
			scenarios: scenarios.map((s) => ({
				name: s.scenario.name,
				agentIds: config.agents.testing.map((a) => a.id),
			})),
		},
		verbose ? { interactive: false } : {},
	);
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
					iterationDirectory,
					iterations,
					log,
					tracker,
					scenarios: runCtx.scenarios,
				}),
			),
		);

		const iterationReport = aggregateIterationReport({
			iterationDirectory,
			runId,
			iteration: iterationNumber,
			scenarios: scenarioRecords,
		});

		iterations.push({
			number: iterationNumber,
			directory: iterationDirectory,
		});

		writeRunSummary(runDirectory, {
			runId,
			pass: iterationReport.pass,
			iterations: [
				{
					number: iterationNumber,
					directory: iterationDirectory,
					pass: iterationReport.pass,
				},
			],
		});
	} finally {
		await tryHook("afterAll", "run", config.hooks?.afterAll, runCtx, log);
		tracker.finish();
	}

	log.dump(iterationDirectory);

	return printSummary({ iterationDirectory, runId });
}

function filterScenarios(
	scenarios: EnumeratedScenario[],
	rawFilters: string[] | undefined,
): EnumeratedScenario[] {
	if (rawFilters === undefined || rawFilters.length === 0) {
		return scenarios;
	}

	const filters: string[] = [];
	const seen = new Set<string>();
	for (const raw of rawFilters) {
		const filter = raw.trim();
		if (filter.length === 0) {
			throw new UserFacingError("Scenario IDs must not be empty.");
		}
		if (!seen.has(filter)) {
			seen.add(filter);
			filters.push(filter);
		}
	}

	const byDirName = new Map(scenarios.map((s) => [s.dirName, s]));
	const unknown = filters.filter((filter) => !byDirName.has(filter));
	if (unknown.length > 0) {
		const label =
			unknown.length === 1
				? `Unknown scenario: ${unknown[0]}`
				: `Unknown scenarios: ${unknown.join(", ")}`;
		const available = scenarios.map((s) => `- ${s.dirName}`).join("\n");
		throw new UserFacingError(`${label}\n\nAvailable scenarios:\n${available}`);
	}

	return filters.map((filter) => byDirName.get(filter) as EnumeratedScenario);
}

interface ScenarioRunArgs {
	runId: string;
	config: SkillsmithConfig;
	projectRoot: string;
	runDirectory: string;
	iterationDirectory: string;
	iterations: IterationInfo[];
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
}

async function runScenario(
	enumerated: EnumeratedScenario,
	args: ScenarioRunArgs,
): Promise<ScenarioRunRecord> {
	const { scenario, error } = enumerated;
	const scenarioDirectory = resolve(args.iterationDirectory, scenario.name);
	const scenarioCtx: ScenarioContext = {
		runId: args.runId,
		config: args.config,
		runDirectory: args.runDirectory,
		iterations: args.iterations,
		scenarios: args.scenarios,
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
				runDirectory: args.runDirectory,
				iterations: args.iterations,
				projectRoot: args.projectRoot,
				log: args.log,
				tracker: args.tracker,
				scenarios: args.scenarios,
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
