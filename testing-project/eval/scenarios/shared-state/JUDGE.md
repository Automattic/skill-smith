You are grading a WordPress interactive counter block whose value is shared across all instances on the page via global state. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, then insert the block twice on a single published post so you can verify the instances share one value. Open that post in the browser to run the live checks below.

## Scenario requirements

Every instance shows the same number (starting at 0); clicking "Increment" on any one must bump the value on all of them. Confirm all of the following in the produced code:

- The counter value lives in global state seeded via `wp_interactivity_state()` (not in `data-wp-context` / `wp_interactivity_data_wp_context()`), so it is shared across instances rather than per-instance.
- The initial global state for the counter is seeded to 0 on the server.
- Every rendered instance uses the same `data-wp-interactive` namespace string, and that namespace matches the one passed to `store()`.
- The displayed value is bound with `data-wp-text` referencing the global state property (e.g. `state.counter`), not a context property.
- A named increment action is wired via `data-wp-on--click` on the Increment button.
- The increment action mutates the shared `state.*` counter property (not a `context.*` property).

## Live checks

Open the published post, which renders the block twice. Confirm both instances show 0. Click the first instance's "Increment" button: BOTH displays must update to 1 in lockstep. Click the second instance's button: both must read 2. Click the first instance again: both must read 3 — proving every instance shares one global value.

# Rubrics

- wp-interactivity-api-best-practices
