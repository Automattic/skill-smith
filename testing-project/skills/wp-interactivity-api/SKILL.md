---
name: wp-interactivity-api
description: "Must use when building any kind of frontend interactivity in WordPress — dynamic or static blocks, classic themes, anything using data-wp-* directives, the @wordpress/interactivity package, wp_interactivity_state/wp_interactivity_data_wp_context/wp_interactivity_config helpers, the interactivity-router, or whenever a task involves making server-rendered WordPress markup interactive (toggles, menus, counters, filters, lightboxes, client-side navigation, etc.). Use this even if the user does not mention 'Interactivity API' by name."
---

# WordPress Interactivity API

Declarative `data-wp-*` directives on HTML paired with a reactive store (`state`, `actions`, `callbacks`). The server pre-renders final HTML from seeded state/context; the client hydrates without re-rendering. Requires WordPress 6.5+.

## Hard rules — every one matters

1. **`block.json` MUST declare `"viewScriptModule": "file:./view.js"`.** `supports.interactivity: true` alone does NOT register the view module. Without `viewScriptModule`, `view.js` is never built, nothing hydrates, `actions.navigate()` falls back to a full reload. Do NOT compensate with `wp_register_script_module()` in a block's `render.php`.
2. **The wrapper element MUST carry `data-wp-interactive="<namespace>"`.** Use the same namespace string in `store()`, `wp_interactivity_state()`, `wp_interactivity_config()`.
3. **`render.php` MUST start in HTML mode — no leading `<?php` left open over the markup.** Use `<?php … ?>` only for the PHP bits (a `$ctx` assignment above the markup, inline `<?php echo … ?>` for helpers). A bare `<?php` opener followed by `<div …>` makes PHP parse the HTML as code → fatal error, block never renders.
   - WRONG: `<?php` on line 1, then `<div data-wp-interactive="…">…</div>` with no `?>`.
   - RIGHT: file begins with `<div data-wp-interactive="…" <?php echo get_block_wrapper_attributes(); ?>>…</div>` (or a `<?php $ctx = […]; ?>` block that closes before the markup).
4. **Seed every reactive value on the server, including empty starting values.** Anything a directive reads (`state.x`, `context.x`, `state.derived`) must exist before JS runs.
   - Per-instance values → `wp_interactivity_data_wp_context([...])` on the wrapper.
   - Cross-instance / SDP-needed values → `wp_interactivity_state('<namespace>', [...])`.
   - Static config (REST URLs, nonces, flags) → `wp_interactivity_config('<namespace>', [...])`.
   - An empty paragraph still needs `'joke' => ''`; a placeholder still needs `'title' => '(no post loaded yet)'`.
5. **Per-instance UI state lives in local context — that is the default.** A counter, a toggle's `isOpen`, a per-instance fetched value — all `wp_interactivity_data_wp_context()` + `getContext()`. Only use `wp_interactivity_state()` when the value is explicitly shared across instances/blocks (see "Local context vs global state" below).
6. **Derived state is a JS GETTER on `state`, never a stored field, and never assigned to.** The directive ALWAYS binds `state.<derived-name>` — never `context.<derived-name>`, even when the underlying source lives in local context. Seed the derived value on the server with `wp_interactivity_state()` (a closure form when the source is per-instance context) so SDP renders the initial value before hydration. Full pattern in [Derived state — per-instance pattern](#derived-state--per-instance-pattern) below.
7. **Async actions are generators, not `async`/`await`.** `function* () { yield fetch(...); }`. `getContext()` / `getElement()` work across `yield`s; `async`/`await` breaks scope restoration.
8. **Wrap with `withSyncEvent()` when the handler synchronously needs `event.preventDefault()` / `stopPropagation()` / `currentTarget`** (e.g. router-navigation click handlers). Full list in [references/store.md](references/store.md).
9. **Mutate in place.** `state.list.push(x)`, `context.foo = y`. Never `state.list = [...state.list, x]` — breaks reactivity.
10. **Never hand-duplicate values a directive will populate.** WRONG: `<span data-wp-text="state.count">0</span>`. RIGHT: `<span data-wp-text="state.count"></span>`. Same rule for bound attributes (omit attribute when `data-wp-bind--<attr>` is set), toggled classes/styles (don't pre-add them), and `data-wp-each` (emit only `<template>` — SDP writes the `<li data-wp-each-child>` items).
11. **Wire all reactive behavior through directives.** `data-wp-text` (not `innerText`), `data-wp-bind--*`, `data-wp-class--*`, `data-wp-on--*` / `data-wp-on-document--*` / `data-wp-on-window--*`. No `addEventListener`, `classList.*`, `style.*`, or `innerHTML` from `view.js`. `.focus()` for focus management is the one allowed DOM write. Directive values are single references (`state.x`, `!context.isOpen`, `ns::state.x`) — move any arithmetic/comparisons/calls into a derived getter.

## Standard skeleton

```json
// block.json
{
  "apiVersion": 3,
  "name": "my-plugin/my-block",
  "title": "My Block",
  "category": "widgets",
  "supports": { "interactivity": true },
  "render": "file:./render.php",
  "viewScriptModule": "file:./view.js"
}
```

```php
// render.php — toggle, seeded context, declarative directives
<?php $ctx = array( 'isOpen' => false ); ?>
<div
  data-wp-interactive="my-plugin/my-block"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
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

store( 'my-plugin/my-block', {
  actions: {
    toggle() {
      const context = getContext();
      context.isOpen = ! context.isOpen;
    },
  },
} );
```

## Local context vs global state

Local context is the default. Reach for global state only when the value is **explicitly shared across instances/blocks** — e.g. "the same counter on every instance on the page", a site-wide filter, a value seeded for `data-wp-each`, or REST URLs / nonces (which usually go in `wp_interactivity_config()`). Anything else — a counter, a toggle, a per-instance fetched result — belongs in local context.

```php
// Local context (default) — each instance has its own counter.
<?php $ctx = array( 'counter' => 5 ); ?>
<div
  data-wp-interactive="my-plugin/counter"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
  <?php echo get_block_wrapper_attributes(); ?>
>
  <span data-wp-text="context.counter"></span>
  <button data-wp-on--click="actions.increment">+</button>
  <button data-wp-on--click="actions.decrement">-</button>
</div>
```

```js
store( 'my-plugin/counter', {
  actions: {
    increment() { getContext().counter += 1; },
    decrement() { getContext().counter -= 1; },
  },
} );
```

```php
// Global state (only when the prompt asks for a single shared value).
<?php wp_interactivity_state( 'my-plugin/tally', array( 'counter' => 0 ) ); ?>
<div data-wp-interactive="my-plugin/tally" <?php echo get_block_wrapper_attributes(); ?>>
  <span data-wp-text="state.counter"></span>
  <button data-wp-on--click="actions.increment">+</button>
</div>
```

```js
const { state } = store( 'my-plugin/tally', {
  actions: { increment() { state.counter += 1; } },
} );
```

If in doubt, pick local context — dropping two instances of a global-state block onto the same page makes them share a number, which is almost never what the prompt asked for.

## Derived state — per-instance pattern

The source of truth (e.g. `counter`) lives in local context. The derived value (e.g. `double`) is a JS getter on `state` that reads from `getContext()`. The directive binds `state.double` — never `context.double`. The server seeds the derived value with a closure inside `wp_interactivity_state()`, which calls `wp_interactivity_get_context()` for the current instance.

```php
<?php $ctx = array( 'counter' => 1 ); ?>
<?php wp_interactivity_state( 'my-plugin/counter', array(
  'double' => function () {
    return wp_interactivity_get_context()['counter'] * 2;
  },
) ); ?>
<div
  data-wp-interactive="my-plugin/counter"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
  <?php echo get_block_wrapper_attributes(); ?>
>
  <span data-wp-text="context.counter"></span>
  <span data-wp-text="state.double"></span>
  <button data-wp-on--click="actions.increment">+</button>
</div>
```

```js
import { store, getContext } from '@wordpress/interactivity';

const { state } = store( 'my-plugin/counter', {
  state: {
    get double() {
      return getContext().counter * 2;
    },
  },
  actions: {
    increment() {
      getContext().counter += 1; // mutate the source only
    },
  },
} );
```

```php
<!-- WRONG — every one of these breaks the pattern: -->

<!-- 1. Derived value seeded inside context → stale after mutation. -->
<?php $ctx = array( 'counter' => 1, 'double' => 2 ); ?>

<!-- 2. Directive binds context.double → wrong surface, never updates. -->
<span data-wp-text="context.double"></span>
```

```js
// 3. Assigning to the derived getter inside an action.
actions: {
  increment() {
    state.counter += 1;
    state.double = state.counter * 2; // defeats the getter
  },
},
```

Source in context. Derived getter on `state`. Directive binds `state.<name>`. Server seed via closure. All four, every time.

## Async fetch — generator, seed the empty value

```php
<?php $ctx = array( 'joke' => '' ); // seed the empty value ?>
<div
  data-wp-interactive="my-plugin/joke"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
  <?php echo get_block_wrapper_attributes(); ?>
>
  <button data-wp-on--click="actions.fetchJoke">Fetch joke</button>
  <p data-wp-text="context.joke"></p>
</div>
```

```js
store( 'my-plugin/joke', {
  actions: {
    *fetchJoke() {
      const context = getContext();
      const res = yield fetch( 'https://example.com/joke' );
      const data = yield res.json();
      context.joke = data.joke; // mutate AFTER the yield
    },
  },
} );
```

For REST + nonce, publish them via `wp_interactivity_config()`, read with `getConfig()`, and send `'X-WP-Nonce': nonce` in the `fetch` headers — full example in [references/store.md](references/store.md).

## List with `data-wp-each`

```php
<?php wp_interactivity_state( 'my-plugin/fruits', array(
  'fruits' => array( 'Apple', 'Banana', 'Cherry' ),
) ); ?>
<div data-wp-interactive="my-plugin/fruits" <?php echo get_block_wrapper_attributes(); ?>>
  <ul>
    <template data-wp-each="state.fruits">
      <li data-wp-text="context.item"></li>
    </template>
  </ul>
  <button data-wp-on--click="actions.addMango">Add Mango</button>
</div>
```

```js
const { state } = store( 'my-plugin/fruits', {
  actions: { addMango() { state.fruits.push( 'Mango' ); } },
} );
```

SDP emits the initial `<li data-wp-each-child>Apple</li>…` after the `<template>`. Don't write them by hand.

## Init callback (`data-wp-init`)

No PHP setup needed → this `render.php` starts directly with `<div>`; no leading `<?php`.

```php
<div
  data-wp-interactive="my-plugin/hello"
  data-wp-init="callbacks.onReady"
  <?php echo get_block_wrapper_attributes(); ?>
>Hello from iAPI</div>
```

```js
store( 'my-plugin/hello', {
  callbacks: { onReady() { console.log( 'iapi-ready' ); } },
} );
```

## Common gotchas (see references for full patterns)

- **Document / window listeners go on the same wrapper that carries `data-wp-interactive`.** `getElement().ref` is the element carrying the directive, so a `data-wp-on-document--keydown` on an inner `<nav>` can't reach a sibling toggle button. Full focus-trap example in [references/store.md](references/store.md).
- **Client-side navigation:** the router region wrapper needs BOTH `data-wp-interactive` AND `data-wp-router-region="<id>"`. The click action is a `withSyncEvent` generator that calls `event.preventDefault()`, dynamically imports `@wordpress/interactivity-router`, and yields `actions.navigate(href)`. Anchors stay real `<a href>` so things work without JS. Build pagination hrefs with `esc_url( add_query_arg( 'pg', $next ) )` — not bare `?pg=<n>`, which replaces the whole query string and drops other vars like `p=<id>` on singular pages. Full pagination example in [references/client-navigation.md](references/client-navigation.md).

## References (load on demand)

- [references/directives.md](references/directives.md) — directive syntax (bind/class/style/text/on/watch/init/run/key/each/context/interactive).
- [references/store.md](references/store.md) — `store()`, `getContext()`, `getElement()`, `getConfig()`, generators, `withSyncEvent()`, `withScope()`, focus-trap pattern.
- [references/server-rendering.md](references/server-rendering.md) — `block.json`, `wp_interactivity_state/data_wp_context/config`, server-side derived state (static + closure form), classic themes.
- [references/client-navigation.md](references/client-navigation.md) — router regions, `actions.navigate`/`prefetch`, `data-wp-key`, server-state sync, full pagination example.
- [references/typescript.md](references/typescript.md) — typing stores, server state, derived getters, async actions.
