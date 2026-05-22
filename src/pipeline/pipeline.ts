import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { runImprovement } from "../improvement/improver";
import { applyVerification, runAfterAllScenarios } from "../improvement/verify";
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
 *      passing, the improver agent edits the failing skills and the
 *      next iteration starts with a subset chosen by `evaluationMode`.
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
			iterationPasses.push(outcome.report.pass);

			mergedScenarios = mergeIntoRunningReport(
				mergedScenarios,
				outcome.report.scenarios,
			);
			mergedPass = writeRunReport(runDirectory, runId, mergedScenarios);
			renderRunSummary();

			// The improver is part of the iteration: it runs after the
			// scenario sweep was graded and verified, when the run is not
			// yet passing and there is budget left.
			if (!mergedPass && i < maxIterations && selfImprovement.mode === "loop") {
				if (config.agents.improver !== undefined) {
					await runImprovement({
						projectRoot,
						runId,
						runDirectory,
						iterations,
						scenarios: runScenarios,
						config,
						selfImprovement,
						agent: config.agents.improver,
						iteration: i,
						iterationDirectory: outcome.iterationDirectory,
						iterationReport: outcome.report,
						allScenarios,
						log: outcome.log,
					});
				} else {
					outcome.log.info(
						"improvement: skipped — agents.improver is not configured",
					);
				}
			}

			await fireAfterIteration(config, runCtx, outcome, i);

			if (mergedPass) break;
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
			iterationPasses.push(outcome.report.pass);
			mergedScenarios = mergeIntoRunningReport(
				mergedScenarios,
				outcome.report.scenarios,
			);
			mergedPass = writeRunReport(runDirectory, runId, mergedScenarios);
			renderRunSummary();
			await fireAfterIteration(config, runCtx, outcome, i);
		}

		prepared = prepareSummary({ runDirectory, runId });
	} finally {
		// The afterAll hook is run-scoped, so its log lives at the run root
		// (`${runDirectory}/run.log`) — not inside an iteration folder,
		// where it would clobber that iteration's own run.log.
		const afterAllLog = new RunLog({ mirrorStderr: verbose ?? false });
		await tryHook(
			"afterAll",
			"run",
			config.hooks?.afterAll,
			runCtx,
			afterAllLog,
		);
		afterAllLog.dump(runDirectory);
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
	await tryHook(
		"beforeAllScenarios",
		`iteration:${args.iteration}`,
		args.config.hooks?.beforeAllScenarios,
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

	// afterAllScenarios closes the scenario sweep. It is the one hook
	// whose return value the harness consumes: it can fail scenarios the
	// judges passed (e.g. an e2e failure), and those failures flow into
	// the report so the matrix, exit code, re-selection, and the
	// improver's context all reflect them.
	const verification = await runAfterAllScenarios(
		args.config.hooks?.afterAllScenarios,
		{ ...iterationCtx, pass: report.pass },
		`iteration:${args.iteration}`,
		log,
	);
	const ranScenarioNames = args.selection.map((s) => s.scenario.name);
	if (applyVerification(report, verification, ranScenarioNames, log)) {
		writeFileSync(
			join(iterationDirectory, "report.json"),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	}

	log.dump(iterationDirectory);

	return { report, iterationDirectory, log };
}

/**
 * Fire `afterIteration` at the very end of an iteration — after the
 * improver has run, so the hook sees the post-improve world — then
 * persist the iteration log.
 */
async function fireAfterIteration(
	config: SkillsmithConfig,
	runCtx: RunContext,
	outcome: IterationOutcome,
	iteration: number,
): Promise<void> {
	await tryHook(
		"afterIteration",
		`iteration:${iteration}`,
		config.hooks?.afterIteration,
		{
			...runCtx,
			iteration,
			iterationDirectory: outcome.iterationDirectory,
			pass: outcome.report.pass,
		},
		outcome.log,
	);
	outcome.log.dump(outcome.iterationDirectory);
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
