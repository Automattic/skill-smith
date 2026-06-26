import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../config/normalize';
import type { SkillsmithConfigInput } from '../config/types';
import { collectConfigErrors } from '../config/validate';

const PATHS = {
	base: './.skillsmith',
	skills: './skills',
	scenarios: './eval/scenarios',
	rubrics: './eval/rubrics',
};

function build(
	overrides: Partial< SkillsmithConfigInput > = {}
): SkillsmithConfigInput {
	return {
		mode: 'test-only',
		agents: {
			tester: { provider: 'claude-code', model: 'm' },
			grader: { provider: 'claude-code', model: 'm' },
			improver: { provider: 'claude-code', model: 'm' },
		},
		roles: {
			test: { agents: [ 'tester' ] },
			judge: 'grader',
			improver: 'improver',
		},
		paths: PATHS,
		...overrides,
	};
}

test( 'validate accepts a judge role that omits concurrency', () => {
	const errors = collectConfigErrors( build() );
	assert.deepEqual( errors, [] );
} );

test( 'validate accepts roles.judge.concurrency set to "serial"', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader', concurrency: 'serial' },
				improver: 'improver',
			},
		} )
	);
	assert.deepEqual( errors, [] );
} );

test( 'validate accepts roles.judge.concurrency set to "parallel"', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader', concurrency: 'parallel' },
				improver: 'improver',
			},
		} )
	);
	assert.deepEqual( errors, [] );
} );

test( 'validate rejects an unknown roles.judge.concurrency value', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				judge: { agent: 'grader', concurrency: 'locked' as any },
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.judge\.concurrency must be one of "serial", "parallel"/
	);
} );

test( 'normalize defaults the judge concurrency to "parallel" when omitted', () => {
	const config = normalizeConfig( build() );
	assert.equal( config.roles.judge.concurrency, 'parallel' );
} );

test( 'normalize carries an explicit "serial" judge concurrency through', () => {
	const config = normalizeConfig(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader', concurrency: 'serial' },
				improver: 'improver',
			},
		} )
	);
	assert.equal( config.roles.judge.concurrency, 'serial' );
} );

test( 'normalize defaults concurrency to "parallel" for the string-shorthand judge role', () => {
	const config = normalizeConfig(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.equal( config.roles.judge.concurrency, 'parallel' );
} );
