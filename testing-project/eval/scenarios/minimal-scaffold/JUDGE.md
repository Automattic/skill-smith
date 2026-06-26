You are grading the smallest correctly-wired WordPress Interactivity API block. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The block should render the text "Hello from iAPI" and log "iapi-ready" to the console once per instance on hydration. Confirm all of the following in the produced code:

- The literal text "Hello from iAPI" is emitted by `render.php` (server-rendered output), not injected client-side from `view.js`.
- The `console.log("iapi-ready")` call lives inside an init callback registered on the store (e.g. `store("<namespace>", { callbacks: { <name>() { console.log("iapi-ready"); } } })`) — not as a top-level statement in `view.js`, not inside a `data-wp-on--*` handler, and not inside a `data-wp-watch` callback.
- The wrapper element rendered by `render.php` carries `data-wp-init="callbacks.<name>"` referencing that init callback so the runtime invokes it on hydration.

## Live checks

Open the published post. Confirm the page shows the text "Hello from iAPI". Watch the browser console while the page hydrates: the message "iapi-ready" must be logged (this only happens if the runtime actually picked the block up via its `data-wp-init` callback). Also confirm the block wrapper carries a non-empty `data-wp-interactive` namespace attribute.

# Rubrics

- wp-interactivity-api-best-practices
