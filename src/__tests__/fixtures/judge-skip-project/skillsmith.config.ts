import { defineConfig } from '../../../index';

export default defineConfig( {
	mode: 'test-only',
	agents: {
		ok: { provider: 'mock', model: 'mock-model' },
		'mock-fail-testing': { provider: 'mock', model: 'mock-model' },
		opus: { provider: 'mock', model: 'mock-model' },
	},
	roles: {
		test: { agents: [ 'ok', 'mock-fail-testing' ] },
		judge: 'opus',
		improver: 'opus',
	},
	paths: {
		base: './.skillsmith',
	},
} );
