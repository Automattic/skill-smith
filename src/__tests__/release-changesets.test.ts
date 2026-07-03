import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateChangesetFile } from '../../scripts/validate-changesets';

/**
 * Absolute path to the repository's live `.changeset/` directory, resolved
 * from this test file so the assertions read the same files the release
 * workflow consumes. These tests pin the *shipping release record* produced
 * by the "update the stale feature changeset, add the breaking-wave and
 * `judging` changesets" task — not the validator logic (covered by
 * `validate-changesets.test.ts`).
 */
const CHANGESET_DIR = fileURLToPath(
	new URL( '../../.changeset', import.meta.url )
);

const PKG_NAME = '@automattic/skillsmith';

/**
 * The current package version. `0.x` means pre-1.0, so `major` is forbidden
 * and breaking changes must ship as `minor` with a `BREAKING:` summary prefix.
 */
const PKG_VERSION = ( () => {
	const pkg = JSON.parse(
		readFileSync(
			fileURLToPath( new URL( '../../package.json', import.meta.url ) ),
			'utf8'
		)
	) as { version: string };
	return pkg.version;
} )();

/**
 * One changeset file read off disk: its filename, raw contents, the parsed
 * bump for `@automattic/skillsmith` (or `undefined` for the fenceless empty
 * form), and the body text below the front matter.
 */
interface ChangesetFile {
	name: string;
	raw: string;
	bump: string | undefined;
	body: string;
}

/**
 * Read every real changeset (`.changeset/*.md` except `README.md`) and parse
 * out each file's bump type and body. The parse mirrors the validator's fence
 * split closely enough to classify records for these assertions; the
 * validator itself is exercised separately below.
 *
 * @returns One {@link ChangesetFile} per shipping changeset.
 */
function readChangesets(): ChangesetFile[] {
	return readdirSync( CHANGESET_DIR )
		.filter( ( n ) => n.endsWith( '.md' ) && n !== 'README.md' )
		.map( ( name ) => {
			const raw = readFileSync( `${ CHANGESET_DIR }/${ name }`, 'utf8' );
			const match = raw.match(
				/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/
			);
			const fm = match?.[ 1 ] ?? '';
			const body = match?.[ 2 ] ?? '';
			const bumpMatch = fm.match(
				/"@automattic\/skillsmith"\s*:\s*(\w+)/
			);
			return { name, raw, bump: bumpMatch?.[ 1 ], body };
		} );
}

/**
 * A breaking changeset is a `minor` record whose body's first non-empty line
 * opens with the `BREAKING:` summary prefix (the pre-1.0 substitute for a
 * `major` bump).
 *
 * @param c - The changeset to classify.
 * @returns `true` when the record is a `minor` `BREAKING:` changeset.
 */
function isBreaking( c: ChangesetFile ): boolean {
	if ( c.bump !== 'minor' ) return false;
	const firstLine = c.body.trim().split( /\r?\n/ )[ 0 ] ?? '';
	return firstLine.startsWith( 'BREAKING:' );
}

test( 'validator passes over every shipping changeset', () => {
	const errors = readChangesets().flatMap( ( c ) =>
		validateChangesetFile( c.name, c.raw, PKG_NAME, PKG_VERSION )
	);
	assert.deepEqual(
		errors,
		[],
		`validator reported errors: ${ JSON.stringify( errors ) }`
	);
} );

test( 'no changeset uses a major bump', () => {
	const majors = readChangesets().filter( ( c ) => c.bump === 'major' );
	assert.deepEqual(
		majors.map( ( c ) => c.name ),
		[],
		'major bumps are forbidden pre-1.0'
	);
} );

test( 'both breaking records are minor with a BREAKING: summary prefix', () => {
	const changesets = readChangesets();
	const breaking = changesets.filter( isBreaking );
	assert.equal(
		breaking.length,
		2,
		`expected exactly two minor BREAKING: changesets; got ${ breaking
			.map( ( c ) => c.name )
			.join( ', ' ) }`
	);
	// Every changeset whose body opens with BREAKING: must be minor (never a
	// stray patch/major that skipped the pre-1.0 substitution).
	for ( const c of changesets ) {
		const opensBreaking = ( c.body.trim().split( /\r?\n/ )[ 0 ] ?? '' )
			.startsWith( 'BREAKING:' );
		if ( opensBreaking ) {
			assert.equal(
				c.bump,
				'minor',
				`${ c.name } opens with BREAKING: but is not a minor bump`
			);
		}
	}
} );

test( 'no changeset presents the load-all rubric model or the removed keys as current behavior', () => {
	// Consistency guard: the retired load-all model must be described nowhere.
	// Any changeset mentioning `paths.rubrics`, `loads all rubrics`, or
	// `all rubrics` may do so only to describe those keys as *removed*.
	const offenders: string[] = [];
	for ( const c of readChangesets() ) {
		const lines = c.body.split( /\r?\n/ );
		for ( const line of lines ) {
			const mentionsRemoved =
				/paths\.rubrics/.test( line ) ||
				/loads all rubrics/i.test( line ) ||
				/all rubrics/i.test( line );
			if ( ! mentionsRemoved ) continue;
			// The mention is only allowed when the same line frames the key
			// as removed / gone / no longer supported.
			const framedAsRemoved = /remov|reject|gone|no longer/i.test(
				line
			);
			if ( ! framedAsRemoved ) {
				offenders.push( `${ c.name }: ${ line.trim() }` );
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`changeset lines present the load-all model as current behavior:\n${ offenders.join(
			'\n'
		) }`
	);
} );

test( 'the judging changeset states the presence rule', () => {
	const judging = readChangesets().find(
		( c ) => /`judging`/.test( c.body ) && ! isBreaking( c )
	);
	assert.ok(
		judging,
		'expected a non-breaking changeset describing the `judging` report block'
	);
	// `judging` present iff the judge phase ran (omitted when testing failed).
	assert.match(
		judging.body,
		/judge phase ran/i,
		'judging changeset must state that `judging` is present iff the judge phase ran'
	);
	assert.match(
		judging.body,
		/testing failed/i,
		'judging changeset must state that `judging` is omitted when testing failed'
	);
	// `tokenUsage` present iff the provider reported usage.
	assert.match(
		judging.body,
		/tokenUsage/,
		'judging changeset must name the `tokenUsage` field'
	);
	assert.match(
		judging.body,
		/reported usage/i,
		'judging changeset must state that `tokenUsage` is present iff the provider reported usage'
	);
} );

test( 'the breaking wave changeset carries the library migration recipe and the dirName note', () => {
	const breaking = readChangesets().filter( isBreaking );
	// The wave changeset is the breaking record that documents the removed
	// config keys and their replacement.
	const wave = breaking.find(
		( c ) =>
			/roles\.judge\.library/.test( c.body ) &&
			/paths\.rubrics/.test( c.body )
	);
	assert.ok(
		wave,
		'expected a breaking changeset naming both `roles.judge.library` and `paths.rubrics`'
	);
	// Removed-and-rejected keys.
	assert.match(
		wave.body,
		/roles\.judge\.prompt/,
		'wave changeset must name the removed `roles.judge.prompt` key'
	);
	// Migration recipe: move the manual to <library>/README.md.
	assert.match(
		wave.body,
		/README\.md/,
		'wave changeset must point the judge manual at the library README.md'
	);
	// Migration recipe: point briefs at judge-library/<rel> paths.
	assert.match(
		wave.body,
		/judge-library\//,
		'wave changeset must point briefs at judge-library/<rel> paths'
	);
	// dirName -> id note.
	assert.match(
		wave.body,
		/dirName/,
		'wave changeset must note the `dirName` removal'
	);
	assert.match(
		wave.body,
		/\bid\b/,
		'wave changeset must name `id` as the `dirName` replacement'
	);
	// The centralized decision rule: brief authors drop the per-brief opener.
	assert.match(
		wave.body,
		/decision rule|all[- ]must[- ]pass/i,
		'wave changeset must describe the centralized decision rule'
	);
} );
