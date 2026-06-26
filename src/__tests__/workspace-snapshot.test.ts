import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
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
