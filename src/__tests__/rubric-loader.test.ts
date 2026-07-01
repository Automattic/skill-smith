import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAllRubrics, loadRubric } from '../scenarios/rubric-loader';

const here = dirname( fileURLToPath( import.meta.url ) );
const rubricsRoot = join( here, 'fixtures', 'rubrics' );
const fixtures = join( here, 'fixtures' );

test( 'wraps the rubric entry file in a section header', () => {
	const blob = loadRubric( 'multi', rubricsRoot );

	assert.match( blob, /=== multi\.md ===/ );
	assert.match( blob, /# multi rubric/ );
} );

test( 'loads <id>.md and follows md-links inside the rubrics root', () => {
	const blob = loadRubric( 'multi', rubricsRoot );

	assert.match( blob, /=== multi\.md ===/ );
	assert.match( blob, /=== sub\/helper\.md ===/ );

	const entryHeaderCount = blob.match( /=== multi\.md ===/g )?.length ?? 0;
	assert.equal( entryHeaderCount, 1, 'no cycles' );
} );

test( 'ignores external URLs and out-of-root paths', () => {
	const blob = loadRubric( 'multi', rubricsRoot );

	const sections = blob.match( /===.*?===/g ) ?? [];
	const allowed = new Set( [
		'=== multi.md ===',
		'=== sub/helper.md ===',
	] );
	for ( const s of sections )
		assert.ok( allowed.has( s ), `unexpected section: ${ s }` );
} );

test( 'throws a clear error naming the id and expected path when missing', () => {
	assert.throws(
		() => loadRubric( 'nope', rubricsRoot ),
		( err: unknown ) => {
			assert.ok( err instanceof Error );
			assert.match( err.message, /nope/ );
			assert.match( err.message, /nope\.md/ );
			return true;
		}
	);
} );

test( 'loadAllRubrics includes every top-level rubric, sorted ascending regardless of filesystem order', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-multi' ) );

	assert.ok( blob !== undefined );
	assert.match( blob, /# Alpha rubric/ );
	assert.match( blob, /# Bravo rubric/ );
	assert.match( blob, /# Charlie rubric/ );

	const alphaAt = blob.indexOf( '# Rubric: alpha' );
	const bravoAt = blob.indexOf( '# Rubric: bravo' );
	const charlieAt = blob.indexOf( '# Rubric: charlie' );
	assert.ok( alphaAt < bravoAt, 'alpha precedes bravo' );
	assert.ok( bravoAt < charlieAt, 'bravo precedes charlie' );
} );

test( 'loadAllRubrics wraps each rubric under a `# Rubric: <id>` header with its body verbatim below', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-multi' ) );

	assert.ok( blob !== undefined );
	// G1 header uses the filename without `.md`.
	assert.match( blob, /# Rubric: alpha/ );
	// The rubric's own body (loadRubric output, including its H1) travels below.
	assert.match(
		blob,
		/# Rubric: alpha[\s\S]*?=== alpha\.md ===[\s\S]*?# Alpha rubric/
	);
} );

test( 'loadAllRubrics pulls in an in-tree md-linked companion via loadRubric', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-multi' ) );

	assert.ok( blob !== undefined );
	assert.match( blob, /=== sub\/shared\.md ===/ );
	assert.match( blob, /# shared helper/ );
} );

test( 'loadAllRubrics dedupes a companion that is also a top-level rubric (by resolved path)', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-dedupe' ) );

	assert.ok( blob !== undefined );
	// `first.md` md-links to `second.md`, which is also a top-level rubric.
	// Its section header must appear exactly once.
	const secondCount = blob.match( /=== second\.md ===/g )?.length ?? 0;
	assert.equal( secondCount, 1, 'second.md included exactly once' );
} );

test( 'loadAllRubrics returns undefined when the rubrics root does not exist', () => {
	const missing = join( fixtures, 'rubrics-does-not-exist' );

	assert.equal( loadAllRubrics( missing ), undefined );
} );

test( 'loadAllRubrics returns undefined when the rubrics root has no *.md files', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-empty' ) );

	assert.equal( blob, undefined );
} );

test( 'loadAllRubrics skips an unreadable top-level rubric without throwing', () => {
	const dir = mkdtempSync( join( tmpdir(), 'skillsmith-rubrics-' ) );
	try {
		writeFileSync( join( dir, 'good.md' ), '# good rubric\n' );
		const badPath = join( dir, 'bad.md' );
		writeFileSync( badPath, '# bad rubric\n' );
		chmodSync( badPath, 0o000 );

		let blob: string | undefined;
		assert.doesNotThrow( () => {
			blob = loadAllRubrics( dir );
		} );

		assert.ok( blob !== undefined );
		assert.match( blob, /# good rubric/ );
		assert.doesNotMatch( blob, /# bad rubric/ );
	} finally {
		try {
			chmodSync( join( dir, 'bad.md' ), 0o600 );
		} catch {
			// best-effort restore before cleanup
		}
		rmSync( dir, { recursive: true, force: true } );
	}
} );

test( 'loadAllRubrics returns no G2 selection lead-in line (caller adds it)', () => {
	const blob = loadAllRubrics( join( fixtures, 'rubrics-multi' ) );

	assert.ok( blob !== undefined );
	assert.doesNotMatch( blob, /Apply ONLY/i );
	assert.doesNotMatch( blob, /reference and must not affect the verdict/i );
} );
