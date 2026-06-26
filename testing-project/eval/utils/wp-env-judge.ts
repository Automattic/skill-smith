import { execFileSync, execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
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

/** Fixed port the per-pair wp-env listens on; the judge loads URLs on it. */
const WP_ENV_PORT = 8987;

/** Block name the scaffold registers; embedded in every test post. */
const TESTING_BLOCK_NAME = 'skillsmith/testing-block';

/**
 * `.wp-env.json` is gitignored and owned by these hooks: it lives only for
 * the duration of one pair's judge bracket and is removed in teardown.
 */
const WP_ENV_CONFIG_PATH = join( PROJECT_ROOT, '.wp-env.json' );

/** The per-pair runtime facts the judge reads from its environment. */
const ENV_VAR_NAMES = [
	'SKILLSMITH_JUDGE_URL',
	'SKILLSMITH_POST_ID',
	'SKILLSMITH_PLUGIN_SLUG',
] as const;

/**
 * Derive the plugin slug for a (scenario, agent) pair. Re-exported from the
 * scaffold so the judge helper and the scaffold share one definition and the
 * judge copy always resolves the directory the scaffold wrote.
 */
export const judgePluginSlug = pluginSlug;

/**
 * Build the permalink of the published test post on the local wp-env. Uses the
 * `?p=<id>` form so it works regardless of the site's permalink structure.
 *
 * @param port - Port wp-env is listening on.
 * @param postId - Numeric ID of the published test post.
 * @returns The fully-qualified URL the judge loads to exercise the block.
 * @example
 * judgeUrl( 8987, 42 ); // 'http://localhost:8987/?p=42'
 */
export function judgeUrl( port: number, postId: number ): string {
	return `http://localhost:${ port }/?p=${ postId }`;
}

/**
 * Build the per-pair environment facts the `JUDGE.md` briefs reference. These
 * are exported to the judge child process so a static brief can name them by
 * convention.
 *
 * @param port - Port wp-env is listening on.
 * @param postId - Numeric ID of the published test post.
 * @param slug - Slug of the activated plugin under evaluation.
 * @returns A record keyed by env-var name:
 *   - `SKILLSMITH_JUDGE_URL` — permalink of the post that renders the block.
 *   - `SKILLSMITH_POST_ID` — that post's numeric ID, as a string.
 *   - `SKILLSMITH_PLUGIN_SLUG` — the activated plugin's slug.
 */
export function judgeEnvVars(
	port: number,
	postId: number,
	slug: string
): Record< ( typeof ENV_VAR_NAMES )[ number ], string > {
	return {
		SKILLSMITH_JUDGE_URL: judgeUrl( port, postId ),
		SKILLSMITH_POST_ID: String( postId ),
		SKILLSMITH_PLUGIN_SLUG: slug,
	};
}

/**
 * Build the `.wp-env.json` describing a single-plugin environment. wp-env
 * loads and (on start) activates exactly the one plugin under evaluation on
 * the fixed port.
 *
 * @param pluginPath - Absolute path to the plugin directory in the judge copy.
 * @param port - Port wp-env should listen on.
 * @returns The `.wp-env.json` object to serialize to disk.
 */
export function wpEnvConfig(
	pluginPath: string,
	port: number
): { plugins: string[]; port: number } {
	return { plugins: [ pluginPath ], port };
}

/**
 * Block markup for the test post. Embedding the scaffolded block as a single
 * self-closing block comment lets WordPress render it server-side and run its
 * Interactivity API view module, so the judge can exercise the produced block
 * live.
 *
 * @returns The post `content` containing the `skillsmith/testing-block` block.
 */
export function testPostContent(): string {
	return `<!-- wp:${ TESTING_BLOCK_NAME } /-->`;
}

/**
 * Run a WP-CLI command inside the running wp-env, capturing stdout. Used to
 * activate the plugin and create the test post (the latter with `--porcelain`
 * so stdout is just the numeric post ID).
 */
function wpCli( args: string[] ): string {
	return execFileSync( 'npx', [ 'wp-env', 'run', 'cli', 'wp', ...args ], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
	} );
}

/**
 * Stand the WordPress environment up for one (scenario, agent) pair and export
 * the runtime facts the judge needs. Built entirely from the **judge copy**
 * (`ctx.judgeWorkspace`) so what the judge verifies is exactly what it sees:
 *
 *   1. Build the produced plugin with `wp-scripts` (emitting `view.asset.php`
 *      so script-module dependencies are declared).
 *   2. Write a single-plugin `.wp-env.json` on port {@link WP_ENV_PORT}.
 *   3. Boot wp-env (`env:start`), which activates the listed plugin.
 *   4. Create and publish a post that renders the block, capturing its ID.
 *   5. Export `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID` /
 *      `SKILLSMITH_PLUGIN_SLUG` for the judge child.
 *
 * The caller (the `beforeJudgeAgent` hook) must pair this with
 * {@link tearDownJudgeEnv}. With `roles.judge.concurrency = 'serial'` the
 * harness holds a run-wide lock across the whole bracket, so only one pair
 * boots wp-env on the shared port at a time.
 *
 * @param ctx - The per-pair agent context; `judgeWorkspace`, `scenario.name`,
 *   and `agent.id` locate the plugin to build and activate.
 */
export function setUpJudgeEnv( ctx: AgentContext ): void {
	const slug = judgePluginSlug( ctx.scenario.name, ctx.agent.id );
	const pluginPath = join( ctx.judgeWorkspace, slug );

	// Build the produced block so `build/blocks/*` (with view.asset.php) is
	// emitted; the scaffold's index.php prefers the build output.
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
			wpEnvConfig( pluginPath, WP_ENV_PORT ),
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

	// `env:start` activates every listed plugin, but activate explicitly so a
	// failure here surfaces rather than silently leaving the block unregistered.
	wpCli( [ 'plugin', 'activate', slug ] );

	const postId = Number(
		wpCli( [
			'post',
			'create',
			'--post_type=post',
			'--post_status=publish',
			'--post_title=Skillsmith judge fixture',
			`--post_content=${ testPostContent() }`,
			'--porcelain',
		] ).trim()
	);
	if ( ! Number.isInteger( postId ) || postId <= 0 ) {
		throw new Error(
			`wp post create did not return a numeric post ID for ${ slug }`
		);
	}

	for ( const [ name, value ] of Object.entries(
		judgeEnvVars( WP_ENV_PORT, postId, slug )
	) ) {
		process.env[ name ] = value;
	}
}

/**
 * Tear the per-pair WordPress environment down: stop wp-env, remove the
 * temporary `.wp-env.json`, and clear the per-pair env vars so they never leak
 * into the next pair's judge. Safe to call even if `env:start` never
 * succeeded — `env:stop` failures are logged, not thrown, so teardown always
 * runs to completion.
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
	for ( const name of ENV_VAR_NAMES ) {
		delete process.env[ name ];
	}
}
