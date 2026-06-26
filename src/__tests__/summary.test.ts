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
import { emitSummary, prepareSummary } from '../reports/summary';

function withReport( scenarios: Record< string, unknown > ): {
	runDirectory: string;
} {
	const runDirectory = mkdtempSync( join( tmpdir(), 'skillsmith-summary-' ) );
	mkdirSync( runDirectory, { recursive: true } );
	writeFileSync(
		join( runDirectory, 'report.json' ),
		JSON.stringify( { runId: '20260101-000000', scenarios }, null, 2 )
	);
	return { runDirectory };
}

function captureStdout< T >( fn: () => T ): { value: T; out: string } {
	const lines: string[] = [];
	const original = console.log;
	console.log = ( ...args: unknown[] ) => {
		lines.push( args.join( ' ' ) );
	};
	try {
		const value = fn();
		return { value, out: lines.join( '\n' ) };
	} finally {
		console.log = original;
	}
}

test( 'all-pass run exits 0 with RUN RESULT: PASS', async () => {
	const { runDirectory } = withReport( {
		'counter-block': {
			scenario: 'counter-block',
			agents: {
				haiku: {
					testing: {
						duration: 1200,
						tokenUsage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 150,
						},
					},
					review: { pass: true, notes: 'looks good' },
				},
				opus: {
					testing: { duration: 900 },
					review: { pass: true, notes: 'looks good' },
				},
			},
		},
	} );

	const { value, out } = captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	assert.equal( value, 0 );
	assert.match( out, /scenario\s+agent\s+result\s+duration\s+tokens/ );
	assert.match( out, /counter-block\s+haiku\s+PASS\s+1\.2s\s+150/ );
	assert.match( out, /\bopus\s+PASS\s+0\.9s/ );
	assert.match( out, /RUN RESULT: PASS/ );
} );

test( 'any failure → exit 1, FAIL, and a line surfacing the judge notes', async () => {
	const { runDirectory } = withReport( {
		'counter-block': {
			scenario: 'counter-block',
			agents: {
				haiku: {
					testing: { duration: 1200 },
					review: { pass: true, notes: 'looks good' },
				},
				opus: {
					testing: { duration: 1100 },
					review: {
						pass: false,
						notes: 'fetch is missing and console.log remains',
					},
				},
			},
		},
	} );

	const { value, out } = captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	assert.equal( value, 1 );
	assert.match( out, /counter-block\s+haiku\s+PASS\s+1\.2s/ );
	assert.match( out, /\bopus\s+FAIL\s+1\.1s/ );
	assert.match( out, /RUN RESULT: FAIL/ );
	assert.match(
		out,
		/opus: fetch is missing and console\.log remains/
	);
	assert.doesNotMatch( out, /not pass/ );
} );

test( 'multiple failing scenarios each get their own block', async () => {
	const { runDirectory } = withReport( {
		'config-fetch': {
			scenario: 'config-fetch',
			agents: {
				'codex-gpt55': {
					testing: { duration: 1000 },
					review: { pass: false, notes: 'config never fetched' },
				},
				'codex-mini': {
					testing: { duration: 1000 },
					review: { pass: false, notes: 'wrong endpoint' },
				},
			},
		},
		other: {
			scenario: 'other',
			agents: {
				'codex-gpt55': {
					testing: { duration: 1000 },
					review: { pass: false, notes: 'broken output' },
				},
				'codex-mini': {
					testing: { duration: 1000 },
					review: { pass: true, notes: 'ok' },
				},
			},
		},
	} );

	const { out } = captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	assert.ok(
		out.includes(
			'config-fetch\n  codex-gpt55: config never fetched\n  codex-mini: wrong endpoint'
		),
		`failure block for config-fetch missing in:\n${ out }`
	);
	assert.ok(
		out.includes( 'other\n  codex-gpt55: broken output' ),
		`failure block for other missing in:\n${ out }`
	);
} );

test( 'SKIPPED cells render with reason', async () => {
	const { runDirectory } = withReport( {
		'counter-block': {
			scenario: 'counter-block',
			agents: {
				haiku: {
					testing: { duration: 800 },
					review: { skipped: 'empty agent config' },
				},
			},
		},
	} );

	const { value, out } = captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	assert.equal( value, 1 );
	assert.match( out, /counter-block\s+haiku\s+SKIPPED\s+0\.8s/ );
	assert.match( out, /haiku: SKIPPED empty agent config/ );
} );

test( 'long format unifies the scenario cell across agent rows', async () => {
	const { runDirectory } = withReport( {
		'counter-block': {
			scenario: 'counter-block',
			agents: {
				haiku: {
					testing: {
						duration: 1200,
						tokenUsage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 1500,
						},
					},
					review: { pass: true, notes: 'looks good' },
				},
				opus: {
					testing: {
						duration: 65000,
						tokenUsage: {
							inputTokens: 800,
							outputTokens: 400,
							totalTokens: 1200,
						},
					},
					review: { pass: true, notes: 'looks good' },
				},
			},
		},
	} );

	const { out } = captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	// The scenario name leads exactly one table row; the second agent
	// row leaves the scenario column blank.
	const scenarioRows = out
		.split( '\n' )
		.filter( ( l ) => l.startsWith( 'counter-block' ) );
	assert.equal( scenarioRows.length, 1 );
	assert.match( out, /\n\s+opus\s+PASS/ );

	// Thousands-separated tokens and m/ss duration formatting.
	assert.match( out, /haiku\s+PASS\s+1\.2s\s+1,500/ );
	assert.match( out, /opus\s+PASS\s+1m05s\s+1,200/ );
} );

test( 'writes summary.txt mirroring the console (without ANSI)', async () => {
	const { runDirectory } = withReport( {
		'counter-block': {
			scenario: 'counter-block',
			agents: {
				haiku: {
					testing: { duration: 800 },
					review: { pass: false, notes: 'output is wrong' },
				},
			},
		},
	} );

	captureStdout( () =>
		emitSummary( prepareSummary( { runDirectory, runId: 'x' } ) )
	);

	const summaryPath = join( runDirectory, 'summary.txt' );
	assert.ok( existsSync( summaryPath ), 'summary.txt should be written' );
	const body = readFileSync( summaryPath, 'utf8' );
	assert.match( body, /counter-block\s+haiku\s+FAIL/ );
	assert.match( body, /RUN RESULT: FAIL/ );
	assert.match( body, /haiku: output is wrong/ );
	assert.equal(
		body.includes( String.fromCharCode( 27 ) ),
		false,
		'summary.txt must not contain ANSI escapes'
	);
} );
