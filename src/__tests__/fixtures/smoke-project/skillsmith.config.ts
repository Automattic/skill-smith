import { defineConfig } from '../../../index';

export default defineConfig( {
	mode: 'test-only',
	agents: {
		haiku: { provider: 'mock', model: 'claude-haiku-4-5-20251001' },
		sonnet: { provider: 'mock', model: 'claude-sonnet-4-6' },
		opus: { provider: 'mock', model: 'claude-opus-4-7' },
	},
	roles: {
		test: { agents: [ 'haiku', 'sonnet' ] },
		judge: 'opus',
		improver: 'opus',
	},
	paths: {
		base: './.skillsmith',
	},
} );
