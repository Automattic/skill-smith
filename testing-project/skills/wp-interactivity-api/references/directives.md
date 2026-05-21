# Directives reference

Directives are `data-*` attributes that bind DOM behavior to the reactive store. They are processed both on the server (by the Server Directive Processor) and on the client (by the runtime, after hydration).

## Expression form

A directive value is a **single reference** to a store property or callback, optionally:

- prefixed with `!` for boolean negation: `!state.isOpen`
- namespaced: `otherPlugin::state.isPlaying`

No JS expressions are allowed in the directive value — no arithmetic, comparisons, function calls, ternaries, template literals. Move logic into a derived getter on `state` and reference the getter by name. The PHP Server Directive Processor evaluates only simple references; inline expressions silently fail server-side and the initial HTML is wrong until hydration.

```js
// Wrong — directive cannot evaluate this:
//   data-wp-bind--hidden="context.currentPage <= 1"

// Right — derived getter, referenced by name:
const { state } = store( 'myPlugin', {
  state: {
    get isFirstPage() {
      return getContext().currentPage <= 1;
    },
  },
} );
```

```html
<a data-wp-bind--hidden="state.isFirstPage" href="?pg=…">Previous</a>
```

By default, a reference resolves in the current `data-wp-interactive` namespace. Use `namespace::reference` to read from a different store.

## `data-wp-interactive`

Activates Interactivity API processing for the element and its descendants under a namespace. Both forms work:

```html
<div data-wp-interactive="myPlugin">…</div>
<div data-wp-interactive='{ "namespace": "myPlugin" }'>…</div>
```

Required for any block/region that uses directives. Future versions may inject it automatically.

## `data-wp-context`

Provides local state available to the element and its descendants. Accepts a stringified JSON object.

**From PHP, always use `wp_interactivity_data_wp_context()`** so the JSON is properly escaped and encoded:

```php
<?php $context = array( 'post' => array( 'id' => $post->ID ) ); ?>
<div <?php echo wp_interactivity_data_wp_context( $context ); ?>>
  <button data-wp-on--click="actions.logId">Click</button>
</div>
```

Hand-writing `data-wp-context='{ … }'` in PHP skips escaping and is a code smell. Inline JSON is fine only for static, hand-authored markup (demos, classic-theme templates with no PHP interpolation).

Contexts nest; deeper levels merge with parent values:

```html
<div data-wp-context='{ "foo": "bar" }'>
  <div data-wp-context='{ "bar": "baz" }'>
    <!-- Inherits foo, adds bar -->
  </div>
</div>
```

## `data-wp-bind--<attribute>`

Sets an HTML attribute from a boolean/string reference. Recomputes when the referenced state/context changes.

- `true` → attribute present (`<div attribute>`)
- `false` → attribute removed
- string → `<div attribute="value">`
- `aria-*` or `data-*` with a boolean value → stringified (`aria-expanded="true"`)

```html
<button
  data-wp-on--click="actions.toggleMenu"
  data-wp-bind--aria-expanded="context.isMenuOpen"
>Toggle</button>
<div data-wp-bind--hidden="!context.isMenuOpen">…</div>
```

When `data-wp-bind--*` will populate an attribute, **omit** that attribute from the markup — don't hand-duplicate the value.

## `data-wp-class--<classname>`

Adds (truthy) or removes (falsy) a class from the `class` attribute.

```html
<li
  data-wp-context='{ "isSelected": false }'
  data-wp-on--click="actions.toggleSelection"
  data-wp-class--selected="context.isSelected"
>Option</li>
```

Use **kebab-case** class names (`is-dark`, not `isDark`) — HTML attribute names are case-insensitive, so `data-wp-class--isDark` is treated as `data-wp-class--isdark`.

Don't pre-add classes that `data-wp-class--*` toggles.

## `data-wp-style--<css-property>`

Adds or removes an inline style:

- `false` → style attribute removed for this property
- string → `<div style="css-property: value;">`

```html
<p data-wp-style--color="context.color">Hello</p>
```

## `data-wp-text`

Sets the element's text content. Leave the element's inner text empty in the markup; SDP fills it in.

```html
<!-- Right -->
<span data-wp-text="state.counter"></span>

<!-- Wrong: hand-duplicated value can drift -->
<span data-wp-text="state.counter">5</span>
```

## `data-wp-on--<event>`, `data-wp-on-window--<event>`, `data-wp-on-document--<event>`

Attach event listeners.

- `data-wp-on--click="actions.doThing"` — listens on the element.
- `data-wp-on-window--resize="callbacks.onResize"` — listens on `window`.
- `data-wp-on-document--keydown="callbacks.onKey"` — listens on `document`.

The referenced action/callback receives the `event`. Returned values are ignored. Listeners are cleaned up when the element is removed.

**Async by default.** Actions run asynchronously to avoid blocking. If the handler needs synchronous access to `event.preventDefault()`, `event.stopPropagation()`, `event.stopImmediatePropagation()`, or `event.currentTarget`, wrap it with `withSyncEvent()`. See `store.md` for details.

**Where to attach matters.** Inside the handler, `getElement().ref` is the element that carries this directive — not the click target, not the block wrapper. When a `document`-/`window`-level handler needs to reach sibling DOM (e.g. an Escape handler that closes a drawer and restores focus to the trigger), attach the directive to the common ancestor (usually the wrapper that already carries `data-wp-interactive`) so `ref.querySelector(...)` can find everything.

For per-handler access to the actual interaction target, prefer `event.target` (preserved across `yield`s in generators) over `getElement().ref`.

## `data-wp-watch`

Runs a callback when the element is created and every time any state/context it reads changes. Multiple watches per element via `data-wp-watch--<unique-id>` (IDs need only be unique per element).

```html
<div data-wp-context='{ "counter": 0 }' data-wp-watch="callbacks.logCounter">…</div>
```

Useful for logging, setting page title, focus management, side effects on state changes. The callback may return a cleanup function (runs before the next call and when the element unmounts).

## `data-wp-init`

Runs a callback once, when the element is created. Multiple inits via `data-wp-init--<unique-id>`. May return a cleanup function (runs when the element unmounts).

```html
<form
  data-wp-init--log="callbacks.logInit"
  data-wp-init--focus="callbacks.focusFirstField"
>…</form>
```

## `data-wp-run`

Runs a callback **during render**. Unlike `wp-init`/`wp-watch`, the callback may use Preact-style hooks (`useState`, `useEffect`, `useRef`, …) imported from `@wordpress/interactivity`. Use it to compose custom reactive logic.

```js
import { store, getElement, useState, useEffect } from '@wordpress/interactivity';

const useInView = () => {
  const [ inView, setInView ] = useState( false );
  useEffect( () => {
    const { ref } = getElement();
    const observer = new IntersectionObserver( ( [ entry ] ) =>
      setInView( entry.isIntersecting )
    );
    observer.observe( ref );
    return () => ref && observer.unobserve( ref );
  }, [] );
  return inView;
};

store( 'myPlugin', {
  callbacks: {
    logInView() {
      const isInView = useInView();
      useEffect( () => {
        console.log( isInView ? 'Inside' : 'Outside' );
      } );
    },
  },
} );
```

`getElement().ref` is `null` during the first render — access it inside an effect hook.

## `data-wp-key`

Gives an element a stable identity for reconciliation, like React/Preact's `key`. Use it on repeated siblings whose order can change, and on top-level sections of router regions that differ between pages.

```html
<li data-wp-key="post-42">…</li>
```

Use a stable, data-derived value (post ID, term ID). Avoid array indices.

## `data-wp-each` and `data-wp-each-child`

Renders a list inside a `<template>` from an array reference.

```html
<ul data-wp-context='{ "list": ["hello", "hola", "olá"] }'>
  <template data-wp-each="context.list">
    <li data-wp-text="context.item"></li>
  </template>
</ul>
```

- The default item name is `context.item`. Override with `data-wp-each--<name>` (e.g. `data-wp-each--greeting`); access as `context.greeting`.
- For arrays of objects, set the key via `data-wp-each-key` on the `<template>` (e.g. `data-wp-each-key="context.greeting.id"`). Don't use `data-wp-key` inside the template — `data-wp-each` wraps each item in a context provider, and the key belongs on the wrapper.
- **Server-rendered output** emits `<li data-wp-each-child>…</li>` items right after the `<template>`. SDP adds these automatically; do not hand-duplicate them in the markup.

```html
<ul data-wp-context='{ "list": [{"id":"en","value":"hello"}, {"id":"es","value":"hola"}] }'>
  <template
    data-wp-each--greeting="context.list"
    data-wp-each-key="context.greeting.id"
  >
    <li data-wp-text="context.greeting.value"></li>
  </template>
  <!-- These are emitted by SDP, don't write them by hand: -->
  <li data-wp-each-child>hello</li>
  <li data-wp-each-child>hola</li>
</ul>
```

## Cross-cutting rules

- **Don't hand-duplicate populated values.** Empty `data-wp-text` targets, omit bound attributes, don't pre-add toggled classes/styles, render only `<template>` for `data-wp-each`. The directive fills it in from seeded state/context.
- **Static markup that matches server state** is fine and sometimes mandatory (e.g. SDP-emitted `<li data-wp-each-child>` items must not be removed). The rule is: if a directive will write the value, the markup leaves it empty/absent; if SDP has already written it, leave it as is.
