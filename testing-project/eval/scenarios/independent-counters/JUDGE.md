You are grading a WordPress interactive counter block where each instance keeps independent state via local context. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, then insert the block twice on a single published post so you can verify the instances stay independent. Open that post in the browser to run the live checks below.

## What to check

- The per-instance counter value lives in local context (set via `data-wp-context` / `wp_interactivity_data_wp_context()`), not in global state via `wp_interactivity_state()`.
- A named increment store action mutates the counter through `getContext()` (e.g. `const ctx = getContext(); ctx.counter += 1`), not via a shared/global state reference.
- `data-wp-text` is bound to the local context property (e.g. `context.counter`) to display the value, not a global state property.

## Live checks

Open the published post, which renders the block twice. Confirm both counters start at 0. Click the first instance's "Increment" button twice: the first counter must read 2 while the second stays at 0. Then click the second instance's "Increment" button once: the second counter reads 1 while the first stays at 2 — proving the instances are independent.
