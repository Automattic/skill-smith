import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { pluginSlug } from '../../testing-project/eval/utils/scaffold-plugin';

/**
 * Contract for Task 9: the run-level warm-env lifecycle in the judge helper
 * (`testing-project/eval/utils/wp-env-judge.ts`).
 *
 * The helper lives outside `src/`, so it is not covered by the core typecheck;
 * these tests pin the filesystem and environment behaviour the `check:config`
 * guardrail only asserts is importable. The wp-env/build shell-outs are stubbed
 * through the helper's injectable command seam, so the real wp-env is never
 * booted; only the on-disk and `process.env` effects are exercised, matching
 * the project's testing posture for these side-effecting orchestrators.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );
/** Absolute path to the judge-env helper under test. */
const HELPER_PATH = join( TESTING_PROJECT, 'eval', 'utils', 'wp-env-judge.ts' );
/** Where {@link bootJudgeEnv} writes the warm-env config. */
const WP_ENV_CONFIG_PATH = join( TESTING_PROJECT, '.wp-env.json' );
/** The host side of the live `wp-content/plugins` bind mount. */
const STAGING_DIR = join( TESTING_PROJECT, '.wp-env-plugins' );

/** The shell-out seam the helper exposes; matches `JudgeEnvCommands`. */
interface JudgeEnvCommands {
	buildPlugin( pluginPath: string ): void;
	startWpEnv(): void;
	stopWpEnv(): void;
	wpCli( args: string[] ): void;
}

interface JudgeEnvModule {
	bootJudgeEnv( commands?: JudgeEnvCommands ): void;
	stopJudgeEnv( commands?: JudgeEnvCommands ): void;
	installPluginForPair(
		ctx: {
			scenario: { name: string };
			agent: { id: string };
			judgeWorkspace: string;
		},
		commands?: JudgeEnvCommands
	): void;
	cleanUpPair(
		ctx: { scenario: { name: string }; agent: { id: string } },
		commands?: JudgeEnvCommands
	): void;
}

/** Re-import the helper fresh so the module-level `booted` flag resets. */
async function loadHelper(): Promise< JudgeEnvModule > {
	return ( await import(
		`${ HELPER_PATH }?t=${ Date.now() }-${ Math.random() }`
	) ) as unknown as JudgeEnvModule;
}

/**
 * A recording stub for the shell-out seam: every call is appended to `calls`
 * and nothing is executed, so the real wp-env / wp-scripts never run.
 */
function recordingCommands(): {
	commands: JudgeEnvCommands;
	calls: Array< { fn: string; args: unknown[] } >;
} {
	const calls: Array< { fn: string; args: unknown[] } > = [];
	const commands: JudgeEnvCommands = {
		buildPlugin: ( p ) => calls.push( { fn: 'buildPlugin', args: [ p ] } ),
		startWpEnv: () => calls.push( { fn: 'startWpEnv', args: [] } ),
		stopWpEnv: () => calls.push( { fn: 'stopWpEnv', args: [] } ),
		wpCli: ( args ) => calls.push( { fn: 'wpCli', args: [ args ] } ),
	};
	return { commands, calls };
}

const PER_PAIR_ENV_VARS = [
	'SKILLSMITH_PROJECT_ROOT',
	'SKILLSMITH_WP_PORT',
	'SKILLSMITH_PLUGIN_SLUG',
] as const;

function clearEnv(): void {
	for ( const name of PER_PAIR_ENV_VARS ) {
		delete process.env[ name ];
	}
}

function cleanFsArtifacts(): void {
	rmSync( WP_ENV_CONFIG_PATH, { force: true } );
	rmSync( STAGING_DIR, { recursive: true, force: true } );
}

beforeEach( () => {
	cleanFsArtifacts();
	clearEnv();
} );

afterEach( () => {
	cleanFsArtifacts();
	clearEnv();
} );

test( 'bootJudgeEnv writes a warm .wp-env.json with empty plugins, the bind mapping, and port 8987', async () => {
	const { bootJudgeEnv } = await loadHelper();
	const { commands } = recordingCommands();

	bootJudgeEnv( commands );

	assert.ok( existsSync( WP_ENV_CONFIG_PATH ), '.wp-env.json is written' );
	const config = JSON.parse( readFileSync( WP_ENV_CONFIG_PATH, 'utf8' ) );
	assert.deepEqual( config.plugins, [], 'no plugins are statically listed' );
	assert.equal(
		config.mappings[ 'wp-content/plugins' ],
		STAGING_DIR,
		'wp-content/plugins is mapped to the host staging dir'
	);
	assert.equal( config.port, 8987, 'the fixed port is preserved' );
} );

test( 'bootJudgeEnv creates an empty staging dir and starts wp-env once', async () => {
	const { bootJudgeEnv } = await loadHelper();
	const { commands, calls } = recordingCommands();

	// A stale staging dir with leftover content must be wiped on boot.
	mkdirSync( STAGING_DIR, { recursive: true } );
	writeFileSync( join( STAGING_DIR, 'stale.txt' ), 'leftover' );

	bootJudgeEnv( commands );

	assert.ok( existsSync( STAGING_DIR ), 'the staging dir exists' );
	assert.ok(
		! existsSync( join( STAGING_DIR, 'stale.txt' ) ),
		'the staging dir is recreated empty'
	);
	assert.deepEqual(
		calls.map( ( c ) => c.fn ),
		[ 'startWpEnv' ],
		'wp-env start runs exactly once'
	);
} );

test( 'bootJudgeEnv is idempotent: a re-entry does not double-boot wp-env', async () => {
	const { bootJudgeEnv } = await loadHelper();
	const { commands, calls } = recordingCommands();

	bootJudgeEnv( commands );
	bootJudgeEnv( commands );

	assert.equal(
		calls.filter( ( c ) => c.fn === 'startWpEnv' ).length,
		1,
		'the second call is a no-op under the booted flag'
	);
} );

test( 'installPluginForPair copies the built plugin into the staging slug dir', async () => {
	const { bootJudgeEnv, installPluginForPair } = await loadHelper();
	const { commands } = recordingCommands();
	bootJudgeEnv( commands );

	const judgeWorkspace = join( STAGING_DIR, '..', 'judge-copy-fixture' );
	const slug = pluginSlug( 'counter', 'haiku' );
	const pluginSrc = join( judgeWorkspace, slug );
	try {
		mkdirSync( pluginSrc, { recursive: true } );
		writeFileSync( join( pluginSrc, 'index.php' ), '<?php // plugin' );

		installPluginForPair(
			{
				scenario: { name: 'counter' },
				agent: { id: 'haiku' },
				judgeWorkspace,
			},
			commands
		);

		const staged = join( STAGING_DIR, slug, 'index.php' );
		assert.ok(
			existsSync( staged ),
			'the plugin is copied into <staging>/<slug>/'
		);
	} finally {
		rmSync( judgeWorkspace, { recursive: true, force: true } );
	}
} );

test( 'installPluginForPair deactivates all then activates the pair slug', async () => {
	const { bootJudgeEnv, installPluginForPair } = await loadHelper();
	const { commands, calls } = recordingCommands();
	bootJudgeEnv( commands );

	const judgeWorkspace = join( STAGING_DIR, '..', 'judge-copy-fixture' );
	const slug = pluginSlug( 'counter', 'haiku' );
	try {
		mkdirSync( join( judgeWorkspace, slug ), { recursive: true } );

		installPluginForPair(
			{
				scenario: { name: 'counter' },
				agent: { id: 'haiku' },
				judgeWorkspace,
			},
			commands
		);

		const cliCalls = calls
			.filter( ( c ) => c.fn === 'wpCli' )
			.map( ( c ) => c.args[ 0 ] as string[] );
		assert.deepEqual(
			cliCalls,
			[
				[ 'plugin', 'deactivate', '--all' ],
				[ 'plugin', 'activate', slug ],
			],
			'clean slate precedes activation of this pair'
		);
	} finally {
		rmSync( judgeWorkspace, { recursive: true, force: true } );
	}
} );

test( 'installPluginForPair exports the bridge env vars for the judge child', async () => {
	const { bootJudgeEnv, installPluginForPair } = await loadHelper();
	const { commands } = recordingCommands();
	bootJudgeEnv( commands );

	const judgeWorkspace = join( STAGING_DIR, '..', 'judge-copy-fixture' );
	const slug = pluginSlug( 'counter', 'haiku' );
	try {
		mkdirSync( join( judgeWorkspace, slug ), { recursive: true } );

		installPluginForPair(
			{
				scenario: { name: 'counter' },
				agent: { id: 'haiku' },
				judgeWorkspace,
			},
			commands
		);

		assert.equal(
			process.env.SKILLSMITH_PROJECT_ROOT,
			TESTING_PROJECT,
			'SKILLSMITH_PROJECT_ROOT points at the testing-project root'
		);
		assert.equal(
			process.env.SKILLSMITH_WP_PORT,
			'8987',
			'SKILLSMITH_WP_PORT carries the wp-env port'
		);
		assert.equal(
			process.env.SKILLSMITH_PLUGIN_SLUG,
			slug,
			'SKILLSMITH_PLUGIN_SLUG carries the activated slug'
		);
	} finally {
		rmSync( judgeWorkspace, { recursive: true, force: true } );
	}
} );

test( 'installPluginForPair only builds when the plugin ships src/blocks', async () => {
	const { bootJudgeEnv, installPluginForPair } = await loadHelper();
	const { commands, calls } = recordingCommands();
	bootJudgeEnv( commands );

	const judgeWorkspace = join( STAGING_DIR, '..', 'judge-copy-fixture' );
	const slug = pluginSlug( 'counter', 'haiku' );
	try {
		mkdirSync( join( judgeWorkspace, slug, 'src', 'blocks' ), {
			recursive: true,
		} );

		installPluginForPair(
			{
				scenario: { name: 'counter' },
				agent: { id: 'haiku' },
				judgeWorkspace,
			},
			commands
		);

		assert.equal(
			calls.filter( ( c ) => c.fn === 'buildPlugin' ).length,
			1,
			'wp-scripts build runs when src/blocks exists'
		);
	} finally {
		rmSync( judgeWorkspace, { recursive: true, force: true } );
	}
} );

test( 'cleanUpPair deactivates all, removes the pair staging dir, and does not stop wp-env', async () => {
	const { bootJudgeEnv, cleanUpPair } = await loadHelper();
	const { commands, calls } = recordingCommands();
	bootJudgeEnv( commands );

	const slug = pluginSlug( 'counter', 'haiku' );
	mkdirSync( join( STAGING_DIR, slug ), { recursive: true } );
	process.env.SKILLSMITH_PLUGIN_SLUG = slug;
	process.env.SKILLSMITH_WP_PORT = '8987';
	process.env.SKILLSMITH_PROJECT_ROOT = TESTING_PROJECT;

	const callsBefore = calls.length;
	cleanUpPair(
		{ scenario: { name: 'counter' }, agent: { id: 'haiku' } },
		commands
	);

	assert.ok(
		! existsSync( join( STAGING_DIR, slug ) ),
		'the pair staging subdir is removed'
	);
	assert.ok(
		existsSync( STAGING_DIR ),
		'the shared staging dir itself stays for the next pair'
	);
	const newCalls = calls.slice( callsBefore );
	assert.deepEqual(
		newCalls.map( ( c ) => c.fn ),
		[ 'wpCli' ],
		'only a clean-slate wpCli runs — no wp-env stop'
	);
	const [ deactivateCall ] = newCalls;
	assert.ok( deactivateCall, 'a clean-slate wpCli call was recorded' );
	assert.deepEqual( deactivateCall.args[ 0 ], [
		'plugin',
		'deactivate',
		'--all',
	] );
	for ( const name of PER_PAIR_ENV_VARS ) {
		assert.equal(
			process.env[ name ],
			undefined,
			`${ name } is cleared after the pair`
		);
	}
} );

test( 'stopJudgeEnv stops wp-env and removes the staging dir and .wp-env.json', async () => {
	const { bootJudgeEnv, stopJudgeEnv } = await loadHelper();
	const { commands, calls } = recordingCommands();
	bootJudgeEnv( commands );

	assert.ok( existsSync( WP_ENV_CONFIG_PATH ) );
	assert.ok( existsSync( STAGING_DIR ) );

	stopJudgeEnv( commands );

	assert.ok(
		calls.some( ( c ) => c.fn === 'stopWpEnv' ),
		'wp-env stop runs'
	);
	assert.ok(
		! existsSync( STAGING_DIR ),
		'the staging dir is removed on stop'
	);
	assert.ok(
		! existsSync( WP_ENV_CONFIG_PATH ),
		'.wp-env.json is removed on stop'
	);
} );

test( 'stopJudgeEnv swallows wp-env stop errors and still removes host state', async () => {
	const { bootJudgeEnv, stopJudgeEnv } = await loadHelper();
	const boot = recordingCommands();
	bootJudgeEnv( boot.commands );

	const throwing: JudgeEnvCommands = {
		buildPlugin: () => {},
		startWpEnv: () => {},
		stopWpEnv: () => {
			throw new Error( 'wp-env stop blew up' );
		},
		wpCli: () => {},
	};

	assert.doesNotThrow(
		() => stopJudgeEnv( throwing ),
		'stopJudgeEnv never throws'
	);
	assert.ok(
		! existsSync( STAGING_DIR ),
		'host state is removed despite the stop failure'
	);
	assert.ok( ! existsSync( WP_ENV_CONFIG_PATH ) );
} );

test( 'stopJudgeEnv resets the booted flag so a later boot starts wp-env again', async () => {
	const { bootJudgeEnv, stopJudgeEnv } = await loadHelper();
	const { commands, calls } = recordingCommands();

	bootJudgeEnv( commands );
	stopJudgeEnv( commands );
	bootJudgeEnv( commands );

	assert.equal(
		calls.filter( ( c ) => c.fn === 'startWpEnv' ).length,
		2,
		'boot after stop starts wp-env a second time'
	);
} );
