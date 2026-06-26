import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@automattic/skillsmith';
import { scaffoldPlugin } from './eval/utils/scaffold-plugin';
import {
	bootJudgeEnv,
	cleanUpPair,
	installPluginForPair,
	stopJudgeEnv,
} from './eval/utils/wp-env-judge';

const here = dirname( fileURLToPath( import.meta.url ) );
const testingAgentPrompt = readFileSync(
	resolve( here, 'eval/prompts/testing-agent.md' ),
	'utf8'
);
const judgePrompt = readFileSync(
	resolve( here, 'eval/prompts/judge.md' ),
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
		// bracket: every pair stages its plugin onto a single shared wp-env on a
		// fixed port, and vanilla wp-env cannot run two instances at once. The
		// judge prompt is the reusable "environment manual" carrying the runtime
		// mechanics (the WP-CLI bridge, the post-create template, the post URL
		// shape, and block discovery) that the per-scenario JUDGE.md briefs build
		// on.
		judge: { agent: 'opus', prompt: judgePrompt, concurrency: 'serial' },
		improver: { agent: 'opus', prompt: improverPrompt },
	},
	selfImprovement: {
		maxIterations: 3,
		scope: 'failed-scenarios',
	},

	// Reusable rubric definitions a scenario's JUDGE.md can reference by id.
	paths: {
		rubrics: './eval/rubrics',
	},

	hooks: {
		// Boot the single warm WordPress environment once before the scenario
		// sweep begins.
		beforeAllScenarios: () => bootJudgeEnv(),

		// Stop the warm environment and clear the host state it owns once the
		// whole sweep has been graded. Returns nothing, so the harness folds the
		// run back as a pass.
		afterAllScenarios: () => stopJudgeEnv(),

		// Scaffold the WordPress plugin each testing agent works inside.
		beforeTestAgent: ( { scenario, agent, agentWorkspace } ) =>
			scaffoldPlugin( agentWorkspace, scenario.name, agent.id ),

		// Stage this pair's produced plugin onto the warm environment, built from
		// the judge copy, and export the per-pair facts the JUDGE.md briefs read.
		beforeJudgeAgent: ( ctx ) => installPluginForPair( ctx ),

		// Tear this pair off the warm environment and clear its per-pair env vars
		// once the judge has graded the pair; the environment stays up for the
		// next pair.
		afterJudgeAgent: ( ctx ) => cleanUpPair( ctx ),
	},
} );
