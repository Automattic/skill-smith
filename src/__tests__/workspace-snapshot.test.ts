import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	copyWorkspaceForJudge,
	diffSnapshots,
	snapshotWorkspace,
} from '../pipeline/workspace-snapshot';

/**
 * Create an empty temporary directory to act as a workspace root for a
 * single test. Each call returns a fresh, isolated directory.
 */
function makeWorkspace(): string {
	return mkdtempSync( join( tmpdir(), 'workspace-snapshot-' ) );
}

test( 'snapshotWorkspace maps every file to its mtimeMs and size by relative path', () => {
	const root = makeWorkspace();
	writeFileSync( join( root, 'a.txt' ), 'aaa' );
	mkdirSync( join( root, 'sub' ), { recursive: true } );
	writeFileSync( join( root, 'sub', 'b.txt' ), 'bbbbb' );

	const snapshot = snapshotWorkspace( root );

	const aStat = statSync( join( root, 'a.txt' ) );
	const bStat = statSync( join( root, 'sub', 'b.txt' ) );

	assert.deepEqual(
		snapshot.get( 'a.txt' ),
		{ mtimeMs: aStat.mtimeMs, size: aStat.size },
		'top-level file is keyed by its relative path with mtimeMs/size'
	);
	assert.deepEqual(
		snapshot.get( join( 'sub', 'b.txt' ) ),
		{ mtimeMs: bStat.mtimeMs, size: bStat.size },
		'nested file is reached by recursive walk and keyed by relative path'
	);
	assert.equal(
		snapshot.size,
		2,
		'only files are recorded, not directories'
	);
} );

test( 'snapshotWorkspace returns an empty map for an empty or missing workspace', () => {
	const root = makeWorkspace();
	assert.equal(
		snapshotWorkspace( root ).size,
		0,
		'an empty workspace yields an empty snapshot'
	);
	assert.equal(
		snapshotWorkspace( join( root, 'does-not-exist' ) ).size,
		0,
		'a missing root yields an empty snapshot rather than throwing'
	);
} );

test( 'diffSnapshots returns added, mtime-changed, and size-changed files sorted by relative path', () => {
	const root = makeWorkspace();
	writeFileSync( join( root, 'unchanged.txt' ), 'same' );
	writeFileSync( join( root, 'touched.txt' ), 'time' );
	writeFileSync( join( root, 'grown.txt' ), 'ab' );

	const before = snapshotWorkspace( root );

	// New file appears after the baseline snapshot.
	writeFileSync( join( root, 'created.txt' ), 'new' );
	// Same size, but a newer mtime.
	utimesSync(
		join( root, 'touched.txt' ),
		new Date(),
		new Date( Date.now() + 5000 )
	);
	// Size changes.
	writeFileSync( join( root, 'grown.txt' ), 'abcdef' );

	const after = snapshotWorkspace( root );
	const written = diffSnapshots( before, after );

	assert.deepEqual(
		written,
		[ 'created.txt', 'grown.txt', 'touched.txt' ],
		'diff lists every added/modified file, sorted, and omits unchanged files'
	);
} );

test( 'diffSnapshots returns an empty list when nothing changed', () => {
	const root = makeWorkspace();
	writeFileSync( join( root, 'a.txt' ), 'a' );
	const snapshot = snapshotWorkspace( root );

	assert.deepEqual(
		diffSnapshots( snapshot, snapshot ),
		[],
		'an unchanged workspace produces no written files'
	);
} );

test( 'copyWorkspaceForJudge reproduces files and nested directories at the destination', () => {
	const parent = makeWorkspace();
	const source = join( parent, 'workspace' );
	const dest = join( parent, 'judge-workspace' );
	mkdirSync( source, { recursive: true } );
	writeFileSync( join( source, 'top.txt' ), 'top contents' );
	mkdirSync( join( source, 'nested', 'deep' ), { recursive: true } );
	writeFileSync( join( source, 'nested', 'deep', 'leaf.txt' ), 'leaf contents' );

	copyWorkspaceForJudge( source, dest );

	assert.equal(
		readFileSync( join( dest, 'top.txt' ), 'utf8' ),
		'top contents',
		'top-level file is reproduced at the destination'
	);
	assert.equal(
		readFileSync( join( dest, 'nested', 'deep', 'leaf.txt' ), 'utf8' ),
		'leaf contents',
		'nested-directory file is reproduced at the destination'
	);
} );

test( 'copyWorkspaceForJudge creates a missing destination parent directory', () => {
	const parent = makeWorkspace();
	const source = join( parent, 'workspace' );
	// Destination parent does not exist yet.
	const dest = join( parent, 'missing-parent', 'judge-workspace' );
	mkdirSync( source, { recursive: true } );
	writeFileSync( join( source, 'file.txt' ), 'data' );

	copyWorkspaceForJudge( source, dest );

	assert.equal(
		readFileSync( join( dest, 'file.txt' ), 'utf8' ),
		'data',
		'destination parent is created so the copy succeeds'
	);
} );

test( 'copyWorkspaceForJudge copies an empty workspace to an empty destination without error', () => {
	const parent = makeWorkspace();
	const source = join( parent, 'workspace' );
	const dest = join( parent, 'judge-workspace' );
	mkdirSync( source, { recursive: true } );

	copyWorkspaceForJudge( source, dest );

	assert.ok(
		existsSync( dest ) && statSync( dest ).isDirectory(),
		'an empty source produces an existing destination directory'
	);
	assert.deepEqual(
		readdirSync( dest ),
		[],
		'the destination of an empty source is itself empty'
	);
} );

test( 'copyWorkspaceForJudge leaves the source workspace unmodified', () => {
	const parent = makeWorkspace();
	const source = join( parent, 'workspace' );
	const dest = join( parent, 'judge-workspace' );
	mkdirSync( join( source, 'sub' ), { recursive: true } );
	writeFileSync( join( source, 'a.txt' ), 'aaa' );
	writeFileSync( join( source, 'sub', 'b.txt' ), 'bbbbb' );

	const before = snapshotWorkspace( source );
	copyWorkspaceForJudge( source, dest );
	const after = snapshotWorkspace( source );

	assert.deepEqual(
		diffSnapshots( before, after ),
		[],
		'the copy adds or modifies nothing in the source workspace'
	);
} );
