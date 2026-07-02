import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_PATHS } from '../config/defaults';
import { PreconditionError } from '../config/resolve-cwd';
import type { SkillsmithConfig } from '../config/types';
import { checkPaths } from '../pipeline/pipeline';

/**
 * Build a `SkillsmithConfig` that only populates the fields `checkPaths`
 * reads (`paths` and `roles.judge.library`). The remaining required config
 * fields are stubbed with empty placeholders so the value type-checks
 * without standing up the whole harness.
 *
 * @param paths   - The `paths` block under check.
 * @param library - Optional `roles.judge.library` value to gate on.
 */
function configWithPaths(
	paths: SkillsmithConfig[ 'paths' ],
	library?: string
): SkillsmithConfig {
	return {
		mode: 'test-only',
		agents: {},
		roles: {
			test: { agents: [] },
			judge: {
				agent: { id: 'j', provider: 'mock', model: 'm' },
				...( library !== undefined ? { library } : {} ),
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

test( 'checkPaths passes when skills/ and scenarios/ exist and no judge library is configured', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-checkpaths-' ) );
	try {
		mkdirSync( join( root, 'skills' ), { recursive: true } );
		mkdirSync( join( root, 'scenarios' ), { recursive: true } );

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

// --- roles.judge.library gate ---------------------------------------------

/** A valid `paths` block pointing at directories the test creates. */
const VALID_PATHS = {
	base: './.skillsmith',
	skills: './skills',
	scenarios: './scenarios',
};

/** Create the `skills/` and `scenarios/` directories `VALID_PATHS` names. */
function makeValidRoot(): string {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-checkpaths-' ) );
	mkdirSync( join( root, 'skills' ), { recursive: true } );
	mkdirSync( join( root, 'scenarios' ), { recursive: true } );
	return root;
}

test( 'checkPaths rejects a configured roles.judge.library that does not exist', () => {
	const root = makeValidRoot();
	try {
		const config = configWithPaths( VALID_PATHS, './eval/judge' );
		assert.throws(
			() => checkPaths( config, root ),
			( err: unknown ) => {
				assert.ok( err instanceof PreconditionError );
				assert.match( err.message, /roles\.judge\.library/ );
				assert.match( err.message, /does not exist/ );
				return true;
			}
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'checkPaths rejects a configured roles.judge.library that is not a directory', () => {
	const root = makeValidRoot();
	try {
		mkdirSync( join( root, 'eval' ), { recursive: true } );
		writeFileSync( join( root, 'eval', 'judge' ), 'a file, not a dir' );

		const config = configWithPaths( VALID_PATHS, './eval/judge' );
		assert.throws(
			() => checkPaths( config, root ),
			( err: unknown ) => {
				assert.ok( err instanceof PreconditionError );
				assert.match( err.message, /roles\.judge\.library/ );
				assert.match( err.message, /not a directory/ );
				return true;
			}
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'checkPaths passes when roles.judge.library points at an existing directory', () => {
	const root = makeValidRoot();
	try {
		mkdirSync( join( root, 'eval', 'judge' ), { recursive: true } );

		const config = configWithPaths( VALID_PATHS, './eval/judge' );
		assert.doesNotThrow( () => checkPaths( config, root ) );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
