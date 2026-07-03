import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentDefinition, Scenario } from '../config/types';
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
 * A scenario in the two-brief shape: it carries `testingBrief` and
 * `judgeBrief` and no `description`/`rubrics`/`acceptance` fields. The judge
 * agent reads `judgeBrief` verbatim and the skill-stripped `testingBrief`.
 *
 * @param judgeBrief   - The judge brief text (the prompt body).
 * @param testingBrief - The testing brief text auto-supplied as the task;
 *   defaults to a trivial brief with no `# Skills` section.
 */
function makeScenario(
	judgeBrief: string,
	testingBrief = 'do the task'
): Scenario {
	return {
		name: 'demo',
		skills: [ 'demo-skill' ],
		testingBrief,
		judgeBrief,
	};
}

/** A default task string helper: `buildJudgeSystemPrompt`'s `task` arg. */
const TASK = 'do the task';

/**
 * A pre-built `# Judge library` section as the agent loop would pass it in:
 * heading included, ready to be appended verbatim.
 */
const LIBRARY_SECTION =
	'# Judge library\nLIBRARY_SECTION_SENTINEL: manual and manifest.';

const judge: AgentDefinition = {
	id: 'grader',
	provider: 'mock',
	model: 'mock-model',
};

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
	const prompt = buildJudgeSystemPrompt( makeScenario( brief ), TASK );
	assert.ok(
		prompt.includes( brief ),
		'the judge system prompt must contain the judgeBrief verbatim'
	);
} );

test( 'buildJudgeSystemPrompt asks for exactly the { pass, notes } object with JSON-only guidance and recursion guard', () => {
	const prompt = buildJudgeSystemPrompt( makeScenario( 'grade it' ), TASK );
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
	const prompt = buildJudgeSystemPrompt( makeScenario( 'grade it' ), TASK );
	assert.ok(
		! prompt.includes( '# Grading rubrics' ),
		'no Grading rubrics section exists in the judge prompt'
	);
	assert.ok(
		! /acceptance/i.test( prompt ),
		'no acceptance scaffolding remains in the judge prompt'
	);
} );

// --- buildJudgeSystemPrompt: output instruction --------------------------

test( 'the output instruction carries the decision-rule default with the brief-override clause on every run', () => {
	const withoutLibrary = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		TASK
	);
	const withLibrary = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		TASK,
		LIBRARY_SECTION
	);
	for ( const prompt of [ withoutLibrary, withLibrary ] ) {
		assert.ok(
			prompt.includes(
				'unless the brief states its own decision rule'
			),
			'the decision rule defers to a brief that states its own rule'
		);
		assert.ok(
			/every check the brief asks for/.test( prompt ) &&
				/rubric check/.test( prompt ),
			'the default requires every brief-requested check, including rubric checks'
		);
		assert.ok(
			prompt.includes( '"pass": true' ) &&
				prompt.includes( '"pass": false' ),
			'the rule states both verdict outcomes explicitly'
		);
	}
} );

test( 'the output instruction carries the missing-material failure duty on every run, library or not', () => {
	const withoutLibrary = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		TASK
	);
	const withLibrary = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		TASK,
		LIBRARY_SECTION
	);
	for ( const prompt of [ withoutLibrary, withLibrary ] ) {
		assert.ok(
			/grading material/.test( prompt ) &&
				/not supplied or cannot\s*be read/.test( prompt ),
			'the duty is phrased against supplied grading material'
		);
		assert.ok(
			/name the missing item in `notes`/.test( prompt ),
			'the duty demands the missing item be named in notes'
		);
	}
} );

test( 'the decision rule and failure duty sit between the JSON-shape text and the recursion guard', () => {
	const prompt = buildJudgeSystemPrompt( makeScenario( 'grade it' ), TASK );
	const jsonIdx = prompt.indexOf( 'Return a single JSON object' );
	const ruleIdx = prompt.indexOf(
		'unless the brief states its own decision rule'
	);
	const dutyIdx = prompt.indexOf( 'grading material' );
	const guardIdx = prompt.indexOf( '# Recursion guard' );
	assert.ok(
		jsonIdx !== -1 && ruleIdx !== -1 && dutyIdx !== -1 && guardIdx !== -1,
		'all four landmarks are present'
	);
	assert.ok(
		jsonIdx < ruleIdx && ruleIdx < guardIdx,
		'the decision rule lands after the JSON shape and before the recursion guard'
	);
	assert.ok(
		jsonIdx < dutyIdx && dutyIdx < guardIdx,
		'the failure duty lands after the JSON shape and before the recursion guard'
	);
} );

// --- buildJudgeSystemPrompt: auto-supplied task -------------------------

test( 'buildJudgeSystemPrompt injects the auto-supplied task under a Testing task heading, placed after the judgeBrief and before the Output format section', () => {
	const brief = 'JUDGE_BRIEF_SENTINEL: confirm the counter increments.';
	const task = 'TASK_SENTINEL: build a counter block.';
	const prompt = buildJudgeSystemPrompt( makeScenario( brief ), task );
	assert.ok(
		prompt.includes( '# Testing task' ),
		'a Testing task heading is present'
	);
	assert.ok( prompt.includes( task ), 'the task text is injected verbatim' );
	const briefIdx = prompt.indexOf( brief );
	const taskHeadingIdx = prompt.indexOf( '# Testing task' );
	const outputIdx = prompt.indexOf( '# Output format' );
	assert.ok(
		briefIdx < taskHeadingIdx,
		'the Testing task section comes after the judgeBrief'
	);
	assert.ok(
		taskHeadingIdx < outputIdx,
		'the Testing task section comes before the Output format section'
	);
} );

test( 'buildJudgeSystemPrompt injects the Testing task section on every run, even with no library section', () => {
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		'TASK_SENTINEL: unconditional'
	);
	assert.ok(
		prompt.includes( '# Testing task' ) &&
			prompt.includes( 'TASK_SENTINEL: unconditional' ),
		'the Testing task section is unconditional'
	);
} );

test( 'buildJudgeSystemPrompt injects the task string verbatim, leaving skill-stripping to the caller', () => {
	// The builder is a pure string builder: it inlines whatever `task` string
	// it is handed. The caller supplies the already skill-stripped brief.
	const strippedTask = '# Task\nBuild it.';
	const prompt = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		strippedTask
	);
	assert.ok(
		prompt.includes( '# Testing task' ) && prompt.includes( strippedTask ),
		'the supplied task string is inlined verbatim under the heading'
	);
} );

// --- buildJudgeSystemPrompt: library section ------------------------------

test( 'buildJudgeSystemPrompt appends the librarySection verbatim as the final section', () => {
	const brief = 'JUDGE_BRIEF_SENTINEL: confirm the counter increments.';
	const prompt = buildJudgeSystemPrompt(
		makeScenario( brief ),
		TASK,
		LIBRARY_SECTION
	);
	assert.ok(
		prompt.includes( LIBRARY_SECTION ),
		'the library section text appears verbatim'
	);
	assert.ok(
		prompt.endsWith( LIBRARY_SECTION ),
		'the library section is the final section of the prompt'
	);
	const guardIdx = prompt.indexOf( '# Recursion guard' );
	const libraryIdx = prompt.indexOf( LIBRARY_SECTION );
	assert.ok(
		guardIdx < libraryIdx,
		'the library section comes after the output instruction'
	);
} );

test( 'buildJudgeSystemPrompt carries no library material when no section is passed', () => {
	const noSection = buildJudgeSystemPrompt( makeScenario( 'grade it' ), TASK );
	const emptySection = buildJudgeSystemPrompt(
		makeScenario( 'grade it' ),
		TASK,
		''
	);
	for ( const prompt of [ noSection, emptySection ] ) {
		assert.ok(
			! prompt.includes( '# Judge library' ),
			'no Judge library heading appears without a section'
		);
		assert.ok(
			prompt.endsWith(
				'Do not invoke `skillsmith` or any wrapper that would re-enter the harness.'
			),
			'the output instruction closes the prompt — nothing follows it'
		);
	}
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

	const msg = buildUserMessage( workspace, [ 'result.txt', 'src/index.js' ] );

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
	const msg = buildUserMessage( workspace, [] );
	assert.ok(
		msg.includes( '=== (no files written) ===' ),
		'the no-files fallback block is present'
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
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
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
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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

test( 'runJudgeAgent returns the parsed { pass, notes } verdict under review on success', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: JSON.stringify( { pass: false, notes: 'missing marker' } ),
		toolUseCount: 0,
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.deepEqual( result.review, { pass: false, notes: 'missing marker' } );
} );

test( 'runJudgeAgent sets usage when the provider reported it on the success path', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	const usage = {
		inputTokens: 40,
		cachedInputTokens: 0,
		outputTokens: 10,
		totalTokens: 50,
	};
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: JSON.stringify( { pass: true, notes: 'ok' } ),
		toolUseCount: 0,
		usage,
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.deepEqual( result.review, { pass: true, notes: 'ok' } );
	assert.deepEqual(
		result.usage,
		usage,
		'usage mirrors the InvokeResult usage on the success path'
	);
} );

test( 'runJudgeAgent omits usage when the provider reported none on the success path', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: JSON.stringify( { pass: true, notes: 'ok' } ),
		toolUseCount: 0,
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.equal(
		result.usage,
		undefined,
		'usage is unset when the provider reported none'
	);
} );

test( 'runJudgeAgent degrades review to an error payload but keeps usage when the verdict is unparseable', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	const usage = {
		inputTokens: 40,
		cachedInputTokens: 0,
		outputTokens: 10,
		totalTokens: 50,
	};
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: 'totally not json',
		toolUseCount: 0,
		usage,
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.deepEqual( result.review, {
		error: 'unparseable',
		raw: 'totally not json',
	} );
	assert.deepEqual(
		result.usage,
		usage,
		'usage is retained on the unparseable path'
	);
} );

test( 'runJudgeAgent omits usage on the dispatch-failed path', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: '',
		toolUseCount: 0,
		error: 'transport exploded',
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.deepEqual( result.review, {
		error: 'judge dispatch failed: transport exploded',
		raw: '',
	} );
	assert.equal(
		result.usage,
		undefined,
		'usage is unset when dispatch failed before a usage report'
	);
} );

test( 'runJudgeAgent embeds a passed librarySection into the judge system prompt', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
			log: new RunLog(),
			testingResult: {
				finalText: '',
				toolUseCount: 0,
				filesWritten: [ 'result.txt' ],
			},
			librarySection: LIBRARY_SECTION,
		} )
	);

	assert.ok( captured, 'provider.invoke must be called' );
	assert.ok(
		captured.systemPrompt.includes( LIBRARY_SECTION ),
		'the library section reaches the judge system prompt verbatim'
	);
	assert.ok(
		! captured.prompt.includes( 'LIBRARY_SECTION_SENTINEL' ),
		'the library section stays out of the judge user message'
	);
} );

test( 'runJudgeAgent carries no library material when no librarySection is passed', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
		! captured.systemPrompt.includes( '# Judge library' ),
		'no Judge library section appears without a librarySection'
	);
} );

test( 'runJudgeAgent auto-supplies the testing brief as the task, with its # Skills section removed', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const testingBrief = [
		'# Task',
		'TASK_SENTINEL: build a counter block.',
		'# Skills',
		'- SKILL_SENTINEL_wp-interactivity-api',
	].join( '\n' );
	const scenario = makeScenario( 'grade it', testingBrief );

	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario,
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
		captured.systemPrompt.includes( '# Testing task' ),
		'the system prompt carries a Testing task section'
	);
	assert.ok(
		captured.systemPrompt.includes( 'TASK_SENTINEL: build a counter block.' ),
		'the task body reaches the judge prompt'
	);
	assert.ok(
		! captured.systemPrompt.includes(
			'SKILL_SENTINEL_wp-interactivity-api'
		),
		'the # Skills section is stripped from the auto-supplied task'
	);
	const briefIdx = captured.systemPrompt.indexOf( 'grade it' );
	const taskIdx = captured.systemPrompt.indexOf( '# Testing task' );
	assert.ok(
		briefIdx !== -1 && taskIdx !== -1 && briefIdx < taskIdx,
		'the task is placed after the judgeBrief'
	);
} );

test( 'runJudgeAgent keeps the task out of the judge user message', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const testingBrief = 'TASK_SENTINEL: build a counter block.';
	const scenario = makeScenario( 'grade it', testingBrief );

	const captured = await captureInvoke( () =>
		runJudgeAgent( {
			scenario,
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
		! captured.prompt.includes( 'TASK_SENTINEL: build a counter block.' ),
		'the user message contains no task text'
	);
	assert.ok(
		captured.prompt.includes( '=== result.txt ===\nGATE_PASS' ),
		'the user message still carries only the produced files'
	);
} );

test( 'runJudgeAgent parses a prose-wrapped verdict via the lenient fallback', async () => {
	const { judgeWorkspace } = makeWorkspaces( 'GATE_PASS' );
	const original = PROVIDERS.mock.invoke;
	PROVIDERS.mock.invoke = async (): Promise< InvokeResult > => ( {
		finalText: 'My verdict is: {"pass":true,"notes":"looks good"}',
		toolUseCount: 0,
	} );
	let result: { review: unknown; usage?: unknown };
	try {
		result = await runJudgeAgent( {
			scenario: makeScenario( 'grade it' ),
			judge,
			agentDirectory: judgeWorkspace,
			judgeWorkspace,
			projectRoot: judgeWorkspace,
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
	assert.deepEqual( result.review, { pass: true, notes: 'looks good' } );
} );
