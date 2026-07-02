import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../config/normalize';
import type { SkillsmithConfigInput } from '../config/types';
import { collectConfigErrors } from '../config/validate';

const PATHS = {
	base: './.skillsmith',
	skills: './skills',
	scenarios: './eval/scenarios',
};

function build(
	overrides: Partial< SkillsmithConfigInput > = {}
): SkillsmithConfigInput {
	return {
		mode: 'test-only',
		agents: {
			tester: { provider: 'claude-code', model: 'claude-haiku-4-5' },
			grader: { provider: 'claude-code', model: 'claude-opus-4-7' },
			improver: { provider: 'claude-code', model: 'claude-opus-4-7' },
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

test( 'rejects an unknown top-level mode', () => {
	const errors = collectConfigErrors(
		build( { mode: 'loop' as unknown as 'test-only' } )
	);
	assert.match( errors.join( '\n' ), /mode must be one of "test-only"/ );
} );

test( 'rejects an empty agents map', () => {
	const errors = collectConfigErrors( build( { agents: {} } ) );
	assert.match(
		errors.join( '\n' ),
		/agents must contain at least one entry/
	);
} );

test( 'rejects an empty roles.test.agents', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.test\.agents must be a non-empty string array/
	);
} );

test( 'rejects an unknown agent referenced from roles.test', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'nope' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.test\.agents references unknown agent "nope"/
	);
} );

test( 'rejects an unknown agent referenced by roles.judge string shorthand', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: 'nope',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.judge references unknown agent "nope"/
	);
} );

test( 'rejects an unknown agent referenced by roles.improver object form', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: 'grader',
				improver: { agent: 'nope' },
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.improver references unknown agent "nope"/
	);
} );

test( 'rejects missing provider on an agent entry', () => {
	const errors = collectConfigErrors(
		build( {
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				broken: { model: 'm' } as any,
				grader: { provider: 'claude-code', model: 'm' },
				improver: { provider: 'claude-code', model: 'm' },
			},
			roles: {
				test: { agents: [ 'broken' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/agents\.broken\.provider must be one of/
	);
} );

test( 'rejects an unknown provider on an agent entry', () => {
	const errors = collectConfigErrors(
		build( {
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				bogus: { provider: 'bogus' as any, model: 'm' },
				grader: { provider: 'claude-code', model: 'm' },
				improver: { provider: 'claude-code', model: 'm' },
			},
			roles: {
				test: { agents: [ 'bogus' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/agents\.bogus\.provider must be one of/
	);
} );

test( 'rejects missing model on an agent entry', () => {
	const errors = collectConfigErrors(
		build( {
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				half: { provider: 'claude-code' } as any,
				grader: { provider: 'claude-code', model: 'm' },
				improver: { provider: 'claude-code', model: 'm' },
			},
			roles: {
				test: { agents: [ 'half' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/agents\.half\.model must be a non-empty string/
	);
} );

test( 'rejects duplicate ids within roles.test.agents', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester', 'tester' ] },
				judge: 'grader',
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.test\.agents: duplicate id "tester"/
	);
} );

test( 'accepts a valid config with extra pass-through keys on an agent', () => {
	const errors = collectConfigErrors(
		build( {
			agents: {
				tester: { provider: 'claude-code', model: 'claude-opus-4-7' },
				grader: {
					provider: 'claude-code',
					model: 'claude-opus-4-7',
					effort: 'xhigh',
				},
				improver: { provider: 'claude-code', model: 'claude-opus-4-7' },
			},
		} )
	);
	assert.deepEqual( errors, [] );
} );

test( 'accepts prompts on the test/improver roles and a library on the judge role', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ], prompt: 'be terse' },
				judge: { agent: 'grader', library: './eval/judge' },
				improver: { agent: 'improver', prompt: 'edit minimally' },
			},
		} )
	);
	assert.deepEqual( errors, [] );
} );

test( 'rejects a non-string improver prompt', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: 'grader',
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				improver: { agent: 'improver', prompt: 42 as any },
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.improver\.prompt must be a string/
	);
} );

// --- roles.judge.library / removed-key migration --------------------------

test( 'accepts a judge role that omits library', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader' },
				improver: 'improver',
			},
		} )
	);
	assert.deepEqual( errors, [] );
} );

test( 'rejects an empty-string roles.judge.library', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader', library: '' },
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.judge\.library must be a non-empty string/
	);
} );

test( 'rejects a non-string roles.judge.library', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				judge: { agent: 'grader', library: 42 as any },
				improver: 'improver',
			},
		} )
	);
	assert.match(
		errors.join( '\n' ),
		/roles\.judge\.library must be a non-empty string/
	);
} );

test( 'rejects the removed roles.judge.prompt with a migration message naming roles.judge.library', () => {
	const errors = collectConfigErrors(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				// biome-ignore lint/suspicious/noExplicitAny: testing the removed key at runtime
				judge: { agent: 'grader', prompt: 'strict' } as any,
				improver: 'improver',
			},
		} )
	);
	const joined = errors.join( '\n' );
	assert.match( joined, /roles\.judge\.prompt was removed/ );
	assert.match( joined, /roles\.judge\.library/ );
} );

test( 'rejects the removed paths.rubrics with a migration message naming roles.judge.library', () => {
	const errors = collectConfigErrors(
		build( {
			// biome-ignore lint/suspicious/noExplicitAny: testing the removed key at runtime
			paths: { ...PATHS, rubrics: './eval/rubrics' } as any,
		} )
	);
	const joined = errors.join( '\n' );
	assert.match( joined, /paths\.rubrics was removed/ );
	assert.match( joined, /roles\.judge\.library/ );
} );

test( 'leaves other paths keys unvalidated — only the removed rubrics key is rejected', () => {
	const errors = collectConfigErrors(
		build( {
			// biome-ignore lint/suspicious/noExplicitAny: testing pass-through of unknown keys
			paths: { ...PATHS, extra: './anything' } as any,
		} )
	);
	assert.deepEqual( errors, [] );
} );

// --- normalization of the judge role's library ----------------------------

test( 'normalize carries roles.judge.library through to the normalized judge role', () => {
	const config = normalizeConfig(
		build( {
			roles: {
				test: { agents: [ 'tester' ] },
				judge: { agent: 'grader', library: './eval/judge' },
				improver: 'improver',
			},
		} )
	);
	assert.equal( config.roles.judge.library, './eval/judge' );
} );

test( 'normalize leaves library unset when not configured and carries no judge prompt', () => {
	const config = normalizeConfig( build() );
	assert.ok(
		! ( 'library' in config.roles.judge ),
		'no library key appears on the normalized judge role when unset'
	);
	assert.ok(
		! ( 'prompt' in config.roles.judge ),
		'the normalized judge role carries no prompt key'
	);
} );
