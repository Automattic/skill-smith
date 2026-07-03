/**
 * The opaque-brief contract: enumeration never parses or validates judge-brief
 * content. `JUDGE.md` is read verbatim into `judgeBrief` and treated as opaque
 * prose — no heading inside it is interpreted, and no grading material named
 * in the prose (rubrics, references, files) is existence-checked at
 * enumeration time. Resolving that material is the judge's job at grading
 * time, which keeps these tests load-bearing: they fail as soon as
 * enumeration starts inspecting brief content.
 */

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { enumerateScenarios } from '../scenarios/enumerate';
import {
	TEST_PATHS,
	makeProject,
	writeScenario,
} from './helpers/scenario-project';

test( 'a prose-only JUDGE.md enumerates with no error and is read verbatim into judgeBrief', () => {
	const root = makeProject();
	try {
		const judgeBrief =
			'# Judge\nGrade the counter for correctness and readability.\n';
		writeScenario( root, 'counter', { judgeBrief } );

		const found = enumerateScenarios( TEST_PATHS, root );

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

test( 'grading material named in judge-brief prose is not existence-validated', () => {
	const root = makeProject();
	try {
		// The judge brief names a rubric in prose; no file by that name exists
		// anywhere in the project. Enumeration must not treat the mention as
		// an unresolved reference.
		writeScenario( root, 'counter', {
			judgeBrief:
				'# Judge\nApply the "ghost" rubric when grading this artifact.\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal(
			found[ 0 ]?.error,
			undefined,
			'prose naming nonexistent grading material is not an enumeration error'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );

test( 'a JUDGE.md with a literal # Rubrics heading is opaque prose, not parsed or validated', () => {
	const root = makeProject();
	try {
		// A `# Rubrics` heading inside the judge brief is prose like any other
		// line: no section is parsed out of it and no listed id is
		// existence-validated, so enumeration stays clean.
		writeScenario( root, 'counter', {
			judgeBrief: '# Judge\nGrade it.\n\n# Rubrics\n- ghost\n',
		} );

		const found = enumerateScenarios( TEST_PATHS, root );

		assert.equal( found.length, 1 );
		assert.equal(
			found[ 0 ]?.error,
			undefined,
			'a # Rubrics heading triggers no rubric id validation'
		);
	} finally {
		rmSync( root, { recursive: true, force: true } );
	}
} );
