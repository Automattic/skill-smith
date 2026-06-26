import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(
	dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

/**
 * The warm-env config the judge hooks write. Pinning `wp-env` to it with
 * `--config` makes every WP-CLI call resolve the same environment regardless of
 * the current working directory.
 */
const WP_ENV_CONFIG_PATH = join( PROJECT_ROOT, '.wp-env.json' );

/**
 * Run a WP-CLI command inside the warm wp-env, capturing stdout. Pinned to the
 * warm-env config with `--config` for cwd-robustness.
 *
 * @param {string[]} args - WP-CLI arguments appended after `wp`.
 * @param {{ stdio?: import('node:child_process').StdioOptions }} [options] -
 *   Overrides; `stdio` defaults to `'inherit'`.
 * @returns {string} The command's stdout, decoded as UTF-8.
 */
export function wpCli( args, options = {} ) {
	return execFileSync(
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
			stdio: options.stdio ?? 'inherit',
			encoding: 'utf8',
		}
	);
}

export function deactivateAllPlugins() {
	try {
		wpCli( [ 'plugin', 'deactivate', '--all', '--quiet' ], {
			stdio: 'pipe',
		} );
	} catch ( err ) {
		if ( err.stdout ) process.stdout.write( err.stdout );
		if ( err.stderr ) process.stderr.write( err.stderr );
		throw err;
	}
}
