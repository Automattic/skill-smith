import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Scaffold the WordPress plugin a testing agent implements against,
 * under `<agentWorkspace>/<slug>/`. The plugin slug stays unique per
 * (scenario, agent) so the e2e run can activate each independently; the
 * block name is fixed because the e2e specs reference it directly.
 */
export function scaffoldPlugin(
	agentWorkspace: string,
	scenarioName: string,
	agentId: string,
): void {
	const slug = pluginSlug(scenarioName, agentId);
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
}
