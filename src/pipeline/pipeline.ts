import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config/load";
import { PreconditionError } from "../config/resolve-cwd";
import {
	type ResolvedSelfImprovement,
	resolveSelfImprovement,
	type SelfImprovementOverrides,
} from "../config/self-improvement";
import type {
	IterationInfo,
	RunContext,
	RunScenario,
	ScenarioContext,
	SkillsmithConfig,
} from "../config/types";
import { runImprovementCycle } from "../improvement/cycle";
import { isGitWorkTree } from "../improvement/git";
import { ProgressTracker } from "../progress";
import {
	aggregateIterationReport,
	type IterationReport,
	mergeIntoRunningReport,
	writeRunReport,
	writeRunSummary,
} from "../reports/iteration-report";
import {
	aggregateScenarioReport,
	type ScenarioReport,
} from "../reports/scenario-report";
import {
	type PreparedSummary,
	emitSummary,
	prepareSummary,
} from "../reports/summary";
import {
	type EnumeratedScenario,
	enumerateScenarios,
} from "../scenarios/enumerate";
import { UserFacingError } from "../util/errors";
import { tryHook } from "../util/hooks";
import { RunLog } from "../util/run-log";
import { runAgents } from "./agent-loop";
import { selectScenarios } from "./select-scenarios";

export interface PipelineParams {
	projectRoot: string;
	runId: string;
	verbose?: boolean;
	scenarios?: string[];
	selfImprovement?: SelfImprovementOverrides;
}

export interface ScenarioRunRecord {
	scenarioName: string;
	dirName: string;
	scenarioDirectory: string;
	error?: string;
}

/**
 * Top-level pipeline. Loads config, validates paths, then drives one
 * or more iterations:
 *
 *   1. Iteration 1 runs every scenario.
 *   2. If `selfImprovement.mode === "loop"` and the run is not yet
 *      passing, the improvement cycle runs (proposer → reviewer →
 *      executor) and the next iteration starts with a subset chosen
 *      by `evaluationMode`.
 *   3. Stop when the merged matrix is all-pass, when `maxIterations`
 *      is reached, or — when `finalPass=true` and the last iteration
 *      was a subset — after one extra full sweep.
 *
 * Layout: `${runDirectory}/iteration-N/<scenario>/<agent>/...`. Each
 * iteration writes its own `report.json`, `summary.txt`, `run.log`.
 * The top-level `${runDirectory}/report.json` is the merged matrix
 * across iterations; `${runDirectory}/run.json` is the iteration
 * roster.
 */
export async function runPipeline(params: PipelineParams): Promise<number> {
	const { projectRoot, runId, verbose } = params;

	const config = await loadConfig(projectRoot);
	checkPaths(config, projectRoot);
	const selfImprovement = resolveSelfImprovement(
		config,
		params.selfImprovement,
	);
	if (selfImprovement.mode === "loop" && !isGitWorkTree(projectRoot)) {
		throw new UserFacingError(
			`Self-improvement loop mode requires a git repository: ${projectRoot} is not inside a git work tree.\n` +
				"The loop captures skill edits as a diff via `git diff`. Run `git init` (and commit the skills) or run with `--mode test-only`.",
		);
	}
	const allScenarios = filterScenarios(
		enumerateScenarios(config.paths, projectRoot),
		params.scenarios,
	);

	const runDirectory = resolve(projectRoot, config.paths.base, runId);
	mkdirSync(runDirectory, { recursive: true });

	const iterations: IterationInfo[] = [];
	const runScenarios: RunScenario[] = allScenarios.map(
		({ dirName, scenario }) => ({
			dirName,
			scenario,
		}),
	);
	const runCtx: RunContext = {
		runId,
		config,
		runDirectory,
		iterations,
		scenarios: runScenarios,
	};

	const tracker = new ProgressTracker(
		{
			runId,
			scenarios: allScenarios.map((s) => ({
				name: s.scenario.name,
				agentIds: config.agents.testing.map((a) => a.id),
			})),
		},
		verbose ? { interactive: false } : {},
	);
	const maxIterations =
		selfImprovement.mode === "test-only" ? 1 : selfImprovement.maxIterations;

	let mergedScenarios: Record<string, ScenarioReport | { error: string }> = {};
	let mergedPass = false;
	let prevReport: IterationReport | undefined;
	let lastWasSubset = false;
	let firedBeforeAll = false;
	let lastIterationDirectory = runDirectory;
	const iterationPasses: boolean[] = [];

	const renderRunSummary = (): void => {
		writeRunSummary(runDirectory, {
			runId,
			pass: mergedPass,
			iterations: iterations.map((info, idx) => ({
				number: info.number,
				directory: info.directory,
				pass: iterationPasses[idx] ?? false,
			})),
		});
	};

	let prepared: PreparedSummary;
	try {
		for (let i = 1; i <= maxIterations; i++) {
			const selection =
				i === 1
					? {
							scenarios: allScenarios,
							agentFilter: undefined as Record<string, string[]> | undefined,
						}
					: selectScenarios(
							i,
							allScenarios,
							prevReport?.scenarios ?? {},
							selfImprovement.evaluationMode,
						);

			lastWasSubset = i > 1 && selfImprovement.evaluationMode !== "all";

			const outcome = await runOneIteration({
				iteration: i,
				iterationTotal: maxIterations,
				config,
				projectRoot,
				runDirectory,
				runId,
				verbose: verbose ?? false,
				selection: selection.scenarios,
				agentFilter: selection.agentFilter,
				iterations,
				runCtx,
				tracker,
				fireBeforeAll: !firedBeforeAll,
				selfImprovement,
			});
			firedBeforeAll = true;
			prevReport = outcome.report;
			lastIterationDirectory = outcome.iterationDirectory;
			iterationPasses.push(outcome.report.pass);

			mergedScenarios = mergeIntoRunningReport(
				mergedScenarios,
				outcome.report.scenarios,
			);
			mergedPass = writeRunReport(runDirectory, runId, mergedScenarios);
			renderRunSummary();

			if (mergedPass) break;

			if (i < maxIterations && selfImprovement.mode === "loop") {
				await runImprovementCycle({
					projectRoot,
					runId,
					runDirectory,
					iterations,
					scenarios: runScenarios,
					config,
					selfImprovement,
					iteration: i,
					iterationDirectory: outcome.iterationDirectory,
					iterationReport: outcome.report,
					allScenarios,
					log: outcome.log,
				});
				outcome.log.dump(outcome.iterationDirectory);
			}
		}

		if (
			selfImprovement.finalPass &&
			lastWasSubset &&
			selfImprovement.mode === "loop" &&
			!mergedPass
		) {
			const i = iterations.length + 1;
			const outcome = await runOneIteration({
				iteration: i,
				iterationTotal: i,
				config,
				projectRoot,
				runDirectory,
				runId,
				verbose: verbose ?? false,
				selection: allScenarios,
				agentFilter: undefined,
				iterations,
				runCtx,
				tracker,
				fireBeforeAll: false,
				selfImprovement,
			});
			lastIterationDirectory = outcome.iterationDirectory;
			iterationPasses.push(outcome.report.pass);
			mergedScenarios = mergeIntoRunningReport(
				mergedScenarios,
				outcome.report.scenarios,
			);
			mergedPass = writeRunReport(runDirectory, runId, mergedScenarios);
			renderRunSummary();
		}

		prepared = prepareSummary({ runDirectory, runId });
	} finally {
		const afterAllLog = new RunLog({ mirrorStderr: verbose ?? false });
		await tryHook(
			"afterAll",
			"run",
			config.hooks?.afterAll,
			runCtx,
			afterAllLog,
		);
		afterAllLog.dump(lastIterationDirectory);
		tracker.finish();
	}

	return emitSummary(prepared);
}

interface RunOneIterationParams {
	iteration: number;
	iterationTotal: number;
	config: SkillsmithConfig;
	projectRoot: string;
	runDirectory: string;
	runId: string;
	verbose: boolean;
	selection: EnumeratedScenario[];
	agentFilter: Record<string, string[]> | undefined;
	iterations: IterationInfo[];
	runCtx: RunContext;
	tracker: ProgressTracker;
	fireBeforeAll: boolean;
	selfImprovement: ResolvedSelfImprovement;
}

interface IterationOutcome {
	report: IterationReport;
	iterationDirectory: string;
	log: RunLog;
}

async function runOneIteration(
	args: RunOneIterationParams,
): Promise<IterationOutcome> {
	const iterationDirectory = resolve(
		args.runDirectory,
		`iteration-${args.iteration}`,
	);
	mkdirSync(iterationDirectory, { recursive: true });

	args.tracker.beginIteration(
		args.iteration,
		args.iterationTotal,
		args.selection.map((s) => s.scenario.name),
	);
	for (const s of args.selection) {
		if (s.error !== undefined) {
			args.tracker.scenarioSkipped(s.scenario.name, s.error);
		}
	}

	const log = new RunLog({ mirrorStderr: args.verbose });
	log.header(`skillsmith iteration ${args.iteration} (run ${args.runId})`);
	log.info(`projectRoot=${args.projectRoot}`);
	log.info(`runDirectory=${args.runDirectory}`);
	log.info(`iterationDirectory=${iterationDirectory}`);
	log.info(
		`selfImprovement: mode=${args.selfImprovement.mode} maxIterations=${args.selfImprovement.maxIterations} evaluation=${args.selfImprovement.evaluationMode} finalPass=${args.selfImprovement.finalPass}`,
	);
	log.info(
		`hooks defined: ${
			Object.entries(args.config.hooks ?? {})
				.filter(([, v]) => typeof v === "function")
				.map(([k]) => k)
				.join(", ") || "(none)"
		}`,
	);

	if (args.fireBeforeAll) {
		await tryHook(
			"beforeAll",
			"run",
			args.config.hooks?.beforeAll,
			args.runCtx,
			log,
		);
	}

	const iterationCtx = {
		...args.runCtx,
		iteration: args.iteration,
		iterationDirectory,
	};
	await tryHook(
		"beforeIteration",
		`iteration:${args.iteration}`,
		args.config.hooks?.beforeIteration,
		iterationCtx,
		log,
	);

	log.section(`scenarios (iteration ${args.iteration})`);
	for (const s of args.selection) {
		log.info(`  - ${s.scenario.name}${s.error ? ` [error: ${s.error}]` : ""}`);
	}

	let scenarioRecords: ScenarioRunRecord[];
	try {
		scenarioRecords = await Promise.all(
			args.selection.map((s) =>
				runScenario(s, {
					runId: args.runId,
					config: args.config,
					projectRoot: args.projectRoot,
					runDirectory: args.runDirectory,
					iterationDirectory,
					iterations: args.iterations,
					agentFilter: args.agentFilter?.[s.scenario.name],
					log,
					tracker: args.tracker,
					scenarios: args.runCtx.scenarios,
				}),
			),
		);
	} catch (err) {
		log.dump(iterationDirectory);
		throw err;
	}

	const report = aggregateIterationReport({
		iterationDirectory,
		runId: args.runId,
		iteration: args.iteration,
		scenarios: scenarioRecords,
	});

	args.iterations.push({
		number: args.iteration,
		directory: iterationDirectory,
	});

	await tryHook(
		"afterIteration",
		`iteration:${args.iteration}`,
		args.config.hooks?.afterIteration,
		{ ...iterationCtx, pass: report.pass },
		log,
	);

	log.dump(iterationDirectory);

	return { report, iterationDirectory, log };
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
	agentFilter?: string[];
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
				agentIdFilter: args.agentFilter,
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
