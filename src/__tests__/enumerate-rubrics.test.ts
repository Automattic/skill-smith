import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Paths } from '../config/types';
import { enumerateScenarios } from '../scenarios/enumerate';

/** Paths with a `rubrics` root set. Enumeration must not existence-validate it. */
const PATHS_WITH_RUBRICS: Paths = {
	base: '.',
	scenarios: 'scenarios',
	skills: 'skills',
	rubrics: 'rubrics',
};

/** Paths with no `rubrics` root set. */
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

test( 'a prose-only JUDGE.md enumerates with no error and is read verbatim into judgeBrief', () => {
	const root = makeProject();
	try {
		const judgeBrief =
			'# Judge\nGrade the counter for correctness and readability.\n';
		writeScenario( root, 'counter', { judgeBrief } );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found.length, 1 );
		assert.equal( found[ 0 ]?.error, undefined );
		assert.equal(
			found[ 0 ]?.scenario.judgeBrief,
			judgeBrief,
			'JUDGE.md content is stored verbatim, parsed structurally into nothing'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'JUDGE.md prose naming a rubric with no matching file does not error (rubrics root set)', () => {
	const root = makeProject();
	try {
		// The judge brief names a "rubric" in prose; there is no rubrics file for
		// it and, crucially, no `# Rubrics` heading. Enumeration must not treat
		// this as an unresolved reference, even with a rubrics root configured.
		writeScenario( root, 'counter', {
			judgeBrief:
				'# Judge\nApply the "ghost" rubric when grading this artifact.\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found.length, 1 );
		assert.equal(
			found[ 0 ]?.error,
			undefined,
			'prose naming a nonexistent rubric is not an enumeration error'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a JUDGE.md with a literal # Rubrics heading is opaque prose, not parsed or validated', () => {
	const root = makeProject();
	try {
		// A leftover `# Rubrics` heading is now just prose: no section is parsed
		// and no rubric id is existence-validated, so enumeration stays clean.
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nGrade it.\n\n# Rubrics\n- ghost\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		assert.equal( found.length, 1 );
		assert.equal(
			found[ 0 ]?.error,
			undefined,
			'a # Rubrics heading no longer triggers rubric id validation'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'no rubric existence-validation runs whether the rubrics root is set or unset', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nApply the never-validated rubric.\n',
		} );

		const withRubrics = enumerateScenarios( PATHS_WITH_RUBRICS, root );
		const withoutRubrics = enumerateScenarios( PATHS_WITHOUT_RUBRICS, root );

		assert.equal(
			withRubrics[ 0 ]?.error,
			undefined,
			'rubrics root set: no existence-validation, no error'
		);
		assert.equal(
			withoutRubrics[ 0 ]?.error,
			undefined,
			'rubrics root unset: no existence-validation, no error'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'an unresolved skill is still reported even though rubrics are never validated', () => {
	const root = makeProject();
	try {
		writeScenario( root, 'counter', {
			testingBrief: '# Task\n\n# Skills\n- ghost-skill\n',
			judgeBrief: '# Judge\nApply the ghost-rubric when grading.\n',
		} );

		const found = enumerateScenarios( PATHS_WITH_RUBRICS, root );

		const error = found[ 0 ]?.error ?? '';
		assert.match(
			error,
			/skill "ghost-skill"/,
			'skill existence-validation is unchanged'
		);
		assert.doesNotMatch(
			error,
			/rubric/,
			'no rubric is ever validated or reported'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
