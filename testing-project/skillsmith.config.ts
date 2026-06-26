import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@automattic/skillsmith';
import { scaffoldPlugin } from './eval/utils/scaffold-plugin';
import { setUpJudgeEnv, tearDownJudgeEnv } from './eval/utils/wp-env-judge';

const here = dirname( fileURLToPath( import.meta.url ) );
const testingAgentPrompt = readFileSync(
	resolve( here, 'eval/prompts/testing-agent.md' ),
	'utf8'
);
const improverPrompt = readFileSync(
	resolve( here, 'eval/prompts/improver.md' ),
	'utf8'
);

export default defineConfig( {
	mode: 'test-only',
	agents: {
		haiku: {
			provider: 'claude-code',
			model: 'claude-haiku-4-5',
		},
		opus: {
			provider: 'claude-code',
			model: 'claude-opus-4-7',
			effort: 'xhigh',
			// The judge reads the produced files (read-only) and exercises the
			// live site: Bash drives `curl` / `wp-env run cli` for server-rendered
			// and directive checks, and the Playwright MCP server drives a real
			// browser for the interactive checks. These capability keys ride the
			// agent passthrough; no WordPress/browser tool vocabulary leaks into
			// Skillsmith core. `allowWrite` stays unset (read-only file tools) —
			// the no-modify guarantee rests on the judge copy.
			tools: [ 'Read', 'Bash' ],
			mcpServers: {
				playwright: {
					command: 'npx',
					args: [ '@playwright/mcp@latest' ],
				},
			},
		},
	},
	roles: {
		test: {
			agents: [ 'haiku' ],
			prompt: testingAgentPrompt,
		},
		// Serialize the whole beforeJudgeAgent -> judge -> afterJudgeAgent
		// bracket: each pair boots a single shared wp-env on a fixed port, and
		// vanilla wp-env cannot run two instances at once.
		judge: { agent: 'opus', concurrency: 'serial' },
		improver: { agent: 'opus', prompt: improverPrompt },
	},
	selfImprovement: {
		maxIterations: 3,
		scope: 'failed-scenarios',
	},

	hooks: {
		// Scaffold the WordPress plugin each testing agent works inside.
		beforeTestAgent: ( { scenario, agent, agentWorkspace } ) =>
			scaffoldPlugin( agentWorkspace, scenario.name, agent.id ),

		// Stand the live WordPress environment up for this pair, built from the
		// judge copy: build the plugin, boot wp-env, activate the plugin, create
		// a test post, and export the per-pair facts the JUDGE.md briefs read.
		beforeJudgeAgent: ( ctx ) => setUpJudgeEnv( ctx ),

		// Tear the environment back down and clear the per-pair env vars once
		// the judge has graded this pair.
		afterJudgeAgent: ( ctx ) => tearDownJudgeEnv( ctx ),
	},
} );
