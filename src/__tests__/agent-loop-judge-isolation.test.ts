import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type {
	AgentContext,
	AgentDefinition,
	Hooks,
	Scenario,
	SkillsmithConfig,
} from '../config/types';
import { runAgents } from '../pipeline/agent-loop';
import { ProgressTracker } from '../progress';
import { classifyVerdict } from '../reports/verdict';
import { SerialMutex } from '../util/mutex';
import { RunLog } from '../util/run-log';

/**
 * Stand up a self-contained project on disk: a skills root with one
 * loadable skill and a base iteration directory the agent loop writes its
 * `<agent>/workspace` trees under.
 */
function makeProject(): { projectRoot: string; scenarioDirectory: string } {
	const projectRoot = mkdtempSync( join( tmpdir(), 'agent-loop-iso-' ) );
	const skillDir = join( projectRoot, 'skills', 'demo-skill' );
	mkdirSync( skillDir, { recursive: true } );
	writeFileSync( join( skillDir, 'SKILL.md' ), '# Demo skill\n' );
	const scenarioDirectory = join( projectRoot, 'iteration-1', 'demo' );
	mkdirSync( scenarioDirectory, { recursive: true } );
	return { projectRoot, scenarioDirectory };
}

/**
 * A scenario that satisfies both the testing-agent and judge-agent
 * runtime reads: a testing brief, a judge brief, and one resolvable skill.
 */
function makeScenario( name: string ): Scenario {
	return {
		name,
		skills: [ 'demo-skill' ],
		testingBrief: 'do the task',
		judgeBrief: 'grade the task',
	};
}

function makeAgent( id: string ): AgentDefinition {
	return { id, provider: 'mock', model: 'mock-model' };
}

/** Paths pointing at the on-disk project, resolved against `projectRoot`. */
const PATHS = {
	base: '.skillsmith',
	skills: 'skills',
	scenarios: 'scenarios',
};

/**
 * Build a config whose test role lists `agentIds` and whose judge
 * concurrency is `concurrency`. The relative `paths.skills` is resolved
 * against the per-call `projectRoot` passed to `runAgents`.
 */
function makeConfig(
	agentIds: string[],
	concurrency: 'serial' | 'parallel',
	hooks?: Hooks
): SkillsmithConfig {
	const testAgents = agentIds.map( ( id ) => makeAgent( id ) );
	const judge = makeAgent( 'grader' );
	const agents: Record< string, AgentDefinition > = { grader: judge };
	for ( const a of testAgents ) agents[ a.id ] = a;
	return {
		mode: 'test-only',
		agents,
		roles: {
			test: { agents: testAgents },
			judge: { agent: judge, concurrency },
			improver: { agent: judge },
		},
		paths: PATHS,
		...( hooks !== undefined ? { hooks } : {} ),
	};
}

/**
 * A discard stream that swallows everything written to it, so the tracker
 * paints into the void rather than the test's stdout.
 */
const sink = {
	write: () => true,
} as unknown as NodeJS.WritableStream;

function makeTracker(
	scenarioNames: string[],
	agentIds: string[]
): ProgressTracker {
	return new ProgressTracker(
		{
			runId: 'test-run',
			scenarios: scenarioNames.map( ( name ) => ( { name, agentIds } ) ),
		},
		{ interactive: false, stream: sink }
	);
}

function readReview( agentDirectory: string ): unknown {
	const report = JSON.parse(
		readFileSync( join( agentDirectory, 'report.json' ), 'utf8' )
	) as { review?: unknown };
	return report.review;
}

test( 'judge runs against a sibling judge-workspace copy, leaving the canonical workspace clean and the verdict the judge returned', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );
	const config = makeConfig( [ 'a' ], 'parallel' );
	const log = new RunLog();
	const tracker = makeTracker( [ 'demo' ], [ 'a' ] );

	await runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log,
		tracker,
		scenarios: [],
		judgeMutex: new SerialMutex(),
	} );

	const agentDirectory = join( scenarioDirectory, 'a' );
	const judgeWorkspace = join( agentDirectory, 'judge-workspace' );
	const canonicalWorkspace = join( agentDirectory, 'workspace' );

	// The canonical workspace was copied to a sibling judge-workspace.
	assert.ok(
		existsSync( judgeWorkspace ),
		'judge-workspace is created as a sibling of workspace'
	);
	assert.deepEqual(
		readdirSync( judgeWorkspace ).sort(),
		readdirSync( canonicalWorkspace ).sort(),
		'the judge-workspace mirrors the canonical workspace contents'
	);

	// The judge did not touch the canonical workspace, so the verdict is
	// exactly what the judge returned (a pass) — the diff-guard did not
	// fold in a failure.
	assert.equal(
		classifyVerdict( readReview( agentDirectory ) ).kind,
		'PASS',
		'an untouched canonical workspace yields the judge verdict verbatim'
	);
} );

test( 'a mutation of the canonical workspace during the judge phase trips the diff-guard and fails the pair', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );

	// A hook that writes into the canonical workspace mid-bracket — a
	// guarantee violation the diff-guard must catch.
	const hooks: Hooks = {
		beforeJudgeAgent: ( ctx: AgentContext ) => {
			writeFileSync(
				join( ctx.agentWorkspace, 'sneaky.txt' ),
				'mutated during judge phase'
			);
		},
	};
	const config = makeConfig( [ 'a' ], 'parallel', hooks );
	const log = new RunLog();
	const tracker = makeTracker( [ 'demo' ], [ 'a' ] );

	await runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log,
		tracker,
		scenarios: [],
		judgeMutex: new SerialMutex(),
	} );

	const agentDirectory = join( scenarioDirectory, 'a' );
	assert.equal(
		classifyVerdict( readReview( agentDirectory ) ).kind,
		'FAIL',
		'a mutated canonical workspace forces the pair to FAIL despite a passing judge'
	);
} );

test( 'beforeJudgeAgent / afterJudgeAgent see the judge-copy workspace path', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );

	let beforeJudgeWorkspace: string | undefined;
	let afterJudgeWorkspace: string | undefined;
	let beforeAgentWorkspace: string | undefined;
	const hooks: Hooks = {
		beforeJudgeAgent: ( ctx: AgentContext ) => {
			beforeJudgeWorkspace = ctx.judgeWorkspace;
			beforeAgentWorkspace = ctx.agentWorkspace;
		},
		afterJudgeAgent: ( ctx: AgentContext ) => {
			afterJudgeWorkspace = ctx.judgeWorkspace;
		},
	};
	const config = makeConfig( [ 'a' ], 'parallel', hooks );

	await runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log: new RunLog(),
		tracker: makeTracker( [ 'demo' ], [ 'a' ] ),
		scenarios: [],
		judgeMutex: new SerialMutex(),
	} );

	const agentDirectory = join( scenarioDirectory, 'a' );
	const expectedJudge = join( agentDirectory, 'judge-workspace' );
	const expectedCanonical = join( agentDirectory, 'workspace' );
	assert.equal(
		beforeJudgeWorkspace,
		expectedJudge,
		'beforeJudgeAgent receives the judge-copy path'
	);
	assert.equal(
		afterJudgeWorkspace,
		expectedJudge,
		'afterJudgeAgent receives the judge-copy path'
	);
	assert.equal(
		beforeAgentWorkspace,
		expectedCanonical,
		'agentWorkspace stays the canonical path'
	);
} );

/**
 * Drive `runAgents` for several agents under one scenario with hooks that
 * record the entry/exit of each judge bracket. The hooks yield twice so
 * any overlap would interleave; a serial mutex must prevent that.
 */
async function recordBracketOverlap(
	concurrency: 'serial' | 'parallel',
	mutex: SerialMutex
): Promise< { events: string[]; sawOverlap: boolean } > {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );
	const agentIds = [ 'a', 'b', 'c' ];

	const events: string[] = [];
	let active = 0;
	let sawOverlap = false;
	const yieldTwice = async (): Promise< void > => {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	};
	const hooks: Hooks = {
		beforeJudgeAgent: async ( ctx: AgentContext ) => {
			active += 1;
			if ( active > 1 ) sawOverlap = true;
			events.push( `enter:${ ctx.agent.id }` );
			await yieldTwice();
		},
		afterJudgeAgent: async ( ctx: AgentContext ) => {
			await yieldTwice();
			events.push( `exit:${ ctx.agent.id }` );
			active -= 1;
		},
	};
	const config = makeConfig( agentIds, concurrency, hooks );

	await runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log: new RunLog(),
		tracker: makeTracker( [ 'demo' ], agentIds ),
		scenarios: [],
		judgeMutex: mutex,
	} );

	return { events, sawOverlap };
}

test( 'with concurrency "serial" no two judge brackets overlap', async () => {
	const { events, sawOverlap } = await recordBracketOverlap(
		'serial',
		new SerialMutex()
	);
	assert.equal(
		sawOverlap,
		false,
		'the serial mutex prevents two brackets from running at once'
	);
	// Every enter is immediately followed by its own exit.
	for ( let i = 0; i < events.length; i += 2 ) {
		const enter = events[ i ] ?? '';
		const id = enter.slice( 'enter:'.length );
		assert.equal(
			enter,
			`enter:${ id }`,
			'each bracket opens with its own enter'
		);
		assert.equal(
			events[ i + 1 ],
			`exit:${ id }`,
			'each bracket closes before the next opens'
		);
	}
} );

test( 'with concurrency "parallel" judge brackets overlap (no lock is taken)', async () => {
	const { sawOverlap } = await recordBracketOverlap(
		'parallel',
		new SerialMutex()
	);
	assert.equal(
		sawOverlap,
		true,
		'parallel mode takes no lock, so brackets run concurrently'
	);
} );

test( 'the same mutex instance serializes brackets across separate runAgents (scenario) calls', async () => {
	// One shared mutex spanning two scenarios' agent loops, started
	// concurrently — the cross-scenario case the run-wide lock must cover.
	const mutex = new SerialMutex();
	const a = makeProjectScenario( 's1' );
	const b = makeProjectScenario( 's2' );

	let active = 0;
	let sawOverlap = false;
	const yieldTwice = async (): Promise< void > => {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	};
	const hooks: Hooks = {
		beforeJudgeAgent: async () => {
			active += 1;
			if ( active > 1 ) sawOverlap = true;
			await yieldTwice();
		},
		afterJudgeAgent: async () => {
			await yieldTwice();
			active -= 1;
		},
	};

	await Promise.all( [
		runAgents( {
			scenario: a.scenario,
			scenarioDirectory: a.scenarioDirectory,
			config: makeConfig( [ 'a' ], 'serial', hooks ),
			runId: 'r',
			runDirectory: a.projectRoot,
			iterations: [],
			projectRoot: a.projectRoot,
			log: new RunLog(),
			tracker: makeTracker( [ 's1' ], [ 'a' ] ),
			scenarios: [],
			judgeMutex: mutex,
		} ),
		runAgents( {
			scenario: b.scenario,
			scenarioDirectory: b.scenarioDirectory,
			config: makeConfig( [ 'a' ], 'serial', hooks ),
			runId: 'r',
			runDirectory: b.projectRoot,
			iterations: [],
			projectRoot: b.projectRoot,
			log: new RunLog(),
			tracker: makeTracker( [ 's2' ], [ 'a' ] ),
			scenarios: [],
			judgeMutex: mutex,
		} ),
	] );

	assert.equal(
		sawOverlap,
		false,
		'the single shared mutex serializes brackets across scenario boundaries'
	);
} );

test( 'the lock is released even when the judge phase throws, so later brackets proceed', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );
	const agentIds = [ 'a', 'b' ];
	const mutex = new SerialMutex();

	const entered: string[] = [];
	const hooks: Hooks = {
		beforeJudgeAgent: ( ctx: AgentContext ) => {
			entered.push( ctx.agent.id );
			// The first pair's hook throws inside the locked bracket.
			if ( ctx.agent.id === 'a' ) throw new Error( 'hook boom' );
		},
	};
	const config = makeConfig( agentIds, 'serial', hooks );

	await runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log: new RunLog(),
		tracker: makeTracker( [ 'demo' ], agentIds ),
		scenarios: [],
		judgeMutex: mutex,
	} );

	assert.ok(
		entered.includes( 'b' ),
		'the second pair acquired the lock after the first released it on throw'
	);
	// And the lock is free afterwards: a fresh acquire resolves promptly.
	const release = await mutex.acquire();
	release();
} );

test( 'the testing phase is not gated by the judge mutex even in serial mode', async () => {
	// Acquire and hold the judge mutex for the whole run. If testing were
	// gated by it, runAgents would deadlock; instead testing completes and
	// only the judge bracket would wait. We release before the judge needs
	// it so the run finishes, then assert testing wrote its output.
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );
	const mutex = new SerialMutex();
	const config = makeConfig( [ 'a' ], 'serial' );

	const release = await mutex.acquire();
	const run = runAgents( {
		scenario,
		scenarioDirectory,
		config,
		runId: 'r',
		runDirectory: projectRoot,
		iterations: [],
		projectRoot,
		log: new RunLog(),
		tracker: makeTracker( [ 'demo' ], [ 'a' ] ),
		scenarios: [],
		judgeMutex: mutex,
	} );

	// Give testing time to complete while the judge bracket is blocked on
	// the held lock, then release so the judge can proceed.
	await new Promise( ( r ) => setTimeout( r, 50 ) );
	const canonicalWorkspace = join( scenarioDirectory, 'a', 'workspace' );
	assert.ok(
		existsSync( join( canonicalWorkspace, 'mock-output.txt' ) ),
		'testing ran and wrote its output while the judge mutex was held'
	);
	release();
	await run;
} );

/**
 * Build a fresh project plus a scenario object for a named scenario,
 * each rooted in its own temp directory.
 */
function makeProjectScenario( name: string ): {
	projectRoot: string;
	scenarioDirectory: string;
	scenario: Scenario;
} {
	const { projectRoot } = makeProject();
	const scenarioDirectory = join( projectRoot, 'iteration-1', name );
	mkdirSync( scenarioDirectory, { recursive: true } );
	return { projectRoot, scenarioDirectory, scenario: makeScenario( name ) };
}
