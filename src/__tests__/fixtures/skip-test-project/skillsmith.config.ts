import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '../../../index';

// One runnable test agent (`mock-ok`) and one that is misconfigured
// whenever OPENAI_API_KEY is unset (`gpt`). The judge and improver are
// always-runnable mock agents. `beforeTestAgent` records which agent ids
// it actually fired for, so a test can assert the skipped agent was never
// provisioned.
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
	hooks: {
		beforeTestAgent: ( ctx ) => {
			appendFileSync(
				join( ctx.runDirectory, 'test-agent-fired.log' ),
				`${ ctx.agent.id }\n`
			);
		},
	},
} );
