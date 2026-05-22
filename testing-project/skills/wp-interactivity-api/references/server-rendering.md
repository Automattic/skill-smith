# Server-side rendering and PHP integration

The Server Directive Processor (SDP) reads seeded state/context and applies directives in PHP before the HTML ships. The client store then hydrates without re-rendering.

## `block.json`

```json
{
  "apiVersion": 3,
  "supports": { "interactivity": true },
  "viewScriptModule": "file:./view.js",
  "render": "file:./render.php"
}
```

- `supports.interactivity: true` enables SDP for the block and tags the view module as router-compatible.
- `viewScriptModule` is the field that actually builds and enqueues `view.js`. **Without it, `view.js` is not emitted, nothing hydrates, and `actions.navigate()` silently falls back to a full reload.**
- Don't use `viewScript` — that's the legacy classic-script field; incompatible with script modules.
- Don't manually call `wp_register_script_module()` / `wp_enqueue_script_module()` from a block's `render.php` to compensate for a missing `viewScriptModule`. That's the classic-theme path and typically points at a file `wp-scripts` never built.

For a non-interactive block that just needs to survive client-side navigation:

```json
{ "supports": { "interactivity": { "interactive": false, "clientNavigation": true } } }
```

A block that drives the router (defines a region, calls `actions.navigate()`) needs `interactive: true` (or the boolean shorthand `true`). The bare `{ "clientNavigation": true }` does NOT register a view module.

## `wp_interactivity_state()` — global state

```php
wp_interactivity_state( 'my-plugin/x', array(
  'counter' => 0,
  'restUrl' => rest_url( 'my-plugin/v1/' ),
) );
```

- Seed even empty initial values when they're genuinely global.
- Multiple calls with the same namespace merge.
- Values are serialized to the client and merged into the store; don't redeclare them in JS.

## `wp_interactivity_data_wp_context()` — local context

Build context as a PHP array; the helper prints the `data-wp-context` attribute with correct escaping.

```php
<?php $ctx = array( 'counter' => 0 ); ?>
<div <?php echo wp_interactivity_data_wp_context( $ctx ); ?>>
  <span data-wp-text="context.counter"></span>
</div>
```

Hand-writing `data-wp-context='{ … }'` from PHP skips escaping. Inline JSON is only OK for hand-authored static markup with no PHP interpolation.

## `wp_interactivity_config()` — static config

```php
wp_interactivity_config( 'my-plugin/x', array(
  'restUrl' => rest_url( 'my-plugin/v1/' ),
  'nonce'   => wp_create_nonce( 'my-plugin' ),
) );
```

Static, non-reactive. Read on the client with `getConfig()`.

## Don't hand-duplicate values directives populate

When a directive writes a value, the markup must leave that target empty:

```html
<!-- Right -->
<span data-wp-text="state.counter"></span>
<a data-wp-bind--href="state.url">Open</a>

<!-- Wrong -->
<span data-wp-text="state.counter">5</span>
<a href="https://example.com" data-wp-bind--href="state.url">Open</a>
```

- Don't pre-add classes that `data-wp-class--*` toggles.
- Don't pre-add inline styles that `data-wp-style--*` sets.
- For `data-wp-each`, emit only the `<template>` — SDP adds the initial `<li data-wp-each-child>` items.

## Derived state on the server

A getter defined only in JS won't run during SDP. The initial HTML won't reflect the derived value until JS hydrates (flash / layout shift).

### Per-instance (default — source lives in local context)

This is the default whenever the source is per-instance UI state (a counter on each instance, a per-instance fetched value, etc.). The source lives in `wp_interactivity_data_wp_context()`; the derived value is seeded on `state` via a closure that calls `wp_interactivity_get_context()`; the JS getter on `state` reads from `getContext()`; the directive binds `state.<derived-name>`.

```php
<?php $ctx = array( 'counter' => 1 ); ?>
<?php wp_interactivity_state( 'my-plugin/x', array(
  'double' => function () {
    return wp_interactivity_get_context()['counter'] * 2;
  },
) ); ?>
<div
  data-wp-interactive="my-plugin/x"
  <?php echo wp_interactivity_data_wp_context( $ctx ); ?>
>
  <span data-wp-text="context.counter"></span>
  <span data-wp-text="state.double"></span>
</div>
```

```js
const { state } = store( 'my-plugin/x', {
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

The closure form runs once per instance during SDP, so each block instance gets its own seeded `state.double`. WRONG: seeding `'double' => $counter * 2` inside `wp_interactivity_data_wp_context([...])` (stored mutable field — drifts after mutation), binding `<span data-wp-text="context.double">` (binds the wrong surface — never updates), or `state.double = state.counter * 2` inside an action (assigning to the derived getter).

### Static (genuinely shared source — counter is global)

Use this only when the source is genuinely shared across all instances on the page (a site-wide tally, a derived rollup from shared data). Server seeds both the source and the derived value on `state`:

```php
$counter = 1;
wp_interactivity_state( 'my-plugin/tally', array(
  'counter' => $counter,
  'double'  => $counter * 2,
) );
```

```js
const { state } = store( 'my-plugin/tally', {
  state: {
    get double() {
      return state.counter * 2;
    },
  },
  actions: {
    increment() {
      state.counter += 1; // never assign to state.double
    },
  },
} );
```

The directive binds `state.double`. Don't reach for this form for ordinary per-instance counters — that's what the per-instance pattern above is for.

### Dynamic (per-iteration values inside `data-wp-each`)

For per-iteration derived values rendered inside a `data-wp-each` template (not for counter/derived pairs — that's the static case above), pass a closure as the state value. Inside the closure, call `wp_interactivity_state()` / `wp_interactivity_get_context()` to read state/context for the current iteration.

```php
wp_interactivity_state( 'my-plugin/fruits', array(
  'fruits'        => array( 'Apple', 'Banana', 'Cherry' ),
  'shoppingList'  => array( 'Apple', 'Cherry' ),
  'onShoppingList' => function() {
    $state   = wp_interactivity_state();
    $context = wp_interactivity_get_context();
    return in_array( $context['item'], $state['shoppingList'], true ) ? 'cart' : '';
  },
) );
```

```html
<ul data-wp-interactive="my-plugin/fruits">
  <template data-wp-each="state.fruits">
    <li>
      <span data-wp-text="context.item"></span>
      <span data-wp-text="state.onShoppingList"></span>
    </li>
  </template>
</ul>
```

## What SDP outputs

```php
wp_interactivity_state( 'my-plugin/x', array(
  'isDark' => true,
  'show'   => false,
  'hello'  => 'world',
) );
?>
<div data-wp-interactive="my-plugin/x" data-wp-class--is-dark="state.isDark">
  <div data-wp-bind--hidden="!state.show">
    Hello <span data-wp-text="state.hello"></span>
  </div>
</div>
```

Output:

```html
<div data-wp-interactive="my-plugin/x" data-wp-class--is-dark="state.isDark" class="is-dark">
  <div hidden data-wp-bind--hidden="!state.show">
    Hello <span data-wp-text="state.hello">world</span>
  </div>
</div>
```

## Classic themes

Without a `block.json`:

```php
ob_start();
?>
<div data-wp-interactive="my-theme/x">…</div>
<?php
$html = ob_get_clean();
echo wp_interactivity_process_directives( $html );
```

Call `wp_interactivity_process_directives()` only on the outermost template containing directives.

Register the script module manually:

```php
add_action( 'wp_enqueue_scripts', function () {
  wp_register_script_module(
    'my-theme/nav',
    get_template_directory_uri() . '/assets/nav.js',
    array(
      '@wordpress/interactivity',
      array( 'id' => '@wordpress/interactivity-router', 'import' => 'dynamic' ),
    )
  );
  wp_enqueue_script_module( 'my-theme/nav' );
} );
```

If the module participates in client-side navigation:

```php
wp_interactivity()->add_client_navigation_support_to_script_module( 'my-theme/nav' );
```
