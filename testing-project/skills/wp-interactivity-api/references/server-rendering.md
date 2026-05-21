# Server-side rendering and PHP integration

WordPress's Server Directive Processor (SDP) reads seeded state/context and applies directives in PHP before the HTML is sent to the browser. The page renders correctly without waiting for JS; the client store then hydrates without re-rendering.

## Block setup — `block.json`

For any interactive block:

```json
{
  "supports": { "interactivity": true },
  "viewScriptModule": "file:./view.js",
  "render": "file:./render.php"
}
```

- `supports.interactivity: true` enables SDP for the block and marks its view module as router-compatible (loaded during client-side navigation).
- `viewScriptModule` is the field that actually turns `view.js` into a built, enqueued script module. Without it, `wp-scripts` does not treat `view.js` as an entry point — the file is not emitted into the build directory and no client store hydrates.

**Don't use `viewScript`.** That is the legacy classic-script field and is incompatible with the Interactivity API's script-module system.

**Don't compensate for a missing `viewScriptModule` by calling `wp_register_script_module()` / `wp_enqueue_script_module()` from `render.php`.** That is the classic-theme path (covered below) and typically points at a `view.js` that `wp-scripts` never emitted.

For non-interactive blocks that only need to survive client-side navigation, the explicit object form is available:

```json
{ "supports": { "interactivity": { "interactive": false, "clientNavigation": true } } }
```

The bare `{ "interactivity": { "clientNavigation": true } }` shorthand does NOT register a view module; use it only for blocks with no `view.js`.

## Seeding global state — `wp_interactivity_state()`

Initialize global state on the server. Values are processed by SDP, then serialized to the client and merged into the store.

```php
wp_interactivity_state( 'myFruitPlugin', array(
  'fruits' => array( 'Apple', 'Banana', 'Cherry' ),
) );
```

Always call it even for empty initial values that are genuinely global — don't skip the call just because the value starts blank:

```php
wp_interactivity_state( 'my-search-plugin/results', array(
  'sharedQuery' => '', // Filled in later by a site-wide search control.
) );
```

Initializing state on the server lets you use any WordPress API — translations, REST URLs, nonces, queries:

```php
wp_interactivity_state( 'myPlugin', array(
  'ajaxUrl' => admin_url( 'admin-ajax.php' ),
  'nonce'   => wp_create_nonce( 'myPlugin_nonce' ),
  'hello'   => __( 'world', 'my-plugin' ),
) );
```

Multiple calls merge:

```php
wp_interactivity_state( 'myPlugin', array( 'a' => 1 ) );
wp_interactivity_state( 'myPlugin', array( 'b' => 2 ) );
// State now has { a: 1, b: 2 }.
```

## Seeding local context — `wp_interactivity_data_wp_context()`

When rendering from PHP, build context as a PHP array and let the helper print the `data-wp-context` attribute with correct escaping and JSON encoding:

```php
<?php $context = array( 'counter' => 0 ); ?>
<div <?php echo wp_interactivity_data_wp_context( $context ); ?>>
  <span data-wp-text="context.counter"></span>
</div>
```

Hand-writing `data-wp-context='{ … }'` from PHP skips escaping and is a code smell. Inline JSON is only appropriate when the markup is hand-authored and static (demos, classic-theme templates with no PHP interpolation).

## Config — `wp_interactivity_config()`

Static, non-reactive server-to-client data. See `store.md` for the JS side.

```php
wp_interactivity_config( 'myPlugin', array(
  'restApiUrl'   => get_rest_url( null, 'my-plugin/v1/' ),
  'nonce'        => wp_create_nonce( 'my_plugin_action' ),
  'translations' => array( 'loading' => __( 'Loading…', 'my-plugin' ) ),
) );
```

## Don't hand-duplicate values directives populate

When a directive's job is to write a value into the markup, the markup must leave that target empty. SDP fills it in from the seeded data; hand-duplicating risks the markup drifting out of sync with the seed.

```html
<!-- Right -->
<span data-wp-text="state.counter"></span>
<a data-wp-bind--href="state.url">Open</a>

<!-- Wrong -->
<span data-wp-text="state.counter">5</span>
<a href="https://example.com" data-wp-bind--href="state.url">Open</a>
```

Likewise:

- Don't pre-add classes that `data-wp-class--*` will toggle.
- Don't pre-add inline styles that `data-wp-style--*` will set.
- For `data-wp-each`, emit only the `<template>` — SDP adds the initial `<li data-wp-each-child>` items.

## Derived state on the server

A getter defined only in JS won't run during SDP. The initial HTML won't reflect the derived value (e.g. `hidden` won't be applied, computed text won't appear) until JS hydrates — visible as a flash or layout shift.

Mirror the derived value in `wp_interactivity_state()`.

**Static cases:** compute and pass the value:

```php
$fruits = array( 'Apple', 'Banana', 'Cherry' );
wp_interactivity_state( 'myFruitPlugin', array(
  'fruits'    => $fruits,
  'hasFruits' => count( $fruits ) > 0, // derived
) );
```

**Dynamic cases** (e.g. derived value depends on `context.item` inside `data-wp-each`): pass a closure. Inside it, use `wp_interactivity_state()` / `wp_interactivity_get_context()` to read the current state and context for each iteration:

```php
wp_interactivity_state( 'myFruitPlugin', array(
  'fruits'        => array( 'Apple', 'Banana', 'Cherry' ),
  'shoppingList'  => array( 'Apple', 'Cherry' ),
  'onShoppingList' => function() {
    $state   = wp_interactivity_state();
    $context = wp_interactivity_get_context();
    return in_array( $context['item'], $state['shoppingList'], true ) ? '🛒' : '';
  },
) );
```

```html
<ul data-wp-interactive="myFruitPlugin">
  <template data-wp-each="state.fruits">
    <li>
      <span data-wp-text="context.item"></span>
      <span data-wp-text="state.onShoppingList"></span>
    </li>
  </template>
</ul>
```

## Worked example: SDP turns directives into final HTML

```php
wp_interactivity_state( 'myPlugin', array(
  'isDarkTheme' => true,
  'show'        => false,
  'helloText'   => __( 'world' ),
) );
?>
<div
  data-wp-interactive="myPlugin"
  data-wp-class--is-dark-theme="state.isDarkTheme"
  class="my-plugin"
>
  <div data-wp-bind--hidden="!state.show">
    Hello <span data-wp-text="state.helloText"></span>
  </div>
  <button data-wp-on--click="actions.toggle">Toggle</button>
</div>
```

SDP outputs:

```html
<div
  data-wp-interactive="myPlugin"
  data-wp-class--is-dark-theme="state.isDarkTheme"
  class="my-plugin is-dark-theme"
>
  <div hidden data-wp-bind--hidden="!state.show">
    Hello <span data-wp-text="state.helloText">world</span>
  </div>
  <button data-wp-on--click="actions.toggle">Toggle</button>
</div>
```

## Classic themes — `wp_interactivity_process_directives()`

Classic themes can use the Interactivity API too. Seed state, build HTML with directives, then run it through `wp_interactivity_process_directives()` to get SDP-processed markup.

```php
wp_interactivity_state( 'myClassicTheme', /* … */ );

ob_start();
?>
<div data-wp-interactive="myClassicTheme">
  …
</div>
<?php
$html = ob_get_clean();
echo wp_interactivity_process_directives( $html );
```

Only call `wp_interactivity_process_directives()` on the **outermost** template that contains directives — processing the same markup twice is redundant.

### Registering script modules in classic themes

Without a `block.json`, register the script module manually in PHP, declaring `@wordpress/interactivity` as a dependency (and `@wordpress/interactivity-router` as a dynamic dependency if needed):

```php
add_action( 'wp_enqueue_scripts', function () {
  wp_register_script_module(
    'my-theme/navigation',
    get_template_directory_uri() . '/assets/navigation.js',
    array(
      '@wordpress/interactivity',
      array(
        'id'     => '@wordpress/interactivity-router',
        'import' => 'dynamic',
      ),
    )
  );
  wp_enqueue_script_module( 'my-theme/navigation' );
} );
```

If the module participates in client-side navigation, also opt it in explicitly:

```php
wp_interactivity()->add_client_navigation_support_to_script_module( 'my-theme/navigation' );
```

Without this, the router won't load the module when navigating to a page that needs it.

## Serializing translations and other processed values

Use `wp_interactivity_state()` to send processed values (translations, sanitized strings, query results) that the client must reuse:

```php
wp_interactivity_state( 'myFruitPlugin', array(
  'fruits' => array( __( 'Apple' ), __( 'Banana' ), __( 'Cherry' ) ),
  'mango'  => __( 'Mango' ),
) );
```

```js
const { state } = store( 'myFruitPlugin', {
  actions: {
    addMango() {
      state.fruits.push( state.mango ); // already translated
    },
  },
} );
```

For dynamic translations inside `data-wp-each`, combine a lookup table with a closure-based derived state:

```php
wp_interactivity_state( 'myFruitPlugin', array(
  'fruits'           => array( 'apple', 'banana', 'cherry' ),
  'translatedFruits' => array(
    'apple'  => __( 'Apple' ),
    'banana' => __( 'Banana' ),
    'cherry' => __( 'Cherry' ),
  ),
  'translatedFruit' => function() {
    $state   = wp_interactivity_state();
    $context = wp_interactivity_get_context();
    return $state['translatedFruits'][ $context['item'] ];
  },
) );
```
