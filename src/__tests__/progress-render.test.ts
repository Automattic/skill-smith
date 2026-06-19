import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSnapshot } from '../progress/render';
import type { Failure, RunSnapshot } from '../progress/types';

function snap( overrides: Partial< RunSnapshot > = {} ): RunSnapshot {
	return {
		runId: '20260506-170805',
		startedAt: 0,
		now: 0,
		counters: {
			scenarios: {
				total: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				running: 0,
				pending: 0,
			},
			phases: {
				total: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				running: 0,
				pending: 0,
			},
		},
		failures: [],
		finished: false,
		...overrides,
	};
}

test( 'renders header, two bars, and elapsed when running (no ETA)', () => {
	const out = renderSnapshot(
		snap( {
			startedAt: 0,
			now: 4 * 60_000 + 12_000,
			counters: {
				scenarios: {
					total: 45,
					passed: 10,
					failed: 2,
					skipped: 0,
					running: 1,
					pending: 32,
				},
				phases: {
					total: 135,
					passed: 25,
					failed: 6,
					skipped: 0,
					running: 2,
					pending: 102,
				},
			},
		} ),
		{ barWidth: 30 }
	);

	const lines = out.split( '\n' );
	assert.equal( lines[ 0 ], 'skillsmith run 20260506-170805' );
	assert.match( lines[ 1 ] ?? '', /^scenarios {2}/ );
	assert.match( lines[ 1 ] ?? '', /12\/45/ );
	assert.match( lines[ 1 ] ?? '', /pass 10 · fail 2 · run 1/ );
	assert.match( lines[ 2 ] ?? '', /^phases {5}/ );
	assert.match( lines[ 2 ] ?? '', /31\/135/ );
	assert.equal( lines[ 3 ], 'elapsed 04:12' );
	assert.doesNotMatch( out, /ETA/ );
} );

test( 'renders an iteration line below the header in loop mode', () => {
	const out = renderSnapshot(
		snap( { iteration: { current: 2, total: 3 } } )
	);
	const lines = out.split( '\n' );
	assert.equal( lines[ 0 ], 'skillsmith run 20260506-170805' );
	assert.equal( lines[ 1 ], 'iteration 2/3' );
	assert.match( lines[ 2 ] ?? '', /^scenarios {2}/ );
} );

test( 'omits the iteration line for single-iteration runs', () => {
	const out = renderSnapshot(
		snap( { iteration: { current: 1, total: 1 } } )
	);
	assert.doesNotMatch( out, /iteration/ );
	assert.match( out.split( '\n' )[ 1 ] ?? '', /^scenarios {2}/ );
} );

test( 'bar fill scales with done/total', () => {
	const half = renderSnapshot(
		snap( {
			counters: {
				scenarios: {
					total: 10,
					passed: 5,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 5,
				},
				phases: {
					total: 20,
					passed: 10,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 10,
				},
			},
		} ),
		{ barWidth: 10 }
	);
	const scenarioBar = half.split( '\n' )[ 1 ] ?? '';
	const filled = ( scenarioBar.match( /█/g ) ?? [] ).length;
	const empty = ( scenarioBar.match( /░/g ) ?? [] ).length;
	assert.equal( filled, 5 );
	assert.equal( empty, 5 );
} );

test( 'zero-total bars render as fully empty', () => {
	const out = renderSnapshot( snap( {} ), { barWidth: 8 } );
	const scenarioBar = out.split( '\n' )[ 1 ] ?? '';
	assert.match( scenarioBar, /░{8}/ );
} );

test( "finished snapshot says 'done' and omits ETA", () => {
	const out = renderSnapshot(
		snap( {
			startedAt: 0,
			now: 16 * 60_000 + 48_000,
			finished: true,
			counters: {
				scenarios: {
					total: 45,
					passed: 41,
					failed: 3,
					skipped: 1,
					running: 0,
					pending: 0,
				},
				phases: {
					total: 135,
					passed: 128,
					failed: 6,
					skipped: 1,
					running: 0,
					pending: 0,
				},
			},
		} )
	);
	assert.match( out, /elapsed 16:48 {3}done/ );
	assert.doesNotMatch( out, /ETA/ );
} );

test( 'renders failures block with aligned columns', () => {
	const failures: Failure[] = [
		{
			scenario: 'follow-instructions',
			agentId: 'opus',
			phase: 'judge',
			detail: 'rubric "no-emojis" not pass',
		},
		{
			scenario: 'no-emojis',
			agentId: 'sonnet',
			phase: 'testing',
			detail: 'agent timeout after 60s',
		},
	];
	const out = renderSnapshot(
		snap( {
			counters: {
				scenarios: {
					total: 45,
					passed: 10,
					failed: 2,
					skipped: 0,
					running: 0,
					pending: 33,
				},
				phases: {
					total: 135,
					passed: 25,
					failed: 6,
					skipped: 0,
					running: 0,
					pending: 104,
				},
			},
			failures,
		} )
	);

	assert.match( out, /\nfailures \(2\):\n/ );
	assert.match(
		out,
		/✗ follow-instructions {2}opus {4}judge {4}rubric "no-emojis" not pass/
	);
	assert.match(
		out,
		/✗ no-emojis {12}sonnet {2}testing {2}agent timeout after 60s/
	);
} );

test( 'no failures: omits failures section entirely', () => {
	const out = renderSnapshot(
		snap( {
			counters: {
				scenarios: {
					total: 3,
					passed: 3,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 0,
				},
				phases: {
					total: 6,
					passed: 6,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 0,
				},
			},
			finished: true,
		} )
	);
	assert.doesNotMatch( out, /failures/ );
} );

test( 'color: true wraps the cross glyph in red ANSI', () => {
	const out = renderSnapshot(
		snap( {
			counters: {
				scenarios: {
					total: 1,
					passed: 0,
					failed: 1,
					skipped: 0,
					running: 0,
					pending: 0,
				},
				phases: {
					total: 2,
					passed: 0,
					failed: 1,
					skipped: 1,
					running: 0,
					pending: 0,
				},
			},
			failures: [
				{
					scenario: 's',
					agentId: 'a',
					phase: 'judge',
					detail: 'boom',
				},
			],
			finished: true,
		} ),
		{ color: true }
	);

	const ESC = String.fromCharCode( 27 );
	assert.ok(
		out.includes( `${ ESC }[31m✗${ ESC }[0m` ),
		'expected red cross glyph'
	);
} );

test( 'formats hh:mm:ss when run exceeds an hour', () => {
	const out = renderSnapshot(
		snap( {
			startedAt: 0,
			now: ( 1 * 3600 + 23 * 60 + 7 ) * 1000,
			finished: true,
			counters: {
				scenarios: {
					total: 1,
					passed: 1,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 0,
				},
				phases: {
					total: 2,
					passed: 2,
					failed: 0,
					skipped: 0,
					running: 0,
					pending: 0,
				},
			},
		} )
	);
	assert.match( out, /elapsed 1:23:07 {3}done/ );
} );
