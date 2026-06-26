You are grading a WordPress interactive counter block that an agent produced. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The block should show a number that starts at 5, plus "Increment" and "Decrement" buttons. Confirm all of the following in the produced code:

- There are named store actions for increment and decrement that modify the counter state.
- Both the increment and decrement buttons are wired with `data-wp-on--click`.
- The counter value is displayed reactively via `data-wp-text` (or an equivalent directive) — not assigned by hand from `view.js`.
- The server-rendered HTML includes the initial counter value (5).

## Live checks

Open the published post. Confirm the rendered counter shows 5. Click the "Increment" button; the number must become 6. Click "Decrement" twice; the number must become 4.

# Rubrics

- wp-interactivity-api-best-practices
