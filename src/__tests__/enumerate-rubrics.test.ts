import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Paths } from '../config/types';
import { enumerateScenarios } from '../scenarios/enumerate';

/** Paths with a `rubrics` root set, so rubric ids are existence-validated. */
const PATHS_WITH_RUBRICS: Paths = {
	base: '.',
	scenarios: 'scenarios',
	skills: 'skills',
	rubrics: 'rubrics',
};

/** Paths with no `rubrics` root, so rubric ids are not existence-validated. */
const PATHS_WITHOUT_RUBRICS: Paths = {
	base: '.',
	scenarios: 'scenarios',
	skills: 'skills',
};

/** Create a project root with an empty `scenarios/` and one resolvable skill. */
function makeProject(): string {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-enumerate-rubrics-' ) );
	mkdirSync( join( root, 'scenarios' ), { recursive: true } );
	mkdirSync( join( root, 'skills', 'counter' ), { recursive: true } );
	writeFileSync( join( root, 'skills', 'counter', 'SKILL.md' ), '# Counter\n' );
	return root;
}

/** Register a resolvable rubric id as a flat `<id>.md` under the rubrics root. */
function writeRubric( root: string, id: string ): void {
	mkdirSync( join( root, 'rubrics' ), { recursive: true } );
	writeFileSync( join( root, 'rubrics', `${ id }.md` ), `# ${ id }\n` );
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

test( 'a known rubric id (rubrics root set) enumerates with no error and is stored', () => {
	const root = makeProject();
	try {
		writeRubric( root, 'correctness' );
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nGrade it.\n\n# Rubrics\n- correctness\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found.length, 1 );
		assert.equal( found[ 0 ]?.error, undefined );
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [ 'correctness' ] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an unknown rubric id (rubrics root set) produces an unresolved-reference error', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nGrade it.\n\n# Rubrics\n- ghost\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		const error = found[ 0 ]?.error ?? '';
		assert.match( error, /^unresolved reference: / );
		assert.match( error, /rubric "ghost"/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'multiple unknown rubric ids are comma-joined in the error', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\n\n# Rubrics\n- ghost\n- phantom\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal(
			found[ 0 ]?.error,
			'unresolved reference: rubric "ghost", rubric "phantom"'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a mix of known and unknown rubrics only flags the unknown ones', () => {
	const root = makeProject();
	try {
		writeRubric( root, 'known' );
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\n\n# Rubrics\n- known\n- ghost\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal(
			found[ 0 ]?.error,
			'unresolved reference: rubric "ghost"'
		);
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [ 'known', 'ghost' ] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a rubric resolved by a flat <id>.md file (not a directory) enumerates valid', () => {
	const root = makeProject();
	try {
		// Resolution is the flat `<id>.md` file, never an `<id>/` directory.
		mkdirSync( join( root, 'rubrics', 'asdir' ), { recursive: true } );
		writeFileSync(
			join( root, 'rubrics', 'asdir', 'index.md' ),
			'# nope\n'
		);
		writeRubric( root, 'asfile' );
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\n\n# Rubrics\n- asfile\n- asdir\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal(
			found[ 0 ]?.error,
			'unresolved reference: rubric "asdir"',
			'only the flat-file rubric resolves; the directory form does not'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a scenario with no Rubrics section enumerates valid with an empty rubrics list', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nGrade it.\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found[ 0 ]?.error, undefined );
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an absent Rubrics section never produces a rubric problem (referencing rubrics is optional)', () => {
	const root = makeProject();
	try {
		// Rubrics root is set but the judge brief omits the section entirely.
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nNo rubrics heading at all.\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found[ 0 ]?.error, undefined );
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an empty Rubrics section is valid and yields an empty rubrics list', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\n\n# Rubrics\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found[ 0 ]?.error, undefined );
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'with no rubrics root set, rubric ids are not existence-validated but are still stored', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\n\n# Rubrics\n- never-validated\n',
		} );

		const found = enumerateScenarios( PATHS_WITHOUT_RUBRICS, root );

		assert.equal(
			found[ 0 ]?.error,
			undefined,
			'no rubric existence error when the rubrics root is unset'
		);
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [ 'never-validated' ] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a stubbed (errored) scenario carries an empty rubrics list', () => {
	const root = makeProject();
	try {
		const dir = join( root, 'scenarios', 'lonely' );
		mkdirSync( dir, { recursive: true } );
		// Missing JUDGE.md -> errored scenario built from stubScenario.
		writeFileSync(
			join( dir, 'TESTING-AGENT.md' ),
			'# Task\n\n# Skills\n- counter\n'
		);

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found.length, 1 );
		assert.match( found[ 0 ]?.error ?? '', /JUDGE\.md/ );
		assert.deepEqual( found[ 0 ]?.scenario.rubrics, [] );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an unresolved rubric and an unresolved skill are both reported', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n- ghost-skill\n',
			judgeBrief: '# Judge\n\n# Rubrics\n- ghost-rubric\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		const error = found[ 0 ]?.error ?? '';
		assert.match( error, /skill "ghost-skill"/ );
		assert.match( error, /rubric "ghost-rubric"/ );
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
