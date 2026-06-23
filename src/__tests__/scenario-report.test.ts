import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { aggregateScenarioReport } from '../reports/scenario-report';

test( 'aggregateScenarioReport creates the directory when missing (skipped scenario)', () => {
	const runDir = mkdtempSync(
		join( tmpdir(), 'skillsmith-scenario-report-' )
	);
	const scenarioDirectory = join( runDir, 'never-created' );

	assert.equal(
		existsSync( scenarioDirectory ),
		false,
		'sanity: directory should not exist before'
	);

	aggregateScenarioReport( {
		scenarioDirectory,
		scenarioName: 'never-created',
		scenarioError: 'scenario.yaml malformed',
	} );

	const reportPath = join( scenarioDirectory, 'report.json' );
	assert.ok( existsSync( reportPath ), 'report.json should be written' );

	const parsed = JSON.parse( readFileSync( reportPath, 'utf8' ) ) as Record<
		string,
		unknown
	>;
	assert.equal( parsed.scenario, 'never-created' );
	assert.equal( parsed.error, 'scenario.yaml malformed' );
	assert.deepEqual( parsed.agents, {} );
} );
