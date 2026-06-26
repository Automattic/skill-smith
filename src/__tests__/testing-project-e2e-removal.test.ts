import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Removal contract for Task 17: the `testing-project` Playwright/e2e harness is
 * gone. These tests pin the on-disk state so the legacy structured model can
 * never silently creep back into the bundled testing-project: the harness files
 * no longer exist, `package.json` carries no Playwright/e2e dependency or script
 * (while keeping `@wordpress/env` + `@wordpress/scripts` and the env/skillsmith
 * scripts), and no source file still names the deleted harness tokens. The
 * shared `eval/rubrics` directory is intentionally retained — the reusable
 * best-practices rubric lives there and is referenced by id from each scenario.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );

/** Read and parse the testing-project `package.json`. */
function readPackageJson(): {
	scripts?: Record< string, string >;
	dependencies?: Record< string, string >;
	devDependencies?: Record< string, string >;
} {
	return JSON.parse(
		readFileSync( join( TESTING_PROJECT, 'package.json' ), 'utf8' )
	);
}

/**
 * Walk the testing-project (excluding `node_modules` and the npm lockfile) and
 * return every tracked file's path relative to the project root. Used to assert
 * that no remaining source still references the removed harness.
 */
function listProjectFiles( dir = TESTING_PROJECT ): string[] {
	const out: string[] = [];
	for ( const entry of readdirSync( dir ) ) {
		if ( entry === 'node_modules' || entry === 'package-lock.json' ) {
			continue;
		}
		const full = join( dir, entry );
		if ( statSync( full ).isDirectory() ) {
			out.push( ...listProjectFiles( full ) );
		} else {
			out.push( relative( TESTING_PROJECT, full ) );
		}
	}
	return out;
}

test( 'the Playwright/e2e harness files no longer exist', () => {
	for ( const removed of [
		'playwright.config.ts',
		'global-setup.mjs',
		join( 'eval', 'utils', 'verify-e2e.ts' ),
	] ) {
		assert.ok(
			! existsSync( join( TESTING_PROJECT, removed ) ),
			`${ removed } must be deleted from the testing-project`
		);
	}
} );

test( 'package.json drops every Playwright/e2e dependency and the test:e2e script', () => {
	const pkg = readPackageJson();
	const deps = {
		...( pkg.dependencies ?? {} ),
		...( pkg.devDependencies ?? {} ),
	};

	assert.equal(
		pkg.scripts?.[ 'test:e2e' ],
		undefined,
		'the test:e2e script must be removed'
	);
	assert.equal(
		deps[ '@playwright/test' ],
		undefined,
		'@playwright/test must be removed'
	);
	assert.equal(
		deps[ '@wordpress/e2e-test-utils-playwright' ],
		undefined,
		'@wordpress/e2e-test-utils-playwright must be removed'
	);
} );

test( 'package.json keeps the WordPress env tooling and the env/skillsmith scripts', () => {
	const pkg = readPackageJson();
	const devDeps = pkg.devDependencies ?? {};

	assert.ok(
		devDeps[ '@wordpress/env' ],
		'@wordpress/env must be retained'
	);
	assert.ok(
		devDeps[ '@wordpress/scripts' ],
		'@wordpress/scripts must be retained'
	);

	const scripts = pkg.scripts ?? {};
	for ( const kept of [
		'env:start',
		'env:stop',
		'skillsmith',
		'check:config',
	] ) {
		assert.ok( scripts[ kept ], `the ${ kept } script must be retained` );
	}
} );

test( 'no remaining file references e2e.spec.mjs, the playwright harness, or verify-e2e', () => {
	const offenders: string[] = [];
	for ( const rel of listProjectFiles() ) {
		const text = readFileSync( join( TESTING_PROJECT, rel ), 'utf8' );
		// The judge's `@playwright/mcp` browser tooling in skillsmith.config.ts
		// is legitimate (it drives the interactive checks) and is not the e2e
		// harness; the harness tokens are the e2e spec, the Playwright test
		// runner / config, and the removed verify-e2e module.
		if (
			/e2e\.spec\.mjs/.test( text ) ||
			/@playwright\/test/.test( text ) ||
			/playwright\.config/.test( text ) ||
			/playwright test/.test( text ) ||
			/verify-e2e/.test( text )
		) {
			offenders.push( rel );
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`files still reference the removed e2e harness: ${ offenders.join(
			', '
		) }`
	);
} );
