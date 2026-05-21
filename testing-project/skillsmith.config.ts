import { execFileSync, execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "skillsmith";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const BLOCK_NAME = "skillsmith/testing-block";
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const WP_ENV_PORT = Number(process.env.WP_ENV_PORT ?? 8987);

function pluginSlug(scenarioName: string, agentId: string): string {
	if (!SLUG_PATTERN.test(scenarioName)) {
		throw new Error(
			`scenario name must match ${SLUG_PATTERN}, got: ${JSON.stringify(scenarioName)}`,
		);
	}
	if (!SLUG_PATTERN.test(agentId)) {
		throw new Error(
			`agent id must match ${SLUG_PATTERN}, got: ${JSON.stringify(agentId)}`,
		);
	}
	return `plugin-${scenarioName}-${agentId}`;
}

function pluginIndexPhp(pluginSlug: string): string {
	return `<?php
/**
 * Plugin Name: ${pluginSlug}
 * Description: Auto-scaffolded by skillsmith. Plugin slug is preserved across the run — do not rename.
 * Version:     0.1.0
 * License:     GPL-3.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'init',
	static function () {
		// Prefer the wp-scripts build output (which ships view.asset.php
		// declaring script-module dependencies like @wordpress/interactivity-router);
		// fall back to raw src/ for plugins that don't need a build.
		$blocks_dir = __DIR__ . '/build/blocks';
		if ( ! is_dir( $blocks_dir ) ) {
			$blocks_dir = __DIR__ . '/src/blocks';
		}
		if ( ! is_dir( $blocks_dir ) ) {
			return;
		}
		foreach ( (array) glob( $blocks_dir . '/*', GLOB_ONLYDIR ) as $block_path ) {
			if ( file_exists( $block_path . '/block.json' ) ) {
				register_block_type( $block_path );
			}
		}
	}
);
`;
}

function agentsMd(slug: string): string {
	return `# Workspace instructions

A WordPress plugin scaffold lives at \`${slug}/\`. Implement the requested work inside this scaffold — do not create a new plugin or rename the existing one.
A block named \`${BLOCK_NAME}\` lives at \`${slug}/src/blocks/testing-block/\` and is registered in \`${slug}/index.php\`. Implement the block as needed for the task, but do not change the block name or registration mechanism.
`;
}

function blockJson(): string {
	return `${JSON.stringify(
		{
			$schema: "https://schemas.wp.org/trunk/block.json",
			apiVersion: 3,
			name: BLOCK_NAME,
			title: "Testing Block",
			category: "widgets",
		},
		null,
		2,
	)}\n`;
}

export default defineConfig({
	agents: {
		testing: [
			{
				id: "haiku",
				provider: "claude-code",
				model: "claude-haiku-4-5-20251001",
			},
			{
				id: "anthropic-sonnet",
				provider: "anthropic-api",
				model: "claude-sonnet-4-6",
			},
			{
				id: "openai-api-nano",
				provider: "openai-api",
				model: "gpt-5.4-nano",
			},
			{ id: "codex-mini", provider: "codex", model: "gpt-5.4-mini" },
			{
				id: "codex-gpt55",
				provider: "codex",
				model: "gpt-5.5",
			},
			{
				id: "gemini-flash",
				provider: "gemini-api",
				model: "gemini-2.5-flash",
			},
		],
		judge: [
			{
				id: "codex",
				provider: "codex",
				model: "gpt-5.5",
				effort: "xhigh",
			},
		],
	},

	hooks: {
		// Plugin slug stays unique per (scenario, agent) so afterAll can
		// activate them independently; the block name is fixed because the
		// e2e specs reference it directly.
		beforeTestAgent: ({ scenario, agent, agentWorkspace }) => {
			const slug = pluginSlug(scenario.name, agent.id);
			const pluginDir = join(agentWorkspace, slug);
			const blockDir = join(pluginDir, "src", "blocks", "testing-block");

			mkdirSync(blockDir, { recursive: true });
			writeFileSync(join(pluginDir, "index.php"), pluginIndexPhp(slug));
			writeFileSync(
				join(pluginDir, "package.json"),
				`${JSON.stringify({ name: slug, version: "0.1.0", private: true }, null, 2)}\n`,
			);
			writeFileSync(join(blockDir, "block.json"), blockJson());
			writeFileSync(join(agentWorkspace, "AGENTS.md"), agentsMd(slug));
		},

		afterAll: ({ runId, config, scenarios }) => {
			const runDirectory = join(config.paths.base, runId);
			const reportPath = join(runDirectory, "tests-report.json");
			const e2eSpecs = scenarios.map(({ dirName }) =>
				join("eval", "scenarios", dirName, "e2e.spec.mjs"),
			);
			// `.wp-env.json` is gitignored and owned by this hook: it lives
			// only for the duration of the run and is removed afterwards.
			const wpEnvConfigPath = join(PROJECT_ROOT, ".wp-env.json");

			const pluginPaths: string[] = [];
			for (const scenarioEntry of readdirSync(runDirectory, {
				withFileTypes: true,
			})) {
				if (!scenarioEntry.isDirectory()) continue;
				const scenarioDir = join(runDirectory, scenarioEntry.name);
				for (const agentEntry of readdirSync(scenarioDir, {
					withFileTypes: true,
				})) {
					if (!agentEntry.isDirectory()) continue;
					const workspaceDir = join(scenarioDir, agentEntry.name, "workspace");
					if (!existsSync(workspaceDir)) continue;
					for (const pluginEntry of readdirSync(workspaceDir, {
						withFileTypes: true,
					})) {
						if (!pluginEntry.isDirectory()) continue;
						if (!pluginEntry.name.startsWith("plugin-")) continue;
						pluginPaths.push(join(workspaceDir, pluginEntry.name));
					}
				}
			}

			// Build each plugin with wp-scripts so view.asset.php is emitted
			// next to view.js, declaring script-module dependencies.
			const wpScriptsBin = join(
				PROJECT_ROOT,
				"node_modules",
				".bin",
				"wp-scripts",
			);
			for (const pluginPath of pluginPaths) {
				if (!existsSync(join(pluginPath, "src", "blocks"))) continue;
				try {
					execFileSync(wpScriptsBin, ["build"], {
						stdio: "inherit",
						cwd: pluginPath,
						env: { ...process.env, WP_EXPERIMENTAL_MODULES: "1" },
					});
				} catch (err) {
					console.error(`wp-scripts build failed for ${pluginPath}:`, err);
				}
			}

			writeFileSync(
				wpEnvConfigPath,
				`${JSON.stringify(
					{
						plugins: pluginPaths,
						port: WP_ENV_PORT,
						testsEnvironment: false,
						// wp-env always runs `wp plugin activate <basename>` for
						// every entry in `plugins` during start; `afterStart`
						// fires after that, so deactivating everything here
						// gives e2e tests a clean slate to activate exactly the
						// plugin they're exercising.
						lifecycleScripts: {
							afterStart: "npx wp-env run cli wp plugin deactivate --all",
						},
					},
					null,
					2,
				)}\n`,
			);

			const wpEnv = {
				...process.env,
				WP_ENV_PORT: String(WP_ENV_PORT),
				WP_BASE_URL: `http://localhost:${WP_ENV_PORT}`,
			};
			try {
				execSync("npm run env:start", {
					stdio: "inherit",
					cwd: PROJECT_ROOT,
					env: wpEnv,
				});
				execFileSync("npm", ["run", "test:e2e", "--", ...e2eSpecs], {
					stdio: "inherit",
					cwd: PROJECT_ROOT,
					env: { ...wpEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
				});
			} finally {
				try {
					execSync("npm run env:stop", {
						stdio: "inherit",
						cwd: PROJECT_ROOT,
						env: wpEnv,
					});
				} catch (err) {
					console.error("wp-env stop failed:", err);
				}
				rmSync(wpEnvConfigPath, { force: true });
			}
		},
	},
});
