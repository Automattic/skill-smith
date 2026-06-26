#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The testing-project root, resolved from this script's own location. The
 * wrapper lives at `<PROJECT_ROOT>/eval/utils/judge-wp.mjs`, so the root is two
 * directories up. Resolving from `import.meta.url` (rather than the caller's
 * cwd) is what lets the judge invoke the bridge from any working directory.
 */
const PROJECT_ROOT = resolve(
	dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

/**
 * The warm-env config the judge hooks write. Pinning `wp-env` to it with
 * `--config` keys WP-CLI to the same warm instance regardless of cwd — wp-env
 * identifies an instance by `md5(configFilePath)`, so the absolute path here is
 * what reaches the already-running environment.
 */
const WP_ENV_CONFIG_PATH = join( PROJECT_ROOT, '.wp-env.json' );

// Forward this script's CLI args (everything after the script path) as WP-CLI
// arguments, running them inside the warm wp-env via the bridge command. The
// child inherits stdio so wp-env's stdout/stderr flow straight to the judge,
// and the wrapper exits with wp-env's own status code.
const wpArgs = process.argv.slice( 2 );
const result = spawnSync(
	'npx',
	[
		'wp-env',
		'--config',
		WP_ENV_CONFIG_PATH,
		'run',
		'cli',
		'wp',
		...wpArgs,
	],
	{ stdio: 'inherit' }
);

if ( result.error ) {
	throw result.error;
}

process.exit( result.status ?? 1 );
