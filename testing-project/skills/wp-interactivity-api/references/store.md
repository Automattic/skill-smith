# Store, state, context, and the runtime API

```js
import { store, getContext } from '@wordpress/interactivity';

const { state, actions } = store( 'my-plugin/my-block', {
  state: { /* ... */ },
  actions: { /* ... */ },
  callbacks: { /* ... */ },
} );
```

Multiple `store()` calls with the same namespace merge into the same object.

## State: global vs context vs derived

### Global — `wp_interactivity_state()` / `store().state`

Cross-instance / cross-block data, or values SDP needs.

```php
wp_interactivity_state( 'my-plugin/x', array(
  'ajaxUrl' => admin_url( 'admin-ajax.php' ),
  'nonce'   => wp_create_nonce( 'x_nonce' ),
  'counter' => 0,
) );
```

Don't redeclare initial values in JS — the server seed merges into the client store automatically.

### Local context — `wp_interactivity_data_wp_context()` / `getContext()`

Per-instance UI state. The default for `isOpen`, instance-local counters, per-instance fetched results.

```php
<?php $ctx = array( 'isOpen' => false, 'items' => $items ); ?>
<div <?php echo wp_interactivity_data_wp_context( $ctx ); ?>>…</div>
```

```js
store( 'my-plugin/x', {
  actions: {
    toggle() {
      const context = getContext();
      context.isOpen = ! context.isOpen;
    },
  },
} );
```

Contexts nest; child contexts inherit and can override.

### Derived — getter on `state` + server seed

A computed value defined in TWO halves: a JS getter (recomputes when its dependencies change) AND a server seed in `wp_interactivity_state()` so SDP renders directives that reference it.

```js
const { state } = store( 'my-plugin/x', {
  state: {
    counter: 1,
    get double() { return state.counter * 2; },
  },
  actions: {
    increment() { state.counter += 1; },
  },
} );
```

```php
$counter = 1;
wp_interactivity_state( 'my-plugin/x', array(
  'counter' => $counter,
  'double'  => $counter * 2,
) );
```

For per-iteration derived values (inside `data-wp-each`), seed a PHP closure — see `server-rendering.md`.

### Mutation

Always mutate in place:

```js
state.list.push( 'new' );    // OK
context.counter += 1;        // OK
state.list = [ ...state.list, 'new' ];  // WRONG — breaks reactivity
```

Derived getters cannot be assigned.

## Actions

Plain JS functions referenced from `data-wp-on--*` or called from other actions.

```js
const { state, actions } = store( 'my-plugin/x', {
  actions: {
    select( id ) { state.selected = id ?? getContext().id; },
    other() { actions.select( 123 ); },
  },
} );
```

### Async actions = generators (NOT `async`/`await`)

The runtime must restore scope (`getContext()`, `getElement()`) across yields. `async`/`await` doesn't give it a hook to do that.

```js
actions: {
  *fetchData() {
    const context = getContext();
    const res = yield fetch( '/api' );
    const data = yield res.json();
    context.result = data.result;
  },
}
```

`event.target` is preserved across `yield`s. `event.currentTarget` is `null` once propagation completes — capture it (or `getElement().ref`) before the first `yield`.

### `withSyncEvent()`

Wrap an action when it needs synchronous access to `event.preventDefault()`, `event.stopPropagation()`, `event.stopImmediatePropagation()`, or `event.currentTarget`. Combines with generators.

```js
import { store, withSyncEvent } from '@wordpress/interactivity';

actions: {
  navigate: withSyncEvent( function* ( event ) {
    event.preventDefault();
    const { actions } = yield import( '@wordpress/interactivity-router' );
    yield actions.navigate( event.target.href );
  } ),
}
```

## Callbacks

Side-effect functions referenced from `data-wp-watch`, `data-wp-init`, `data-wp-run`. `data-wp-watch` callbacks re-run when dependencies change; return value may be a cleanup function.

## Accessing data inside actions/callbacks

- **`getContext( namespace? )`** — local context of the element that owns the firing directive.
- **`getElement()`** — `{ ref, attributes }`. `ref` is the element that carries the directive. May be `null` during hydration.
- **`getServerState( namespace? )`** / **`getServerContext( namespace? )`** — reactive read-only views of server-provided values; update on every `actions.navigate()`. See `client-navigation.md`.
- **`getConfig( namespace? )`** — static, non-reactive config from `wp_interactivity_config()`.

### `getElement().ref` — which element you get

`ref` is the element that carries the **firing** directive — not the wrapper, not the click target.

If a document/window listener needs to reach both a trigger AND a sibling subtree, attach the directive to a common ancestor (the wrapper that already has `data-wp-interactive`) so `ref` covers everything.

Inside `data-wp-on--*` handlers, prefer `event.target` for the interaction target.

#### Focus-trap menu pattern

A menu with a toggle button, a drawer, Escape-to-close + focus restore, and Tab/Shift+Tab wrap-around. The wrapper carries `data-wp-interactive` AND `data-wp-on-document--keydown`, so `getElement().ref` inside `handleKey` is the wrapper and `ref.querySelector('.menu-toggle')` works:

```php
<?php $ctx = array( 'isOpen' => false ); ?>
<div
  data-wp-interactive="my-plugin/menu"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
  <?php echo get_block_wrapper_attributes(); ?>
  data-wp-on-document--keydown="actions.handleKey"
>
  <button
    class="menu-toggle"
    data-wp-on--click="actions.toggle"
    data-wp-bind--aria-expanded="context.isOpen"
  >Menu</button>
  <nav data-wp-bind--hidden="!context.isOpen">
    <a href="#home" data-wp-on--keydown="actions.trapTab">Home</a>
    <a href="#about" data-wp-on--keydown="actions.trapTab">About</a>
    <a href="#contact" data-wp-on--keydown="actions.trapTab">Contact</a>
  </nav>
</div>
```

```js
import { store, getContext, getElement, withSyncEvent } from '@wordpress/interactivity';

store( 'my-plugin/menu', {
  actions: {
    toggle() {
      const context = getContext();
      context.isOpen = ! context.isOpen;
    },
    handleKey: withSyncEvent( ( event ) => {
      if ( event.key !== 'Escape' ) return;
      const context = getContext();
      if ( ! context.isOpen ) return;
      event.preventDefault();
      context.isOpen = false;
      const { ref } = getElement(); // wrapper — directive lives there
      ref.querySelector( '.menu-toggle' ).focus();
    } ),
    trapTab: withSyncEvent( ( event ) => {
      if ( event.key !== 'Tab' ) return;
      const { ref } = getElement(); // ref is THIS link
      const links = ref.closest( '[data-wp-interactive]' ).querySelectorAll( 'nav a' );
      const first = links[ 0 ], last = links[ links.length - 1 ];
      if ( ! event.shiftKey && ref === last ) { event.preventDefault(); first.focus(); }
      else if ( event.shiftKey && ref === first ) { event.preventDefault(); last.focus(); }
    } ),
  },
} );
```

WRONG — directive on `<nav>` means `ref` is the nav and `ref.querySelector('.menu-toggle')` returns null:

```html
<!-- WRONG -->
<div data-wp-interactive="my-plugin/menu">
  <button class="menu-toggle">Menu</button>
  <nav data-wp-on-document--keydown="actions.handleKey">…</nav>
</div>
```

## Config — `wp_interactivity_config()` / `getConfig()`

Static, non-reactive server→client data (REST URLs, nonces, feature flags, translations).

```php
wp_interactivity_config( 'my-plugin/x', array(
  'restUrl' => rest_url( 'my-plugin/v1/' ),
  'nonce'   => wp_create_nonce( 'my-plugin_action' ),
) );
```

```js
import { getConfig } from '@wordpress/interactivity';

actions: {
  *fetchData() {
    const { restUrl, nonce } = getConfig();
    const res = yield fetch( `${ restUrl }data`, {
      headers: { 'X-WP-Nonce': nonce },
    } );
    // ...
  },
}
```

Config doesn't trigger reactivity. Use state if reactivity is needed.

## `withScope()` — for callbacks outside the runtime

The runtime sets the action scope automatically. If you trigger store code from `setInterval`, a third-party listener, or a Promise callback, wrap with `withScope()` so `getContext()`/`getElement()` still work.

```js
import { withScope } from '@wordpress/interactivity';

callbacks: {
  init() {
    setInterval( withScope( () => actions.tick() ), 1000 );
  },
}
```

## Server state during client navigation

On `actions.navigate()`, server-provided values update but client state is NOT overwritten — only new properties merge in. To force-sync specific values, read `getServerState()` / `getServerContext()` (reactive) inside a callback and assign back manually. See `client-navigation.md`.

## Quick guide

| Need | Use |
| --- | --- |
| Per-instance UI flag | Local context |
| Cross-instance shared value | Global state |
| Static server-to-client config | `wp_interactivity_config()` |
| Computed value | Derived getter (JS) + server seed |
| `event.preventDefault()` | `withSyncEvent()` |
| Async work | Generator (`function*` + `yield`) |
| `setInterval` calling store code | `withScope()` |
| Sync client with new server values on navigation | `getServerState()`/`getServerContext()` in a callback |
