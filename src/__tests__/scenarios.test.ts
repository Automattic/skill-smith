import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PATHS } from '../config/defaults';
import {
	compareScenarioIds,
	type EnumeratedScenario,
	enumerateScenarios,
} from '../scenarios/enumerate';
import {
	TEST_PATHS,
	makeProject,
	writeScenario,
	writeSkill,
} from './helpers/scenario-project';

const here = dirname( fileURLToPath( import.meta.url ) );
const projectRoot = join( here, 'fixtures', 'proj1' );

test( 'scenarios with unresolved refs are flagged but others continue', () => {
	const found = enumerateScenarios( DEFAULT_PATHS, projectRoot );

	const byId = new Map( found.map( ( s ) => [ s.id, s ] ) );
	assert.equal( byId.size, 2, 'two scenarios should be found' );

	const good = byId.get( 'good' );
	assert.ok( good, 'good scenario present' );
	assert.equal( good?.scenario.name, 'good' );
	assert.equal( good?.dirName, 'good' );
	assert.deepEqual( good?.scenario.skills, [ 'foo' ] );
	assert.equal( good?.error, undefined, 'good scenario has no error' );

	const bad = byId.get( 'bad' );
	assert.ok( bad, 'bad scenario present' );
	assert.equal( bad?.scenario.name, 'bad' );
	assert.equal( bad?.dirName, 'bad' );
	assert.match( bad?.error ?? '', /unresolved reference/ );
	assert.match( bad?.error ?? '', /missing-skill/ );
} );

test( 'enumeration reads both briefs verbatim and parses the # Skills section', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief:
				'Build a counter block.\n\n# Skills\n\n- counter\n- counter\n',
			judgeBrief: 'Pass when the counter increments.\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );
		const counter = found.find( ( s ) => s.id === 'counter' );

		assert.ok( counter, 'counter scenario present' );
		assert.equal( counter?.error, undefined );
		assert.equal(
			counter?.scenario.testingBrief,
			'Build a counter block.\n\n# Skills\n\n- counter\n- counter\n',
			'testing brief is stored verbatim'
		);
		assert.equal(
			counter?.scenario.judgeBrief,
			'Pass when the counter increments.\n',
			'judge brief is stored verbatim'
		);
		assert.deepEqual(
			counter?.scenario.skills,
			[ 'counter', 'counter' ],
			'each # Skills list item becomes a skill id'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a testing brief without a # Skills section is an errored scenario', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'no-skills', {
			testingBrief: 'Do the task.\n',
			judgeBrief: 'Pass when done.\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );
		const scenario = found.find( ( s ) => s.id === 'no-skills' );

		assert.ok( scenario, 'scenario present' );
		assert.match( scenario?.error ?? '', /missing required # Skills section/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an empty # Skills section is valid and not flagged as missing', () => {
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

test( 'an unknown skill reference is an errored scenario naming the skill', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'unknown-skill', {
			testingBrief: 'Do the task.\n\n# Skills\n\n- absent-skill\n',
			judgeBrief: 'Pass when done.\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );
		const scenario = found.find( ( s ) => s.id === 'unknown-skill' );

		assert.ok( scenario, 'scenario present' );
		assert.match( scenario?.error ?? '', /unresolved reference/ );
		assert.match( scenario?.error ?? '', /absent-skill/ );
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

		assert.equal( found[ 0 ]?.error, 'unresolved reference: skill "ghost"' );
		assert.deepEqual( found[ 0 ]?.scenario.skills, [ 'known', 'ghost' ] );
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

test( 'a directory with only one of the two briefs is an errored scenario', () => {
	const root = makeProject();
	try {
		const testingBrief = 'Do the task.\n\n# Skills\n\n- counter\n';
		const testingOnly = join( root, 'scenarios', 'testing-only' );
		mkdirSync( testingOnly, { recursive: true } );
		writeFileSync( join( testingOnly, 'TESTING-AGENT.md' ), testingBrief );

		const judgeBrief = 'Pass when done.\n';
		const judgeOnly = join( root, 'scenarios', 'judge-only' );
		mkdirSync( judgeOnly, { recursive: true } );
		writeFileSync( join( judgeOnly, 'JUDGE.md' ), judgeBrief );

		const found = enumerateScenarios( TEST_PATHS, root );
		const byId = new Map( found.map( ( s ) => [ s.id, s ] ) );

		const testingOnlyEntry = byId.get( 'testing-only' );
		assert.match(
			testingOnlyEntry?.error ?? '',
			/missing required file: JUDGE\.md/
		);
		// The errored entry still carries a full stub scenario: name equals
		// the id, the readable brief is stored verbatim, the missing file
		// yields '', and no skills are parsed.
		assert.equal( testingOnlyEntry?.scenario.name, 'testing-only' );
		assert.equal( testingOnlyEntry?.scenario.testingBrief, testingBrief );
		assert.equal( testingOnlyEntry?.scenario.judgeBrief, '' );
		assert.deepEqual( testingOnlyEntry?.scenario.skills, [] );

		const judgeOnlyEntry = byId.get( 'judge-only' );
		assert.match(
			judgeOnlyEntry?.error ?? '',
			/missing required file: TESTING-AGENT\.md/
		);
		assert.equal( judgeOnlyEntry?.scenario.name, 'judge-only' );
		assert.equal( judgeOnlyEntry?.scenario.judgeBrief, judgeBrief );
		assert.equal( judgeOnlyEntry?.scenario.testingBrief, '' );
		assert.deepEqual( judgeOnlyEntry?.scenario.skills, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'scenario enumeration discovers nested scenarios in deterministic ID order', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter' );
		writeScenario( root, 'blocks' );
		writeScenario( root, 'blocks/counter' );
		writeScenario( root, 'groups/deeper' );
		writeFileSync(
			join( root, 'scenarios', 'notes.txt' ),
			'not a directory'
		);
		symlinkSync(
			join( root, 'scenarios', 'counter' ),
			join( root, 'scenarios', 'linked-counter' ),
			'dir'
		);

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.deepEqual(
			found.map( ( scenario ) => scenario.id ),
			[ 'blocks', 'blocks/counter', 'counter', 'groups/deeper' ]
		);
		assert.deepEqual(
			found.map( ( scenario ) => scenario.dirName ),
			found.map( ( scenario ) => scenario.id )
		);
		assert.equal(
			found.find( ( scenario ) => scenario.id === 'groups' ),
			undefined,
			'grouping directories without the two briefs are not emitted'
		);
		assert.equal(
			found.find( ( scenario ) => scenario.id === 'linked-counter' ),
			undefined,
			'symlinked directories are not emitted'
		);
		assert.ok(
			found.every( ( scenario ) => scenario.scenario.name === scenario.id ),
			'each scenario name equals its id'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'scenario enumeration keeps nested errors isolated while recursing', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'valid' );
		writeScenario( root, 'missing', { skills: [ 'absent-skill' ] } );
		mkdirSync( join( root, 'scenarios', 'broken' ), { recursive: true } );
		writeFileSync(
			join( root, 'scenarios', 'broken', 'TESTING-AGENT.md' ),
			'Do the task.\n\n# Skills\n\n- counter\n'
		);
		writeScenario( root, 'broken/child' );

		const found = enumerateScenarios( TEST_PATHS, root );
		const byId = new Map(
			found.map( ( scenario ) => [ scenario.id, scenario ] )
		);

		assert.deepEqual(
			found.map( ( scenario ) => scenario.id ),
			[ 'broken', 'broken/child', 'missing', 'valid' ]
		);
		assert.match(
			byId.get( 'broken' )?.error ?? '',
			/missing required file: JUDGE\.md/
		);
		assert.match(
			byId.get( 'missing' )?.error ?? '',
			/unresolved reference/
		);
		assert.match( byId.get( 'missing' )?.error ?? '', /absent-skill/ );
		assert.equal( byId.get( 'valid' )?.error, undefined );
		assert.equal( byId.get( 'broken/child' )?.error, undefined );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'enumeration does not throw on a missing scenarios root and returns no scenarios', () => {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-scenarios-empty-' ) );
	try {
		// No scenarios/ directory exists at all under the project root.
		assert.deepEqual( enumerateScenarios( TEST_PATHS, root ), [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'compareScenarioIds orders enumerated scenarios lexicographically by id', () => {
	const make = ( id: string ): EnumeratedScenario => ( {
		scenario: { name: id, skills: [], testingBrief: '', judgeBrief: '' },
		id,
		dirName: id,
	} );

	assert.ok(
		compareScenarioIds( make( 'a' ), make( 'b' ) ) < 0,
		'a sorts before b'
	);
	assert.ok(
		compareScenarioIds( make( 'b' ), make( 'a' ) ) > 0,
		'b sorts after a'
	);
	assert.equal(
		compareScenarioIds( make( 'a' ), make( 'a' ) ),
		0,
		'equal ids compare as equal'
	);
	assert.ok(
		compareScenarioIds( make( 'Zed' ), make( 'apple' ) ) < 0,
		'ordering is by code unit, so uppercase sorts before lowercase'
	);
	assert.deepEqual(
		[ make( 'z' ), make( 'blocks/counter' ), make( 'a' ) ]
			.sort( compareScenarioIds )
			.map( ( scenario ) => scenario.id ),
		[ 'a', 'blocks/counter', 'z' ],
		'sorting with the comparator yields the deterministic id order'
	);
} );
