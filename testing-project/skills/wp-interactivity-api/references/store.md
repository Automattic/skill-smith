# Store, state, context, and the runtime API

The store holds `state`, `actions`, `callbacks`, and (optionally) `config`. Directives reference store properties by name; the runtime wires them up.

```js
import { store, getContext } from '@wordpress/interactivity';

const { state, actions } = store( 'my-plugin/my-block', {
  state: { /* ... */ },
  actions: { /* ... */ },
  callbacks: { /* ... */ },
} );
```

All calls to `store()` with the same namespace return the **same** object — store parts are merged. You can split a store across files, call `store('my-plugin/my-block')` to get back the shared instance, or destructure `state`/`actions` from any call.

## State: global vs local context vs derived

The Interactivity API has three flavors of state. Pick deliberately.

### Global state — `wp_interactivity_state()` / `store().state`

Page-wide data, shared across all blocks. Use it for:

- Data shared between blocks that aren't related in the DOM.
- A single source of truth (e.g. a site-wide cart count, current filter, AJAX URLs/nonces).
- Values that the Server Directive Processor needs to evaluate directives server-side.

Initialize on the **server** with `wp_interactivity_state()`. It merges into the client store automatically — don't redeclare initial values in JS.

```php
// render.php
wp_interactivity_state( 'myPlugin', array(
  'ajaxUrl' => admin_url( 'admin-ajax.php' ),
  'nonce'   => wp_create_nonce( 'myPlugin_nonce' ),
  'show'    => false,
) );
```

```js
// view.js — DO NOT redeclare state.show: 'false' here.
const { state } = store( 'myPlugin', {
  actions: {
    toggle() { state.show = ! state.show; },
  },
} );
```

### Local context — `wp_interactivity_data_wp_context()` / `data-wp-context`

Per-instance state, scoped to a subtree of the DOM. Use it for:

- Per-instance UI state (`isOpen`, expanded flag, focused tab, instance-local counter).
- Per-instance async results, such as a fetched joke/message/list that should update only the block whose button was clicked.
- Anything that must be independent across multiple instances of the same block on a page.

This is the default for UI state. Reach for global state only when sharing is actually required.

```php
<?php $context = array( 'isOpen' => false, 'items' => $items ); ?>
<div <?php echo wp_interactivity_data_wp_context( $context ); ?>>…</div>
```

```js
import { getContext } from '@wordpress/interactivity';

store( 'my-plugin/toggle-block', {
  actions: {
    toggle() {
      const context = getContext();
      context.isOpen = ! context.isOpen;
    },
  },
} );
```

Contexts nest; child contexts inherit and can override parent values:

```html
<div data-wp-context='{ "theme": "light", "counter": 0 }'>
  <div data-wp-context='{ "theme": "dark" }'>
    <!-- theme === 'dark', counter === 0 -->
  </div>
</div>
```

### Derived state — getters on `state` + server seed

Computed values defined in two halves: a getter on the client store (recomputes automatically when the state/context it reads changes) **and** a server seed in `wp_interactivity_state()` so SDP can render directives that reference it. Treat both halves as part of the definition; defining only the JS half leaves the initial HTML wrong until hydration.

```js
const { state } = store( 'myCounterPlugin', {
  state: {
    counter: 1,
    get double() {
      return state.counter * 2;
    },
    get priceWithTax() {
      const { priceWithoutTax } = getContext();
      return priceWithoutTax * ( 1 + state.taxRate );
    },
  },
  actions: {
    increment() { state.counter += 1; },
  },
} );
```

Derived state can read from `state`, `getContext()`, or both. From the consumer's side it looks identical to plain state — directives reference `state.double` the same way.

Seed the server half in `wp_interactivity_state()`: a static value when it's known up-front, or a PHP closure (calling `wp_interactivity_state()` / `wp_interactivity_get_context()`) for dynamic / per-iteration values. See `server-rendering.md` for the patterns.

### Mutation rules

You mutate `state` and `context` **in place** — the proxy detects changes by writes, not by reference replacement.

```js
// Right:
state.list.push( 'new item' );
context.counter += 1;

// Wrong — breaks reactivity for anything holding the old reference:
state.list = [ ...state.list, 'new item' ];
```

Derived state cannot be assigned. Update the underlying state/context and the getter recomputes.

## Actions

Plain JS functions, typically referenced by `data-wp-on--*` directives or called from other actions.

```js
const { state, actions } = store( 'myPlugin', {
  actions: {
    select( id ) {
      state.selected = id ?? getContext().id;
    },
    other() {
      actions.select( 123 );
    },
  },
} );
```

### Async actions: generators, not `async`/`await`

Async actions must be generator functions (`function* () { yield … }`), **not** `async`/`await`. The runtime restores the action's "scope" (so `getContext()` and `getElement()` keep returning the right values) before resuming a yielded action — `async`/`await` doesn't give the runtime a hook to do that.

```js
const { state } = store( 'myPlugin', {
  state: {
    get isOpen() { return getContext().isOpen; },
  },
  actions: {
    *someAction() {
      state.isOpen;        // correct scope
      yield longDelay();
      state.isOpen;        // still correct — runtime restored scope
    },
  },
} );
```

Yield as many times as the action needs. Insert extra `yield splitTask()` points in long actions to let the main thread breathe:

```js
import { splitTask } from '@wordpress/interactivity';

actions: {
  handleClick: withSyncEvent( function* ( event ) {
    event.preventDefault();
    yield splitTask();
    doExpensiveWork();
  } ),
}
```

### `withSyncEvent()` — when actions need synchronous event access

Actions run asynchronously by default. If your handler must use any of these synchronously, wrap the action with `withSyncEvent()`:

- `event.preventDefault()`
- `event.stopPropagation()`
- `event.stopImmediatePropagation()`
- `event.currentTarget`

```js
import { store, withSyncEvent } from '@wordpress/interactivity';

store( 'myPlugin', {
  actions: {
    preventNav: withSyncEvent( ( event ) => {
      event.preventDefault();
    } ),

    logTarget( event ) {
      // event.target is fine async; no wrapper needed.
      console.log( event.target );
    },
  },
} );
```

Combine `withSyncEvent` with a generator if you need both sync event access and async work:

```js
actions: {
  navigate: withSyncEvent( function* ( event ) {
    event.preventDefault();
    const { actions } = yield import( '@wordpress/interactivity-router' );
    yield actions.navigate( event.target.href );
  } ),
}
```

Without `withSyncEvent`, calls to those sync APIs trigger a deprecation warning today, and will silently fail in a future release.

After a `yield`, `event.target` is preserved; `event.currentTarget` is `null` once event propagation completes. To read the listening element after a yield, capture it synchronously before the first `yield`, or use `getElement().ref`.

For per-instance fetches, capture context before the first `yield` and mutate that context after the response resolves:

```js
store( 'my-plugin/joke-block', {
  actions: {
    *fetchJoke() {
      const context = getContext();
      const response = yield fetch( 'https://example.com/joke' );
      const data = yield response.json();
      context.joke = data.joke;
    },
  },
} );
```

## Callbacks

Side-effect functions, referenced by `data-wp-watch`, `data-wp-init`, or `data-wp-run`. Same shape as actions, but typically used for logging, focus management, analytics, syncing server state, etc. `data-wp-watch` callbacks re-run when their dependencies change; their return value may be a cleanup function.

## Accessing data in callbacks/actions

Inside any store function you can call:

- **`getContext( namespace? )`** — returns the local context of the element that owns the directive that triggered this call. Pass a namespace to read context from a different interactive region.
- **`getElement()`** — returns `{ ref, attributes }`. `ref` is the DOM element that carries the directive (read-only). `ref` may be `null` during hydration/mounting.
- **`getServerState( namespace? )`** — read-only, reactive. Reflects whatever `wp_interactivity_state()` produced for the current page. Updates on every navigation via `actions.navigate()` (see `client-navigation.md`).
- **`getServerContext( namespace? )`** — read-only, reactive. Analogous to `getServerState()`, but for local context.
- **`getConfig( namespace? )`** — returns the static config set via `wp_interactivity_config()`. Not reactive.

```js
store( 'myPlugin', {
  state: {
    get someDerivedValue() {
      const context = getContext();
      const { ref } = getElement();
      // ...
    },
  },
} );
```

### `getElement().ref` — which element you actually get

`ref` is **the element that carries the directive that invoked this function** — not the wrapper, not the click target.

```html
<!-- ref = the wrapper -->
<div data-wp-interactive="myPlugin" data-wp-on-document--keydown="actions.onKey">
  <button data-wp-on--click="actions.open">Menu</button>

  <!-- ref = this inner div, NOT the wrapper or the button -->
  <div data-wp-on-document--keydown="actions.onKey" hidden>
    <a href="#one">One</a>
  </div>
</div>
```

If a document/window handler needs to query both the trigger element and a sibling section, attach the `data-wp-on-document--*` / `data-wp-on-window--*` directive to a common ancestor (usually the wrapper that already carries `data-wp-interactive`).

Inside `data-wp-on--*` handlers wrapped with `withSyncEvent`, prefer `event.target` to get the actual interaction target — `getElement().ref` always points at the listener's element, regardless of where the click landed.

## `withScope()` — for code outside the runtime

The runtime sets the scope automatically before calling actions/callbacks. When you trigger store code from outside the runtime (e.g. inside `setInterval`, a third-party event listener, a Promise callback), wrap the callback with `withScope()` so `getContext()`/`getElement()` keep working:

```js
import { store, withScope } from '@wordpress/interactivity';

store( 'mySlider', {
  callbacks: {
    init() {
      setInterval( withScope( () => actions.nextImage() ), 3000 );
    },
  },
} );
```

## Config — `wp_interactivity_config()` / `getConfig()`

Static, non-reactive data from server to client (REST URLs, nonces, feature flags, translations). Set in PHP, read with `getConfig()` in JS.

```php
wp_interactivity_config( 'myPlugin', array(
  'restApiUrl'     => get_rest_url( null, 'my-plugin/v1/' ),
  'nonce'          => wp_create_nonce( 'my_plugin_action' ),
  'isUserLoggedIn' => is_user_logged_in(),
  'translations'   => array( 'loading' => __( 'Loading…', 'my-plugin' ) ),
) );
```

```js
import { store, getConfig } from '@wordpress/interactivity';

store( 'myPlugin', {
  actions: {
    *fetchData() {
      const { restApiUrl, nonce } = getConfig();
      const res = yield fetch( `${ restApiUrl }data`, {
        headers: { 'X-WP-Nonce': nonce },
      } );
      // ...
    },
  },
} );
```

Config doesn't trigger UI updates — use state if you need reactivity.

## Private stores — `lock`

Mark a namespace as private so other plugins can't `store()` into it.

```js
const { state } = store(
  'myPlugin/private',
  { state: { messages: [ 'private' ] } },
  { lock: true }
);

// Throws: another caller can't extend the locked namespace.
store( 'myPlugin/private', { /* ... */ } );
```

To share access across files in the same plugin, use a string lock as a shared secret:

```js
import { PRIVATE_LOCK } from './lock';

const { state } = store(
  'myPlugin/private',
  { state: { messages: [ 'private' ] } },
  { lock: PRIVATE_LOCK }
);

// In another file:
store( 'myPlugin/private', { /* extension */ }, { lock: PRIVATE_LOCK } );
```

## Server state and context during client-side navigation

When the page is updated via `actions.navigate()` from `@wordpress/interactivity-router`, the runtime fetches new server data but **does not overwrite client state**. Existing properties on `state` / `getContext()` are preserved; only new properties are merged in.

Use `getServerState()` / `getServerContext()` to subscribe specifically to server-provided values and selectively update client state:

```js
import { store, getContext, getServerContext } from '@wordpress/interactivity';

store( 'myPlugin', {
  callbacks: {
    updateQuestion() {
      const serverContext = getServerContext();
      const context = getContext();
      // Override only what the server should drive on every page.
      context.currentQuestion = serverContext.currentQuestion;
    },
  },
} );
```

Both functions return reactive, read-only objects. A callback that reads them re-runs on every navigation event. See `client-navigation.md` for details on when this matters.

## Quick comparison

| Need | Use |
| --- | --- |
| Per-instance UI flag (`isOpen`, `selectedTab`) | Local context |
| Cross-block shared value (cart count, global filter) | Global state |
| Static server-to-client config (URLs, nonces, flags) | `wp_interactivity_config()` |
| Computed from other state/context | Derived state (getter on `state`) |
| Mutate during action | Direct: `state.x = …`, `context.x = …`, `state.list.push(…)` |
| Need `event.preventDefault()` | Wrap action with `withSyncEvent()` |
| Async work in an action | Generator (`function* () { yield … }`) |
| Trigger store code from `setInterval` / library callback | Wrap with `withScope()` |
| Sync client state with new server state during navigation | `getServerState()` / `getServerContext()` |
