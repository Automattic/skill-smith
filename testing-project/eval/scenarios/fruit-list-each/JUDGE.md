You are grading a WordPress interactive block that renders a fruit list server-side via `data-wp-each` with an "Add Mango" button that appends. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A WordPress site has been stood up with the produced block built and activated. You have these values available as environment variables:

- `$SKILLSMITH_JUDGE_URL` — the URL of a published post that renders the block. Load this page to exercise the block live.
- `$SKILLSMITH_POST_ID` — the numeric ID of that test post.
- `$SKILLSMITH_PLUGIN_SLUG` — the slug of the activated plugin that contains the block.

## Scenario requirements

The list should already contain "Apple", "Banana", "Cherry" on load, with an "Add Mango" button below it. Confirm all of the following in the produced code:

- The `fruits` array is seeded server-side through the Interactivity API — either via `wp_interactivity_state()` (global state) or via `wp_interactivity_data_wp_context()` (local context). It must NOT be hand-encoded JSON in HTML attributes, and must NOT be a PHP-only variable that never enters Interactivity state/context. The initial value is the three strings "Apple", "Banana", "Cherry" in that order.
- The `<ul>` renders its items via `data-wp-each` iterating the seeded fruits collection (e.g. `data-wp-each="state.fruits"` or `data-wp-each="context.fruits"`), with the per-item `<li>` defined inside a child `<template>` element — not a PHP `foreach` that emits static `<li>` tags.
- The `<li>` inside the `<template>` binds its text via `data-wp-text` referencing the per-iteration context item (e.g. `data-wp-text="context.item"`), rather than echoing the value through PHP or assigning it from JS.
- The three initial `<li>` elements are present in the server-rendered HTML produced by `data-wp-each`'s server-side hydration of the seeded fruits array, so the list is visible before JavaScript runs.
- A named store action is wired to the "Add Mango" button through `data-wp-on--click` (no manual `addEventListener` in view.js).
- The "Add Mango" action mutates the existing fruits array in place via `.push("Mango")` (or equivalent in-place mutation) rather than reassigning the array, so `data-wp-each` reactivity picks up the new item.

## Live checks

Load the post at `$SKILLSMITH_JUDGE_URL`. Confirm the list shows exactly three items in order: "Apple", "Banana", "Cherry". Click "Add Mango": a fourth `<li>` reading "Mango" must appear at the end of the list. Click "Add Mango" again: a fifth `<li>` reading "Mango" must appear, leaving the earlier items unchanged.

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
