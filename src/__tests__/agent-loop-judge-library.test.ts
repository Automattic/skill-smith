import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
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
import { PROVIDERS } from '../providers/registry';
import type { InvokeParams, InvokeResult } from '../providers/types';
import { classifyVerdict } from '../reports/verdict';
import { SerialMutex } from '../util/mutex';
import { RunLog } from '../util/run-log';

const MANUAL_SENTINEL =
	'LIBRARY_MANUAL_SENTINEL: verify against the live site.';
const RUBRIC_SENTINEL = 'LIBRARY_RUBRIC_SENTINEL: the block registers.';

/**
 * Stand up a self-contained project on disk: a skills root with one
 * loadable skill, a judge library at `eval/judge` seeded with a README
 * manual and one rubric, and a scenario directory the agent loop writes
 * its `<agent>/workspace` trees under.
 */
function makeProject(): { projectRoot: string; scenarioDirectory: string } {
	const projectRoot = mkdtempSync( join( tmpdir(), 'agent-loop-lib-' ) );
	const skillDir = join( projectRoot, 'skills', 'demo-skill' );
	mkdirSync( skillDir, { recursive: true } );
	writeFileSync( join( skillDir, 'SKILL.md' ), '# Demo skill\n' );
	const library = join( projectRoot, 'eval', 'judge' );
	mkdirSync( join( library, 'rubrics' ), { recursive: true } );
	writeFileSync( join( library, 'README.md' ), `${ MANUAL_SENTINEL }\n` );
	writeFileSync(
		join( library, 'rubrics', 'sample.md' ),
		`${ RUBRIC_SENTINEL }\n`
	);
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

/**
 * Build a config whose test role lists `agentIds` and whose judge role
 * points at the fixture library at `./eval/judge`.
 */
function makeConfig( agentIds: string[], hooks?: Hooks ): SkillsmithConfig {
	const testAgents = agentIds.map( ( id ) => makeAgent( id ) );
	const judge = makeAgent( 'grader' );
	const agents: Record< string, AgentDefinition > = { grader: judge };
	for ( const a of testAgents ) agents[ a.id ] = a;
	return {
		mode: 'test-only',
		agents,
		roles: {
			test: { agents: testAgents },
			judge: {
				agent: judge,
				library: './eval/judge',
				concurrency: 'parallel',
			},
			improver: { agent: judge },
		},
		paths: { base: '.skillsmith', skills: 'skills', scenarios: 'scenarios' },
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

/**
 * Swap the mock provider's `invoke` for a recorder that captures every
 * invocation's {@link InvokeParams} while delegating to the real mock
 * behavior, runs `fn`, then restores the original.
 */
async function captureAllInvocations(
	fn: () => Promise< void >
): Promise< InvokeParams[] > {
	const original = PROVIDERS.mock.invoke;
	const captured: InvokeParams[] = [];
	PROVIDERS.mock.invoke = async (
		params: InvokeParams
	): Promise< InvokeResult > => {
		captured.push( params );
		return original( params );
	};
	try {
		await fn();
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	return captured;
}

function readReview( agentDirectory: string ): unknown {
	const report = JSON.parse(
		readFileSync( join( agentDirectory, 'report.json' ), 'utf8' )
	) as { review?: unknown };
	return report.review;
}

test( 'the library is on disk before beforeJudgeAgent and its material reaches only the judge prompt', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );

	let libraryOnDiskBeforeHook: boolean | undefined;
	const hooks: Hooks = {
		beforeJudgeAgent: ( ctx: AgentContext ) => {
			libraryOnDiskBeforeHook =
				existsSync(
					join( ctx.judgeWorkspace, 'judge-library', 'README.md' )
				) &&
				existsSync(
					join(
						ctx.judgeWorkspace,
						'judge-library',
						'rubrics',
						'sample.md'
					)
				);
		},
	};
	const config = makeConfig( [ 'a' ], hooks );

	const invocations = await captureAllInvocations( () =>
		runAgents( {
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
		} )
	);

	assert.equal(
		libraryOnDiskBeforeHook,
		true,
		'judge-library/ is fully mirrored inside the judge workspace before beforeJudgeAgent fires'
	);

	const testing = invocations.find( ( p ) => p.role === 'testing' );
	const judging = invocations.find( ( p ) => p.role === 'judge' );
	assert.ok( testing, 'the testing agent was invoked' );
	assert.ok( judging, 'the judge agent was invoked' );

	// The judge prompt carries the library section: heading, manual, and
	// the manifest path of the copied rubric.
	assert.ok(
		judging.systemPrompt.includes( '# Judge library' ),
		'the judge system prompt carries the Judge library section'
	);
	assert.ok(
		judging.systemPrompt.includes( MANUAL_SENTINEL ),
		'the README manual is inlined into the judge system prompt'
	);
	assert.ok(
		judging.systemPrompt.includes( 'judge-library/rubrics/sample.md' ),
		'the manifest names the copied rubric by its judge-library/<rel> path'
	);

	// The grading-leak invariant: the testing invocation carries none of
	// the library material in either channel.
	for ( const text of [ testing.systemPrompt, testing.prompt ] ) {
		assert.ok(
			! text.includes( MANUAL_SENTINEL ),
			'the library manual never reaches the testing agent'
		);
		assert.ok(
			! text.includes( RUBRIC_SENTINEL ),
			'the library rubric never reaches the testing agent'
		);
		assert.ok(
			! text.includes( 'judge-library' ),
			'no judge-library path reaches the testing agent'
		);
	}
} );

test( 'a pre-seeded judge-library entry fails the pair with the collision error in report.json while the run continues', async () => {
	const { projectRoot, scenarioDirectory } = makeProject();
	const scenario = makeScenario( 'demo' );

	// Seed a colliding top-level `judge-library` entry into agent a's
	// canonical workspace after testing ran; the judge copy then carries
	// it into the judge workspace, where the collision guard must trip.
	const hooks: Hooks = {
		afterTestAgent: ( ctx: AgentContext ) => {
			if ( ctx.agent.id === 'a' ) {
				writeFileSync(
					join( ctx.agentWorkspace, 'judge-library' ),
					'artifact file squatting on the reserved name'
				);
			}
		},
	};
	const config = makeConfig( [ 'a', 'b' ], hooks );

	const invocations = await captureAllInvocations( () =>
		runAgents( {
			scenario,
			scenarioDirectory,
			config,
			runId: 'r',
			runDirectory: projectRoot,
			iterations: [],
			projectRoot,
			log: new RunLog(),
			tracker: makeTracker( [ 'demo' ], [ 'a', 'b' ] ),
			scenarios: [],
			judgeMutex: new SerialMutex(),
		} )
	);

	// Pair a: the collision error is recorded as its review and the pair
	// fails; the judge itself never ran for it.
	const reviewA = readReview( join( scenarioDirectory, 'a' ) ) as {
		pass?: boolean;
		error?: string;
	};
	assert.equal( reviewA.pass, false, 'the colliding pair fails' );
	assert.match(
		reviewA.error ?? '',
		/judge-library/,
		'the recorded error names the judge-library collision'
	);
	assert.equal(
		classifyVerdict( reviewA ).kind,
		'FAIL',
		'the recorded review classifies as a failure'
	);
	const judgeCwds = invocations
		.filter( ( p ) => p.role === 'judge' )
		.map( ( p ) => p.cwd );
	assert.ok(
		! judgeCwds.includes( join( scenarioDirectory, 'a', 'judge-workspace' ) ),
		'no judge invocation ran for the colliding pair'
	);

	// Pair b: unaffected — the run continued and its judge verdict landed.
	assert.deepEqual(
		readReview( join( scenarioDirectory, 'b' ) ),
		{ pass: true, notes: 'mock' },
		'the other pair completes normally with its judge verdict'
	);
} );
