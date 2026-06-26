import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyVerdict, summarizeFailures } from '../reports/verdict';

test( 'pass:false with notes → FAIL surfacing the notes', () => {
	const cell = classifyVerdict( { pass: false, notes: 'reason' } );
	assert.equal( cell.kind, 'FAIL' );
	if ( cell.kind !== 'FAIL' ) return;
	assert.deepEqual( cell.failures, [ 'reason' ] );
} );

test( 'pass:false with no detail → FAIL with the generic fallback', () => {
	const cell = classifyVerdict( { pass: false } );
	assert.equal( cell.kind, 'FAIL' );
	if ( cell.kind !== 'FAIL' ) return;
	assert.deepEqual( cell.failures, [ 'verdict failed without detail' ] );
} );

test( 'pass:true with notes → PASS', () => {
	const cell = classifyVerdict( { pass: true, notes: 'ok' } );
	assert.equal( cell.kind, 'PASS' );
} );

test( 'pass:false with error → FAIL with that error (notes branch unchanged)', () => {
	const cell = classifyVerdict( { pass: false, error: 'boom' } );
	assert.equal( cell.kind, 'FAIL' );
	if ( cell.kind !== 'FAIL' ) return;
	assert.deepEqual( cell.failures, [ 'boom' ] );
} );

test( 'pass:false with failures[] → FAIL listing each failure (notes branch unchanged)', () => {
	const cell = classifyVerdict( {
		pass: false,
		failures: [
			{ kind: 'rubric', id: 'r1', notes: 'too slow' },
			{ kind: 'acceptance', id: 'a1' },
		],
	} );
	assert.equal( cell.kind, 'FAIL' );
	if ( cell.kind !== 'FAIL' ) return;
	assert.deepEqual( cell.failures, [
		'rubric r1 — too slow',
		'acceptance a1',
	] );
} );

test( 'skipped string → SKIPPED with reason', () => {
	const cell = classifyVerdict( { skipped: 'no agents' } );
	assert.equal( cell.kind, 'SKIPPED' );
	if ( cell.kind !== 'SKIPPED' ) return;
	assert.equal( cell.reason, 'no agents' );
} );

test( 'error string → FAIL with that error as the only failure', () => {
	const cell = classifyVerdict( { error: 'unparseable' } );
	assert.equal( cell.kind, 'FAIL' );
	if ( cell.kind !== 'FAIL' ) return;
	assert.deepEqual( cell.failures, [ 'unparseable' ] );
} );

test( 'a verdict with no pass flag → FAIL', () => {
	const cell = classifyVerdict( {} );
	assert.equal( cell.kind, 'FAIL' );
} );

test( 'non-object verdict → FAIL', () => {
	assert.equal( classifyVerdict( null ).kind, 'FAIL' );
	assert.equal( classifyVerdict( 'nope' ).kind, 'FAIL' );
} );

test( 'summarizeFailures: rubric + acceptance counts get pluralised', () => {
	assert.equal(
		summarizeFailures( [ 'rubric r1', 'acceptance a1' ] ),
		'1 rubric, 1 acceptance failed'
	);
	assert.equal(
		summarizeFailures( [
			'rubric r1',
			'rubric r2',
			'acceptance a1',
			'acceptance a2',
		] ),
		'2 rubrics, 2 acceptances failed'
	);
} );

test( 'summarizeFailures: only one category present omits the other', () => {
	assert.equal(
		summarizeFailures( [ 'rubric r1', 'rubric r2' ] ),
		'2 rubrics failed'
	);
	assert.equal(
		summarizeFailures( [ 'acceptance a1' ] ),
		'1 acceptance failed'
	);
} );

test( 'summarizeFailures: diagnostic strings pass through unchanged', () => {
	assert.equal(
		summarizeFailures( [ 'verdict missing' ] ),
		'verdict missing'
	);
	assert.equal(
		summarizeFailures( [ 'no rubrics or acceptance in verdict' ] ),
		'no rubrics or acceptance in verdict'
	);
	assert.equal(
		summarizeFailures( [ 'judge dispatch failed: 403 Forbidden' ] ),
		'judge dispatch failed: 403 Forbidden'
	);
} );
