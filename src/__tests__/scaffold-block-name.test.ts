import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Contract for Task 13: the scaffold no longer pins the block name and the
 * testing-agent prompt no longer forbids renaming/restructuring the block.
 *
 * The scaffold and prompt live under the bundled `testing-project/`, outside
 * `src/`, so they are not covered by the core typecheck; these tests pin the
 * behaviour by importing the scaffold's pure builders and exercising them on a
 * throwaway workspace, and by inspecting the prompt's source text.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );
/** Absolute path to the scaffold module. */
const SCAFFOLD_PATH = join(
	TESTING_PROJECT,
	'eval',
	'utils',
	'scaffold-plugin.ts'
);
/** Absolute path to the shared testing-agent prompt. */
const PROMPT_PATH = join(
	TESTING_PROJECT,
	'eval',
	'prompts',
	'testing-agent.md'
);

/** Import the scaffold's exported builders. */
async function loadScaffold(): Promise< {
	scaffoldPlugin: (
		agentWorkspace: string,
		scenarioName: string,
		agentId: string
	) => void;
	pluginSlug: ( scenarioName: string, agentId: string ) => string;
} > {
	return ( await import( SCAFFOLD_PATH ) ) as {
		scaffoldPlugin: (
			agentWorkspace: string,
			scenarioName: string,
			agentId: string
		) => void;
		pluginSlug: ( scenarioName: string, agentId: string ) => string;
	};
}

/** Read the scaffold's raw source text. */
function scaffoldSource(): string {
	return readFileSync( SCAFFOLD_PATH, 'utf8' );
}

/** Read the testing-agent prompt's raw source text. */
function promptSource(): string {
	return readFileSync( PROMPT_PATH, 'utf8' );
}

/**
 * Scaffold a plugin into a throwaway workspace and return the parsed
 * `block.json`, the raw `index.php`, the parsed `package.json`, and the slug.
 */
async function scaffoldInto(
	scenarioName: string,
	agentId: string
): Promise< {
	slug: string;
	blockJson: Record< string, unknown >;
	indexPhp: string;
	packageJson: Record< string, unknown >;
} > {
	const { scaffoldPlugin, pluginSlug } = await loadScaffold();
	const workspace = mkdtempSync( join( tmpdir(), 'scaffold-block-name-' ) );
	scaffoldPlugin( workspace, scenarioName, agentId );
	const slug = pluginSlug( scenarioName, agentId );
	const pluginDir = join( workspace, slug );
	const blockJson = JSON.parse(
		readFileSync(
			join( pluginDir, 'src', 'blocks', 'testing-block', 'block.json' ),
			'utf8'
		)
	) as Record< string, unknown >;
	const indexPhp = readFileSync( join( pluginDir, 'index.php' ), 'utf8' );
	const packageJson = JSON.parse(
		readFileSync( join( pluginDir, 'package.json' ), 'utf8' )
	) as Record< string, unknown >;
	return { slug, blockJson, indexPhp, packageJson };
}

test( "the scaffolded block.json no longer pins skillsmith/testing-block", async () => {
	const { blockJson } = await scaffoldInto( 'counter', 'haiku' );
	assert.notEqual(
		blockJson.name,
		'skillsmith/testing-block',
		'the starter block name must not be the previously pinned name'
	);
} );

test( 'the scaffold source no longer hard-codes the skillsmith/testing-block name', () => {
	const src = scaffoldSource();
	assert.ok(
		! src.includes( 'skillsmith/testing-block' ),
		'the pinned block name must be gone from the scaffold source'
	);
} );

test( "the scaffold's doc comment no longer claims the block name is fixed", () => {
	const src = scaffoldSource();
	assert.ok(
		! /block name is fixed/i.test( src ),
		'the doc comment must not say the block name is fixed'
	);
} );

test( 'the plugin slug stays deterministic and name-agnostic registration is kept', async () => {
	const { slug, indexPhp, packageJson } = await scaffoldInto(
		'counter',
		'haiku'
	);
	assert.equal(
		slug,
		'plugin-counter-haiku',
		'the slug is plugin-<scenario>-<agent>'
	);
	assert.equal(
		packageJson.name,
		slug,
		'package.json keeps the deterministic slug name'
	);
	// Registers any built block dir by globbing, not a single hard-coded name.
	assert.ok(
		indexPhp.includes( '/build/blocks' ) &&
			indexPhp.includes( '/src/blocks' ),
		'index.php globs build/blocks then src/blocks'
	);
	assert.ok(
		indexPhp.includes( 'register_block_type' ),
		'index.php registers discovered block dirs'
	);
	assert.ok(
		! indexPhp.includes( 'skillsmith/testing-block' ),
		'index.php must not reference the pinned block name'
	);
	// The plugin slug itself stays non-renameable.
	assert.ok(
		/do not rename/i.test( indexPhp ),
		'index.php still tells the agent not to rename the plugin slug'
	);
} );

test( "index.php's do-not-rename wording targets the plugin slug, not a block name", async () => {
	const { indexPhp } = await scaffoldInto( 'counter', 'haiku' );
	// The do-not-rename guidance must be about the plugin slug; it must not
	// imply a pinned block name.
	assert.ok(
		/slug/i.test( indexPhp ),
		'the do-not-rename guidance references the plugin slug'
	);
	assert.ok(
		! /block name/i.test( indexPhp ),
		'index.php must not imply a pinned block name'
	);
} );

test( 'the testing-agent prompt no longer forbids renaming or restructuring the block', () => {
	const src = promptSource();
	assert.ok(
		! /do not change the block name/i.test( src ),
		'the prompt must not forbid changing the block name'
	);
	assert.ok(
		! src.includes( '`skillsmith/testing-block`' ),
		'the prompt must not name a pinned block'
	);
	assert.ok(
		! /do not change the block name or registration mechanism/i.test(
			src
		),
		'the prompt must not forbid changing the registration mechanism'
	);
} );

test( 'the testing-agent prompt still forbids creating a new plugin or renaming the slug', () => {
	const src = promptSource();
	assert.ok(
		/do not create a new plugin/i.test( src ),
		'the prompt still forbids creating a new plugin'
	);
	assert.ok(
		/slug/i.test( src ),
		'the prompt still references preserving the plugin slug'
	);
} );

test( 'the testing-agent prompt retains the get_block_wrapper_attributes guidance', () => {
	const src = promptSource();
	assert.ok(
		src.includes( 'get_block_wrapper_attributes()' ),
		'the get_block_wrapper_attributes() guidance is retained'
	);
} );
