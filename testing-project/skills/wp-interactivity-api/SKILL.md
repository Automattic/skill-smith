---
name: wp-interactivity-api
description: "Must use when building any kind of frontend interactivity in WordPress — dynamic or static blocks, classic themes, anything using data-wp-* directives, the @wordpress/interactivity package, wp_interactivity_state/wp_interactivity_data_wp_context/wp_interactivity_config helpers, the interactivity-router, or whenever a task involves making server-rendered WordPress markup interactive (toggles, menus, counters, filters, lightboxes, client-side navigation, etc.). Use this even if the user does not mention 'Interactivity API' by name."
---

# WordPress Interactivity API

The Interactivity API is WordPress's standard system for client-side behavior in server-rendered markup. It pairs HTML directives (`data-wp-interactive`, `data-wp-bind--*`, `data-wp-on--*`, `data-wp-context`, …) with a reactive store (`state`, `actions`, `callbacks`) so a block stays declarative, renders correctly server-side, and hydrates on the client without rewriting its markup.

It requires **WordPress 6.5+**.

## Core mental model

- **Declarative, not imperative.** Describe what the UI depends on, not how to mutate the DOM. Bind attributes/text/classes/styles with `data-wp-*` directives; mutate `state` or `context` in actions; let the runtime update the DOM.
- **Server-rendered first, then hydrated.** WordPress's Server Directive Processor (SDP) reads the seeded state/context and applies the directives in PHP, so the HTML that ships to the browser is already in its final form. The client store then takes over without re-rendering.
- **Use a deliberate namespace.** Pick one plugin-scoped namespace string, preferably the block name or plugin slug path such as `my-plugin/my-block`, and reuse it exactly in `data-wp-interactive`, every `store( '<namespace>' )` call, `wp_interactivity_state()`, `wp_interactivity_config()`, and namespaced directive references. Avoid generic names like `myPlugin`, `testingBlock`, `counter`, or `app`.
- **State lives in three places, on purpose:**
  - **Local context** (`wp_interactivity_data_wp_context()` / `data-wp-context`) — per-instance UI state, scoped to a subtree. The default for anything that should be independent across block instances.
  - **Global state** (`wp_interactivity_state()` / `store().state`) — reserved for data genuinely shared across blocks/instances or values SDP needs to render.
  - **Derived state** — getters on `state` that compute from other state/context. Never store what you can compute. When you use derived state, remember it has two halves: the JS getter and a server seed in `wp_interactivity_state()` so SDP can substitute it — see `references/server-rendering.md`.
- **Mutation is direct.** Unlike React/Redux, you mutate `state` and `context` in place (`state.list.push(...)`, `context.isOpen = !context.isOpen`). Don't spread/copy — the proxy-based reactivity needs the same reference.
- **`getContext()` and `getElement()` are scoped to the current action call.** `getContext()` returns the local context for the closest `data-wp-context` ancestor; `getElement()` returns `{ ref, attributes }` where `ref` is the element that owns the directive that fired this action — not the block wrapper, not the event target. Attach listeners to the element whose subtree you need to query (see pitfalls).

## Minimal working example

```php
// render.php
<?php
$namespace = 'my-plugin/toggle-block';
$context = array( 'isOpen' => false );
?>
<div
  data-wp-interactive="<?php echo esc_attr( $namespace ); ?>"
  <?php echo wp_interactivity_data_wp_context( $context ); ?>
  <?php echo get_block_wrapper_attributes(); ?>
>
  <button
    data-wp-on--click="actions.toggle"
    data-wp-bind--aria-expanded="context.isOpen"
  >Toggle</button>
  <p data-wp-bind--hidden="!context.isOpen">Now visible.</p>
</div>
```

```js
// view.js
import { store, getContext } from '@wordpress/interactivity';

store( 'my-plugin/toggle-block', {
  actions: {
    toggle() {
      const context = getContext();
      context.isOpen = ! context.isOpen;
    },
  },
} );
```

```json
// block.json
{
  "supports": { "interactivity": true },
  "viewScriptModule": "file:./view.js",
  "render": "file:./render.php"
}
```

## When to read references

Reach for these as the task demands; do not load them all up front.

- [references/directives.md](references/directives.md) — full directive reference (`data-wp-bind`, `data-wp-class`, `data-wp-style`, `data-wp-text`, `data-wp-on--*`, `data-wp-on-window--*`, `data-wp-on-document--*`, `data-wp-watch`, `data-wp-init`, `data-wp-run`, `data-wp-key`, `data-wp-each`, `data-wp-context`, `data-wp-interactive`). Read when you need exact syntax or semantics for a directive.
- [references/store.md](references/store.md) — store API in depth: `store()`, `getContext()`, `getElement()`, `getServerState()`, `getServerContext()`, `getConfig()`, `withScope()`, `withSyncEvent()`, async actions (generators), private stores, namespacing, when to use global state vs context vs derived state. Read for any non-trivial JS logic.
- [references/server-rendering.md](references/server-rendering.md) — `block.json` setup, `wp_interactivity_state()`, `wp_interactivity_data_wp_context()`, `wp_interactivity_config()`, `wp_interactivity_process_directives()`, server-side derived state (static + closure), classic-theme integration. **Read whenever you write `render.php`** — the seeding rules are easy to get wrong and the failure modes are silent.
- [references/client-navigation.md](references/client-navigation.md) — `@wordpress/interactivity-router`, router regions, `actions.navigate()` / `actions.prefetch()`, `data-wp-key` for reconciliation, server-state sync across navigations. Read only when the task involves client-side navigation, region replacement, pagination, or in-place page swaps.
- [references/typescript.md](references/typescript.md) — typing patterns for stores, server state, local context, derived state, async actions, multi-block stores. Read only if the codebase uses TypeScript.

## Common pitfalls

Internalize these before writing code — they cause most of the bugs that slip past a first pass.

- **Directive values are references, not expressions.** A directive's value is a single reference to a store property or callback, optionally prefixed with `!` and optionally namespaced (`otherPlugin::state.foo`). Anything more — arithmetic, comparisons (`<=`, `===`), function calls (`state.items.length`), ternaries, template literals — must move into a derived getter and be referenced by name. The PHP Server Directive Processor only evaluates simple references; if you inline JS-style expressions, the directive does not affect the server-rendered HTML and the page renders incorrectly until hydration. See `references/directives.md` ("Expression form").
- **`getElement().ref` is the directive's host element, not the wrapper.** When an action must query DOM that isn't a descendant of the listener element — e.g. an Escape handler that closes a drawer and refocuses a sibling "Menu" button, or a Tab handler that enumerates links from one of them — attach the directive (`data-wp-on--*` / `data-wp-on-document--*` / `data-wp-on-window--*`) to the block's wrapper (or another common ancestor) so `ref` covers everything you need. Attaching it to an inner element and then calling `ref.querySelector(...)` silently returns null/empty. The API has no `data-wp-ref` directive — element references come only from `getElement().ref` inside actions/callbacks.

  ```html
  <!-- Directive on the WRAPPER, so getElement().ref covers the whole subtree. -->
  <div data-wp-interactive="myPlugin" data-wp-on-document--keydown="actions.onKey">
    <button class="menu-toggle" data-wp-on--click="actions.open">Menu</button>
    <div class="drawer" hidden><a href="#one">One</a></div>
  </div>
  ```

  ```js
  actions: {
    onKey( event ) {
      if ( event.key !== 'Escape' ) return;
      const { ref } = getElement(); // the wrapper — directive lives there
      ref.querySelector( 'button.menu-toggle' ).focus();
    },
  },
  ```
- **A block with a `view.js` needs `viewScriptModule` in `block.json`.** `supports.interactivity: true` alone does NOT register the view module — `wp-scripts` only treats `view.js` as an entry point when `block.json` declares `"viewScriptModule": "file:./view.js"` (the script-module field, not the legacy `viewScript`). Without it, `view.js` is not built into the plugin's output directory, nothing is enqueued, no directives hydrate, and any `actions.navigate()` link silently falls back to a full-page reload. Do NOT compensate by calling `wp_register_script_module()` / `wp_enqueue_script_module()` from `render.php` — that is the classic-theme path and typically points at a `view.js` that `wp-scripts` never emitted.
- **Per-instance UI state belongs in local context, not global state.** A toggle's `isOpen`, a counter that should be independent across instances, a drawer's expanded flag, or fetched data displayed only inside one block instance must live in `wp_interactivity_data_wp_context()` and be read/mutated through `getContext()`. Putting per-instance UI in `wp_interactivity_state()` makes every block instance share the same value and update together. Reach for `wp_interactivity_state()` only when the data is genuinely shared across all instances (a site-wide cart count, a shared filter, AJAX URLs/nonces) or when seeding a derived getter that SDP needs.
- **Don't hand-duplicate values a directive will populate.** Leave `data-wp-text` / `data-wp-bind--*` targets empty, don't pre-add classes/styles a directive will toggle, and emit only the `<template>` for `data-wp-each`. SDP fills them in from the seeded state/context.
- **Async actions are generators, not `async`/`await`.** The runtime must restore scope (`getContext()`, `getElement()`) across awaits. Use `function* () { … yield somePromise; … }`. If the async result belongs to the current block instance, seed it in local context on the server and call `const context = getContext();` inside the generator, then assign `context.result = data.result` after the relevant `yield` resolves. Actions that need synchronous access to the event (`event.preventDefault()`, `event.stopPropagation()`, `event.currentTarget`) must be wrapped in `withSyncEvent()`.
- **Mutate, don't replace.** `state.list.push(x)` and `context.foo = y` are correct. `state.list = [...state.list, x]` breaks reactivity for consumers that hold the old reference and is the wrong shape for SDP-seeded arrays.
- **Initialize derived state on the server too.** A getter defined only in `view.js` won't run during SDP, so directives referencing the derived value render empty (or the wrong shape) until JS hydrates. Mirror the value in `wp_interactivity_state()` — a static value when known up-front, or a PHP closure (calling `wp_interactivity_state()` / `wp_interactivity_get_context()`) for per-instance / per-iteration cases. See `references/server-rendering.md`.
