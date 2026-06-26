import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRubricsSection } from '../scenarios/enumerate';

test( 'a simple list item resolves to a bare rubric id', () => {
	const brief = [ '# Rubrics', '', '- correctness', '' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'correctness' ] );
} );

test( 'backtick-wrapped and Markdown-link list items resolve to the bare id', () => {
	const brief = [
		'# Rubrics',
		'',
		'- `correctness`',
		'- [readability](./rubrics/readability)',
		'',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [
		'correctness',
		'readability',
	] );
} );

test( 'both asterisk and dash bullets are recognized', () => {
	const brief = [ '# Rubrics', '* alpha', '- beta' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'a deeper sub-heading does not terminate the section', () => {
	const brief = [
		'# Rubrics',
		'- alpha',
		'## Notes',
		'- beta',
		'# Other',
		'- gamma',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'a sibling or parent heading terminates the section', () => {
	const brief = [
		'## Rubrics',
		'- alpha',
		'## After',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'a shallower heading after a deep Rubrics heading terminates the section', () => {
	const brief = [
		'### Rubrics',
		'- alpha',
		'## Parent',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'a Rubrics heading at depth ## is accepted', () => {
	const brief = [ '## Rubrics', '- alpha' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'a Rubrics heading at depth ### is accepted', () => {
	const brief = [ '### Rubrics', '- alpha' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'the Rubrics word match is case-insensitive', () => {
	const brief = [ '# rubrics', '- alpha' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'an empty Rubrics section returns an empty list', () => {
	const brief = [ '# Rubrics', '', '# Next', '- alpha' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [] );
} );

test( 'a Rubrics section with only prose returns an empty list', () => {
	const brief = [ '# Rubrics', 'Some prose, no bullets.', '' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [] );
} );

test( 'a brief with no Rubrics heading is reported as absent', () => {
	const brief = [ '# Overview', '- not a rubric' ].join( '\n' );

	assert.equal( parseRubricsSection( brief ), undefined );
} );

test( 'absent is distinct from an empty section', () => {
	assert.deepEqual(
		parseRubricsSection( '# Rubrics\n' ),
		[],
		'an empty Rubrics section is the empty list'
	);
	assert.equal(
		parseRubricsSection( '# Other\n' ),
		undefined,
		'no Rubrics heading is absent'
	);
} );

test( 'only the first Rubrics heading is used when several appear', () => {
	const brief = [
		'# Rubrics',
		'- alpha',
		'# Rubrics',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'prose and blank lines inside the section are ignored', () => {
	const brief = [
		'# Rubrics',
		'',
		'Intro prose.',
		'- alpha',
		'',
		'More prose.',
		'- beta',
		'',
	].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'CRLF input parses the same as LF', () => {
	const lf = [ '# Rubrics', '- alpha', '## Notes', '- beta' ].join( '\n' );
	const crlf = [ '# Rubrics', '- alpha', '## Notes', '- beta' ].join(
		'\r\n'
	);
	const cr = [ '# Rubrics', '- alpha', '## Notes', '- beta' ].join( '\r' );

	assert.deepEqual(
		parseRubricsSection( crlf ),
		parseRubricsSection( lf )
	);
	assert.deepEqual( parseRubricsSection( cr ), parseRubricsSection( lf ) );
} );

test( 'a backtick-wrapped Markdown link resolves to the bare id', () => {
	const brief = [ '# Rubrics', '- `[alpha](./rubrics/alpha)`' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'surrounding whitespace inside the bullet is trimmed', () => {
	const brief = [ '# Rubrics', '-    alpha   ' ].join( '\n' );

	assert.deepEqual( parseRubricsSection( brief ), [ 'alpha' ] );
} );

test( 'the Rubrics heading must be only the word Rubrics', () => {
	const brief = [ '# Rubrics Required', '- alpha' ].join( '\n' );

	assert.equal( parseRubricsSection( brief ), undefined );
} );
