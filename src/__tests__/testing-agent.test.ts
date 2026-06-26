import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type {
	AgentDefinition,
	Scenario,
	SkillsmithConfig,
} from '../config/types';
import { runTestingAgent } from '../pipeline/testing-agent';
import { PROVIDERS } from '../providers/registry';
import type { InvokeParams, InvokeResult } from '../providers/types';
import { RunLog } from '../util/run-log';

/**
 * Stand up a self-contained project on disk: a skills root with one
 * loadable skill and an empty agent workspace. Returns the project root
 * plus the skill id and the verbatim skill text so tests can assert the
 * blob is inlined into the system prompt.
 */
function makeProject(): {
	projectRoot: string;
	agentWorkspace: string;
	skillId: string;
	skillText: string;
} {
	const projectRoot = mkdtempSync( join( tmpdir(), 'testing-agent-' ) );
	const skillId = 'demo-skill';
	const skillText = '# Demo skill\nDo the demo task carefully.\n';
	const skillDir = join( projectRoot, 'skills', skillId );
	mkdirSync( skillDir, { recursive: true } );
	writeFileSync( join( skillDir, 'SKILL.md' ), skillText );
	const agentWorkspace = join( projectRoot, 'workspace' );
	mkdirSync( agentWorkspace, { recursive: true } );
	return { projectRoot, agentWorkspace, skillId, skillText };
}

const agent: AgentDefinition = {
	id: 'agent-a',
	provider: 'mock',
	model: 'mock-model',
};

/**
 * Minimal config whose `paths.skills` points at the on-disk skills root.
 * `roles.test.prompt` is supplied by the caller so tests can toggle the
 * role-instructions section on and off.
 */
function makeConfig( rolePrompt?: string ): SkillsmithConfig {
	return {
		mode: 'test-only',
		agents: { [ agent.id ]: agent },
		roles: {
			test: { agents: [ agent ], prompt: rolePrompt },
			judge: { agent },
			improver: { agent },
		},
		paths: { base: '.skillsmith', skills: 'skills', scenarios: 'scenarios' },
	};
}

/**
 * Temporarily swap the mock provider's `invoke` for a recorder that
 * captures the {@link InvokeParams} it is handed, runs `fn`, then
 * restores the original. Returns the captured params (or `undefined` if
 * `invoke` was never called).
 */
async function captureInvoke(
	fn: () => Promise< unknown >
): Promise< InvokeParams | undefined > {
	const original = PROVIDERS.mock.invoke;
	let captured: InvokeParams | undefined;
	PROVIDERS.mock.invoke = async (
		params: InvokeParams
	): Promise< InvokeResult > => {
		captured = params;
		return { finalText: 'ok', toolUseCount: 0 };
	};
	try {
		await fn();
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	return captured;
}

test( 'testing agent receives scenario.testingBrief verbatim as its prompt', async () => {
	const { projectRoot, agentWorkspace, skillId } = makeProject();
	const testingBrief =
		'TESTING_BRIEF_SENTINEL: build a widget that does the thing.';
	const scenario: Scenario = {
		name: 'demo',
		skills: [ skillId ],
		testingBrief,
		judgeBrief: 'judge brief sentinel',
	};

	const captured = await captureInvoke( () =>
		runTestingAgent( {
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config: makeConfig(),
			log: new RunLog(),
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.equal(
		captured.prompt,
		testingBrief,
		'the user message must be scenario.testingBrief verbatim'
	);
} );

test( 'testing agent system prompt inlines the skill blob and the workspace constraint', async () => {
	const { projectRoot, agentWorkspace, skillId, skillText } = makeProject();
	const scenario: Scenario = {
		name: 'demo',
		skills: [ skillId ],
		testingBrief: 'brief',
		judgeBrief: 'judge brief',
	};

	const captured = await captureInvoke( () =>
		runTestingAgent( {
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config: makeConfig(),
			log: new RunLog(),
		} )
	);

	assert.ok( captured );
	assert.ok(
		captured.systemPrompt.includes( skillText.trim() ),
		'the loaded skill blob must be present in the system prompt'
	);
	assert.ok(
		captured.systemPrompt.includes( '# Workspace constraint' ),
		'the workspace constraint section must be present'
	);
	assert.ok(
		captured.systemPrompt.includes(
			`Only write files under ${ agentWorkspace }.`
		),
		'the workspace constraint must name the agent workspace'
	);
} );

test( "testing agent system prompt appends roles.test.prompt when it is set", async () => {
	const { projectRoot, agentWorkspace, skillId } = makeProject();
	const rolePrompt = 'ROLE_PROMPT_SENTINEL: prefer terse output.';
	const scenario: Scenario = {
		name: 'demo',
		skills: [ skillId ],
		testingBrief: 'brief',
		judgeBrief: 'judge brief',
	};

	const captured = await captureInvoke( () =>
		runTestingAgent( {
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config: makeConfig( rolePrompt ),
			log: new RunLog(),
		} )
	);

	assert.ok( captured );
	assert.ok(
		captured.systemPrompt.includes( '# Role instructions' ),
		'the role-instructions section must be present when roles.test.prompt is set'
	);
	assert.ok(
		captured.systemPrompt.includes( rolePrompt ),
		'roles.test.prompt must be appended verbatim'
	);
} );

test( 'testing agent omits the role-instructions section when roles.test.prompt is unset', async () => {
	const { projectRoot, agentWorkspace, skillId } = makeProject();
	const scenario: Scenario = {
		name: 'demo',
		skills: [ skillId ],
		testingBrief: 'brief',
		judgeBrief: 'judge brief',
	};

	const captured = await captureInvoke( () =>
		runTestingAgent( {
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config: makeConfig(),
			log: new RunLog(),
		} )
	);

	assert.ok( captured );
	assert.equal(
		captured.systemPrompt.includes( '# Role instructions' ),
		false,
		'the role-instructions section must be absent when roles.test.prompt is unset'
	);
} );
