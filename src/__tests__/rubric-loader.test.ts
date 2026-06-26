import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRubric } from '../scenarios/rubric-loader';

const here = dirname( fileURLToPath( import.meta.url ) );
const rubricsRoot = join( here, 'fixtures', 'rubrics' );

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
