import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { InvokeParams, InvokeResult, Provider } from './types';

/**
 * Sentinels that opt a fixture into the deterministic self-improvement
 * loop behaviour exercised by `self-improvement-loop.test.ts`. A skill
 * carrying `MOCK_GATE` is "fixed" once it also carries `MOCK_MARKER`;
 * the mock improver is what appends the marker between iterations.
 * Fixtures without `MOCK_GATE` keep the original always-pass behaviour
 * relied on by the smoke and agent-loop tests.
 */
const GATE = 'MOCK_GATE';
const MARKER = 'SKILLSMITH_LOOP_OK';

const PASS_JSON = JSON.stringify( { pass: true, notes: 'mock' } );

const FAIL_JSON = JSON.stringify( {
	pass: false,
	notes: 'skill is missing the marker',
} );

const MOCK_USAGE = {
	inputTokens: 100,
	cachedInputTokens: 0,
	outputTokens: 50,
	totalTokens: 150,
};

/**
 * Deterministic provider used by tests and dry runs. Drops a sentinel
 * file in the workspace for the testing role; returns a passing JSON
 * verdict for the judge role. Gated branches (see `GATE`) let a fixture
 * drive a full multi-iteration improvement loop with no real model.
 */
export const mockProvider: Provider = {
	id: 'mock',
	async invoke( params: InvokeParams ): Promise< InvokeResult > {
		if ( params.role === 'testing' ) {
			return invokeTesting( params );
		}
		return invokeJudge( params );
	},
};

function invokeTesting( params: InvokeParams ): InvokeResult {
	// Improver agent: its cwd is the skills root. Edit the skills
	// directly by appending the success marker to every SKILL.md it
	// finds — no proposal, no reviewer, no executor.
	if ( params.systemPrompt.includes( 'improver agent' ) ) {
		const edited = applyMarkerToSkills( params.cwd );
		return {
			finalText: `improver applied marker to ${ edited } skill(s)`,
			toolUseCount: edited,
		};
	}

	// Sentinel id used by `agent-loop.test.ts` to exercise the
	// "testing failed → judge skipped" branch deterministically.
	if ( params.agent.id === 'mock-fail-testing' ) {
		return {
			finalText: '',
			toolUseCount: 0,
			error: 'mock testing failure',
		};
	}

	// Gated testing agent: the skill text is inlined into the system
	// prompt, so surface whether it already carries the marker. The
	// judge keys off the file we write here.
	if ( params.systemPrompt.includes( GATE ) ) {
		const ok = params.systemPrompt.includes( MARKER );
		const verdict = ok ? 'GATE_PASS' : 'GATE_FAIL';
		writeFileSync( join( params.cwd, 'result.txt' ), `${ verdict }\n` );
		return { finalText: verdict, toolUseCount: 1, usage: MOCK_USAGE };
	}

	writeFileSync(
		join( params.cwd, 'mock-output.txt' ),
		`mock testing output for ${ params.agent.id }\n`
	);
	return {
		finalText: `mock testing output for ${ params.agent.id }`,
		toolUseCount: 0,
		usage: MOCK_USAGE,
	};
}

function invokeJudge( params: InvokeParams ): InvokeResult {
	// Report usage on every judge verdict so the `judging.tokenUsage`
	// block is exercised end-to-end (the agent loop persists it iff the
	// provider reports usage).
	// Gated judge: the testing agent's workspace files are inlined into
	// the user prompt. Fail until the skill edit propagates a pass.
	if ( params.prompt.includes( 'GATE_FAIL' ) ) {
		return { finalText: FAIL_JSON, toolUseCount: 0, usage: MOCK_USAGE };
	}
	if ( params.prompt.includes( 'GATE_PASS' ) ) {
		return { finalText: PASS_JSON, toolUseCount: 0, usage: MOCK_USAGE };
	}

	return { finalText: PASS_JSON, toolUseCount: 0, usage: MOCK_USAGE };
}

// Append the success marker to every immediate <dir>/SKILL.md under
// skillsDir that doesn't already carry it. Returns the count edited.
function applyMarkerToSkills( skillsDir: string ): number {
	let edited = 0;
	let entries: Dirent[];
	try {
		entries = readdirSync( skillsDir, { withFileTypes: true } );
	} catch {
		return 0;
	}
	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) continue;
		const skillPath = join( skillsDir, entry.name, 'SKILL.md' );
		if ( ! existsSync( skillPath ) ) continue;
		const body = readFileSync( skillPath, 'utf8' );
		if ( body.includes( MARKER ) ) continue;
		writeFileSync( skillPath, `${ body }\n${ MARKER }\n` );
		edited++;
	}
	return edited;
}
