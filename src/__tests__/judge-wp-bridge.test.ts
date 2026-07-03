import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

/**
 * Contract for Task 11: the judge's WP-CLI bridge wrapper
 * (`testing-project/eval/utils/judge-wp.mjs`).
 *
 * The wrapper shells out to `npx wp-env … run cli wp …`. These tests exercise
 * it end-to-end by putting a recording `npx` stub first on `PATH`: every
 * invocation writes its received argv (and cwd) to a capture file, then echoes
 * a chosen stdout/stderr and exits with a chosen code. Running the wrapper from
 * an unrelated cwd proves the `--config` path is anchored to the script's own
 * location rather than the caller's, and proves exit status and output are
 * propagated. The real wp-env is never booted.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );
/** Absolute path to the bridge wrapper under test. */
const BRIDGE_PATH = join( TESTING_PROJECT, 'eval', 'utils', 'judge-wp.mjs' );
/**
 * The `--config` path the wrapper must pin: `<PROJECT_ROOT>/.wp-env.json`,
 * where `PROJECT_ROOT` is two directories up from the wrapper.
 */
const EXPECTED_CONFIG_PATH = join( TESTING_PROJECT, '.wp-env.json' );

let stubDir: string;
let captureFile: string;

/**
 * Write a fake `npx` executable into a fresh temp dir and prepend that dir to
 * `PATH`. The stub records its argv and cwd to {@link captureFile}, then prints
 * the requested stdout/stderr and exits with `exitCode`.
 *
 * @param stub.stdout   - Text the stub writes to its stdout.
 * @param stub.stderr   - Text the stub writes to its stderr.
 * @param stub.exitCode - Exit code the stub returns.
 */
function writeNpxStub( {
	stdout = '',
	stderr = '',
	exitCode = 0,
}: { stdout?: string; stderr?: string; exitCode?: number } = {} ): void {
	const script = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(
	process.env.JUDGE_WP_CAPTURE,
	JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })
);
if (${ JSON.stringify( stdout ) }) process.stdout.write(${ JSON.stringify(
		stdout
	) });
if (${ JSON.stringify( stderr ) }) process.stderr.write(${ JSON.stringify(
		stderr
	) });
process.exit(${ exitCode });
`;
	const npxPath = join( stubDir, 'npx' );
	writeFileSync( npxPath, script );
	chmodSync( npxPath, 0o755 );
}

/**
 * Run the bridge wrapper with the given trailing args from a chosen cwd, with
 * the recording `npx` stub first on `PATH`.
 */
function runBridge(
	args: string[],
	cwd: string
): ReturnType< typeof spawnSync > {
	return spawnSync( process.execPath, [ BRIDGE_PATH, ...args ], {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${ stubDir }:${ process.env.PATH ?? '' }`,
			JUDGE_WP_CAPTURE: captureFile,
		},
	} );
}

/** Read the argv/cwd the `npx` stub recorded on its last invocation. */
function readCapture(): { argv: string[]; cwd: string } {
	return JSON.parse( readFileSync( captureFile, 'utf8' ) );
}

beforeEach( () => {
	stubDir = mkdtempSync( join( tmpdir(), 'judge-wp-stub-' ) );
	captureFile = join( stubDir, 'capture.json' );
} );

afterEach( () => {
	rmSync( stubDir, { recursive: true, force: true } );
} );

test( 'invokes `npx wp-env --config <PROJECT_ROOT>/.wp-env.json run cli wp <args>`', () => {
	writeNpxStub();

	// Run from a temp cwd unrelated to the testing-project to prove the config
	// path is anchored to the script's own location, not the caller's cwd.
	const unrelatedCwd = mkdtempSync( join( tmpdir(), 'judge-wp-cwd-' ) );
	try {
		const result = runBridge( [ 'plugin', 'list' ], unrelatedCwd );
		assert.equal( result.status, 0 );

		const { argv } = readCapture();
		assert.deepEqual(
			argv,
			[
				'wp-env',
				'--config',
				EXPECTED_CONFIG_PATH,
				'run',
				'cli',
				'wp',
				'plugin',
				'list',
			],
			'npx receives the pinned wp-env bridge command with the trailing args'
		);
	} finally {
		rmSync( unrelatedCwd, { recursive: true, force: true } );
	}
} );

test( 'pins --config to <PROJECT_ROOT>/.wp-env.json regardless of the caller cwd', () => {
	writeNpxStub();

	// Two different, unrelated working directories must both yield the same
	// absolute --config path resolved from the script location.
	for ( const cwdLabel of [ 'cwd-a', 'cwd-b' ] ) {
		const cwd = mkdtempSync( join( tmpdir(), `judge-wp-${ cwdLabel }-` ) );
		try {
			runBridge( [ 'option', 'get', 'home' ], cwd );
			const { argv } = readCapture();
			const configIdx = argv.indexOf( '--config' );
			assert.ok( configIdx !== -1, '--config is forwarded' );
			assert.equal(
				argv[ configIdx + 1 ],
				EXPECTED_CONFIG_PATH,
				'the --config path is the script-anchored absolute path'
			);
		} finally {
			rmSync( cwd, { recursive: true, force: true } );
		}
	}
} );

test( 'forwards arbitrary trailing args verbatim, including flags and quoted values', () => {
	writeNpxStub();
	const cwd = mkdtempSync( join( tmpdir(), 'judge-wp-args-' ) );
	try {
		const wpArgs = [
			'post',
			'create',
			'--post_type=post',
			'--post_status=publish',
			"--post_title=Judge fixture",
			'--post_content=<!-- wp:skillsmith/counter /-->',
			'--porcelain',
		];
		runBridge( wpArgs, cwd );

		const { argv } = readCapture();
		const wpIdx = argv.indexOf( 'wp' );
		assert.ok( wpIdx !== -1, 'the wp marker is present' );
		assert.deepEqual(
			argv.slice( wpIdx + 1 ),
			wpArgs,
			'every trailing arg is forwarded verbatim after `wp`'
		);
	} finally {
		rmSync( cwd, { recursive: true, force: true } );
	}
} );

test( 'propagates a non-zero wp-env exit status', () => {
	writeNpxStub( { exitCode: 7 } );
	const cwd = mkdtempSync( join( tmpdir(), 'judge-wp-exit-' ) );
	try {
		const result = runBridge( [ 'plugin', 'list' ], cwd );
		assert.equal(
			result.status,
			7,
			'the wrapper exits with the same status as wp-env'
		);
	} finally {
		rmSync( cwd, { recursive: true, force: true } );
	}
} );

test( 'propagates wp-env stdout and stderr to the judge', () => {
	writeNpxStub( {
		stdout: 'akismet\nhello\n',
		stderr: 'a warning line\n',
		exitCode: 0,
	} );
	const cwd = mkdtempSync( join( tmpdir(), 'judge-wp-io-' ) );
	try {
		const result = runBridge( [ 'plugin', 'list' ], cwd );
		assert.equal( result.status, 0 );
		assert.equal(
			String( result.stdout ),
			'akismet\nhello\n',
			'wp-env stdout reaches the wrapper caller'
		);
		assert.match(
			String( result.stderr ),
			/a warning line/,
			'wp-env stderr reaches the wrapper caller'
		);
	} finally {
		rmSync( cwd, { recursive: true, force: true } );
	}
} );
