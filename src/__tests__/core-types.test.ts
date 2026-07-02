import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
	AgentDefinitionInput,
	McpServerConfig,
	Paths,
	Scenario,
} from '../config/types';
import type {
	InvokeParams,
	JudgeCapabilities,
} from '../providers/types';
// The package entry point must re-export the new descriptor types so
// consuming projects can type their config against them.
import type {
	JudgeCapabilities as ExportedJudgeCapabilities,
	McpServerConfig as ExportedMcpServerConfig,
} from '../index';

/**
 * Helper that forces the compiler to check `value` against type `T` while
 * still producing a runtime value the test can assert on. The `satisfies`
 * call is the real assertion: if the shape drifts, `tsc --noEmit` fails.
 */
function ofType< T >( value: T ): T {
	return value;
}

test( 'Scenario carries exactly name/skills/testingBrief/judgeBrief', () => {
	const scenario = ofType< Scenario >( {
		name: 'counter',
		skills: [ 'block-development' ],
		testingBrief: 'Build a counter block.',
		judgeBrief: 'The block increments on click.',
	} );

	assert.deepEqual( Object.keys( scenario ).sort(), [
		'judgeBrief',
		'name',
		'skills',
		'testingBrief',
	] );
	assert.equal( scenario.name, 'counter' );
	assert.deepEqual( scenario.skills, [ 'block-development' ] );
	assert.equal( scenario.testingBrief, 'Build a counter block.' );
	assert.equal( scenario.judgeBrief, 'The block increments on click.' );

	// The open index signature still admits arbitrary extra keys.
	const withExtra = ofType< Scenario >( {
		name: 's',
		skills: [],
		testingBrief: 't',
		judgeBrief: 'j',
		custom: 123,
	} );
	assert.equal( withExtra.custom, 123 );
} );

test( 'Paths is exactly base/skills/scenarios', () => {
	const paths = ofType< Paths >( {
		base: './.skillsmith',
		skills: './skills',
		scenarios: './eval/scenarios',
	} );

	assert.deepEqual( Object.keys( paths ).sort(), [
		'base',
		'scenarios',
		'skills',
	] );
} );

test( 'McpServerConfig mirrors the stdio shape', () => {
	const minimal = ofType< McpServerConfig >( { command: 'node' } );
	assert.equal( minimal.command, 'node' );

	const full = ofType< McpServerConfig >( {
		command: 'node',
		args: [ 'server.js' ],
		env: { TOKEN: 'x' },
	} );
	assert.deepEqual( full.args, [ 'server.js' ] );
	assert.deepEqual( full.env, { TOKEN: 'x' } );
} );

test( 'JudgeCapabilities exposes the configurable capability fields', () => {
	const caps = ofType< JudgeCapabilities >( {
		tools: [ 'Read', 'Bash' ],
		mcpServers: { fs: { command: 'node', args: [ 'mcp.js' ] } },
		allowWrite: true,
		network: true,
	} );
	assert.deepEqual( caps.tools, [ 'Read', 'Bash' ] );
	assert.equal( caps.allowWrite, true );
	assert.equal( caps.network, true );
	assert.equal( caps.mcpServers?.fs?.command, 'node' );

	// All fields are optional.
	const empty = ofType< JudgeCapabilities >( {} );
	assert.deepEqual( empty, {} );
} );

test( 'InvokeParams accepts an optional capabilities descriptor', () => {
	const base: InvokeParams = {
		agent: { id: 'a', provider: 'claude-code', model: 'm' },
		systemPrompt: 'sys',
		prompt: 'p',
		cwd: '/tmp',
		role: 'judge',
	};
	// Omitting capabilities is valid.
	assert.equal( base.capabilities, undefined );

	const withCaps: InvokeParams = {
		...base,
		capabilities: { tools: [ 'Read' ], allowWrite: false },
	};
	assert.deepEqual( withCaps.capabilities?.tools, [ 'Read' ] );
} );

test( 'AgentDefinitionInput accepts typed DX fields plus extra keys', () => {
	const agent = ofType< AgentDefinitionInput >( {
		provider: 'claude-code',
		model: 'claude-opus-4-7',
		tools: [ 'Read', 'Write' ],
		mcpServers: { fs: { command: 'node' } },
		allowWrite: true,
		network: false,
		// Arbitrary pass-through key still permitted by the index signature.
		effort: 'high',
	} );

	assert.deepEqual( agent.tools, [ 'Read', 'Write' ] );
	assert.equal( agent.allowWrite, true );
	assert.equal( agent.network, false );
	assert.equal( agent.mcpServers?.fs?.command, 'node' );
	assert.equal( agent.effort, 'high' );
} );

test( 'JudgeCapabilities and McpServerConfig are exported from the entry point', () => {
	// Compile-time proof that the entry-point re-exports are the same shapes.
	const caps = ofType< ExportedJudgeCapabilities >( { network: true } );
	const server = ofType< ExportedMcpServerConfig >( { command: 'node' } );
	assert.equal( caps.network, true );
	assert.equal( server.command, 'node' );
} );
