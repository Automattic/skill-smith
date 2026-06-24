import { defineConfig } from '../../../index';

// A runnable test agent (`mock-ok`) that genuinely fails the gated
// scenario alongside a misconfigured `gpt`. Exercises exit-code
// precedence: the skip and the real failure both surface, and the skip
// outranks the failure for the exit code.
export default defineConfig( {
	mode: 'test-only',
	agents: {
		'mock-ok': { provider: 'mock', model: 'mock-model' },
		gpt: { provider: 'openai-api', model: 'gpt-4o-mini' },
		judge: { provider: 'mock', model: 'mock-model' },
		improver: { provider: 'mock', model: 'mock-model' },
	},
	roles: {
		test: { agents: [ 'mock-ok', 'gpt' ] },
		judge: 'judge',
		improver: 'improver',
	},
	paths: {
		base: './.skillsmith',
	},
} );
