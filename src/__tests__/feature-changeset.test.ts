import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateChangesetFile } from '../../scripts/validate-changesets';

/**
 * Absolute path to the repository's `.changeset/` directory.
 *
 * Resolved from this test file's URL (`src/__tests__/` → `../../.changeset`)
 * so the assertions run against the committed changesets rather than a
 * fixture, locking the consolidated feature changeset's shape into CI.
 */
const CHANGESET_DIR = fileURLToPath(
	new URL( '../../.changeset', import.meta.url )
);

const PKG_NAME = '@automattic/skillsmith';

/**
 * Filename of the single, consolidated feature changeset for the
 * flexible-scenarios + judge-verification line of work. Pinned so the
 * content assertions read the exact note that ships, not merely "the one
 * remaining feature changeset".
 */
const FEATURE_CHANGESET = 'flexible-scenarios-judge-verification.md';

/**
 * The four pre-existing, unrelated changesets that must survive the
 * consolidation untouched. They belong to earlier, already-shipped work and
 * are explicitly out of scope for this feature's single changeset.
 */
const UNRELATED_CHANGESETS = [
	'claude-code-subscription-auth.md',
	'initial-scaffolding.md',
	'nested-scenario-folders.md',
	'wordpress-coding-standards.md',
];

/**
 * Parse a changeset's leading YAML front-matter `"<pkg>": <bump>` line.
 *
 * @param raw - Full changeset file contents.
 * @returns The bump string for {@link PKG_NAME}, or `undefined` if absent.
 */
function frontMatterBump( raw: string ): string | undefined {
	const match = raw.match(
		/^---\r?\n([\s\S]*?)\r?\n---\r?\n/
	);
	const fm = match?.[ 1 ];
	if ( fm === undefined ) {
		return undefined;
	}
	const line = fm
		.split( /\r?\n/ )
		.find( ( l ) => l.includes( PKG_NAME ) );
	return line?.split( ':' ).slice( 1 ).join( ':' ).trim();
}

/**
 * Return the changeset body (everything after the closing front-matter
 * fence), trimmed of surrounding whitespace.
 *
 * @param raw - Full changeset file contents.
 */
function changesetBody( raw: string ): string {
	const match = raw.match( /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/ );
	return ( match?.[ 1 ] ?? '' ).trim();
}

test( 'the consolidated judge-workspace-isolation changeset is removed', () => {
	assert.equal(
		existsSync( path.join( CHANGESET_DIR, 'judge-workspace-isolation.md' ) ),
		false,
		'judge-workspace-isolation.md must be folded into the single feature changeset'
	);
} );

test( 'the four unrelated changesets remain', () => {
	for ( const name of UNRELATED_CHANGESETS ) {
		assert.ok(
			existsSync( path.join( CHANGESET_DIR, name ) ),
			`expected unrelated changeset ${ name } to remain untouched`
		);
	}
} );

test( 'exactly one new feature changeset exists with minor + BREAKING summary', () => {
	const featureFiles = readdirSync( CHANGESET_DIR ).filter(
		( name ) =>
			name.endsWith( '.md' ) &&
			name !== 'README.md' &&
			! UNRELATED_CHANGESETS.includes( name )
	);

	assert.equal(
		featureFiles.length,
		1,
		`expected exactly one new feature changeset; got ${ JSON.stringify(
			featureFiles
		) }`
	);

	const featureFile = featureFiles[ 0 ];
	assert.ok( featureFile, 'expected a feature changeset filename' );

	const raw = readFileSync(
		path.join( CHANGESET_DIR, featureFile ),
		'utf8'
	);

	assert.equal(
		frontMatterBump( raw ),
		'minor',
		'feature changeset must declare a "minor" bump'
	);

	const body = changesetBody( raw );
	assert.ok(
		body.startsWith( 'BREAKING:' ),
		`feature changeset summary must start with "BREAKING:"; got ${ JSON.stringify(
			body.slice( 0, 40 )
		) }`
	);
} );

test( 'the feature changeset describes the final natural-language-rubric + auto-supplied-skill-agnostic-task model', () => {
	const raw = readFileSync(
		path.join( CHANGESET_DIR, FEATURE_CHANGESET ),
		'utf8'
	);
	const body = changesetBody( raw );

	// Natural-language rubric selection: the author names the rubric in prose;
	// Skillsmith loads every rubric and lets the prose pick which apply.
	assert.match(
		body,
		/natural[ -]?language/i,
		'body must state that scenario authors name the rubric in natural-language prose'
	);
	assert.match(
		body,
		/\ball\b[\s\S]*rubrics|every rubric|all rubrics/i,
		'body must state that Skillsmith loads all rubrics and the prose selects which apply'
	);

	// Auto-supplied, skill-agnostic task: the judge receives the testing task
	// with its `# Skills` section removed on every run.
	assert.match(
		body,
		/# ?Skills/,
		"body must mention that the testing task's `# Skills` section is removed"
	);
	assert.match(
		body,
		/skill-agnostic|skill agnostic/i,
		'body must state the judge is kept skill-agnostic'
	);

	// The final surface: the `Scenario` type no longer carries a `rubrics`
	// field, and `paths.rubrics` stays optional with no default / existence gate.
	assert.match(
		body,
		/`?Scenario`?[\s\S]*rubrics/i,
		'body must state the Scenario type no longer carries a rubrics field'
	);

	// Verdict is unchanged.
	assert.match(
		body,
		/\{ ?pass, ?notes ?\}/,
		'body must state the verdict stays { pass, notes }'
	);
} );

test( 'the feature changeset does not describe the rubric-by-id `# Rubrics` model as shipped behavior', () => {
	const raw = readFileSync(
		path.join( CHANGESET_DIR, FEATURE_CHANGESET ),
		'utf8'
	);
	const body = changesetBody( raw );

	// The reversed review-1 model must not be presented as current behavior:
	// no author-authored `# Rubrics` id-section, no `Scenario.rubrics`
	// regaining a list of ids, no id-resolved injection. These assertions
	// target the *affirmative* review-1 phrasings; the body may (and does)
	// mention `# Rubrics`/`rubric ids` only to state their absence, which is
	// part of describing the final model.
	assert.doesNotMatch(
		body,
		/reference[s]? (?:reusable )?rubrics by id|resolved from the (?:optional )?`?paths\.rubrics`?/i,
		'body must not describe id-resolved rubric injection as shipped behavior'
	);
	assert.doesNotMatch(
		body,
		/regains an optional `?rubrics`?|a list of rubric ids referenced from/i,
		'body must not describe the Scenario type regaining a rubrics field'
	);
	assert.doesNotMatch(
		body,
		/each id is resolved|the rubric body is injected/i,
		'body must not describe per-id rubric resolution as shipped behavior'
	);
} );

test( 'every committed changeset passes the validator (no major bump)', () => {
	const files = readdirSync( CHANGESET_DIR ).filter(
		( name ) => name.endsWith( '.md' ) && name !== 'README.md'
	);
	for ( const file of files ) {
		const raw = readFileSync( path.join( CHANGESET_DIR, file ), 'utf8' );
		const errors = validateChangesetFile( file, raw, PKG_NAME, '0.1.0' );
		assert.deepEqual(
			errors,
			[],
			`${ file } must be a valid changeset; got ${ JSON.stringify(
				errors
			) }`
		);
	}
} );
