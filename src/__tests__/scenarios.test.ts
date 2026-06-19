import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PATHS } from '../config/defaults';
import { enumerateScenarios } from '../scenarios/enumerate';

const here = dirname( fileURLToPath( import.meta.url ) );
const projectRoot = join( here, 'fixtures', 'proj1' );

test( 'scenarios with unresolved refs are flagged but others continue', () => {
	const found = enumerateScenarios( DEFAULT_PATHS, projectRoot );

	const byName = new Map( found.map( ( s ) => [ s.scenario.name, s ] ) );
	assert.equal( byName.size, 2, 'two scenarios should be found' );

	const good = byName.get( 'good-scenario' );
	assert.ok( good, 'good scenario present' );
	assert.equal( good?.error, undefined, 'good scenario has no error' );

	const bad = byName.get( 'bad-scenario' );
	assert.ok( bad, 'bad scenario present' );
	assert.match( bad?.error ?? '', /unresolved reference/ );
	assert.match( bad?.error ?? '', /missing-skill/ );
	assert.match( bad?.error ?? '', /missing-rubric/ );
} );
