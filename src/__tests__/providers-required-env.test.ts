/**
 * Each provider is imported directly from its file (not via `registry.ts`)
 * so the test does not depend on the Codex SDK being installable in the
 * test environment — see `src/providers/registry.ts:8`, which instantiates
 * `Codex` at module load.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anthropicApiProvider } from '../providers/anthropic-api';
import { createClaudeCodeProvider } from '../providers/claude-code';
import { geminiApiProvider } from '../providers/gemini-api';
import { mockProvider } from '../providers/mock';
import { openaiApiProvider } from '../providers/openai-api';

// The provider is built from a factory; its `requiredEnv` does not depend
// on the query implementation, so a no-op stub is enough to inspect it.
const claudeCodeProvider = createClaudeCodeProvider( async function* () {} );

test( 'credentialed providers declare the env var their credential requires', () => {
	assert.equal( openaiApiProvider.requiredEnv, 'OPENAI_API_KEY' );
	assert.equal( anthropicApiProvider.requiredEnv, 'ANTHROPIC_API_KEY' );
	assert.equal(
		geminiApiProvider.requiredEnv,
		'GOOGLE_GENERATIVE_AI_API_KEY'
	);
} );

test( 'providers without a static credential omit requiredEnv', () => {
	assert.equal( claudeCodeProvider.requiredEnv, undefined );
	assert.equal( mockProvider.requiredEnv, undefined );
} );
