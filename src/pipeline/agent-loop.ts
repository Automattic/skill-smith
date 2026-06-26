import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	AgentContext,
	AgentDefinition,
	IterationInfo,
	RunScenario,
	Scenario,
	SkillsmithConfig,
} from '../config/types';
import type { ProgressTracker } from '../progress';
import type { TokenUsage } from '../providers/types';
import {
	type Cell,
	classifyVerdict,
	summarizeFailures,
} from '../reports/verdict';
import { tryHook } from '../util/hooks';
import type { SerialMutex } from '../util/mutex';
import type { RunLog } from '../util/run-log';
import { runJudgeAgent } from './judge-agent';
import { runTestingAgent } from './testing-agent';
import {
	copyWorkspaceForJudge,
	diffSnapshots,
	snapshotWorkspace,
} from './workspace-snapshot';

export interface RunAgentsParams {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
	/**
	 * The single run-wide mutex that serializes the judge bracket when
	 * `config.roles.judge.concurrency === 'serial'`. The pipeline
	 * constructs exactly one instance per iteration and threads the same
	 * instance through every scenario's agent loop so the lock spans both
	 * the scenario and agent fan-outs.
	 */
	judgeMutex: SerialMutex;
	/**
	 * When present, only testing agents whose ids appear in this list
	 * run for this scenario. Used by `failed-pairs` mode to re-run only
	 * the agents that failed in the previous iteration.
	 */
	agentIdFilter?: string[];
}

export interface TestingAgentResult {
	finalText: string;
	toolUseCount: number;
	filesWritten: string[];
	error?: string;
	usage?: TokenUsage;
}

/**
 * The `testing` block persisted into the per-agent `report.json`.
 * `duration` is wall-clock milliseconds for the testing-agent
 * invocation; `tokenUsage` is omitted when the provider reported no
 * usage (e.g. the testing agent errored before returning any).
 */
interface TestingBlock {
	duration: number;
	tokenUsage?: TokenUsage;
}

/**
 * Per-scenario agent loop. Mkdirs each `agentWorkspace`, fires the
 * four agent-scoped hooks, and dispatches testing + judge agents in
 * parallel across testing entries.
 */
export async function runAgents( params: RunAgentsParams ): Promise< void > {
	const {
		scenario,
		scenarioDirectory,
		config,
		runId,
		runDirectory,
		iterations,
		projectRoot,
		log,
		tracker,
		scenarios,
		judgeMutex,
		agentIdFilter,
	} = params;

	const filterSet =
		agentIdFilter !== undefined ? new Set( agentIdFilter ) : undefined;
	const agents =
		filterSet === undefined
			? config.roles.test.agents
			: config.roles.test.agents.filter( ( a ) => filterSet.has( a.id ) );

	if ( filterSet !== undefined ) {
		log.info(
			`agent filter active for ${ scenario.name }: ${ agents.map( ( a ) => a.id ).join( ',' ) || '(none)' }`
		);
	}

	await Promise.all(
		agents.map( ( agent ) =>
			runAgentPair( {
				agent,
				scenario,
				scenarioDirectory,
				config,
				runId,
				runDirectory,
				iterations,
				projectRoot,
				log,
				tracker,
				scenarios,
				judgeMutex,
			} )
		)
	);
}

interface RunAgentPairParams {
	agent: AgentDefinition;
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
	/** The shared run-wide judge mutex (see {@link RunAgentsParams.judgeMutex}). */
	judgeMutex: SerialMutex;
}

async function runAgentPair( params: RunAgentPairParams ): Promise< void > {
	const {
		agent,
		scenario,
		scenarioDirectory,
		config,
		runId,
		runDirectory,
		iterations,
		projectRoot,
		log,
		tracker,
		scenarios,
		judgeMutex,
	} = params;
	const agentDirectory = join( scenarioDirectory, agent.id );
	const agentWorkspace = join( agentDirectory, 'workspace' );
	const judgeWorkspace = join( agentDirectory, 'judge-workspace' );

	mkdirSync( agentWorkspace, { recursive: true } );

	const agentCtx: AgentContext = {
		runId,
		config,
		runDirectory,
		iterations,
		scenarios,
		scenario,
		agent,
		agentWorkspace,
		judgeWorkspace,
	};

	const scope = `scenario:${ scenario.name }/agent:${ agent.id }`;

	await tryHook(
		'beforeTestAgent',
		scope,
		config.hooks?.beforeTestAgent,
		agentCtx,
		log
	);

	tracker.phaseStarted( scenario.name, agent.id, 'testing' );
	const testingStart = Date.now();
	let testingResult: TestingAgentResult;
	try {
		testingResult = await runTestingAgent( {
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config,
			log,
		} );
	} catch ( err ) {
		const msg = err instanceof Error ? err.message : String( err );
		log.info( `testing-agent failed (${ scope }): ${ msg }` );
		testingResult = {
			finalText: '',
			toolUseCount: 0,
			filesWritten: [],
			error: msg,
		};
	}
	const testingDuration = Date.now() - testingStart;
	tracker.phaseFinished( scenario.name, agent.id, 'testing', {
		status: testingResult.error === undefined ? 'passed' : 'failed',
		durationMs: testingDuration,
		detail: testingResult.error,
	} );

	const testing: TestingBlock = { duration: testingDuration };
	if ( testingResult.usage !== undefined ) {
		testing.tokenUsage = testingResult.usage;
	}

	await tryHook(
		'afterTestAgent',
		scope,
		config.hooks?.afterTestAgent,
		agentCtx,
		log
	);

	if ( testingResult.error !== undefined ) {
		// Testing didn't produce evaluable output (missing API key, transport
		// error, etc.). Skip the judge entirely: an empty workspace can't pass
		// the rubrics, so running the judge would burn compute and add a
		// redundant `N rubrics failed` row to the dashboard one line below the
		// real cause. The paired before/afterJudgeAgent hooks are skipped
		// symmetrically.
		tracker.phaseFinished( scenario.name, agent.id, 'judge', {
			status: 'skipped',
			detail: 'testing failed',
		} );
		writeAgentReport( agentDirectory, testing, {
			skipped: `testing failed: ${ testingResult.error }`,
		} );
	} else {
		// Serialize the whole beforeJudgeAgent → judge → afterJudgeAgent
		// bracket under the run-wide mutex when configured, so no two pairs
		// grade at once (e.g. a shared, non-reentrant `wp-env start`). In
		// parallel mode no lock is taken — `release` is a no-op. The lock is
		// released in `finally` even when the judge or a hook throws.
		const serial = config.roles.judge.concurrency === 'serial';
		const release = serial ? await judgeMutex.acquire() : noop;
		try {
			// Run the judge against an isolated copy so it can never mutate
			// the canonical artifact, and snapshot the canonical workspace
			// around the phase to detect any mutation that slips through a
			// hook.
			copyWorkspaceForJudge( agentWorkspace, judgeWorkspace );
			const beforeJudge = snapshotWorkspace( agentWorkspace );

			await tryHook(
				'beforeJudgeAgent',
				scope,
				config.hooks?.beforeJudgeAgent,
				agentCtx,
				log
			);

			tracker.phaseStarted( scenario.name, agent.id, 'judge' );
			const judgeStart = Date.now();
			let judgeError: string | undefined;
			let rawReview: unknown;
			try {
				rawReview = await runJudgeAgent( {
					scenario,
					judge: config.roles.judge.agent,
					agentDirectory,
					agentWorkspace,
					judgeWorkspace,
					projectRoot,
					config,
					log,
					testingResult,
				} );
			} catch ( err ) {
				const msg = err instanceof Error ? err.message : String( err );
				log.info( `judge-agent failed (${ scope }): ${ msg }` );
				rawReview = { skipped: `judge dispatch failed: ${ msg }` };
				judgeError = msg;
			}

			// Diff-guard: a non-empty diff means the judge (or a hook)
			// mutated the canonical artifact — a guarantee violation. Log it
			// loudly and force the pair to FAIL rather than silently pass.
			const afterJudge = snapshotWorkspace( agentWorkspace );
			const touched = diffSnapshots( beforeJudge, afterJudge );
			const guardFailure =
				touched.length > 0
					? `judge phase mutated the canonical workspace: ${ touched.join(
							', '
						) }`
					: undefined;
			if ( guardFailure !== undefined ) {
				log.info(
					`WARNING: ${ guardFailure } (${ scope }) — marking pair FAIL`
				);
			}

			const cell = classifyPairVerdict(
				judgeError,
				guardFailure,
				rawReview
			);
			const verdictResult = cellToPhaseResult( cell );
			tracker.phaseFinished( scenario.name, agent.id, 'judge', {
				status: verdictResult.status,
				durationMs: Date.now() - judgeStart,
				detail: verdictResult.detail,
			} );

			// Persist the judge's complete review (every rubric / acceptance
			// item with its pass flag and notes) so a human or the improver
			// can read the full picture. The collapsed `verdict` above is
			// only used to drive the live dashboard. When the diff-guard
			// tripped, the review is overwritten with the violation so the
			// stored verdict and the live verdict agree.
			writeAgentReport(
				agentDirectory,
				testing,
				guardFailure !== undefined
					? { pass: false, error: guardFailure }
					: rawReview
			);

			await tryHook(
				'afterJudgeAgent',
				scope,
				config.hooks?.afterJudgeAgent,
				agentCtx,
				log
			);
		} finally {
			release();
		}
	}
}

/** No-op release used when the judge bracket runs without a lock. */
function noop(): void {}

/**
 * Collapse the judge phase into a single {@link Cell}. A dispatch error or
 * a diff-guard violation forces a FAIL (the guard failure is reported in
 * addition to any judge error); otherwise the judge's parsed verdict is
 * classified as-is.
 *
 * @param judgeError   - The judge dispatch error, if the judge threw.
 * @param guardFailure - The diff-guard message, if the canonical
 *   workspace was mutated during the judge phase.
 * @param rawReview    - The judge's parsed review payload.
 * @returns The collapsed pass/fail/skipped cell for the pair.
 */
function classifyPairVerdict(
	judgeError: string | undefined,
	guardFailure: string | undefined,
	rawReview: unknown
): Cell {
	const failures: string[] = [];
	if ( judgeError !== undefined ) failures.push( judgeError );
	if ( guardFailure !== undefined ) failures.push( guardFailure );
	if ( failures.length > 0 ) return { kind: 'FAIL', failures };
	return classifyVerdict( rawReview );
}

function cellToPhaseResult( cell: Cell ): {
	status: 'passed' | 'failed' | 'skipped';
	detail?: string;
} {
	if ( cell.kind === 'SKIPPED' ) {
		return { status: 'skipped', detail: cell.reason };
	}
	if ( cell.kind === 'PASS' ) return { status: 'passed' };
	return { status: 'failed', detail: summarizeFailures( cell.failures ) };
}

/**
 * Single writer of the per-agent `report.json`. Pairs the `testing`
 * block (always present) with the judge's `review` verbatim — the
 * complete set of rubrics and acceptance items with their pass flags
 * and notes — so reports stay fully informative. Testing/dispatch
 * failures persist a `{ skipped }` marker in place of the review.
 */
function writeAgentReport(
	agentDirectory: string,
	testing: TestingBlock,
	review: unknown
): void {
	mkdirSync( agentDirectory, { recursive: true } );
	writeFileSync(
		join( agentDirectory, 'report.json' ),
		`${ JSON.stringify( { testing, review }, null, 2 ) }\n`
	);
}
