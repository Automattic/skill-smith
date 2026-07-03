import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	type JudgeLibrarySection,
	prepareJudgeLibrary,
} from '../pipeline/judge-library';
import { snapshotWorkspace } from '../pipeline/workspace-snapshot';
import type { JudgeCapabilities } from '../providers/types';

const README_BODY = '# Judge manual\nVerify behavior against the live site.\n';
const RUBRIC_BODY = '# Rubric: sample\n- The block registers cleanly.\n';
const NOTES_BODY = 'Reference notes for graders.\n';

/**
 * A throwaway project layout for one test: a project root holding a
 * judge library at `eval/judge` (README optional) and an empty judge
 * workspace directory.
 */
interface Fixture {
	/** Absolute project root the library path resolves against. */
	projectRoot: string;
	/** Absolute path of the judge workspace the library is copied into. */
	judgeWorkspace: string;
	/** Absolute path of the seeded library directory. */
	library: string;
}

/**
 * Create a fresh project fixture whose `eval/judge` library holds
 * `rubrics/sample.md`, `notes.md`, and (unless disabled) `README.md`.
 */
function makeFixture( {
	withReadme = true,
}: {
	withReadme?: boolean;
} = {} ): Fixture {
	const projectRoot = mkdtempSync( join( tmpdir(), 'judge-library-' ) );
	const library = join( projectRoot, 'eval', 'judge' );
	mkdirSync( join( library, 'rubrics' ), { recursive: true } );
	writeFileSync( join( library, 'rubrics', 'sample.md' ), RUBRIC_BODY );
	writeFileSync( join( library, 'notes.md' ), NOTES_BODY );
	if ( withReadme ) {
		writeFileSync( join( library, 'README.md' ), README_BODY );
	}
	const judgeWorkspace = join( projectRoot, 'agent', 'judge-workspace' );
	mkdirSync( judgeWorkspace, { recursive: true } );
	return { projectRoot, judgeWorkspace, library };
}

/**
 * Run `prepareJudgeLibrary` against a fixture with the project-relative
 * `./eval/judge` library path and assert a section came back.
 */
function prepare(
	fixture: Fixture,
	capabilities: JudgeCapabilities = {}
): JudgeLibrarySection {
	const section = prepareJudgeLibrary( {
		projectRoot: fixture.projectRoot,
		libraryPath: './eval/judge',
		judgeWorkspace: fixture.judgeWorkspace,
		capabilities,
	} );
	assert.notEqual(
		section,
		undefined,
		'a non-empty library produces a section'
	);
	return section as JudgeLibrarySection;
}

test( 'prepareJudgeLibrary copies the whole library to judge-library/ inside the judge workspace', () => {
	const fixture = makeFixture();

	const section = prepare( fixture );

	const dest = join( fixture.judgeWorkspace, 'judge-library' );
	assert.equal( section.mode, 'mounted', 'a tools-unset judge mounts' );
	assert.equal(
		readFileSync( join( dest, 'README.md' ), 'utf8' ),
		README_BODY,
		'the README is part of the faithful mirror'
	);
	assert.equal(
		readFileSync( join( dest, 'notes.md' ), 'utf8' ),
		NOTES_BODY,
		'top-level library files are copied'
	);
	assert.equal(
		readFileSync( join( dest, 'rubrics', 'sample.md' ), 'utf8' ),
		RUBRIC_BODY,
		'nested library files are copied'
	);
} );

test( 'the disk copy is identical in mounted and inline modes; only the section differs', () => {
	const mountedFixture = makeFixture();
	const inlineFixture = makeFixture();

	const mounted = prepare( mountedFixture, {} );
	const inline = prepare( inlineFixture, { tools: [] } );

	assert.equal( mounted.mode, 'mounted' );
	assert.equal( inline.mode, 'inline' );
	assert.notEqual(
		mounted.text,
		inline.text,
		'the two modes produce different section text'
	);

	const mountedFiles = [
		...snapshotWorkspace(
			join( mountedFixture.judgeWorkspace, 'judge-library' )
		).keys(),
	].sort();
	const inlineFiles = [
		...snapshotWorkspace(
			join( inlineFixture.judgeWorkspace, 'judge-library' )
		).keys(),
	].sort();
	assert.deepEqual(
		inlineFiles,
		mountedFiles,
		'both modes copy the same file set to judge-library/'
	);
	assert.deepEqual(
		mountedFiles,
		[ 'README.md', 'notes.md', join( 'rubrics', 'sample.md' ) ].sort(),
		'the copy mirrors the whole library'
	);
	for ( const rel of mountedFiles ) {
		assert.equal(
			readFileSync(
				join( inlineFixture.judgeWorkspace, 'judge-library', rel ),
				'utf8'
			),
			readFileSync(
				join( mountedFixture.judgeWorkspace, 'judge-library', rel ),
				'utf8'
			),
			`both modes copy identical contents for ${ rel }`
		);
	}
} );

test( 'the collision guard throws identically in mounted and inline modes', () => {
	const mountedFixture = makeFixture();
	const inlineFixture = makeFixture();
	// A pre-existing top-level entry named judge-library — a file in one
	// workspace, a directory in the other — must fail the copy loudly.
	writeFileSync(
		join( mountedFixture.judgeWorkspace, 'judge-library' ),
		'occupied'
	);
	mkdirSync( join( inlineFixture.judgeWorkspace, 'judge-library' ) );

	assert.throws(
		() => prepare( mountedFixture, {} ),
		/judge-library/,
		'mounted mode throws a message naming the judge-library collision'
	);
	assert.throws(
		() => prepare( inlineFixture, { tools: [] } ),
		/judge-library/,
		'inline mode throws a message naming the judge-library collision'
	);
	assert.equal(
		readFileSync(
			join( mountedFixture.judgeWorkspace, 'judge-library' ),
			'utf8'
		),
		'occupied',
		'the colliding entry is left untouched'
	);
} );

test( 'the section carries heading, README manual, manifest, and selection instruction in order', () => {
	const fixture = makeFixture();

	const section = prepare( fixture );

	assert.ok(
		section.text.startsWith( '# Judge library' ),
		'the section opens with the # Judge library heading'
	);
	const readmeAt = section.text.indexOf( README_BODY );
	const manifestAt = section.text.indexOf( 'judge-library/notes.md' );
	const selectionAt = section.text.indexOf( 'must not affect the verdict' );
	assert.ok( readmeAt !== -1, 'the README manual is inlined verbatim' );
	assert.ok( manifestAt !== -1, 'the manifest lists the library files' );
	assert.ok( selectionAt !== -1, 'the selection instruction is present' );
	assert.ok(
		readmeAt < manifestAt && manifestAt < selectionAt,
		'sections appear in manual → manifest → selection order'
	);
	assert.ok(
		section.text.includes( "this scenario's brief" ),
		'the selection instruction scopes application to brief-named items'
	);
	assert.ok(
		! section.text.includes( RUBRIC_BODY ) &&
			! section.text.includes( NOTES_BODY ),
		'mounted mode announces paths only — no file bodies in the prompt'
	);
} );

test( 'a library without README.md omits the manual but still emits the rest of the section', () => {
	const fixture = makeFixture( { withReadme: false } );

	const section = prepare( fixture );

	assert.ok(
		section.text.startsWith( '# Judge library' ),
		'the heading is still emitted'
	);
	assert.ok(
		! section.text.includes( README_BODY ) &&
			! section.text.includes( 'judge-library/README.md' ),
		'no manual text and no README manifest entry appear'
	);
	assert.ok(
		section.text.includes( 'judge-library/notes.md' ) &&
			section.text.includes( 'judge-library/rubrics/sample.md' ),
		'the manifest still lists the library files'
	);
	assert.ok(
		section.text.includes( 'must not affect the verdict' ),
		'the selection instruction is still emitted'
	);
} );

test( 'the manifest lists /-joined relative paths sorted lexicographically', () => {
	const projectRoot = mkdtempSync( join( tmpdir(), 'judge-library-' ) );
	const library = join( projectRoot, 'lib' );
	// Seeded so that a depth-first walk order (checks/one.md before
	// checks.md) differs from lexicographic order (checks.md first).
	mkdirSync( join( library, 'checks' ), { recursive: true } );
	writeFileSync( join( library, 'checks', 'one.md' ), 'nested check\n' );
	writeFileSync( join( library, 'checks.md' ), 'top-level check\n' );
	const judgeWorkspace = join( projectRoot, 'judge-workspace' );
	mkdirSync( judgeWorkspace );

	const section = prepareJudgeLibrary( {
		projectRoot,
		libraryPath: 'lib',
		judgeWorkspace,
		capabilities: {},
	} ) as JudgeLibrarySection;

	const manifestLines = section.text
		.split( '\n' )
		.filter( ( line ) => line.startsWith( 'judge-library/' ) );
	assert.deepEqual(
		manifestLines,
		[ 'judge-library/checks.md', 'judge-library/checks/one.md' ],
		'manifest entries are /-joined and sorted, not in walk order'
	);
} );

test( 'an explicit tools array lacking Read and Bash inlines; any other shape mounts', () => {
	const cases: Array< {
		capabilities: JudgeCapabilities;
		mode: JudgeLibrarySection[ 'mode' ];
	} > = [
		{ capabilities: { tools: [] }, mode: 'inline' },
		{ capabilities: { tools: [ 'WebSearch' ] }, mode: 'inline' },
		{ capabilities: {}, mode: 'mounted' },
		{ capabilities: { tools: [ 'Read' ] }, mode: 'mounted' },
		{ capabilities: { tools: [ 'WebSearch', 'Bash' ] }, mode: 'mounted' },
	];
	for ( const { capabilities, mode } of cases ) {
		const section = prepare( makeFixture(), capabilities );
		assert.equal(
			section.mode,
			mode,
			`tools=${ JSON.stringify( capabilities.tools ) } yields ${ mode }`
		);
	}
} );

test( 'inline mode replaces the manifest with judge-library/<rel>-labelled file bodies', () => {
	const fixture = makeFixture();

	const section = prepare( fixture, { tools: [ 'WebSearch' ] } );

	assert.equal( section.mode, 'inline' );
	assert.ok(
		section.text.includes(
			`=== judge-library/notes.md ===\n${ NOTES_BODY }`
		),
		'each top-level file body sits under its judge-library/<rel> label'
	);
	assert.ok(
		section.text.includes(
			`=== judge-library/rubrics/sample.md ===\n${ RUBRIC_BODY }`
		),
		'nested file labels are /-joined judge-library/<rel> paths'
	);
	assert.equal(
		section.text.split( README_BODY ).length - 1,
		2,
		'the README body appears twice: as the manual and as its block'
	);
	const lastBlockAt = section.text.indexOf(
		'=== judge-library/rubrics/sample.md ==='
	);
	const selectionAt = section.text.indexOf( 'must not affect the verdict' );
	assert.ok(
		selectionAt > lastBlockAt,
		'the selection instruction still closes the section'
	);
} );

test( 'an empty library yields undefined and creates no judge-library directory', () => {
	const projectRoot = mkdtempSync( join( tmpdir(), 'judge-library-' ) );
	mkdirSync( join( projectRoot, 'lib' ) );
	const judgeWorkspace = join( projectRoot, 'judge-workspace' );
	mkdirSync( judgeWorkspace );

	const section = prepareJudgeLibrary( {
		projectRoot,
		libraryPath: 'lib',
		judgeWorkspace,
		capabilities: {},
	} );

	assert.equal( section, undefined, 'no files means no section' );
	assert.ok(
		! existsSync( join( judgeWorkspace, 'judge-library' ) ),
		'no judge-library directory is created for an empty library'
	);
} );
