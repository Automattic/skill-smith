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
