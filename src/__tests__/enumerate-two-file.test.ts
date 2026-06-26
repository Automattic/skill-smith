import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Paths } from '../config/types';
import { enumerateScenarios } from '../scenarios/enumerate';

const TEST_PATHS: Paths = {
	base: '.',
	scenarios: 'scenarios',
	skills: 'skills',
};

/** Create a project root with an empty `scenarios/` and one resolvable skill. */
function makeProject(): string {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-enumerate-' ) );
	mkdirSync( join( root, 'scenarios' ), { recursive: true } );
	mkdirSync( join( root, 'skills', 'counter' ), { recursive: true } );
	writeFileSync( join( root, 'skills', 'counter', 'SKILL.md' ), '# Counter\n' );
	return root;
}

/** Register a resolvable skill id under the project's skills root. */
function writeSkill( root: string, id: string ): void {
	const dir = join( root, 'skills', ...id.split( '/' ) );
	mkdirSync( dir, { recursive: true } );
	writeFileSync( join( dir, 'SKILL.md' ), `# ${ id }\n` );
}

/** Write a two-file scenario (testing + judge brief) at the given id path. */
function writeScenario(
	root: string,
	id: string,
	options: { testingBrief?: string; judgeBrief?: string } = {}
): void {
	const dir = join( root, 'scenarios', ...id.split( '/' ) );
	mkdirSync( dir, { recursive: true } );
	const testingBrief =
		options.testingBrief ?? '# Task\nBuild it.\n\n# Skills\n- counter\n';
	const judgeBrief = options.judgeBrief ?? '# Judge\nGrade it.\n';
	writeFileSync( join( dir, 'TESTING-AGENT.md' ), testingBrief );
	writeFileSync( join( dir, 'JUDGE.md' ), judgeBrief );
}

test( 'a directory with both briefs is discovered as a runnable scenario', () => {
	const root = makeProject();
	try {
		const testingBrief = '# Task\nDo the thing.\n\n# Skills\n- counter\n';
		const judgeBrief = '# Judge\nWas the thing done?\n';
		writeScenario( root, 'counter', { testingBrief, judgeBrief } );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		const [ entry ] = found;
		assert.ok( entry );
		assert.equal( entry?.id, 'counter' );
		assert.equal( entry?.dirName, 'counter' );
		assert.equal( entry?.error, undefined );
		assert.equal( entry?.scenario.name, 'counter' );
		assert.equal( entry?.scenario.name, entry?.id );
		assert.deepEqual( entry?.scenario.skills, [ 'counter' ] );
		assert.equal( entry?.scenario.testingBrief, testingBrief );
		assert.equal( entry?.scenario.judgeBrief, judgeBrief );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a scenario directory with no scenario.yaml is still discovered', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter' );
		// No scenario.yaml is written; discovery is by brief presence alone.

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal( found[ 0 ]?.id, 'counter' );
		assert.equal( found[ 0 ]?.error, undefined );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a nested scenario is discovered with a slash-joined id and name', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'blocks/counter' );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal( found[ 0 ]?.id, 'blocks/counter' );
		assert.equal( found[ 0 ]?.dirName, 'blocks/counter' );
		assert.equal( found[ 0 ]?.scenario.name, 'blocks/counter' );
		assert.equal( found[ 0 ]?.error, undefined );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a folder with neither brief is not enumerated but its children are walked', () => {
	const root = makeProject();
	try {
		// `blocks` is a pure grouping folder (no briefs) holding a scenario.
		mkdirSync( join( root, 'scenarios', 'blocks' ), { recursive: true } );
		writeScenario( root, 'blocks/counter' );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.deepEqual(
			found.map( ( s ) => s.id ),
			[ 'blocks/counter' ]
		);
		assert.equal(
			found.find( ( s ) => s.id === 'blocks' ),
			undefined,
			'grouping folder without briefs is not emitted'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a directory missing JUDGE.md produces an errored scenario naming the missing file', () => {
	const root = makeProject();
	try {
		const dir = join( root, 'scenarios', 'lonely' );
		mkdirSync( dir, { recursive: true } );
		writeFileSync(
			join( dir, 'TESTING-AGENT.md' ),
			'# Task\n\n# Skills\n- counter\n'
		);

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal( found[ 0 ]?.id, 'lonely' );
		assert.equal( found[ 0 ]?.error, 'missing required file: JUDGE.md' );
		// The stub scenario still carries name=id and the readable brief.
		assert.equal( found[ 0 ]?.scenario.name, 'lonely' );
		assert.deepEqual( found[ 0 ]?.scenario.skills, [] );
		assert.equal( found[ 0 ]?.scenario.judgeBrief, '' );
		assert.match( found[ 0 ]?.scenario.testingBrief ?? '', /# Task/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a directory missing TESTING-AGENT.md produces an errored scenario naming the missing file', () => {
	const root = makeProject();
	try {
		const dir = join( root, 'scenarios', 'lonely' );
		mkdirSync( dir, { recursive: true } );
		writeFileSync( join( dir, 'JUDGE.md' ), '# Judge\n' );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal(
			found[ 0 ]?.error,
			'missing required file: TESTING-AGENT.md'
		);
		assert.equal( found[ 0 ]?.scenario.testingBrief, '' );
		assert.match( found[ 0 ]?.scenario.judgeBrief ?? '', /# Judge/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a testing brief with no Skills section is flagged as missing the section', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\nNo skills heading here.\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal(
			found[ 0 ]?.error,
			'missing required # Skills section in TESTING-AGENT.md'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an empty Skills section is valid and not flagged as missing', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found[ 0 ]?.error, undefined );
		assert.deepEqual( found[ 0 ]?.scenario.skills, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an unknown skill id produces an unresolved-reference error', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n- ghost\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		const error = found[ 0 ]?.error ?? '';
		assert.match( error, /^unresolved reference: / );
		assert.match( error, /skill "ghost"/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'multiple unknown skill ids are comma-joined in the error', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n- ghost\n- phantom\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal(
			found[ 0 ]?.error,
			'unresolved reference: skill "ghost", skill "phantom"'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a mix of known and unknown skills only flags the unknown ones', () => {
	const root = makeProject();
	try {
		writeSkill( root, 'known' );
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n- known\n- ghost\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		const error = found[ 0 ]?.error ?? '';
		assert.equal( error, 'unresolved reference: skill "ghost"' );
		assert.deepEqual( found[ 0 ]?.scenario.skills, [ 'known', 'ghost' ] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'enumeration does not throw on a missing scenarios root and returns sorted ids', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-enumerate-empty-' ) );
	try {
		// No scenarios/ directory exists at all.
		assert.deepEqual( enumerateScenarios( TEST_PATHS, root ), [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'results stay sorted by id across nested and sibling scenarios', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter' );
		writeScenario( root, 'blocks/counter' );
		writeScenario( root, 'blocks/button' );
		writeScenario( root, 'groups/deeper' );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.deepEqual(
			found.map( ( s ) => s.id ),
			[ 'blocks/button', 'blocks/counter', 'counter', 'groups/deeper' ]
		);
		assert.deepEqual(
			found.map( ( s ) => s.dirName ),
			found.map( ( s ) => s.id )
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'errored scenarios still appear in sorted output alongside valid ones', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'good' );
		// `bad` is missing JUDGE.md -> errored, but still enumerated.
		const badDir = join( root, 'scenarios', 'bad' );
		mkdirSync( badDir, { recursive: true } );
		writeFileSync(
			join( badDir, 'TESTING-AGENT.md' ),
			'# Task\n\n# Skills\n- counter\n'
		);

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.deepEqual(
			found.map( ( s ) => s.id ),
			[ 'bad', 'good' ]
		);
		assert.match( found[ 0 ]?.error ?? '', /JUDGE\.md/ );
		assert.equal( found[ 1 ]?.error, undefined );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
