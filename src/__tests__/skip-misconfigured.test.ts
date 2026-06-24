import assert from 'node:assert/strict';
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../runner';

const here = dirname( fileURLToPath( import.meta.url ) );
const fixtures = join( here, 'fixtures' );

interface CapturedRun {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * Run a fixture with OPENAI_API_KEY deleted for the duration (restored
 * afterward) so `openai-api` agents are deterministically misconfigured
 * and no real model is ever called. Captures stdout and stderr.
 */
async function runWithoutOpenAIKey(
	projectRoot: string
): Promise< CapturedRun > {
	const savedKey = process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_API_KEY;

	const originalLog = console.log;
	const originalError = console.error;
	const stdout: string[] = [];
	const stderr: string[] = [];
	console.log = ( ...args: unknown[] ) => {
		stdout.push( args.join( ' ' ) );
	};
	console.error = ( ...args: unknown[] ) => {
		stderr.push( args.join( ' ' ) );
	};

	let exitCode: number;
	try {
		exitCode = await run( { cwd: projectRoot } );
	} finally {
		console.log = originalLog;
		console.error = originalError;
		if ( savedKey === undefined ) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = savedKey;
	}

	return {
		exitCode,
		stdout: stdout.join( '\n' ),
		stderr: stderr.join( '\n' ),
	};
}

function latestRunDir( baseDir: string ): string {
	const runIds = readdirSync( baseDir ).filter( ( n ) =>
		/^\d{8}-\d{6}$/.test( n )
	);
	assert.equal(
		runIds.length,
		1,
		`exactly one runId; got ${ runIds.join( ', ' ) }`
	);
	return join( baseDir, runIds[ 0 ] ?? '' );
}

interface RunReport {
	pass?: boolean;
	scenarios?: Record<
		string,
		{ agents?: Record< string, unknown >; pass?: boolean }
	>;
	skipped?: Array< { id?: string; roles?: string[]; reason?: string } >;
}

function readRunReport( runDir: string ): RunReport {
	return JSON.parse(
		readFileSync( join( runDir, 'report.json' ), 'utf8' )
	) as RunReport;
}

test( 'one misconfigured test agent is skipped while the runnable agent is graded', async () => {
	const projectRoot = join( fixtures, 'skip-test-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode } = await runWithoutOpenAIKey( projectRoot );
	assert.equal( exitCode, 2, 'a skipped agent forces exit 2' );

	const runDir = latestRunDir( baseDir );
	const report = readRunReport( runDir );

	// The runnable agent has a graded cell; the skipped agent has none.
	const scenario = report.scenarios?.[ 'hello-scenario' ];
	assert.ok(
		scenario !== undefined,
		'scenario present in the merged report'
	);
	assert.ok(
		scenario.agents?.[ 'mock-ok' ] !== undefined,
		'runnable mock-ok agent is graded'
	);
	assert.ok(
		scenario.agents !== undefined && ! ( 'gpt' in scenario.agents ),
		'skipped gpt agent has no cell in the scenario report'
	);
	assert.equal(
		scenario.pass,
		true,
		'the scenario passes on the runnable agent alone, matching a mock-ok-only run'
	);

	// No workspace directory was ever created for the skipped agent.
	const gptWorkspace = join( runDir, 'iteration-1', 'hello-scenario', 'gpt' );
	assert.ok(
		! existsSync( gptWorkspace ),
		'no workspace directory was created for the skipped gpt agent'
	);

	// The skip is recorded at the report's top level with its reason.
	const skippedGpt = report.skipped?.find( ( s ) => s.id === 'gpt' );
	assert.ok(
		skippedGpt !== undefined,
		'gpt is recorded in top-level skipped'
	);
	assert.equal( skippedGpt.reason, 'OPENAI_API_KEY is not set' );
	assert.ok(
		skippedGpt.roles?.includes( 'test' ),
		"gpt's skip records the test role"
	);

	// The provisioning hook never fired for the skipped agent.
	const firedLog = readFileSync(
		join( runDir, 'test-agent-fired.log' ),
		'utf8'
	);
	const fired = firedLog.split( '\n' ).filter( ( l ) => l.length > 0 );
	assert.deepEqual(
		fired,
		[ 'mock-ok' ],
		'beforeTestAgent fired only for mock-ok'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'all test agents misconfigured leaves an empty, non-passing matrix and exits 2', async () => {
	const projectRoot = join( fixtures, 'skip-test-all-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode, stdout } = await runWithoutOpenAIKey( projectRoot );
	assert.equal(
		exitCode,
		2,
		'a skipped agent forces exit 2 even with no runnable testers'
	);

	const runDir = latestRunDir( baseDir );
	const report = readRunReport( runDir );

	const skippedGpt = report.skipped?.find( ( s ) => s.id === 'gpt' );
	assert.ok( skippedGpt !== undefined, 'gpt surfaced in top-level skipped' );

	// The lone scenario produced no graded cells.
	const scenario = report.scenarios?.[ 'hello-scenario' ];
	assert.ok(
		scenario === undefined ||
			scenario.agents === undefined ||
			Object.keys( scenario.agents ).length === 0,
		'no agent cells were graded'
	);
	assert.notEqual( report.pass, true, 'the run is not all-pass' );
	assert.doesNotMatch( stdout, /RUN RESULT: PASS/ );

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a misconfigured judge stops the run before any hook or report', async () => {
	const projectRoot = join( fixtures, 'skip-judge-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode, stderr } = await runWithoutOpenAIKey( projectRoot );
	assert.equal(
		exitCode,
		2,
		'a misconfigured judge stops the run with exit 2'
	);

	// A single clear message names the judge id and the reason.
	assert.match( stderr, /gpt/, 'the stop message names the judge id' );
	assert.match(
		stderr,
		/OPENAI_API_KEY is not set/,
		'the stop message states the reason'
	);

	const runDir = latestRunDir( baseDir );
	assert.ok(
		! existsSync( join( runDir, 'report.json' ) ),
		'no run report is written when the judge stops the run'
	);
	assert.ok(
		! existsSync( join( runDir, 'iteration-1' ) ),
		'no graded iteration sweep ran'
	);
	assert.ok(
		! existsSync( join( runDir, 'before-all-fired.marker' ) ),
		'beforeAll did not fire'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'an id that is both judge and test agent stops the run (most severe wins)', async () => {
	const projectRoot = join( fixtures, 'skip-multirole-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode, stderr } = await runWithoutOpenAIKey( projectRoot );
	assert.equal(
		exitCode,
		2,
		'the multi-role misconfigured id stops the run'
	);

	assert.match( stderr, /gpt/, 'the stop message names the offending id' );
	assert.match( stderr, /OPENAI_API_KEY is not set/ );

	const runDir = latestRunDir( baseDir );
	assert.ok(
		! existsSync( join( runDir, 'report.json' ) ),
		'no run report is written'
	);
	assert.ok(
		! existsSync( join( runDir, 'before-all-fired.marker' ) ),
		'beforeAll did not fire'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a misconfigured improver finishes the iteration, then halts', async () => {
	const projectRoot = join( fixtures, 'skip-improver-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	const skillPath = join( projectRoot, 'skills', 'wp-foo', 'SKILL.md' );
	const pristineSkill = readFileSync( skillPath, 'utf8' );
	rmSync( baseDir, { recursive: true, force: true } );

	let result: CapturedRun;
	try {
		result = await runWithoutOpenAIKey( projectRoot );
	} finally {
		// The improver is misconfigured, so it should not edit the skill;
		// restore defensively regardless.
		writeFileSync( skillPath, pristineSkill );
	}
	assert.equal(
		result.exitCode,
		2,
		'the misconfigured improver forces exit 2'
	);

	const runDir = latestRunDir( baseDir );
	const iter1 = join( runDir, 'iteration-1' );

	// Iteration 1 completed and produced a real graded matrix.
	assert.ok(
		existsSync( join( iter1, 'report.json' ) ),
		'iteration 1 produced a graded report'
	);
	const iter1Report = JSON.parse(
		readFileSync( join( iter1, 'report.json' ), 'utf8' )
	) as {
		scenarios?: Record< string, { agents?: Record< string, unknown > } >;
	};
	assert.ok(
		iter1Report.scenarios?.[ 'wp-marker' ]?.agents?.tester !== undefined,
		"iteration 1's matrix graded the runnable tester"
	);

	// The loop halted after iteration 1: no improver edit, no iteration 2.
	assert.ok(
		! existsSync( join( iter1, 'improvement.md' ) ),
		'no improver transcript — the improver never ran'
	);
	assert.ok(
		! existsSync( join( runDir, 'iteration-2' ) ),
		'no second iteration was attempted'
	);

	const report = readRunReport( runDir );
	const skippedImprover = report.skipped?.find( ( s ) => s.id === 'gpt' );
	assert.ok(
		skippedImprover !== undefined,
		'the improver id surfaced in top-level skipped'
	);
	assert.ok(
		skippedImprover.roles?.includes( 'improver' ),
		'the skip records the improver role'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'exit-code precedence: a genuine failure plus a skip both surface and exit 2', async () => {
	const projectRoot = join( fixtures, 'skip-precedence-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode } = await runWithoutOpenAIKey( projectRoot );
	assert.equal(
		exitCode,
		2,
		'the skip outranks the genuine failure for the exit code'
	);

	const runDir = latestRunDir( baseDir );
	const report = readRunReport( runDir );

	// The surviving agent's failure is recorded in scenarios.
	const scenario = report.scenarios?.[ 'gated-scenario' ];
	assert.ok( scenario !== undefined, 'the gated scenario is in the report' );
	assert.equal( scenario.pass, false, 'the runnable agent genuinely failed' );
	assert.ok(
		scenario.agents?.[ 'mock-ok' ] !== undefined,
		'the failing runnable agent has a cell'
	);
	assert.ok(
		scenario.agents !== undefined && ! ( 'gpt' in scenario.agents ),
		'the skipped agent has no cell'
	);

	// The skip is recorded at the top level.
	const skippedGpt = report.skipped?.find( ( s ) => s.id === 'gpt' );
	assert.ok( skippedGpt !== undefined, 'gpt surfaced in top-level skipped' );

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a misconfigured test agent is announced early on stderr (non-TTY)', async () => {
	// AC1 + AC4: the harness resolves non-interactive (non-TTY), so the
	// early skip is announced via console.error at detection — captured on
	// stderr here — rather than only riding a live dashboard.
	const projectRoot = join( fixtures, 'skip-test-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode, stderr, stdout } =
		await runWithoutOpenAIKey( projectRoot );
	assert.equal( exitCode, 2, 'a skipped test agent still forces exit 2' );

	// The early announcement names the misconfigured id and the reason.
	assert.match(
		stderr,
		/gpt/,
		'the early skip line names the test agent id'
	);
	assert.match(
		stderr,
		/OPENAI_API_KEY is not set/,
		'the early skip line states the reason'
	);
	assert.match(
		stderr,
		/skipping misconfigured agent/,
		'the early console.error fired because the run resolved non-interactive'
	);

	// It is emitted at detection, before the end-of-run summary on stdout.
	assert.match(
		stdout,
		/RUN RESULT/,
		'the run still prints its end summary'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a misconfigured improver is announced early on stderr (non-TTY)', async () => {
	// AC2 + AC4: improver-role skips (HALT_AFTER_ITERATION) are announced
	// early too, on the same non-interactive console.error path.
	const projectRoot = join( fixtures, 'skip-improver-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	const skillPath = join( projectRoot, 'skills', 'wp-foo', 'SKILL.md' );
	const pristineSkill = readFileSync( skillPath, 'utf8' );
	rmSync( baseDir, { recursive: true, force: true } );

	let result: CapturedRun;
	try {
		result = await runWithoutOpenAIKey( projectRoot );
	} finally {
		writeFileSync( skillPath, pristineSkill );
	}
	assert.equal(
		result.exitCode,
		2,
		'the misconfigured improver forces exit 2'
	);

	assert.match(
		result.stderr,
		/gpt/,
		'the early skip line names the improver id'
	);
	assert.match(
		result.stderr,
		/OPENAI_API_KEY is not set/,
		'the early skip line states the reason'
	);
	assert.match(
		result.stderr,
		/skipping misconfigured agent/,
		'the improver skip is announced early on the non-interactive path'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a skip-free mock run emits no early skip announcement (no false signal)', async () => {
	// AC7 at the pipeline layer: a fully-runnable mock-only run (no
	// requiredEnv, nothing misconfigured) must not emit the early skip line.
	// runWithoutOpenAIKey deletes the key, but smoke-project uses only the
	// mock provider, so no agent is misconfigured.
	const projectRoot = join( fixtures, 'smoke-project' );
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const { exitCode, stderr } = await runWithoutOpenAIKey( projectRoot );
	assert.equal( exitCode, 0, 'the all-mock run passes' );
	assert.doesNotMatch(
		stderr,
		/skipping misconfigured agent/,
		'no early skip line when nothing is skipped'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );
