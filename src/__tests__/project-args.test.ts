import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SkillsmithConfigInput } from '../config/types';
import { projectArgs } from '../../testing-project/eval/utils/project-args';

// `projectArgs` assembles the `--project` selectors the testing-project's
// e2e hook forwards to Playwright. It is pure, so it is unit-checked here
// even though the surrounding e2e harness needs wp-env to run.

test( 'projectArgs forwards a single runnable id', () => {
	assert.deepEqual( projectArgs( [ 'haiku' ], [ 'haiku', 'gpt' ] ), [
		'--project',
		'haiku',
	] );
} );

test( 'projectArgs forwards every runnable id that is a configured project', () => {
	assert.deepEqual( projectArgs( [ 'haiku', 'gpt' ], [ 'haiku', 'gpt' ] ), [
		'--project',
		'haiku',
		'--project',
		'gpt',
	] );
} );

test( 'projectArgs drops an id that is not a configured project', () => {
	assert.deepEqual( projectArgs( [ 'haiku', 'ghost' ], [ 'haiku', 'gpt' ] ), [
		'--project',
		'haiku',
	] );
} );

test( 'projectArgs forwards nothing when no runnable id matches', () => {
	assert.deepEqual( projectArgs( [], [ 'haiku', 'gpt' ] ), [] );
	assert.deepEqual( projectArgs( [ 'ghost' ], [ 'haiku', 'gpt' ] ), [] );
} );

// playwright.config.ts derives one Playwright project per configured test
// agent from the *statically imported* config — i.e. the unnormalized
// input, where `roles.test.agents` is a `string[]` of ids. This guards the
// contract that each project `name` is that id string (so `--project <id>`
// binds), catching any regression that maps over the normalized
// `AgentDefinition[]` shape (which is not what the static import yields).
test( 'playwright project names are the string agent ids from the config input', () => {
	const input: Pick< SkillsmithConfigInput, 'roles' > = {
		roles: {
			test: { agents: [ 'haiku', 'gpt' ] },
			judge: 'opus',
			improver: 'opus',
		},
	};
	const projects = input.roles.test.agents.map( ( agentId ) => ( {
		name: agentId,
		metadata: { agentId },
	} ) );
	for ( const project of projects ) {
		assert.equal( typeof project.name, 'string' );
	}
	assert.deepEqual(
		projects.map( ( p ) => p.name ),
		[ 'haiku', 'gpt' ]
	);
} );
