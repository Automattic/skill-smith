import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from '../providers/registry';
import { classifyVerdict } from '../reports/verdict';
import { run } from '../runner';

const here = dirname( fileURLToPath( import.meta.url ) );
const projectRoot = join( here, 'fixtures', 'judge-skip-project' );

test( 'judge phase is skipped when the testing agent reports an error', async () => {
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	try {
		exitCode = await run( { cwd: projectRoot } );
	} finally {
		console.log = originalLog;
	}

	assert.equal( exitCode, 1, 'any agent failing testing fails the run' );

	const runIds = readdirSync( baseDir ).filter( ( n ) =>
		/^\d{8}-\d{6}$/.test( n )
	);
	const iterationDir = join( baseDir, runIds[ 0 ] ?? '', 'iteration-1' );

	// The failing agent's review is recorded as SKIPPED with the testing
	// error inlined into the reason, so summaries can show why.
	const failReportPath = join(
		iterationDir,
		'hello',
		'mock-fail-testing',
		'report.json'
	);
	assert.ok( existsSync( failReportPath ) );
	const failReport = JSON.parse( readFileSync( failReportPath, 'utf8' ) ) as {
		judging?: unknown;
		review?: { skipped?: string };
	};
	assert.match(
		failReport.review?.skipped ?? '',
		/^testing failed: mock testing failure/
	);

	// The judge phase never started, so no `judging` block is written:
	// there is no duration to report. `review` stays the skipped marker.
	assert.equal(
		failReport.judging,
		undefined,
		'a testing-failed pair carries no judging block'
	);

	// The skipped judge wasn't run, so no `mock-output.txt`-equivalent
	// judge artefact and the workspace is empty save for the harness's
	// own directory creation.
	const failWorkspace = join(
		iterationDir,
		'hello',
		'mock-fail-testing',
		'workspace'
	);
	assert.ok( existsSync( failWorkspace ) );

	// The other agent's full pipeline still runs as normal: its report
	// carries the judge's { pass, notes } review, which classifies as a
	// pass — distinct from the skipped block above.
	const okReportPath = join( iterationDir, 'hello', 'ok', 'report.json' );
	const okReport = JSON.parse( readFileSync( okReportPath, 'utf8' ) ) as {
		judging?: { duration?: unknown; tokenUsage?: { totalTokens?: unknown } };
		review?: { skipped?: unknown };
	};
	assert.ok(
		okReport.review !== undefined && ! ( 'skipped' in okReport.review ),
		'the passing agent gets a real judge verdict, not a skipped block'
	);
	assert.equal(
		classifyVerdict( okReport.review ).kind,
		'PASS',
		"the passing agent's { pass, notes } review classifies as a pass"
	);
	assert.deepEqual(
		okReport.review,
		{ pass: true, notes: 'mock' },
		"the passing agent persists the judge's { pass, notes } review verbatim"
	);

	// The judge phase ran on the normal path, so `judging` is present with a
	// numeric duration and (the mock reports usage) a populated tokenUsage.
	assert.ok(
		okReport.judging !== undefined &&
			typeof okReport.judging.duration === 'number',
		`the passing agent has judging.duration: ${ JSON.stringify( okReport ) }`
	);
	assert.equal(
		okReport.judging?.tokenUsage?.totalTokens,
		150,
		'the passing agent has judging.tokenUsage.totalTokens from the mock provider'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );

test( 'a judge-dispatch throw persists judging with duration and no tokenUsage, and an error review', async () => {
	const baseDir = join( projectRoot, '.skillsmith' );
	rmSync( baseDir, { recursive: true, force: true } );

	// Force the judge invocation to throw so the phase runs (starts the
	// bracket timer) but returns no verdict and no usage report.
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async ( params ) => {
		if ( params.role === 'judge' ) {
			throw new Error( 'judge boom' );
		}
		return original( params );
	};

	const originalLog = console.log;
	console.log = () => {};
	try {
		await run( { cwd: projectRoot } );
	} finally {
		console.log = originalLog;
		PROVIDERS.mock.invoke = original;
	}

	const runIds = readdirSync( baseDir ).filter( ( n ) =>
		/^\d{8}-\d{6}$/.test( n )
	);
	const iterationDir = join( baseDir, runIds[ 0 ] ?? '', 'iteration-1' );

	// The `ok` agent passes testing, so the judge phase starts before the
	// throw — `judging` is present with a numeric duration but no
	// tokenUsage (dispatch threw before any usage report). `review`
	// carries the dispatch-failed marker.
	const okReportPath = join( iterationDir, 'hello', 'ok', 'report.json' );
	const okReport = JSON.parse( readFileSync( okReportPath, 'utf8' ) ) as {
		judging?: { duration?: unknown; tokenUsage?: unknown };
		review?: { skipped?: unknown };
	};
	assert.ok(
		okReport.judging !== undefined &&
			typeof okReport.judging.duration === 'number',
		`a judge-dispatch throw still records judging.duration: ${ JSON.stringify(
			okReport
		) }`
	);
	assert.equal(
		okReport.judging?.tokenUsage,
		undefined,
		'no tokenUsage is recorded when dispatch threw before a usage report'
	);
	assert.match(
		String( okReport.review?.skipped ?? '' ),
		/^judge dispatch failed: judge boom/,
		'the review carries the dispatch-failed marker'
	);

	rmSync( baseDir, { recursive: true, force: true } );
} );
