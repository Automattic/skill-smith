You are grading a WordPress interactive block that paginates a post list using a router region for client-side navigation. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, then insert the block on a published post. Create enough additional posts that the list spans more than one page. Open the post embedding the block in the browser to run the live checks below.

## Scenario requirements

The block should list the 3 newest posts (newest first, titles linked) with "Previous"/"Next" controls and an in-place page swap. Confirm all of the following in the produced code:

- The wrapper around the post list and Next/Previous controls carries `data-wp-router-region` (with a stable region id) so the runtime knows what to swap on client-side navigation.
- Next/Previous controls are real `<a>` anchors whose `href` is the canonical `?pg=<n>` URL for the target page, so the block works with JavaScript disabled.
- Each Next/Previous anchor wires its click through `data-wp-on--click` (no manual `addEventListener` in view.js) bound to a store action that performs the in-place swap.
- The click action is wrapped with `withSyncEvent` so it can call `event.preventDefault()` synchronously before yielding, suppressing the browser's default full-page navigation.
- The click action is a generator (`function*`), dynamically imports the router via `yield import('@wordpress/interactivity-router')`, and calls its `actions.navigate(href)` with the anchor's own `href`.
- `render.php` reads `$_GET['pg']` (defaulting to 1 when absent / invalid) and uses it to compute which 3-post slice of the latest-posts query to render, so the correct posts are present in the initial server-rendered HTML.
- `block.json`'s `supports.interactivity` registers the view module for router-driven loading — the boolean `true` shorthand or the explicit `{ "interactive": true, "clientNavigation": true }` form (the bare `{ "clientNavigation": true }` without `interactive: true` does NOT enable client-side navigation for a block that drives the router).
- On page 1 the "Previous" control must not be present in the accessibility tree, and on the last page the "Next" control must not be — required server-side, before JS hydrates (e.g. omitted server-side, or rendered with `data-wp-bind--hidden` bound to a derived getter the Server Directive Processor turns into the `hidden` attribute; an inline expression like `context.pg <= 1` does NOT work because SDP does not evaluate it).

## Live checks

Open the published post. Confirm page 1 shows the 3 newest posts and that no "Previous" link is present (it is absent from the accessibility tree on the initial HTML). Click "Next": the post list must swap in place to page 2 (older posts now shown, newest no longer shown) WITHOUT a full page reload, and the URL must update to include `?pg=2`. A reliable signal that the swap was client-side: set a sentinel value on `window` before clicking and confirm it survives the navigation (a full reload would wipe it).

# Rubrics

- wp-interactivity-api-best-practices
