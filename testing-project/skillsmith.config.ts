import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "skillsmith";
import { runE2eVerification } from "./eval/verify-e2e";

const BLOCK_NAME = "skillsmith/testing-block";
const SLUG_PATTERN = /^[a-z0-9-]+$/;

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
The root element rendered by \`render.php\` must apply \`<?php echo get_block_wrapper_attributes(); ?>\` so WordPress emits the standard block class (\`wp-block-skillsmith-testing-block\`) and any block-supports attributes on the wrapper. Adding your own \`class="..."\` attribute alongside the helper is fine; replacing the helper with a hand-written class is not.
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
			// Add this manually until we improve WordPress skills.
			render: "file:./render.php",
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
				id: "opus",
				provider: "claude-code",
				model: "claude-opus-4-6",
			},
			// {
			// 	id: "anthropic-sonnet",
			// 	provider: "anthropic-api",
			// 	model: "claude-sonnet-4-6",
			// },
			// {
			// 	id: "openai-api-nano",
			// 	provider: "openai-api",
			// 	model: "gpt-5.4-nano",
			// },
			{ id: "codex-mini", provider: "codex", model: "gpt-5.4-mini" },
			{
				id: "codex-gpt55",
				provider: "codex",
				model: "gpt-5.5",
			},
			// {
			// 	id: "gemini-flash",
			// 	provider: "gemini-api",
			// 	model: "gemini-2.5-flash",
			// },
		],
		judge: [
			{
				id: "codex",
				provider: "codex",
				model: "gpt-5.5",
				effort: "xhigh",
			},
		],
		// Single agent that edits the failing skills between iterations in
		// loop mode. It edits SKILL.md files in place — no proposal,
		// reviewer, or git.
		improver: {
			id: "improver",
			provider: "claude-code",
			model: "claude-opus-4-6",
		},
	},

	// Self-improvement is opt-in. With `agents.improver` set, a run with
	// `--mode loop` will, after each failing iteration, let the improver
	// edit the relevant SKILL.md files and re-run the failing scenarios.
	// `--mode test-only` (the default) ignores it entirely. Point
	// `paths.improverPrompt` at a file to replace the built-in improver
	// instructions with a project-specific strategy.
	selfImprovement: {
		mode: "test-only",
		maxIterations: 3,
		evaluationMode: "failed-scenarios",
		// paths: { improverPrompt: "./eval/improvement/improver.md" },
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

		// Run the e2e suite against the artifacts this iteration produced,
		// after the judges have graded them but before the improver runs.
		// A spec failure marks that exact (scenario, agent) pair failed —
		// even if the judge passed it — so the improver learns the code
		// looked right but broke in a real runtime, and the loop iterates.
		afterAllScenarios: ({ scenarios, iterationDirectory }) => {
			const failures = runE2eVerification(iterationDirectory, scenarios);
			return failures.length > 0 ? { failures } : true;
		},
	},
});
