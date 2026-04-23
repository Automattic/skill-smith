# Environment

How to operate the WordPress environment around each scenario run. All commands run from the `testing-project/` directory.

This file is a prose spec for a future `environment.ts` that implements the harness `Environment` contract. Until that lands, an agent can follow these instructions directly.

## Setup (once per run)

Run:

    npm run env:start

This boots `@wordpress/env`. WordPress comes up at http://localhost:8888 with `./eval/testing-plugin` mounted and activated.

## Reset (before each scenario)

Restore `eval/testing-plugin/` to its committed state so the agent starts every scenario from a clean slate:

- `eval/testing-plugin/index.php` matches its committed contents.
- `eval/testing-plugin/src/blocks/testing-block/` contains only the committed seed files (the minimal `block.json`).

Any files the agent wrote during a previous scenario must be removed.

## Verify (after each scenario)

Run the scenario's end-to-end spec against the live environment:

    npm run test:e2e -- eval/scenarios/<scenario>/e2e.spec.mjs

The verdict is pass when Playwright exits `0`, fail otherwise. Capture stdout and stderr as details.

## Teardown (once per run)

Run:

    npm run env:stop
