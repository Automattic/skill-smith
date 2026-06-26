import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Paths } from '../config/types';
import { enumerateScenarios } from '../scenarios/enumerate';

/**
 * Conversion contract for the bundled `testing-project` scenarios.
 *
 * All 11 scenarios use the two-file model (`TESTING-AGENT.md` +
 * `JUDGE.md`) rather than the legacy structured model (`scenario.yaml` +
 * Playwright `e2e.spec.mjs`). Each `JUDGE.md` references the shared
 * best-practices rubric by id (a `# Rubrics` section listing
 * `wp-interactivity-api-best-practices`) instead of inlining its text,
 * and describes judge-driven human-language setup rather than the
 * removed per-post env-var bridge. These tests assert that contract for
 * the on-disk scenarios — discovery cleanliness, prompt preservation,
 * and the judge-brief content contract.
 */

const here = dirname( fileURLToPath( import.meta.url ) );
/** Absolute root of the bundled testing-project. */
const TESTING_PROJECT = join( here, '..', '..', 'testing-project' );
/** Paths mirroring the testing-project's on-disk layout. */
const PATHS: Paths = {
	base: '.',
	scenarios: 'eval/scenarios',
	skills: 'skills',
};

/** The 11 scenario ids the testing-project ships. */
const SCENARIO_IDS = [
	'async-fetch',
	'config-fetch',
	'counter',
	'derived-double',
	'focus-trap-menu',
	'fruit-list-each',
	'independent-counters',
	'minimal-scaffold',
	'paginated-list',
	'shared-state',
	'toggle-visibility',
] as const;

/** Absolute path to a scenario directory by id. */
function scenarioDir( id: string ): string {
	return join( TESTING_PROJECT, 'eval', 'scenarios', id );
}

/** Read a scenario file's contents. */
function readScenarioFile( id: string, file: string ): string {
	return readFileSync( join( scenarioDir( id ), file ), 'utf8' );
}

/**
 * A distinctive sentence from the shared best-practices rubric. A
 * `JUDGE.md` that references the rubric by id must NOT contain this
 * sentence — its absence proves the rubric text was not inlined.
 */
const RUBRIC_SENTINEL =
	'`block.json` declares the view module as `viewScriptModule` (NOT `viewScript`).';

/** The rubric id every converted `JUDGE.md` references in its `# Rubrics` section. */
const RUBRIC_ID = 'wp-interactivity-api-best-practices';

/**
 * Per-scenario anchors. `prompt` is a verbatim fragment of the original
 * `scenario.yaml` prompt that the `TESTING-AGENT.md` must preserve.
 * `liveChecks` are fragments derived from the deleted `e2e.spec.mjs`
 * that the plain-language judge checks must cover.
 */
const ANCHORS: Record<
	string,
	{ prompt: string; liveChecks: string[] }
> = {
	'async-fetch': {
		prompt: 'fetches a joke from a remote',
		liveChecks: [ 'Fetch joke', 'empty' ],
	},
	'config-fetch': {
		prompt: 'loads a post from the',
		liveChecks: [ 'Load post', '(no post loaded yet)' ],
	},
	counter: {
		prompt: 'starts at 5',
		liveChecks: [ '5', 'Increment', 'Decrement' ],
	},
	'derived-double': {
		prompt: 'always exactly double the counter',
		liveChecks: [ '1', '2', 'Increment' ],
	},
	'focus-trap-menu': {
		prompt: 'accessible hamburger',
		liveChecks: [ 'Menu', 'Escape', 'Home', 'About', 'Contact' ],
	},
	'fruit-list-each': {
		prompt: 'list of fruits',
		liveChecks: [ 'Apple', 'Banana', 'Cherry', 'Add Mango' ],
	},
	'independent-counters': {
		prompt: 'each one needs to keep its own count',
		liveChecks: [ 'Increment', 'independent' ],
	},
	'minimal-scaffold': {
		prompt: 'Hello from iAPI',
		liveChecks: [ 'Hello from iAPI', 'iapi-ready' ],
	},
	'paginated-list': {
		prompt: 'paginated list',
		liveChecks: [ 'Next', 'Previous', 'pg=2' ],
	},
	'shared-state': {
		prompt: 'shared tally',
		liveChecks: [ 'Increment', 'every instance' ],
	},
	'toggle-visibility': {
		prompt: 'expandable note',
		liveChecks: [ 'aria-expanded', 'hidden' ],
	},
};

test( 'every scenario has both two-file briefs and no legacy files', () => {
	for ( const id of SCENARIO_IDS ) {
		const dir = scenarioDir( id );
		assert.ok(
			existsSync( join( dir, 'TESTING-AGENT.md' ) ),
			`${ id } is missing TESTING-AGENT.md`
		);
		assert.ok(
			existsSync( join( dir, 'JUDGE.md' ) ),
			`${ id } is missing JUDGE.md`
		);
		assert.ok(
			! existsSync( join( dir, 'scenario.yaml' ) ),
			`${ id } still has a scenario.yaml`
		);
		assert.ok(
			! existsSync( join( dir, 'e2e.spec.mjs' ) ),
			`${ id } still has an e2e.spec.mjs`
		);
	}
} );

test( 'all 11 scenarios enumerate cleanly with the wp-interactivity-api skill', () => {
	const found = enumerateScenarios( PATHS, TESTING_PROJECT );
	const byId = new Map( found.map( ( entry ) => [ entry.id, entry ] ) );

	for ( const id of SCENARIO_IDS ) {
		const entry = byId.get( id );
		assert.ok( entry, `${ id } was not discovered` );
		assert.equal(
			entry?.error,
			undefined,
			`${ id } enumerated with an error: ${ entry?.error }`
		);
		assert.deepEqual(
			entry?.scenario.skills,
			[ 'wp-interactivity-api' ],
			`${ id } does not list the wp-interactivity-api skill`
		);
	}
} );

test( 'the anchors cover exactly the shipped scenario set', () => {
	assert.deepEqual(
		Object.keys( ANCHORS ).sort(),
		[ ...SCENARIO_IDS ].sort()
	);
} );

test( 'each TESTING-AGENT.md preserves the prompt and has a Skills section', () => {
	for ( const [ id, anchor ] of Object.entries( ANCHORS ) ) {
		const brief = readScenarioFile( id, 'TESTING-AGENT.md' );
		assert.match(
			brief,
			/^#+\s+Skills$/im,
			`${ id } TESTING-AGENT.md has no # Skills heading`
		);
		assert.ok(
			brief.includes( anchor.prompt ),
			`${ id } TESTING-AGENT.md does not preserve the prompt text`
		);
		// Shared workspace/scaffold instructions live in roles.test.prompt;
		// they must not be duplicated into the per-scenario brief.
		assert.ok(
			! brief.includes( 'get_block_wrapper_attributes' ),
			`${ id } TESTING-AGENT.md duplicates the shared scaffold instructions`
		);
	}
} );

test( 'each JUDGE.md references the rubric by id, drops the removed env vars, and keeps live checks', () => {
	for ( const [ id, anchor ] of Object.entries( ANCHORS ) ) {
		const brief = readScenarioFile( id, 'JUDGE.md' );

		// The rubric is referenced by id, not stamped in. A `# Rubrics`
		// section lists the shared rubric id; the inlined rubric text
		// (the sentinel sentence) must NOT appear in the brief.
		assert.match(
			brief,
			/^#+\s+Rubrics$/im,
			`${ id } JUDGE.md has no # Rubrics heading`
		);
		assert.match(
			brief,
			new RegExp( `^\\s*-\\s+${ RUBRIC_ID }\\s*$`, 'm' ),
			`${ id } JUDGE.md does not list the ${ RUBRIC_ID } rubric id`
		);
		assert.ok(
			! brief.includes( RUBRIC_SENTINEL ),
			`${ id } JUDGE.md still inlines the shared rubric text`
		);

		// The removed bridge env vars must no longer be named; only
		// retained bridge facts (the plugin slug) may appear.
		for ( const removed of [
			'$SKILLSMITH_JUDGE_URL',
			'$SKILLSMITH_POST_ID',
		] ) {
			assert.ok(
				! brief.includes( removed ),
				`${ id } JUDGE.md still names the removed ${ removed } env var`
			);
		}
		assert.ok(
			brief.includes( '$SKILLSMITH_PLUGIN_SLUG' ),
			`${ id } JUDGE.md does not reference the retained $SKILLSMITH_PLUGIN_SLUG bridge fact`
		);

		// Plain-language live checks derived from the old e2e spec.
		for ( const fragment of anchor.liveChecks ) {
			assert.ok(
				brief.includes( fragment ),
				`${ id } JUDGE.md is missing a live check covering "${ fragment }"`
			);
		}

		// The harness appends the { pass, notes } instruction; the brief
		// must not pre-state it.
		assert.ok(
			! /\{\s*["']?pass["']?/.test( brief ),
			`${ id } JUDGE.md should not include the JSON output instruction`
		);
	}
} );

test( '_candidates.yaml no longer documents the legacy scenario.yaml / rubrics shape', () => {
	const candidates = readFileSync(
		join( TESTING_PROJECT, 'eval', 'scenarios', '_candidates.yaml' ),
		'utf8'
	);
	// The header comment must not advertise the old per-scenario file shape
	// or the removed `rubrics:` key.
	assert.ok(
		! /scenario\.yaml/.test( candidates ),
		'_candidates.yaml still references the old scenario.yaml shape'
	);
	assert.ok(
		! /`rubrics:`|rubrics:` keys?|minus the[\s\S]*rubrics/.test(
			candidates
		),
		'_candidates.yaml still documents the removed rubrics: key'
	);
} );
