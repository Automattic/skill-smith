import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mockProvider } from '../providers/mock';
import type { InvokeParams } from '../providers/types';
import { classifyVerdict } from '../reports/verdict';

/**
 * Build a judge-role {@link InvokeParams} for the mock provider, defaulting
 * the unused testing-only fields and letting each test override only the
 * `prompt` (the seam the gated judge keys off).
 */
function judgeParams( overrides: Partial< InvokeParams > = {} ): InvokeParams {
	const cwd = overrides.cwd ?? mkdtempSync( join( tmpdir(), 'mock-judge-' ) );
	return {
		agent: { id: 'j', provider: 'mock', model: 'mock' },
		systemPrompt: 'judge system prompt',
		prompt: 'judge user prompt',
		cwd,
		role: 'judge',
		...overrides,
	};
}

test( 'mock judge pass path returns { pass: true, notes }', async () => {
	const result = await mockProvider.invoke( judgeParams() );
	const verdict = JSON.parse( result.finalText );
	assert.equal( verdict.pass, true );
	assert.equal( typeof verdict.notes, 'string' );
} );

test( 'mock judge fail path returns { pass: false, notes }', async () => {
	const result = await mockProvider.invoke(
		judgeParams( { prompt: 'inlined result.txt: GATE_FAIL\n' } )
	);
	const verdict = JSON.parse( result.finalText );
	assert.equal( verdict.pass, false );
	assert.equal( typeof verdict.notes, 'string' );
	assert.ok(
		verdict.notes.length > 0,
		'fail verdict surfaces explanatory notes'
	);
} );

test( 'classifyVerdict on the mock pass output yields PASS', async () => {
	const result = await mockProvider.invoke( judgeParams() );
	const cell = classifyVerdict( JSON.parse( result.finalText ) );
	assert.equal( cell.kind, 'PASS' );
} );

test( 'classifyVerdict on the mock fail output yields FAIL with notes surfaced', async () => {
	const result = await mockProvider.invoke(
		judgeParams( { prompt: 'inlined result.txt: GATE_FAIL\n' } )
	);
	const verdict = JSON.parse( result.finalText );
	const cell = classifyVerdict( verdict );
	assert.equal( cell.kind, 'FAIL' );
	assert.deepEqual(
		cell.kind === 'FAIL' ? cell.failures : [],
		[ verdict.notes ],
		'the fail notes are surfaced as a failure entry'
	);
} );

test( 'gated judge passes once the GATE_PASS marker propagates', async () => {
	// The testing agent inlines its produced `result.txt` into the judge
	// user message; once the improver appends the marker, that file reads
	// GATE_PASS and the judge must pass.
	const passResult = await mockProvider.invoke(
		judgeParams( { prompt: 'inlined result.txt: GATE_PASS\n' } )
	);
	assert.equal(
		classifyVerdict( JSON.parse( passResult.finalText ) ).kind,
		'PASS'
	);

	const failResult = await mockProvider.invoke(
		judgeParams( { prompt: 'inlined result.txt: GATE_FAIL\n' } )
	);
	assert.equal(
		classifyVerdict( JSON.parse( failResult.finalText ) ).kind,
		'FAIL'
	);
} );

test( 'gated testing agent writes the verdict the judge keys off', async () => {
	// GATE present but MARKER absent → GATE_FAIL written to result.txt.
	const failCwd = mkdtempSync( join( tmpdir(), 'mock-testing-' ) );
	const failRun = await mockProvider.invoke( {
		agent: { id: 't', provider: 'mock', model: 'mock' },
		systemPrompt: 'testing agent MOCK_GATE skill body',
		prompt: 'testing user prompt',
		cwd: failCwd,
		role: 'testing',
	} );
	assert.equal( failRun.finalText, 'GATE_FAIL' );
	assert.match(
		readFileSync( join( failCwd, 'result.txt' ), 'utf8' ),
		/GATE_FAIL/
	);

	// GATE and MARKER both present → GATE_PASS written to result.txt.
	const passCwd = mkdtempSync( join( tmpdir(), 'mock-testing-' ) );
	const passRun = await mockProvider.invoke( {
		agent: { id: 't', provider: 'mock', model: 'mock' },
		systemPrompt: 'testing agent MOCK_GATE SKILLSMITH_LOOP_OK skill body',
		prompt: 'testing user prompt',
		cwd: passCwd,
		role: 'testing',
	} );
	assert.equal( passRun.finalText, 'GATE_PASS' );
	assert.match(
		readFileSync( join( passCwd, 'result.txt' ), 'utf8' ),
		/GATE_PASS/
	);
} );
