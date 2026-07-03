import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSkillsSection } from '../scenarios/enumerate';

test( 'a simple list item resolves to a bare skill id', () => {
	const brief = [ '# Skills', '', '- wp-interactivity-api', '' ].join(
		'\n'
	);

	assert.deepEqual( parseSkillsSection( brief ), [ 'wp-interactivity-api' ] );
} );

test( 'backtick-wrapped and Markdown-link list items resolve to the bare id', () => {
	const brief = [
		'# Skills',
		'',
		'- `wp-interactivity-api`',
		'- [wp-block-editor](./skills/wp-block-editor)',
		'',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [
		'wp-interactivity-api',
		'wp-block-editor',
	] );
} );

test( 'both asterisk and dash bullets are recognized', () => {
	const brief = [ '# Skills', '* alpha', '- beta' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'a deeper sub-heading does not terminate the section', () => {
	const brief = [
		'# Skills',
		'- alpha',
		'## Notes',
		'- beta',
		'# Other',
		'- gamma',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'a sibling or parent heading terminates the section', () => {
	const brief = [
		'## Skills',
		'- alpha',
		'## After',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'a shallower heading after a deep Skills heading terminates the section', () => {
	const brief = [
		'### Skills',
		'- alpha',
		'## Parent',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'a Skills heading at depth ## is accepted', () => {
	const brief = [ '## Skills', '- alpha' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'a Skills heading at depth ### is accepted', () => {
	const brief = [ '### Skills', '- alpha' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'the Skills word match is case-insensitive', () => {
	const brief = [ '# skills', '- alpha' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'an empty Skills section returns an empty list', () => {
	const brief = [ '# Skills', '', '# Next', '- alpha' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [] );
} );

test( 'a Skills section with only prose returns an empty list', () => {
	const brief = [ '# Skills', 'Some prose, no bullets.', '' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [] );
} );

test( 'a brief with no Skills heading is reported as absent', () => {
	const brief = [ '# Overview', '- not a skill' ].join( '\n' );

	assert.equal( parseSkillsSection( brief ), undefined );
} );

test( 'absent is distinct from an empty section', () => {
	assert.deepEqual(
		parseSkillsSection( '# Skills\n' ),
		[],
		'an empty Skills section is the empty list'
	);
	assert.equal(
		parseSkillsSection( '# Other\n' ),
		undefined,
		'no Skills heading is absent'
	);
} );

test( 'only the first Skills heading is used when several appear', () => {
	const brief = [
		'# Skills',
		'- alpha',
		'# Skills',
		'- beta',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'prose and blank lines inside the section are ignored', () => {
	const brief = [
		'# Skills',
		'',
		'Intro prose.',
		'- alpha',
		'',
		'More prose.',
		'- beta',
		'',
	].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha', 'beta' ] );
} );

test( 'CRLF input parses the same as LF', () => {
	const lf = [ '# Skills', '- alpha', '## Notes', '- beta' ].join( '\n' );
	const crlf = [ '# Skills', '- alpha', '## Notes', '- beta' ].join(
		'\r\n'
	);
	const cr = [ '# Skills', '- alpha', '## Notes', '- beta' ].join( '\r' );

	assert.deepEqual(
		parseSkillsSection( crlf ),
		parseSkillsSection( lf )
	);
	assert.deepEqual( parseSkillsSection( cr ), parseSkillsSection( lf ) );
} );

test( 'a backtick-wrapped Markdown link resolves to the bare id', () => {
	const brief = [ '# Skills', '- `[alpha](./skills/alpha)`' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'surrounding whitespace inside the bullet is trimmed', () => {
	const brief = [ '# Skills', '-    alpha   ' ].join( '\n' );

	assert.deepEqual( parseSkillsSection( brief ), [ 'alpha' ] );
} );

test( 'the Skills heading must be only the word Skills', () => {
	const brief = [ '# Skills Required', '- alpha' ].join( '\n' );

	assert.equal( parseSkillsSection( brief ), undefined );
} );
