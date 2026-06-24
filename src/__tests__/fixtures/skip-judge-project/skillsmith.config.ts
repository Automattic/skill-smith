import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '../../../index';

// The judge is misconfigured whenever OPENAI_API_KEY is unset, which
// stops the whole run before any hook fires or any report is written.
// `beforeAll` writes a marker so a test can assert it never ran.
export default defineConfig( {
	mode: 'test-only',
	agents: {
		tester: { provider: 'mock', model: 'mock-model' },
		gpt: { provider: 'openai-api', model: 'gpt-4o-mini' },
		improver: { provider: 'mock', model: 'mock-model' },
	},
	roles: {
		test: { agents: [ 'tester' ] },
		judge: 'gpt',
		improver: 'improver',
	},
	paths: {
		base: './.skillsmith',
	},
	hooks: {
		beforeAll: ( ctx ) => {
			writeFileSync(
				join( ctx.runDirectory, 'before-all-fired.marker' ),
				'fired'
			);
		},
	},
} );
