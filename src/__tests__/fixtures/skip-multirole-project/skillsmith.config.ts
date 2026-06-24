import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '../../../index';

// `gpt` fills both the test and judge roles, backed by `openai-api`. When
// OPENAI_API_KEY is unset it is misconfigured in both roles; the
// most-severe consequence (the judge's) wins, so the whole run stops just
// as in the judge-skip case. `beforeAll` writes a marker to prove it
// never ran.
export default defineConfig( {
	mode: 'test-only',
	agents: {
		'mock-ok': { provider: 'mock', model: 'mock-model' },
		gpt: { provider: 'openai-api', model: 'gpt-4o-mini' },
		improver: { provider: 'mock', model: 'mock-model' },
	},
	roles: {
		test: { agents: [ 'mock-ok', 'gpt' ] },
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
