# Environment

How to operate the WordPress environment around each scenario run. All commands run from the `testing-project/` directory.

This file is a prose spec for a future `environment.ts` that implements the harness `Environment` contract. Until that lands, an agent can follow these instructions directly.

The harness executes the stages below in the order shown in `assets/skill-tester-workflow.png`:

- **Lifecycle stages** (required): `## Setup`, `## Verify`, `## Teardown`. Every project must define what happens here.
- **Hooks** (optional customization points): `## beforeEachScenario`, `## afterTestingAgent`, `## afterJudgeAgent`, `## afterEachScenario`. A hook section may be left as a no-op.

## Setup (once per run)

Run:

    npm run env:start

This boots `@wordpress/env`. WordPress comes up at http://localhost:8888 with `./eval/testing-plugin` mounted and activated in its seed state.

## beforeEachScenario

No-op for this project. Seed state is maintained by `## afterEachScenario` at the end of the previous pair; the first pair inherits the seed state from `## Setup`.

## afterTestingAgent

Preserve the agent's produced plugin state immediately after the testing agent returns, so a human can inspect what each model wrote before downstream stages (judge, verify) run:

    cp -R eval/testing-plugin/. <results-dir>/plugin-snapshot/

`<results-dir>` is `.results/<run-id>/<model>/<scenario>/` — the same directory where `judge-result.json`, `e2e-result.json`, and `trace.json` are later written. Create the destination directory first if it does not exist.

## afterJudgeAgent

No-op for this project.

## Verify (after each scenario)

Run the scenario's end-to-end spec against the live environment:

    npm run test:e2e -- eval/scenarios/<scenario>/e2e.spec.mjs

The verdict is pass when Playwright exits `0`, fail otherwise. Capture stdout and stderr as details.

## afterEachScenario

Restore `eval/testing-plugin/` to its seed state so the next pair starts clean. The procedure, no git involved:

1. **Empty the directory without removing it.** `wp-env` bind-mounts `eval/testing-plugin/` into the container at `env:start`; if the directory's inode is replaced, the mount detaches and WordPress stops seeing the plugin. Use `rm -rf eval/testing-plugin/*` (optionally plus `rm -rf eval/testing-plugin/.[!.]*` if dotfiles are expected) — never `rm -rf eval/testing-plugin` itself.
2. Recreate the two seed files verbatim from the blocks below.

After cleanup, only these two files exist under `eval/testing-plugin/`:

### `eval/testing-plugin/index.php`

```php
<?php
/**
 * Plugin Name: Testing Plugin
 * Description: Harness target plugin. Agents write block code into src/blocks/testing-block/ or this file.
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
```

### `eval/testing-plugin/src/blocks/testing-block/block.json`

```json
{
	"$schema": "https://schemas.wp.org/trunk/block.json",
	"apiVersion": 3,
	"name": "testing-plugin/testing-block",
	"title": "Testing Block",
	"category": "widgets",
	"textdomain": "testing-plugin"
}
```

## Teardown (once per run)

Run:

    npm run env:stop
