import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentContext } from '@automattic/skillsmith';
import { pluginSlug } from './scaffold-plugin';

// This file lives at `<projectRoot>/eval/utils/wp-env-judge.ts`, so the
// project root — where `node_modules`, `.wp-env.json`, and the npm scripts
// live — is two directories up (matching the sibling `wp-cli.mjs`).
const PROJECT_ROOT = resolve(
	dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

/** Fixed port the warm wp-env listens on; the judge loads URLs on it. */
const WP_ENV_PORT = 8987;

/**
 * `.wp-env.json` is gitignored and owned by these hooks: a single warm
 * environment is described here for the whole run and the file is removed when
 * the run-level environment stops.
 */
const WP_ENV_CONFIG_PATH = join( PROJECT_ROOT, '.wp-env.json' );

/**
 * Host directory live-mounted into the warm wp-env at `wp-content/plugins`.
 * Each pair stages its built plugin under `<STAGING_DIR>/<slug>/`; the bind
 * mount makes additions and removals visible to WordPress without a restart.
 */
const STAGING_DIR = join( PROJECT_ROOT, '.wp-env-plugins' );

/** The per-pair runtime facts the judge reads from its environment. */
const ENV_VAR_NAMES = [
	'SKILLSMITH_PROJECT_ROOT',
	'SKILLSMITH_WP_PORT',
	'SKILLSMITH_PLUGIN_SLUG',
] as const;

/**
 * Derive the plugin slug for a (scenario, agent) pair. Re-exported from the
 * scaffold so the judge helper and the scaffold share one definition and the
 * judge copy always resolves the directory the scaffold wrote.
 */
export const judgePluginSlug = pluginSlug;

/**
 * Whether the run-level warm wp-env has been booted. Module-level so a re-entry
 * of {@link bootJudgeEnv} (for example a retried first pair) does not boot a
 * second environment on the shared port.
 */
let booted = false;

/**
 * The shell-outs the lifecycle functions perform, behind one injectable seam.
 * Defaults run the real commands; tests pass stubs to exercise the filesystem
 * and environment behaviour without booting wp-env. Each member is invoked by
 * exactly one lifecycle stage and is named for that stage.
 */
export interface JudgeEnvCommands {
	/** Run `wp-scripts build` against a plugin in the judge copy. */
	buildPlugin( pluginPath: string ): void;
	/** Run `wp-env start` against the warm-env config. */
	startWpEnv(): void;
	/** Run `wp-env stop` against the warm-env config. */
	stopWpEnv(): void;
	/** Run a WP-CLI command inside the warm environment. */
	wpCli( args: string[] ): void;
}

/**
 * Run a WP-CLI command inside the running wp-env. Pinned to the warm-env config
 * with `--config` so it resolves the same environment regardless of the current
 * working directory.
 *
 * @param args - WP-CLI arguments appended after `wp` (for example
 *   `[ 'plugin', 'activate', slug ]`).
 */
function runWpCli( args: string[] ): void {
	execFileSync(
		'npx',
		[
			'wp-env',
			'run',
			'cli',
			'--config',
			WP_ENV_CONFIG_PATH,
			'wp',
			...args,
		],
		{
			cwd: PROJECT_ROOT,
			stdio: 'inherit',
		}
	);
}

/** The real shell-outs used in production runs. */
const defaultCommands: JudgeEnvCommands = {
	buildPlugin( pluginPath: string ): void {
		const wpScriptsBin = join(
			PROJECT_ROOT,
			'node_modules',
			'.bin',
			'wp-scripts'
		);
		execFileSync( wpScriptsBin, [ 'build' ], {
			stdio: 'inherit',
			cwd: pluginPath,
			env: { ...process.env, WP_EXPERIMENTAL_MODULES: '1' },
		} );
	},
	startWpEnv(): void {
		execFileSync(
			'npx',
			[ 'wp-env', 'start', '--config', WP_ENV_CONFIG_PATH ],
			{
				stdio: 'inherit',
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					WP_ENV_PORT: String( WP_ENV_PORT ),
					WP_BASE_URL: `http://localhost:${ WP_ENV_PORT }`,
				},
			}
		);
	},
	stopWpEnv(): void {
		execFileSync(
			'npx',
			[ 'wp-env', 'stop', '--config', WP_ENV_CONFIG_PATH ],
			{
				stdio: 'inherit',
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					WP_ENV_PORT: String( WP_ENV_PORT ),
				},
			}
		);
	},
	wpCli: runWpCli,
};

/**
 * The `.wp-env.json` describing the warm environment: no statically-listed
 * plugins (pairs stage their own under the live bind mount) and a mapping of
 * `wp-content/plugins` onto the host {@link STAGING_DIR} so staged plugins
 * appear without restarting wp-env.
 *
 * @returns The `.wp-env.json` object serialized by {@link bootJudgeEnv}.
 */
function warmEnvConfig(): {
	plugins: string[];
	mappings: Record< string, string >;
	port: number;
} {
	return {
		plugins: [],
		mappings: { 'wp-content/plugins': STAGING_DIR },
		port: WP_ENV_PORT,
	};
}

/**
 * Boot the single warm WordPress environment for the whole run.
 *
 *   1. Defensively clear and recreate an empty {@link STAGING_DIR}, the host
 *      side of the live `wp-content/plugins` bind mount.
 *   2. Overwrite `.wp-env.json` with the warm-env config: no static plugins, a
 *      `wp-content/plugins -> STAGING_DIR` mapping, and port {@link WP_ENV_PORT}.
 *   3. Start wp-env once against that config.
 *
 * Idempotent: while {@link booted} is already true a re-entry returns
 * immediately so the shared port is never double-booted. The caller must pair
 * this run-level boot with {@link stopJudgeEnv}.
 *
 * @param commands - Shell-out seam; defaults to the real commands. Tests pass
 *   stubs to exercise the filesystem behaviour without booting wp-env.
 */
export function bootJudgeEnv(
	commands: JudgeEnvCommands = defaultCommands
): void {
	if ( booted ) {
		return;
	}

	rmSync( STAGING_DIR, { recursive: true, force: true } );
	mkdirSync( STAGING_DIR, { recursive: true } );

	writeFileSync(
		WP_ENV_CONFIG_PATH,
		`${ JSON.stringify( warmEnvConfig(), null, 2 ) }\n`
	);

	commands.startWpEnv();

	booted = true;
}

/**
 * Stop the run-level warm WordPress environment and remove the host state it
 * owns: stop wp-env, then delete {@link STAGING_DIR} and `.wp-env.json`. Every
 * step is wrapped so a failure is logged rather than thrown — teardown always
 * runs to completion and the {@link booted} flag is reset so a later boot can
 * stand a fresh environment up.
 *
 * @param commands - Shell-out seam; defaults to the real commands. Tests pass
 *   stubs to exercise the filesystem behaviour without driving wp-env.
 */
export function stopJudgeEnv(
	commands: JudgeEnvCommands = defaultCommands
): void {
	try {
		commands.stopWpEnv();
	} catch ( err ) {
		console.error( 'wp-env stop failed:', err );
	}

	try {
		rmSync( STAGING_DIR, { recursive: true, force: true } );
	} catch ( err ) {
		console.error( 'removing the plugin staging dir failed:', err );
	}

	try {
		rmSync( WP_ENV_CONFIG_PATH, { force: true } );
	} catch ( err ) {
		console.error( 'removing .wp-env.json failed:', err );
	}

	booted = false;
}

/**
 * Install the produced plugin into the warm environment for one (scenario,
 * agent) pair and export the bridge env vars the `JUDGE.md` briefs reference.
 * Built entirely from the **judge copy** (`ctx.judgeWorkspace`) so what the
 * judge verifies is exactly what it sees:
 *
 *   1. When the plugin ships blocks, build it with `wp-scripts` (emitting
 *      `view.asset.php` so script-module dependencies are declared).
 *   2. Copy the built plugin directory into `<STAGING_DIR>/<slug>/`; the live
 *      bind mount makes it visible to WordPress without restarting wp-env.
 *   3. Deactivate every plugin (clean slate from the prior pair) then activate
 *      this pair's slug.
 *   4. Export `SKILLSMITH_PROJECT_ROOT`, `SKILLSMITH_WP_PORT`, and
 *      `SKILLSMITH_PLUGIN_SLUG` for the judge child.
 *
 * Requires {@link bootJudgeEnv} to have run. Pair this with
 * {@link cleanUpPair}. With `roles.judge.concurrency = 'serial'` the harness
 * holds a run-wide lock across the whole bracket, so only one pair is staged on
 * the shared environment at a time.
 *
 * @param ctx - The per-pair agent context; `judgeWorkspace`, `scenario.name`,
 *   and `agent.id` locate the plugin to build and activate.
 * @param commands - Shell-out seam; defaults to the real commands. Tests pass
 *   stubs to exercise the filesystem and environment behaviour.
 */
export function installPluginForPair(
	ctx: AgentContext,
	commands: JudgeEnvCommands = defaultCommands
): void {
	const slug = judgePluginSlug( ctx.scenario.name, ctx.agent.id );
	const pluginPath = join( ctx.judgeWorkspace, slug );

	// Build the produced block so `build/blocks/*` (with view.asset.php) is
	// emitted; the scaffold's index.php prefers the build output.
	if ( existsSync( join( pluginPath, 'src', 'blocks' ) ) ) {
		commands.buildPlugin( pluginPath );
	}

	// Stage the built plugin under the live bind mount so WordPress sees it
	// without a restart.
	const stagedPath = join( STAGING_DIR, slug );
	rmSync( stagedPath, { recursive: true, force: true } );
	cpSync( pluginPath, stagedPath, { recursive: true } );

	// Clean slate from the previous pair, then activate this one explicitly so a
	// failure surfaces rather than silently leaving the block unregistered.
	commands.wpCli( [ 'plugin', 'deactivate', '--all' ] );
	commands.wpCli( [ 'plugin', 'activate', slug ] );

	process.env.SKILLSMITH_PROJECT_ROOT = PROJECT_ROOT;
	process.env.SKILLSMITH_WP_PORT = String( WP_ENV_PORT );
	process.env.SKILLSMITH_PLUGIN_SLUG = slug;
}

/**
 * Tear one pair off the warm environment without stopping wp-env: deactivate
 * every plugin and remove this pair's `<STAGING_DIR>/<slug>/` from the bind
 * mount, then clear the per-pair env vars so they never leak into the next
 * pair's judge. The warm environment stays up for the following pair.
 *
 * @param ctx - The per-pair agent context; `scenario.name` and `agent.id`
 *   locate the staged plugin to remove.
 * @param commands - Shell-out seam; defaults to the real commands. Tests pass
 *   stubs to exercise the filesystem and environment behaviour.
 */
export function cleanUpPair(
	ctx: AgentContext,
	commands: JudgeEnvCommands = defaultCommands
): void {
	const slug = judgePluginSlug( ctx.scenario.name, ctx.agent.id );

	commands.wpCli( [ 'plugin', 'deactivate', '--all' ] );
	rmSync( join( STAGING_DIR, slug ), { recursive: true, force: true } );

	for ( const name of ENV_VAR_NAMES ) {
		delete process.env[ name ];
	}
}

/**
 * Stand the WordPress environment up for one (scenario, agent) pair and export
 * the runtime facts the judge needs. Retained as the legacy per-pair
 * orchestrator until the config is rewired onto {@link bootJudgeEnv} /
 * {@link installPluginForPair}; not used by the new run-level lifecycle.
 *
 * @param ctx - The per-pair agent context; `judgeWorkspace`, `scenario.name`,
 *   and `agent.id` locate the plugin to build and activate.
 */
export function setUpJudgeEnv( ctx: AgentContext ): void {
	const slug = judgePluginSlug( ctx.scenario.name, ctx.agent.id );
	const pluginPath = join( ctx.judgeWorkspace, slug );

	if ( existsSync( join( pluginPath, 'src', 'blocks' ) ) ) {
		const wpScriptsBin = join(
			PROJECT_ROOT,
			'node_modules',
			'.bin',
			'wp-scripts'
		);
		execFileSync( wpScriptsBin, [ 'build' ], {
			stdio: 'inherit',
			cwd: pluginPath,
			env: { ...process.env, WP_EXPERIMENTAL_MODULES: '1' },
		} );
	}

	writeFileSync(
		WP_ENV_CONFIG_PATH,
		`${ JSON.stringify(
			{ plugins: [ pluginPath ], port: WP_ENV_PORT },
			null,
			2
		) }\n`
	);

	const wpEnv = {
		...process.env,
		WP_ENV_PORT: String( WP_ENV_PORT ),
		WP_BASE_URL: `http://localhost:${ WP_ENV_PORT }`,
	};
	execSync( 'npm run env:start', {
		stdio: 'inherit',
		cwd: PROJECT_ROOT,
		env: wpEnv,
	} );

	runWpCli( [ 'plugin', 'activate', slug ] );

	process.env.SKILLSMITH_PLUGIN_SLUG = slug;
}

/**
 * Tear the per-pair WordPress environment down. Retained as the legacy
 * counterpart to {@link setUpJudgeEnv} until the config is rewired onto
 * {@link stopJudgeEnv} / {@link cleanUpPair}; not used by the new run-level
 * lifecycle. `env:stop` failures are logged, not thrown.
 *
 * @param _ctx - The per-pair agent context (unused; present so the hook reads
 *   symmetrically with {@link setUpJudgeEnv}).
 */
export function tearDownJudgeEnv( _ctx: AgentContext ): void {
	try {
		execSync( 'npm run env:stop', {
			stdio: 'inherit',
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				WP_ENV_PORT: String( WP_ENV_PORT ),
			},
		} );
	} catch ( err ) {
		console.error( 'wp-env stop failed:', err );
	}
	rmSync( WP_ENV_CONFIG_PATH, { force: true } );
	delete process.env.SKILLSMITH_PLUGIN_SLUG;
}
