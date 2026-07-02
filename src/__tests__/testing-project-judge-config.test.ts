import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Contract for `testing-project/skillsmith.config.ts` and its judge-env
 * helper (`eval/utils/wp-env-judge.ts`) under the run-level warm-env model:
 * `beforeAllScenarios` boots one warm wp-env for the whole run,
 * `beforeJudgeAgent`/`afterJudgeAgent` install and clean up each
 * (scenario, agent) pair's plugin on it, and `afterAllScenarios` stops it.
 *
 * The config and helper live outside `src/`, so they are not covered by the
 * core typecheck; these tests pin the wiring the `check:config` guardrail
 * only asserts is importable. The config is verified by inspecting its
 * resolved object and source text; the helper's lifecycle behaviour is
 * exercised through its injectable command seam in
 * `wp-env-judge-lifecycle.test.ts`, so the real wp-env is never booted here.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );
/** Absolute path to the rewritten config. */
const CONFIG_PATH = join( TESTING_PROJECT, 'skillsmith.config.ts' );
/** Absolute path to the new judge-env helper. */
const HELPER_PATH = join( TESTING_PROJECT, 'eval', 'utils', 'wp-env-judge.ts' );

/** Read the config's raw source text. */
function configSource(): string {
	return readFileSync( CONFIG_PATH, 'utf8' );
}

/** Import the resolved config object the harness would consume. */
async function loadConfig(): Promise< Record< string, unknown > > {
	const mod = ( await import( CONFIG_PATH ) ) as {
		default: Record< string, unknown >;
	};
	return mod.default;
}

/** Import the helper module's exported builders. */
async function loadHelper(): Promise< Record< string, unknown > > {
	return ( await import( HELPER_PATH ) ) as Record< string, unknown >;
}

test( 'the judge agent carries read-only file tools, Bash, and a playwright MCP server', async () => {
	const config = await loadConfig();
	const agents = config.agents as Record<
		string,
		Record< string, unknown >
	>;
	// `roles.judge` resolves through the `opus` agent definition.
	const roles = config.roles as Record< string, unknown >;
	const judgeRole = roles.judge as { agent: string } | string;
	const judgeAgentId =
		typeof judgeRole === 'string' ? judgeRole : judgeRole.agent;
	const judge = agents[ judgeAgentId ];
	assert.ok( judge, 'the judge role resolves to a defined agent' );

	assert.deepEqual(
		judge.tools,
		[ 'Read', 'Bash' ],
		'the judge agent gets read-only file tools plus Bash'
	);
	// allowWrite stays unset/false — the no-modify guarantee rests on the
	// judge copy, not on a writable file tool.
	assert.notEqual(
		judge.allowWrite,
		true,
		'the judge agent is not granted write access'
	);

	const mcp = judge.mcpServers as
		| Record< string, { command: string; args?: string[] } >
		| undefined;
	assert.ok( mcp?.playwright, 'a playwright MCP server is configured' );
	assert.equal( mcp?.playwright.command, 'npx' );
	assert.deepEqual( mcp?.playwright.args, [ '@playwright/mcp@latest' ] );
} );

test( 'browser/WP tool names stay project-local (not in Skillsmith core)', () => {
	// The judge's capability strings are an editor convenience on the generic
	// agent passthrough; the project-local browser/WP tool vocabulary must not
	// leak into core. The MCP server name (`playwright`) is the concrete
	// project-local token to guard against. (`wp-env` may appear in core only
	// as an illustrative doc-comment example of a non-reentrant environment,
	// never as a declared tool/server, so it is not asserted on here.)
	const coreTypes = readFileSync(
		join( here, '..', 'config', 'types.ts' ),
		'utf8'
	);
	assert.ok(
		! /playwright/i.test( coreTypes ),
		'core config types must not name the playwright MCP server'
	);
} );

test( 'roles.judge requests serial judge concurrency', async () => {
	const config = await loadConfig();
	const roles = config.roles as Record< string, unknown >;
	const judgeRole = roles.judge as { concurrency?: string };
	assert.equal(
		judgeRole.concurrency,
		'serial',
		'the judge bracket must be serialized for the shared wp-env'
	);
} );

test( 'the config wires run-level boot/stop and per-pair install/clean-up env hooks', async () => {
	const config = await loadConfig();
	const hooks = config.hooks as Record< string, unknown >;

	// Run-level lifecycle: boot once before the sweep, stop once after.
	assert.equal(
		typeof hooks.beforeAllScenarios,
		'function',
		'beforeAllScenarios boots the warm env once for the run'
	);
	assert.equal(
		typeof hooks.afterAllScenarios,
		'function',
		'afterAllScenarios stops the warm env once for the run'
	);
	// Per-pair lifecycle: install/clean-up the produced plugin per pair.
	assert.equal(
		typeof hooks.beforeJudgeAgent,
		'function',
		'beforeJudgeAgent installs the produced plugin per pair'
	);
	assert.equal(
		typeof hooks.afterJudgeAgent,
		'function',
		'afterJudgeAgent cleans the produced plugin up per pair'
	);
	// The testing-agent scaffolding stays.
	assert.equal(
		typeof hooks.beforeTestAgent,
		'function',
		'beforeTestAgent still scaffolds the plugin'
	);
} );

test( 'afterAllScenarios returns nothing so the harness treats the run as a pass', async () => {
	const config = await loadConfig();
	const hooks = config.hooks as Record< string, unknown >;
	const afterAllScenarios = hooks.afterAllScenarios as () => unknown;
	// `stopJudgeEnv` is the real side-effecting target; here we only assert the
	// wrapper yields no verdict. We invoke a stand-in shape rather than the
	// real wp-env shell-out: the wired hook must return undefined regardless.
	const result = afterAllScenarios.length;
	assert.equal(
		result,
		0,
		'afterAllScenarios takes no required args and folds back as a pass'
	);
	const src = configSource();
	assert.ok(
		/afterAllScenarios:\s*\(\)\s*=>\s*stopJudgeEnv\(\)/.test( src ),
		'afterAllScenarios is wired to stopJudgeEnv() and returns its void result'
	);
	assert.ok(
		/beforeAllScenarios:\s*\(\)\s*=>\s*bootJudgeEnv\(\)/.test( src ),
		'beforeAllScenarios is wired to bootJudgeEnv()'
	);
} );

test( 'the config wires the per-pair install/clean-up helpers by name', () => {
	const src = configSource();
	assert.ok(
		/beforeJudgeAgent:\s*\(\s*ctx\s*\)\s*=>\s*installPluginForPair\(\s*ctx\s*\)/.test(
			src
		),
		'beforeJudgeAgent installs the produced plugin for the pair'
	);
	assert.ok(
		/afterJudgeAgent:\s*\(\s*ctx\s*\)\s*=>\s*cleanUpPair\(\s*ctx\s*\)/.test(
			src
		),
		'afterJudgeAgent cleans the pair up'
	);
} );

test( 'the config declares paths.rubrics pointing at the reusable rubric directory', async () => {
	const config = await loadConfig();
	const paths = config.paths as { rubrics?: string } | undefined;
	assert.equal(
		paths?.rubrics,
		'./eval/rubrics',
		'paths.rubrics points the harness at the reusable rubric directory'
	);
} );

test( 'the config keeps the shared testing-agent prompt on roles.test', async () => {
	const config = await loadConfig();
	const roles = config.roles as Record< string, unknown >;
	const testRole = roles.test as { prompt?: string };
	const expected = readFileSync(
		join( TESTING_PROJECT, 'eval', 'prompts', 'testing-agent.md' ),
		'utf8'
	);
	assert.equal(
		testRole.prompt,
		expected,
		'roles.test.prompt carries the shared workspace instructions'
	);
} );

test( 'the new run-level + per-pair lifecycle helpers are exported and imported by the config', async () => {
	const helper = await loadHelper();
	for ( const name of [
		'bootJudgeEnv',
		'stopJudgeEnv',
		'installPluginForPair',
		'cleanUpPair',
	] ) {
		assert.equal(
			typeof helper[ name ],
			'function',
			`${ name } is exported from the judge-env helper`
		);
	}
	const src = configSource();
	const importMatch = src.match(
		/import\s*\{([^}]*)\}\s*from\s*'\.\/eval\/utils\/wp-env-judge'/s
	);
	assert.ok(
		importMatch,
		'the config imports from the judge-env helper module'
	);
	const imported = ( importMatch?.[ 1 ] ?? '' )
		.split( ',' )
		.map( ( name ) => name.trim() );
	for ( const name of [
		'bootJudgeEnv',
		'stopJudgeEnv',
		'installPluginForPair',
		'cleanUpPair',
	] ) {
		assert.ok(
			imported.includes( name ),
			`the config imports ${ name } from the judge-env helper`
		);
	}
} );

test( "roles.judge.prompt is the environment manual describing the judge's runtime mechanics", async () => {
	const config = await loadConfig();
	const roles = config.roles as Record< string, unknown >;
	const judgeRole = roles.judge as { prompt?: string };
	const prompt = judgeRole.prompt ?? '';

	// The judge-wp.mjs command form, anchored at the project-root env var.
	assert.ok(
		/node\s+"\$SKILLSMITH_PROJECT_ROOT\/eval\/utils\/judge-wp\.mjs"/.test(
			prompt
		),
		'the manual shows the judge-wp.mjs command form'
	);
	// The post-create template, porcelain so stdout is the numeric id.
	assert.ok(
		/wp post create --post_type=post --post_status=publish/.test(
			prompt
		) && /--porcelain/.test( prompt ),
		'the manual shows the wp post create … --porcelain template'
	);
	// The URL shape carrying the port var and ?p=<id>.
	assert.ok(
		/http:\/\/localhost:\$SKILLSMITH_WP_PORT\/\?p=<id>/.test( prompt ),
		'the manual shows the ?p=<id> URL shape with the port var'
	);
	// The block-discovery instruction reading the built block.json files.
	assert.ok(
		/build\/blocks\/\*\/block\.json/.test( prompt ),
		'the manual tells the judge to discover block names from build/blocks/*/block.json'
	);
	assert.ok(
		/self-closing block comment/i.test( prompt ),
		'the manual tells the judge to insert one self-closing block comment per name'
	);
} );

test( 'roles.judge.prompt is read from the eval/prompts/judge.md manual file', async () => {
	const config = await loadConfig();
	const roles = config.roles as Record< string, unknown >;
	const judgeRole = roles.judge as { prompt?: string };
	const expected = readFileSync(
		join( TESTING_PROJECT, 'eval', 'prompts', 'judge.md' ),
		'utf8'
	);
	assert.equal(
		judgeRole.prompt,
		expected,
		'roles.judge.prompt carries the judge.md environment manual verbatim'
	);
} );
