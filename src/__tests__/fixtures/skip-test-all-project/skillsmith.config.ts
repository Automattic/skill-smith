import { defineConfig } from '../../../index';

// Every test agent is misconfigured when OPENAI_API_KEY is unset: the
// sole tester is `gpt`. The judge and improver are always-runnable mock
// agents. With no runnable testers the matrix is empty and the run is
// non-passing, while the skip still forces a non-zero exit.
export default defineConfig( {
	mode: 'test-only',
	agents: {
		gpt: { provider: 'openai-api', model: 'gpt-4o-mini' },
		judge: { provider: 'mock', model: 'mock-model' },
		improver: { provider: 'mock', model: 'mock-model' },
	},
	roles: {
		test: { agents: [ 'gpt' ] },
		judge: 'judge',
		improver: 'improver',
	},
	paths: {
		base: './.skillsmith',
	},
} );
