// Projects would import from 'skill-smith' in a real project.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "../src";

const BLOCK_NAME = "testing-plugin/testing-block";

function pluginIndexPhp(pluginSlug: string): string {
	return `<?php
/**
 * Plugin Name: ${pluginSlug}
 * Description: Auto-scaffolded by skill-smith. Plugin slug is preserved across the run — do not rename.
 * Version:     0.1.0
 * License:     GPL-3.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'init',
	static function () {
		$blocks_dir = __DIR__ . '/src/blocks';
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

function blockJson(): string {
	return `${JSON.stringify(
		{
			$schema: "https://schemas.wp.org/trunk/block.json",
			apiVersion: 3,
			name: BLOCK_NAME,
			title: "Testing Block",
			category: "widgets",
			textdomain: "testing-plugin",
		},
		null,
		2,
	)}\n`;
}

export default defineConfig({
	agents: {
		testing: {
			haiku: "claude-haiku-4-5-20251001",
			sonnet: "claude-sonnet-4-6",
			opus: "claude-opus-4-7",
		},
		judge: {
			opus: { model: "claude-opus-4-7", effort: "xhigh" },
		},
	},

	hooks: {
		// Plugin slug stays unique per (scenario, agent) so afterAll can
		// activate them independently; the block name is fixed because the
		// e2e specs reference it directly.
		beforeTestAgent: ({ scenario, agentId, agentWorkspace }) => {
			const pluginSlug = `plugin-${scenario.name}-${agentId}`;
			const blockDir = join(agentWorkspace, "src", "blocks", "testing-block");

			mkdirSync(blockDir, { recursive: true });
			writeFileSync(
				join(agentWorkspace, "index.php"),
				pluginIndexPhp(pluginSlug),
			);
			writeFileSync(join(blockDir, "block.json"), blockJson());
		},

		afterAll: ({ runId, config }) => {
			const reportPath = join(
				config.paths.base,
				runId,
				"tests-report.json",
			);

			execSync("npm run env:start", { stdio: "inherit" });
			try {
				execSync("npm run test:e2e", {
					stdio: "inherit",
					env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
				});
			} finally {
				execSync("npm run env:stop", { stdio: "inherit" });
			}
		},
	},
});
