You are grading a WordPress interactive counter block whose value is shared across all instances on the page via global state. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A WordPress site has been stood up with the produced block built and activated. You have these values available as environment variables:

- `$SKILLSMITH_JUDGE_URL` — the URL of a published post that renders the block. Load this page to exercise the block live.
- `$SKILLSMITH_POST_ID` — the numeric ID of that test post.
- `$SKILLSMITH_PLUGIN_SLUG` — the slug of the activated plugin that contains the block.

The test post embeds the block twice so you can verify the instances share one value.

## Scenario requirements

Every instance shows the same number (starting at 0); clicking "Increment" on any one must bump the value on all of them. Confirm all of the following in the produced code:

- The counter value lives in global state seeded via `wp_interactivity_state()` (not in `data-wp-context` / `wp_interactivity_data_wp_context()`), so it is shared across instances rather than per-instance.
- The initial global state for the counter is seeded to 0 on the server.
- Every rendered instance uses the same `data-wp-interactive` namespace string, and that namespace matches the one passed to `store()`.
- The displayed value is bound with `data-wp-text` referencing the global state property (e.g. `state.counter`), not a context property.
- A named increment action is wired via `data-wp-on--click` on the Increment button.
- The increment action mutates the shared `state.*` counter property (not a `context.*` property).

## Live checks

Load the post at `$SKILLSMITH_JUDGE_URL`, which renders the block twice. Confirm both instances show 0. Click the first instance's "Increment" button: BOTH displays must update to 1 in lockstep. Click the second instance's button: both must read 2. Click the first instance again: both must read 3 — proving every instance shares one global value.

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
