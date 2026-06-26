You are grading a WordPress interactive block that paginates a post list using a router region for client-side navigation. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A WordPress site has been stood up with the produced block built and activated. You have these values available as environment variables:

- `$SKILLSMITH_JUDGE_URL` — the URL of a published post that renders the block. Load this page to exercise the block live.
- `$SKILLSMITH_POST_ID` — the numeric ID of that test post.
- `$SKILLSMITH_PLUGIN_SLUG` — the slug of the activated plugin that contains the block.

The test post embeds the block, and additional posts have been created so the list spans more than one page.

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

Load the post at `$SKILLSMITH_JUDGE_URL`. Confirm page 1 shows the 3 newest posts and that no "Previous" link is present (it is absent from the accessibility tree on the initial HTML). Click "Next": the post list must swap in place to page 2 (older posts now shown, newest no longer shown) WITHOUT a full page reload, and the URL must update to include `?pg=2`. A reliable signal that the swap was client-side: set a sentinel value on `window` before clicking and confirm it survives the navigation (a full reload would wipe it).

## Best-practices rubric

Evaluate the produced block (PHP, JavaScript, and `block.json`) against the WordPress Interactivity API's conventions and idioms.

### Block wiring

- `block.json` declares `supports.interactivity` — either the boolean `true` form or the object form when sub-options (such as `clientNavigation`) are required.
- `block.json` declares the view module as `viewScriptModule` (NOT `viewScript`).
- The view module imports from `@wordpress/interactivity` (e.g. `store`, `getContext`, `getConfig`, `getElement`, `withSyncEvent`) — no reliance on `window.wp.*` globals.
- The root element rendered by `render.php` carries `data-wp-interactive` with a deliberate, plugin-scoped namespace string.
- The namespace passed to `store()` matches the namespace declared in `data-wp-interactive` (and any `<namespace>::path` cross-references).

### Server-side initialization

- When using global state, initial global state is seeded with `wp_interactivity_state()` — not hand-encoded JSON in HTML attributes.
- When using local context, initial local context is seeded with `wp_interactivity_data_wp_context()` — not hand-encoded JSON inside `data-wp-context`.
- Prefer local context for per-instance values; reserve global state for values shared across instances or blocks, or values read from another namespace.
- The server-rendered HTML reflects the initial state/context so the block reads correctly before JavaScript runs (no flash of unbound content).
- `render.php` does NOT hand-duplicate values that a directive will populate. The Server Directive Processing fills these in automatically from the seeded `wp_interactivity_state()` / `wp_interactivity_data_wp_context()`, so the markup should leave the directive's target unset:
    - For `data-wp-text`, leave the element's text content empty (e.g. `<span data-wp-text="context.counter"></span>`, not `<span data-wp-text="context.counter">5</span>`).
    - For `data-wp-bind--<attr>`, omit the corresponding HTML attribute (e.g. don't also write `href="..."` next to `data-wp-bind--href`).
    - For `data-wp-class--<name>` and `data-wp-style--<prop>`, don't pre-add the toggled class or inline style; the directive will add/remove it based on the seeded value.
    - For `data-wp-each`, render the `<template>` only — don't also output the seeded list items by hand; the directive emits the initial `data-wp-each-child` items server-side.
  Hand-duplicating the value is redundant and risks the markup and the seeded state/context drifting out of sync.

### Reactivity and directives

- Reactive text content is bound with `data-wp-text` — never assigned via `innerText` / `textContent`.
- Reactive attributes / classes / styles are bound with `data-wp-bind--<attr>`, `data-wp-class--<name>`, and `data-wp-style--<prop>` — never assigned by hand from `view.js`.
- DOM events are wired through the `data-wp-on*` directive family (`data-wp-on--<event>`, `data-wp-on-window--<event>`, `data-wp-on-document--<event>`, `data-wp-on-async--<event>`) — never via manual `addEventListener` calls in `view.js`.
- Store actions mutate state/context in place; the runtime handles re-rendering. No direct DOM writes (`element.style.*`, `classList.*`, `innerHTML`, etc.) inside actions/callbacks. Calling `.focus()` to manage keyboard focus is NOT a violation — focus management is a legitimate side-effect that the declarative directives don't cover.
- Directive expressions reference a single property or derived getter rather than embedding non-trivial inline logic. A simple boolean negation such as `!context.isOpen` counts as a single reference and is fine; the rubric is meant to flag arithmetic, function calls, or other non-trivial computation inlined into the directive value.

### Async actions

- Asynchronous store actions are declared as generator functions (`function*` / `*name()`) and use `yield` (never `async` / `await`) for suspending calls such as `fetch`, `.json()`, dynamic imports, `actions.navigate(...)`, and `splitTask()`.
- State or context that depends on an async result is only mutated after the corresponding `yield` resolves.
