import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripSkillsSection } from '../scenarios/enumerate';

test( 'a Skills section between two other sections is removed, keeping the surrounding sections intact', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'# Skills',
		'- wp-interactivity-api',
		'',
		'# Constraints',
		'Be careful.',
		'',
	].join( '\n' );

	const expected = [
		'# Overview',
		'Do the task.',
		'',
		'# Constraints',
		'Be careful.',
		'',
	].join( '\n' );

	assert.equal( stripSkillsSection( brief ), expected );
} );

test( 'a Skills section that is the last section is removed cleanly through EOF', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'# Skills',
		'- wp-interactivity-api',
		'- wp-block-editor',
	].join( '\n' );

	const result = stripSkillsSection( brief );

	assert.equal( result, [ '# Overview', 'Do the task.', '' ].join( '\n' ) );
	assert.ok( ! result.includes( 'wp-interactivity-api' ) );
	assert.ok( ! result.includes( 'wp-block-editor' ) );
	assert.ok( ! result.includes( '# Skills' ) );
} );

test( 'a Skills section containing prose is removed in full, leaking no skill-identifying text', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'# Skills',
		'You should apply the following skills as needed:',
		'- wp-interactivity-api',
		'',
		'Prefer the directive-driven approach.',
		'',
		'# Constraints',
		'Be careful.',
	].join( '\n' );

	const result = stripSkillsSection( brief );

	assert.equal(
		result,
		[
			'# Overview',
			'Do the task.',
			'',
			'# Constraints',
			'Be careful.',
		].join( '\n' )
	);
	assert.ok( ! result.includes( 'wp-interactivity-api' ) );
	assert.ok( ! result.includes( 'directive-driven' ) );
	assert.ok( ! result.includes( 'apply the following skills' ) );
} );

test( 'a brief with no Skills heading is returned unchanged', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'# Constraints',
		'Be careful.',
	].join( '\n' );

	assert.equal( stripSkillsSection( brief ), brief );
} );

test( 'CRLF input has its Skills section removed just as LF input does', () => {
	const lines = [
		'# Overview',
		'Do the task.',
		'',
		'# Skills',
		'- wp-interactivity-api',
		'',
		'# Constraints',
		'Be careful.',
	];
	const lf = lines.join( '\n' );
	const crlf = lines.join( '\r\n' );

	assert.equal( stripSkillsSection( crlf ), stripSkillsSection( lf ) );
	assert.ok( ! stripSkillsSection( crlf ).includes( 'wp-interactivity-api' ) );
} );

test( 'a deeper-depth ## Skills heading is matched and removed, consistent with parseSkillsSection', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'## Skills',
		'- wp-interactivity-api',
		'',
		'## Constraints',
		'Be careful.',
	].join( '\n' );

	const result = stripSkillsSection( brief );

	assert.equal(
		result,
		[
			'# Overview',
			'Do the task.',
			'',
			'## Constraints',
			'Be careful.',
		].join( '\n' )
	);
	assert.ok( ! result.includes( 'wp-interactivity-api' ) );
} );

test( 'a deeper sub-heading inside the Skills section stays inside the removed block', () => {
	const brief = [
		'# Overview',
		'Do the task.',
		'',
		'# Skills',
		'- wp-interactivity-api',
		'## Notes',
		'- extra note',
		'# Constraints',
		'Be careful.',
	].join( '\n' );

	const result = stripSkillsSection( brief );

	assert.equal(
		result,
		[
			'# Overview',
			'Do the task.',
			'',
			'# Constraints',
			'Be careful.',
		].join( '\n' )
	);
	assert.ok( ! result.includes( '## Notes' ) );
	assert.ok( ! result.includes( 'extra note' ) );
} );

test( 'only the first Skills heading opens the removed section', () => {
	const brief = [
		'# Skills',
		'- alpha',
		'# Middle',
		'text',
		'# Skills',
		'- beta',
	].join( '\n' );

	const result = stripSkillsSection( brief );

	assert.equal( result, [ '# Middle', 'text', '# Skills', '- beta' ].join( '\n' ) );
} );
