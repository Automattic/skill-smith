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
import {
	buildJudgeSystemPrompt,
	buildUserMessage,
	parseJudgeJson,
	runJudgeAgent,
} from '../pipeline/judge-agent';
import { PROVIDERS } from '../providers/registry';
import type { InvokeParams, InvokeResult } from '../providers/types';
import { RunLog } from '../util/run-log';

/**
 * A scenario in the new two-brief shape: it carries `testingBrief` and
 * `judgeBrief` and no `description`/`rubrics`/`acceptance` fields. The
 * judge agent must read only `judgeBrief`.
 */
function makeScenario( judgeBrief: string ): Scenario {
	return {
		name: 'demo',
		skills: [ 'demo-skill' ],
		testingBrief: 'do the task',
		judgeBrief,
	};
}

const judge: AgentDefinition = {
	id: 'grader',
	provider: 'mock',
	model: 'mock-model',
};

/**
 * Minimal config carrying an optional `roles.judge.prompt` so tests can
 * toggle the role-instructions section on and off.
 */
function makeConfig( judgePrompt?: string ): SkillsmithConfig {
	return {
		mode: 'test-only',
		agents: { [ judge.id ]: judge },
		roles: {
			test: { agents: [ judge ] },
			judge: { agent: judge, concurrency: 'parallel', prompt: judgePrompt },
			improver: { agent: judge },
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
	fn: () => Promise< unknown >,
	result: InvokeResult = {
		finalText: JSON.stringify( { pass: true, notes: 'ok' } ),
		toolUseCount: 0,
	}
): Promise< InvokeParams | undefined > {
	const original = PROVIDERS.mock.invoke;
	let captured: InvokeParams | undefined;
	PROVIDERS.mock.invoke = async (
		params: InvokeParams
	): Promise< InvokeResult > => {
		captured = params;
		return result;
	};
	try {
		await fn();
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	return captured;
}

// --- buildJudgeSystemPrompt ---------------------------------------------

test( 'buildJudgeSystemPrompt includes the verbatim judgeBrief', () => {
	const brief =
		'JUDGE_BRIEF_SENTINEL: confirm the counter increments on click.';
	const prompt = buildJudgeSystemPrompt( makeScenario( brief ), makeConfig() );
	assert.ok(
		prompt.includes( brief ),
		'the judge system prompt must contain the judgeBrief verbatim'
	);
} );

test( 'buildJudgeSystemPrompt asks for exactly the { pass, notes } object with JSON-only guidance and recursion guard', () => {
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		makeConfig()
	);
	assert.ok(
		prompt.includes( '"pass"' ) && prompt.includes( '"notes"' ),
		'the output instruction names the pass and notes keys'
	);
	assert.ok(
		/escape[\s\S]*\\n/.test( prompt ) &&
			prompt.includes( '\\"' ) &&
			prompt.includes( '\\\\' ),
		'the JSON-escaping guidance for \\n, \\", and \\\\ is retained'
	);
	assert.ok(
		/only the JSON object/i.test( prompt ) &&
			/no prose|no Markdown|Markdown fences/i.test( prompt ),
		'the prompt firmly requires JSON-only output with no prose or fences'
	);
	assert.ok(
		prompt.includes( 'skillsmith' ) && /re-enter/i.test( prompt ),
		'the recursion guard against re-entering the harness is retained'
	);
} );

test( 'buildJudgeSystemPrompt carries no rubric/acceptance scaffolding', () => {
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		makeConfig()
	);
	assert.ok(
		! /rubric/i.test( prompt ),
		'no rubric scaffolding remains in the judge prompt'
	);
	assert.ok(
		! /acceptance/i.test( prompt ),
		'no acceptance scaffolding remains in the judge prompt'
	);
} );

test( 'buildJudgeSystemPrompt appends roles.judge.prompt as a Role instructions section when set', () => {
	const rolePrompt = 'ROLE_PROMPT_SENTINEL: prefer the live environment.';
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		makeConfig( rolePrompt )
	);
	assert.ok(
		prompt.includes( '# Role instructions' ) &&
			prompt.includes( rolePrompt ),
		'the role prompt is appended under a Role instructions heading'
	);
} );

test( 'buildJudgeSystemPrompt omits the Role instructions section when no role prompt is set', () => {
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		makeConfig()
	);
	assert.ok(
		! prompt.includes( '# Role instructions' ),
		'no Role instructions heading appears without a role prompt'
	);
} );

// --- parseJudgeJson ------------------------------------------------------

test( 'parseJudgeJson parses a bare { pass, notes } object', () => {
	assert.deepEqual( parseJudgeJson( '{"pass":true,"notes":"x"}' ), {
		pass: true,
		notes: 'x',
	} );
} );

test( 'parseJudgeJson recovers the verdict from a prose-wrapped object via the lenient fallback', () => {
	assert.deepEqual(
		parseJudgeJson(
			'Here is my verdict: {"pass":false,"notes":"y"}'
		),
		{ pass: false, notes: 'y' }
	);
} );

test( 'parseJudgeJson lenient fallback takes the last balanced object in the text', () => {
	assert.deepEqual(
		parseJudgeJson(
			'Working notes {"draft":1}. Final verdict: {"pass":true,"notes":"done"}'
		),
		{ pass: true, notes: 'done' }
	);
} );

test( 'parseJudgeJson returns undefined for fully unparseable text', () => {
	assert.equal(
		parseJudgeJson( 'no json here at all, just prose.' ),
		undefined
	);
} );

// --- buildUserMessage ----------------------------------------------------

test( 'buildUserMessage inlines each readable workspace file as a fenced block read from the given workspace', () => {
	const workspace = mkdtempSync( join( tmpdir(), 'judge-msg-' ) );
	writeFileSync( join( workspace, 'result.txt' ), 'GATE_PASS\n' );
	mkdirSync( join( workspace, 'src' ), { recursive: true } );
	writeFileSync( join( workspace, 'src', 'index.js' ), 'export const a = 1;' );

	const msg = buildUserMessage( makeScenario( 'grade it' ), workspace, [
		'result.txt',
		'src/index.js',
	] );

	assert.ok(
		msg.includes( '=== result.txt ===\nGATE_PASS' ),
		'result.txt is inlined with its === <rel> === header and verbatim body'
	);
	assert.ok(
		msg.includes( 'GATE_PASS' ),
		'the GATE_PASS marker appears verbatim in the judge prompt'
	);
	assert.ok(
		msg.includes( '=== src/index.js ===\nexport const a = 1;' ),
		'nested files are inlined with their relative path header'
	);
} );

test( 'buildUserMessage emits the no-files fallback when nothing was written', () => {
	const workspace = mkdtempSync( join( tmpdir(), 'judge-msg-empty-' ) );
	const msg = buildUserMessage( makeScenario( 'grade it' ), workspace, [] );
	assert.ok(
		msg.includes( '=== (no files written) ===' ),
		'the no-files fallback block is present'
	);
} );

test( 'buildUserMessage does not read scenario.description or any removed scenario field', () => {
	const workspace = mkdtempSync( join( tmpdir(), 'judge-msg-nodesc-' ) );
	writeFileSync( join( workspace, 'a.txt' ), 'body' );
	// A scenario with no description/rubrics/acceptance fields at all.
	const scenario = makeScenario( 'grade it' );

	const msg = buildUserMessage( scenario, workspace, [ 'a.txt' ] );
	assert.ok(
		! msg.includes( 'undefined' ),
		'a missing description must not leak the string "undefined" into the message'
	);
	assert.ok(
		msg.includes( '=== a.txt ===\nbody' ),
		'the produced file is still inlined'
	);
} );

// --- runJudgeAgent -------------------------------------------------------

/**
 * Stand up a judge-copy workspace and a (distinct) canonical workspace on
 * disk so a test can prove the judge reads from — and runs in — the copy.
 */
function makeWorkspaces( marker: string ): {
	agentWorkspace: string;
	judgeWorkspace: string;
} {
	const root = mkdtempSync( join( tmpdir(), 'judge-run-' ) );
	const agentWorkspace = join( root, 'workspace' );
	const judgeWorkspace = join( root, 'judge-workspace' );
	mkdirSync( agentWorkspace, { recursive: true } );
	mkdirSync( judgeWorkspace, { recursive: true } );
	// Only the judge copy carries the marker file.
	writeFileSync( join( judgeWorkspace, 'result.txt' ), `${ marker }\n` );
	return { agentWorkspace, judgeWorkspace };
}

test( 'runJudgeAgent invokes the judge with cwd set to the judge-copy workspace', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.equal(
		captured.cwd,
		judgeWorkspace,
		'the judge runs with cwd set to the judge-copy workspace'
	);
	assert.equal( captured.role, 'judge', 'the role is judge' );
} );

test( 'runJudgeAgent inlines files read from the judge-copy workspace, not the canonical one', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.ok(
		captured.prompt.includes( '=== result.txt ===\nGATE_PASS' ),
		'the marker from the judge copy reaches the judge prompt verbatim'
	);
} );

test( 'runJudgeAgent assembles capabilities from the judge agent definition passthrough keys', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const capableJudge: AgentDefinition = {
		id: 'grader',
		provider: 'mock',
		model: 'mock-model',
		tools: [ 'Read', 'Bash' ],
		mcpServers: { demo: { command: 'node', args: [ 's.js' ] } },
		allowWrite: true,
		network: false,
	};

	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge: capableJudge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.deepEqual(
		captured.capabilities,
		{
			tools: [ 'Read', 'Bash' ],
			mcpServers: { demo: { command: 'node', args: [ 's.js' ] } },
			allowWrite: true,
			network: false,
		},
		'capabilities mirror the judge agent definition passthrough keys'
	);
} );

test( 'runJudgeAgent omits unset capability keys, leaving the provider default in place', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.deepEqual(
		captured.capabilities,
		{},
		'a judge with no capability keys yields an empty capabilities object'
	);
} );

test( 'runJudgeAgent returns the parsed { pass, notes } verdict on success', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: JSON.stringify( { pass: false, notes: 'missing marker' } ),
		toolUseCount: 0,
	} );
	let result: unknown;
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} );
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	assert.deepEqual( result, { pass: false, notes: 'missing marker' } );
} );

test( 'runJudgeAgent degrades to an error payload when the verdict is unparseable', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: 'totally not json',
		toolUseCount: 0,
	} );
	let result: unknown;
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} );
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	assert.deepEqual( result, {
		error: 'unparseable',
		raw: 'totally not json',
	} );
} );

test( 'runJudgeAgent parses a prose-wrapped verdict via the lenient fallback', async () => {
	const { agentWorkspace, judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: 'My verdict is: {"pass":true,"notes":"looks good"}',
		toolUseCount: 0,
	} );
	let result: unknown;
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			agentWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			config: makeConfig(),
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
		} );
	} finally {
		PROVIDERS.mock.invoke = original;
	}
	assert.deepEqual( result, { pass: true, notes: 'looks good' } );
} );
