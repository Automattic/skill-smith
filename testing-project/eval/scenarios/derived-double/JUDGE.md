You are grading a WordPress interactive block that shows a counter and its doubled value computed via a derived getter. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A WordPress site has been stood up with the produced block built and activated. You have these values available as environment variables:

- `$SKILLSMITH_JUDGE_URL` — the URL of a published post that renders the block. Load this page to exercise the block live.
- `$SKILLSMITH_POST_ID` — the numeric ID of that test post.
- `$SKILLSMITH_PLUGIN_SLUG` — the slug of the activated plugin that contains the block.

## Scenario requirements

The block should show a counter (starting at 1) next to a value that is always exactly double it, plus an "Increment" button. Confirm all of the following in the produced code:

- The counter is the only mutable numeric field in state/context, and the client-side store exposes the doubled value as a derived getter (computed from the counter on read) — not as a separately stored mutable field. Seeding the doubled value alongside the counter in `wp_interactivity_state()` for server-side rendering is acceptable (the static-derived-state pattern); the test is that the client store has only one mutable field plus a `double` getter, and that no action ever writes to `double`.
- There is a named increment action that mutates only the counter (e.g. `state.counter++` or the context equivalent); it never assigns to the doubled field.
- `data-wp-on--click` on the increment button is wired to the increment action.
- The doubled value in the directive expression references the derived getter directly (e.g. `state.double`), not an inline arithmetic expression like `state.counter * 2` or a duplicated stored field.
- The server-rendered HTML includes the initial values (1 for the counter and 2 for the doubled value) so both read correctly before JavaScript hydrates.

## Live checks

Load the post at `$SKILLSMITH_JUDGE_URL`. Confirm the block initially shows 1 and 2. Click "Increment" once; the two numbers must become 2 and 4. Click it again; they must become 3 and 6. The doubled value must stay exactly twice the counter on every click.

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
