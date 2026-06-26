import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Contract for Task 18: the rewritten `testing-project/skillsmith.config.ts`
 * and its new per-pair WP-env judge helper (`eval/utils/wp-env-judge.ts`).
 *
 * The config and helper live outside `src/`, so they are not covered by the
 * core typecheck; these tests pin the behaviour the `check:config` guardrail
 * only asserts is importable. The config is verified by inspecting its
 * resolved object and source text; the helper's pure builders are imported
 * and exercised directly. The side-effecting boot/teardown orchestrators are
 * not invoked here — they shell out to `wp-env` and are exercised manually
 * per the project's testing posture.
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

test( 'the config wires beforeJudgeAgent/afterJudgeAgent and drops the e2e gate', async () => {
	const config = await loadConfig();
	const hooks = config.hooks as Record< string, unknown >;

	assert.equal(
		typeof hooks.beforeJudgeAgent,
		'function',
		'beforeJudgeAgent stands the env up per pair'
	);
	assert.equal(
		typeof hooks.afterJudgeAgent,
		'function',
		'afterJudgeAgent tears the env down per pair'
	);
	// The testing-agent scaffolding stays.
	assert.equal(
		typeof hooks.beforeTestAgent,
		'function',
		'beforeTestAgent still scaffolds the plugin'
	);
	// The old e2e gate and its import are gone.
	assert.equal(
		hooks.afterAllScenarios,
		undefined,
		'the afterAllScenarios e2e gate is removed'
	);

	const src = configSource();
	assert.ok(
		! /runE2eVerification/.test( src ),
		'the runE2eVerification import is removed'
	);
	assert.ok(
		! /verify-e2e/.test( src ),
		'no reference to the verify-e2e module remains'
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

test( 'judgeUrl builds a localhost permalink for the test post on port 8987', async () => {
	const { judgeUrl } = await loadHelper();
	assert.equal(
		( judgeUrl as ( port: number, postId: number ) => string )(
			8987,
			42
		),
		'http://localhost:8987/?p=42'
	);
} );

test( 'judgeEnvVars exports the three per-pair facts the JUDGE.md briefs reference', async () => {
	const { judgeEnvVars } = await loadHelper();
	const vars = (
		judgeEnvVars as (
			port: number,
			postId: number,
			slug: string
		) => Record< string, string >
	)( 8987, 42, 'plugin-counter-haiku' );
	assert.deepEqual( vars, {
		SKILLSMITH_JUDGE_URL: 'http://localhost:8987/?p=42',
		SKILLSMITH_POST_ID: '42',
		SKILLSMITH_PLUGIN_SLUG: 'plugin-counter-haiku',
	} );
} );

test( 'wpEnvConfig points wp-env at exactly the one judge-copy plugin on the given port', async () => {
	const { wpEnvConfig } = await loadHelper();
	const config = (
		wpEnvConfig as (
			pluginPath: string,
			port: number
		) => Record< string, unknown >
	)( '/judge/plugin-counter-haiku', 8987 );
	assert.deepEqual( config.plugins, [ '/judge/plugin-counter-haiku' ] );
	assert.equal( config.port, 8987 );
} );

test( 'testPostContent embeds the fixed testing-block so the rendered post exercises it', async () => {
	const { testPostContent } = await loadHelper();
	const content = ( testPostContent as () => string )();
	assert.match(
		content,
		/wp:skillsmith\/testing-block/,
		'the post content must contain the scaffolded block'
	);
} );

test( 'judgePluginSlug matches the scaffold slug so the judge copy resolves the right plugin', async () => {
	const { judgePluginSlug } = await loadHelper();
	const { pluginSlug } = ( await import(
		join( TESTING_PROJECT, 'eval', 'utils', 'scaffold-plugin.ts' )
	) ) as { pluginSlug: ( s: string, a: string ) => string };
	assert.equal(
		( judgePluginSlug as ( s: string, a: string ) => string )(
			'counter',
			'haiku'
		),
		pluginSlug( 'counter', 'haiku' ),
		'the helper derives the same slug the scaffold wrote'
	);
} );

test( 'setUpJudgeEnv and tearDownJudgeEnv are exported as the hook orchestrators', async () => {
	const helper = await loadHelper();
	assert.equal(
		typeof helper.setUpJudgeEnv,
		'function',
		'setUpJudgeEnv brings the env up for a pair'
	);
	assert.equal(
		typeof helper.tearDownJudgeEnv,
		'function',
		'tearDownJudgeEnv tears the env down for a pair'
	);
} );
