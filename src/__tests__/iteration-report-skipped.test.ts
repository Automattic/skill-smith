import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeRunReport } from '../reports/iteration-report';
import type { ScenarioReport } from '../reports/scenario-report';

function readReport( runDir: string ): Record< string, unknown > {
	const raw = readFileSync( join( runDir, 'report.json' ), 'utf8' );
	return JSON.parse( raw ) as Record< string, unknown >;
}

const passingScenario: ScenarioReport = {
	scenario: 'alpha',
	pass: true,
	agents: {},
};

const failingScenario: ScenarioReport = {
	scenario: 'alpha',
	pass: false,
	agents: {},
};

test( 'writeRunReport puts skipped at the top level, sibling to scenarios', () => {
	const runDir = mkdtempSync(
		join( tmpdir(), 'skillsmith-run-report-skipped-' )
	);

	writeRunReport( runDir, 'run-1', {}, [
		{ id: 'gpt', roles: [ 'test' ], reason: 'OPENAI_API_KEY is not set' },
	] );

	const parsed = readReport( runDir );
	assert.ok( Array.isArray( parsed.skipped ), 'skipped should be an array' );
	const skipped = parsed.skipped as Array< Record< string, unknown > >;
	assert.equal( skipped[ 0 ]?.id, 'gpt' );
	assert.equal( skipped[ 0 ]?.reason, 'OPENAI_API_KEY is not set' );

	// The skipped set is a sibling of scenarios, never nested inside one.
	assert.ok( 'scenarios' in parsed, 'scenarios should be present' );
	for ( const scenario of Object.values( parsed.scenarios ?? {} ) ) {
		assert.ok(
			! ( scenario as Record< string, unknown > ).skipped,
			'skipped should not be nested inside a scenario'
		);
	}
} );

test( 'writeRunReport defaults skipped to [] and returns pass unchanged (all-pass)', () => {
	const runDir = mkdtempSync(
		join( tmpdir(), 'skillsmith-run-report-skipped-' )
	);

	const pass = writeRunReport( runDir, 'run-2', { alpha: passingScenario } );

	assert.equal( pass, true );
	const parsed = readReport( runDir );
	assert.deepEqual( parsed.skipped, [] );
} );

test( 'writeRunReport defaults skipped to [] and returns pass unchanged (a failure)', () => {
	const runDir = mkdtempSync(
		join( tmpdir(), 'skillsmith-run-report-skipped-' )
	);

	const pass = writeRunReport( runDir, 'run-3', { alpha: failingScenario } );

	assert.equal( pass, false );
	const parsed = readReport( runDir );
	assert.deepEqual( parsed.skipped, [] );
} );
