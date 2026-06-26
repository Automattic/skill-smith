import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Non-binding placeholder name for the starter block. The agent is free to
// rename or restructure the block(s); the judge discovers block names from the
// built `block.json`, so nothing pins this value. The plugin *slug* (below)
// stays deterministic and must not be renamed.
const STARTER_BLOCK_NAME = 'example/starter-block';
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Derive the unique plugin slug for one (scenario, agent) pair:
 * `plugin-<scenarioName>-<agentId>`. The slug is the directory name the
 * scaffold writes under the agent workspace and is reused by the judge-env
 * helper to locate that plugin inside the judge copy, so both sides agree
 * on the path without hard-coding it.
 *
 * @param scenarioName - Slug-safe scenario name (`[a-z0-9-]+`).
 * @param agentId - Slug-safe agent id (`[a-z0-9-]+`).
 * @returns The plugin directory slug.
 * @throws If either argument is not slug-safe.
 * @example
 * pluginSlug( 'counter', 'haiku' ); // 'plugin-counter-haiku'
 */
export function pluginSlug( scenarioName: string, agentId: string ): string {
	if ( ! SLUG_PATTERN.test( scenarioName ) ) {
		throw new Error(
			`scenario name must match ${ SLUG_PATTERN }, got: ${ JSON.stringify( scenarioName ) }`
		);
	}
	if ( ! SLUG_PATTERN.test( agentId ) ) {
		throw new Error(
			`agent id must match ${ SLUG_PATTERN }, got: ${ JSON.stringify( agentId ) }`
		);
	}
	return `plugin-${ scenarioName }-${ agentId }`;
}

function pluginIndexPhp( pluginSlug: string ): string {
	return `<?php
/**
 * Plugin Name: ${ pluginSlug }
 * Description: Auto-scaffolded by skillsmith. The plugin slug is preserved across the run — do not rename the slug. Blocks may be freely named, restructured, or added; this file registers any built block directory by globbing.
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

function blockJson(): string {
	return `${ JSON.stringify(
		{
			$schema: 'https://schemas.wp.org/trunk/block.json',
			apiVersion: 3,
			name: STARTER_BLOCK_NAME,
			title: 'Starter Block',
			category: 'widgets',
			// Add this manually until we improve WordPress skills.
			render: 'file:./render.php',
		},
		null,
		2
	) }\n`;
}

/**
 * Scaffold the WordPress plugin a testing agent implements against,
 * under `<agentWorkspace>/<slug>/`. The plugin slug stays unique per
 * (scenario, agent) so the e2e run can activate each independently. The
 * starter block ships a non-binding placeholder name the agent may rename,
 * restructure, or replace; the judge discovers block names from the built
 * `block.json`, so nothing pins the starter name.
 */
export function scaffoldPlugin(
	agentWorkspace: string,
	scenarioName: string,
	agentId: string
): void {
	const slug = pluginSlug( scenarioName, agentId );
	const pluginDir = join( agentWorkspace, slug );
	const blockDir = join( pluginDir, 'src', 'blocks', 'testing-block' );

	mkdirSync( blockDir, { recursive: true } );
	writeFileSync( join( pluginDir, 'index.php' ), pluginIndexPhp( slug ) );
	writeFileSync(
		join( pluginDir, 'package.json' ),
		`${ JSON.stringify( { name: slug, version: '0.1.0', private: true }, null, 2 ) }\n`
	);
	writeFileSync( join( blockDir, 'block.json' ), blockJson() );
}
