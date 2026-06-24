import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentDefinition, SkillsmithConfig } from '../config/types';
import type { ProviderId } from '../providers/types';
import { classifyRunnability, decide } from '../runnability';

/** A minimal `AgentDefinition`; only `id`/`provider`/`model` matter here. */
function agent( id: string, provider: ProviderId ): AgentDefinition {
	return { id, provider, model: 'x' };
}

/**
 * Builds a minimal `SkillsmithConfig` in memory. Callers pass the test
 * agents plus the single judge/improver agents; everything else is
 * stubbed to the smallest shape the classifier reads.
 */
function makeConfig( opts: {
	test: AgentDefinition[];
	judge: AgentDefinition;
	improver: AgentDefinition;
} ): SkillsmithConfig {
	const agents: Record< string, AgentDefinition > = {};
	for ( const a of [ ...opts.test, opts.judge, opts.improver ] ) {
		agents[ a.id ] = a;
	}
	return {
		mode: 'test-only',
		agents,
		roles: {
			test: { agents: opts.test },
			judge: { agent: opts.judge },
			improver: { agent: opts.improver },
		},
		paths: { base: '.', skills: '.', scenarios: '.', rubrics: '.' },
	};
}

const mock = agent( 'm', 'mock' );

test( 'an openai-api test agent is skipped when OPENAI_API_KEY is unset', () => {
	const config = makeConfig( {
		test: [ agent( 'gpt', 'openai-api' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.equal( result.runnableTestAgentIds.length, 0 );
	assert.equal( result.skipped.length, 1 );
	const entry = result.skipped[ 0 ];
	assert.ok( entry );
	assert.equal( entry.id, 'gpt' );
	assert.equal( entry.reason, 'OPENAI_API_KEY is not set' );
	assert.deepEqual( entry.roles, [ 'test' ] );

	const runnable = classifyRunnability( config, { OPENAI_API_KEY: 'sk-x' } );
	assert.deepEqual( runnable.runnableTestAgentIds, [ 'gpt' ] );
	assert.deepEqual( runnable.skipped, [] );
} );

test( 'an anthropic-api test agent is skipped when ANTHROPIC_API_KEY is unset', () => {
	const config = makeConfig( {
		test: [ agent( 'claude', 'anthropic-api' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.deepEqual( result.runnableTestAgentIds, [] );
	assert.equal( result.skipped[ 0 ]?.reason, 'ANTHROPIC_API_KEY is not set' );

	const runnable = classifyRunnability( config, { ANTHROPIC_API_KEY: 'x' } );
	assert.deepEqual( runnable.runnableTestAgentIds, [ 'claude' ] );
	assert.deepEqual( runnable.skipped, [] );
} );

test( 'a gemini-api test agent is skipped when GOOGLE_GENERATIVE_AI_API_KEY is unset', () => {
	const config = makeConfig( {
		test: [ agent( 'gem', 'gemini-api' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.deepEqual( result.runnableTestAgentIds, [] );
	assert.equal(
		result.skipped[ 0 ]?.reason,
		'GOOGLE_GENERATIVE_AI_API_KEY is not set'
	);

	const runnable = classifyRunnability( config, {
		GOOGLE_GENERATIVE_AI_API_KEY: 'x',
	} );
	assert.deepEqual( runnable.runnableTestAgentIds, [ 'gem' ] );
	assert.deepEqual( runnable.skipped, [] );
} );

test( 'an empty-string credential is treated as absent', () => {
	const config = makeConfig( {
		test: [ agent( 'gpt', 'openai-api' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, { OPENAI_API_KEY: '' } );
	assert.deepEqual( result.runnableTestAgentIds, [] );
	assert.equal( result.skipped[ 0 ]?.reason, 'OPENAI_API_KEY is not set' );
} );

test( 'claude-code and mock test agents are runnable regardless of env', () => {
	const config = makeConfig( {
		test: [ agent( 'cc', 'claude-code' ), agent( 'mk', 'mock' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.deepEqual( result.runnableTestAgentIds, [ 'cc', 'mk' ] );
	assert.deepEqual( result.skipped, [] );
} );

test( 'one misconfigured test agent among several yields exactly one skip', () => {
	const config = makeConfig( {
		test: [ agent( 'gpt', 'openai-api' ), agent( 'mk', 'mock' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.deepEqual( result.runnableTestAgentIds, [ 'mk' ] );
	assert.equal( result.skipped.length, 1 );
	assert.equal( result.skipped[ 0 ]?.id, 'gpt' );
} );

test( 'a misconfigured judge sets judgeRunnable false with a judge role', () => {
	const config = makeConfig( {
		test: [ mock ],
		judge: agent( 'gpt', 'openai-api' ),
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	assert.equal( result.judgeRunnable, false );
	const entry = result.skipped.find( ( s ) => s.id === 'gpt' );
	assert.ok( entry );
	assert.ok( entry.roles.includes( 'judge' ) );
} );

test( 'a misconfigured improver sets improverRunnable false with an improver role', () => {
	const config = makeConfig( {
		test: [ mock ],
		judge: mock,
		improver: agent( 'gpt', 'openai-api' ),
	} );

	const result = classifyRunnability( config, {} );
	assert.equal( result.improverRunnable, false );
	const entry = result.skipped.find( ( s ) => s.id === 'gpt' );
	assert.ok( entry );
	assert.ok( entry.roles.includes( 'improver' ) );
} );

test( 'an id used as both judge and test agent yields one entry with both roles', () => {
	const shared = agent( 'gpt', 'openai-api' );
	const config = makeConfig( {
		test: [ shared ],
		judge: shared,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	const entries = result.skipped.filter( ( s ) => s.id === 'gpt' );
	assert.equal( entries.length, 1 );
	const entry = entries[ 0 ];
	assert.ok( entry );
	assert.ok( entry.roles.includes( 'judge' ) );
	assert.ok( entry.roles.includes( 'test' ) );
	assert.equal( result.judgeRunnable, false );
	assert.deepEqual( result.runnableTestAgentIds, [] );
} );

test( 'decide maps single roles to their consequence', () => {
	assert.equal( decide( [ 'test' ] ), 'EXCLUDE_LANE' );
	assert.equal( decide( [ 'improver' ] ), 'HALT_AFTER_ITERATION' );
	assert.equal( decide( [ 'judge' ] ), 'STOP_RUN' );
} );

test( 'decide returns the most-severe consequence across multiple roles', () => {
	assert.equal( decide( [ 'judge', 'test' ] ), 'STOP_RUN' );
	assert.equal( decide( [ 'improver', 'test' ] ), 'HALT_AFTER_ITERATION' );
} );

test( 'the classifier is synchronous and never invokes a provider', () => {
	const config = makeConfig( {
		test: [ agent( 'gpt', 'openai-api' ) ],
		judge: mock,
		improver: mock,
	} );

	const result = classifyRunnability( config, {} );
	// A plain object, not a Promise — the classifier does no async work.
	assert.equal( typeof ( result as { then?: unknown } ).then, 'undefined' );
	assert.ok( Array.isArray( result.skipped ) );
} );
