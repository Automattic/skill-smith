import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_PATHS } from '../config/defaults';
import { PreconditionError } from '../config/resolve-cwd';
import type { SkillsmithConfig } from '../config/types';
import { checkPaths } from '../pipeline/pipeline';

/**
 * Build a `SkillsmithConfig` that only populates the fields `checkPaths`
 * reads (`paths`). The remaining required config fields are stubbed with
 * empty placeholders so the value type-checks without standing up the whole
 * harness.
 */
function configWithPaths(
	paths: SkillsmithConfig[ 'paths' ]
): SkillsmithConfig {
	return {
		mode: 'test-only',
		agents: {},
		roles: {
			test: { agents: [] },
			judge: {
				agent: { id: 'j', provider: 'mock', model: 'm' },
				concurrency: 'parallel',
			},
			improver: { agent: { id: 'i', provider: 'mock', model: 'm' } },
		},
		paths,
	};
}

test( 'DEFAULT_PATHS defaults exactly the base/scenarios/skills roots', () => {
	// The defaulted path set is a closed contract: exactly these three roots
	// are supplied out of the box; everything else is per-project opt-in.
	assert.deepEqual( Object.keys( DEFAULT_PATHS ).sort(), [
		'base',
		'scenarios',
		'skills',
	] );
} );

test( 'checkPaths passes when skills/ and scenarios/ exist but rubrics/ does not', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-checkpaths-' ) );
	try {
		mkdirSync( join( root, 'skills' ), { recursive: true } );
		mkdirSync( join( root, 'scenarios' ), { recursive: true } );
		// Deliberately no rubrics/ directory.

		const config = configWithPaths( {
			base: './.skillsmith',
			skills: './skills',
			scenarios: './scenarios',
		} );

		assert.doesNotThrow( () => checkPaths( config, root ) );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'checkPaths throws a clear error when skills/ is missing', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-checkpaths-' ) );
	try {
		mkdirSync( join( root, 'scenarios' ), { recursive: true } );
		// No skills/ directory.

		const config = configWithPaths( {
			base: './.skillsmith',
			skills: './skills',
			scenarios: './scenarios',
		} );

		assert.throws(
			() => checkPaths( config, root ),
			( err: unknown ) => {
				assert.ok( err instanceof PreconditionError );
				assert.match( err.message, /paths\.skills/ );
				assert.match( err.message, /does not exist/ );
				return true;
			}
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'checkPaths throws a clear error when scenarios/ is missing', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-checkpaths-' ) );
	try {
		mkdirSync( join( root, 'skills' ), { recursive: true } );
		// No scenarios/ directory.

		const config = configWithPaths( {
			base: './.skillsmith',
			skills: './skills',
			scenarios: './scenarios',
		} );

		assert.throws(
			() => checkPaths( config, root ),
			( err: unknown ) => {
				assert.ok( err instanceof PreconditionError );
				assert.match( err.message, /paths\.scenarios/ );
				assert.match( err.message, /does not exist/ );
				return true;
			}
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
