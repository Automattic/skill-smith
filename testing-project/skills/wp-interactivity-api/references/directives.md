# Directives reference

`data-*` attributes that bind DOM behavior to the store. Processed both server-side (SDP) and client-side (after hydration).

## Expression form

A directive value is a **single reference** to a store property or callback. Allowed:

- `state.foo` / `context.foo` / `actions.bar` / `callbacks.baz`
- `!state.foo` — boolean negation
- `otherPlugin::state.foo` — cross-namespace reference

No arithmetic, comparisons, function calls, ternaries, or template literals. Move logic into a derived getter:

```js
// Wrong: data-wp-bind--hidden="context.currentPage <= 1"
// Right:
store( 'myPlugin', {
  state: {
    get isFirstPage() { return getContext().currentPage <= 1; },
  },
} );
```

```html
<a data-wp-bind--hidden="state.isFirstPage" href="?pg=…">Previous</a>
```

Default namespace is the closest `data-wp-interactive`. Use `namespace::reference` to read from another store.

## `data-wp-interactive`

Activates the API for the element and its descendants under a namespace.

```html
<div data-wp-interactive="my-plugin/block">…</div>
```

Required on the wrapper of every interactive region.

## `data-wp-context`

Local state for the subtree. From PHP, ALWAYS use the helper so JSON is escaped:

```php
<?php $ctx = array( 'isOpen' => false ); ?>
<div <?php echo wp_interactivity_data_wp_context( $ctx ); ?>>…</div>
```

Inline `data-wp-context='{ … }'` is acceptable only in hand-authored static markup.

Contexts nest; child contexts inherit and can override parent values.

## `data-wp-bind--<attr>`

Sets an HTML attribute from a reference. Recomputes when the value changes.

- `true` → attribute present; `false` → attribute removed
- string → `attr="value"`
- `aria-*` / `data-*` with boolean → stringified (`aria-expanded="true"`)

```html
<button data-wp-bind--aria-expanded="context.isOpen">Toggle</button>
<div data-wp-bind--hidden="!context.isOpen">…</div>
```

Omit the attribute from the static markup when bound — don't hand-duplicate the value.

## `data-wp-class--<classname>`

Adds (truthy) / removes (falsy) a class. Use **kebab-case** (`is-dark`, not `isDark`) — HTML attribute names are case-insensitive.

```html
<li data-wp-class--selected="context.isSelected">Option</li>
```

Don't pre-add classes the directive toggles.

## `data-wp-style--<css-property>`

Adds/removes one inline style. `false` removes it; string sets it.

```html
<p data-wp-style--color="context.color">Hello</p>
```

## `data-wp-text`

Sets text content. Leave the element empty; SDP fills it in. This holds even when the seeded value is a literal like `0` — don't type it inside the tag.

```html
<!-- WRONG --> <span data-wp-text="state.counter">0</span>
<!-- RIGHT --> <span data-wp-text="state.counter"></span>
```

## `data-wp-on--<event>` / `data-wp-on-window--<event>` / `data-wp-on-document--<event>`

Attach listeners to the element, `window`, or `document`.

```html
<button data-wp-on--click="actions.doThing">Go</button>
<div data-wp-on-document--keydown="actions.onKey">…</div>
```

Async by default. Wrap with `withSyncEvent()` (see `store.md`) if the handler synchronously uses `event.preventDefault()`, `event.stopPropagation()`, `event.stopImmediatePropagation()`, or `event.currentTarget`.

`getElement().ref` inside the handler is the element **that carries the directive** — not the click target, not the wrapper. When the handler needs to reach sibling DOM (e.g. close a drawer and refocus the trigger button), attach the directive to a common ancestor (usually the wrapper that already has `data-wp-interactive`).

For the actual interaction target, use `event.target` (preserved across `yield`s).

## `data-wp-watch`

Runs when the element mounts and re-runs when any state/context it reads changes. Multiple via `data-wp-watch--<id>`. May return a cleanup function.

```html
<div data-wp-watch="callbacks.syncTitle">…</div>
```

## `data-wp-init`

Runs once on mount. Multiple via `data-wp-init--<id>`. May return a cleanup function.

```html
<div data-wp-init="callbacks.onReady">…</div>
```

## `data-wp-run`

Runs during render; the callback may use Preact hooks (`useState`, `useEffect`, `useRef`) imported from `@wordpress/interactivity`. Use for custom reactive logic. `getElement().ref` is `null` on the first render — access it inside an effect.

## `data-wp-key`

Stable identity for reconciliation. Required on repeated siblings whose order can change, and on top-level sections of router regions that differ between pages.

```html
<li data-wp-key="post-42">…</li>
```

Use a stable identifier (post ID, slug). Avoid indices.

## `data-wp-each` and `data-wp-each-child`

Renders an array via a `<template>`.

```html
<ul data-wp-context='{ "list": ["hello", "hola", "olá"] }'>
  <template data-wp-each="context.list">
    <li data-wp-text="context.item"></li>
  </template>
</ul>
```

- Default item is `context.item`. Override with `data-wp-each--<name>` (access as `context.<name>`).
- For objects, set key on the `<template>`: `data-wp-each-key="context.item.id"`. Don't add `data-wp-key` inside the template.
- SDP emits initial `<li data-wp-each-child>…</li>` items right after the `<template>`. Don't write them by hand.

## Rule: don't hand-duplicate populated values

Empty `data-wp-text` targets. Omit attributes that `data-wp-bind--*` sets. Don't pre-add classes/styles that directives toggle. Render only `<template>` for `data-wp-each`. The directive fills it from seeded state/context.
