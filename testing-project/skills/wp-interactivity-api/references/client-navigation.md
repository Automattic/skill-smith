# Client-side navigation

The `@wordpress/interactivity-router` package replaces selected regions of the page during navigation instead of doing a full reload. Client state is preserved; SEO/HTML structure is preserved (the server still renders full pages); transitions feel instant after the first hit.

The package is bundled with WordPress Core since 6.5.

## Mental model

- You mark sections of your page with `data-wp-router-region="some-id"`.
- A user clicks a link whose handler calls `actions.navigate( url )` from the router.
- The router fetches the destination page, extracts regions with matching IDs, and patches them into the current DOM. Everything outside router regions stays untouched.
- The browser's history is updated; styles and script modules for the new page are loaded as needed.

There is also an experimental full-page mode (covered at the end). Stick with region-based navigation in normal use.

## Setup

Steps 1–2 differ by environment (block vs classic theme). Steps 3–4 are the same.

### 1. Add the router as a dynamic dependency

For **blocks**: dynamic-import the package from `view.js`. `wp-scripts` picks up the dynamic import and registers the PHP-side dependency automatically.

```js
// view.js
import { store, withSyncEvent } from '@wordpress/interactivity';

store( 'myPlugin', {
  actions: {
    navigate: withSyncEvent( function* ( event ) {
      event.preventDefault();
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.navigate( event.target.href );
    } ),
  },
} );
```

`block.json` must declare `viewScriptModule` — without it `wp-scripts` doesn't build `view.js`, nothing is enqueued, and `actions.navigate()` silently falls back to a full reload:

```json
{
  "supports": { "interactivity": true },
  "viewScriptModule": "file:./view.js"
}
```

For **classic themes**: register the script module in PHP and list the router as a dynamic dependency (see `server-rendering.md` for the full registration snippet).

### 2. Mark the script module as router-compatible

For **blocks**: `supports.interactivity: true` does this automatically — it tags the built view module with `loadOnClientNavigation: true`, so the router knows to load it on new pages.

For **classic themes** or any module registered outside `block.json`:

```php
wp_interactivity()->add_client_navigation_support_to_script_module( 'my-theme/navigation' );
```

Without this, the router won't load your module when navigating to a page that needs it.

### 3. Define router regions

A router region needs **both** `data-wp-router-region="<unique-id>"` **and** `data-wp-interactive="<namespace>"` on the same element. Region IDs must be unique within a page; matching IDs across pages tell the router which region updates which.

```php
<div
  data-wp-interactive="myPlugin"
  data-wp-router-region="myPlugin/posts-list"
>
  <?php foreach ( $posts as $post ) : ?>
    <article>
      <h2><?php echo esc_html( $post->post_title ); ?></h2>
    </article>
  <?php endforeach; ?>
</div>
```

**Placement:**

- Standalone: the region is both the interactive boundary and the updated content.
- Inside another interactive element: the region still needs its own `data-wp-interactive`. The outer element stays untouched during navigation; the region's content is updated.
- Inside another router region: the inner region becomes part of the outer one and is updated together as a single unit, not independently.

### 4. Trigger navigation

```html
<a data-wp-on--click="actions.navigateTo" href="/page-2/">Go to Page 2</a>
```

```js
import { store, withSyncEvent } from '@wordpress/interactivity';

store( 'myPlugin', {
  actions: {
    navigateTo: withSyncEvent( function* ( event ) {
      event.preventDefault();
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.navigate( event.target.href );
    } ),
  },
} );
```

`withSyncEvent` is required because `event.preventDefault()` needs synchronous access.

After a `yield`, `event.target` is still valid (preserved across yields), but `event.currentTarget` is `null` once the browser finishes event propagation. To use the listening element specifically, capture it synchronously before the first `yield`, or read it from `getElement().ref` (preserved across yields).

```js
navigateTo: withSyncEvent( function* ( event ) {
  event.preventDefault();
  const href = event.currentTarget.href; // synchronous — still valid here
  const { actions } = yield import( '@wordpress/interactivity-router' );
  yield actions.navigate( href );
} ),
```

## Prefetching

`actions.prefetch( url )` fetches and stores a page in memory without navigating. Combine with `actions.navigate()` on click to make navigation feel instant.

```html
<a
  data-wp-on--mouseenter="actions.prefetchPage"
  data-wp-on--click="actions.navigateTo"
  href="/page-2/"
>Hover to prefetch, click to navigate</a>
```

```js
store( 'myPlugin', {
  actions: {
    prefetchPage: function* ( event ) {
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.prefetch( event.target.href );
    },

    navigateTo: withSyncEvent( function* ( event ) {
      event.preventDefault();
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.navigate( event.target.href );
    } ),
  },
} );
```

`prefetch` doesn't need `withSyncEvent` because it doesn't call any synchronous event API.

## Reconciliation and `data-wp-key`

When the router patches a region with new content, it diffs the new and old virtual DOM. The matching algorithm relies on heuristics that work for most cases but can fail when elements share the same type and position but represent different things. Symptoms range from unnecessary DOM recreation to corrupted state or even one element's directives being applied to a completely different element.

Use `data-wp-key` to give elements a stable, data-derived identity:

```php
<ul>
  <?php while ( $query->have_posts() ) : $query->the_post(); ?>
    <li data-wp-key="post-<?php echo get_the_ID(); ?>">
      <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
    </li>
  <?php endwhile; wp_reset_postdata(); ?>
</ul>
```

Use keys whenever:

- A list changes across pages (pagination, filters, sorts).
- A region renders structurally different content on different pages (e.g. a product detail layout vs a product list layout).

Use stable identifiers (post ID, term ID, slug). Avoid array indices — they change when items shift.

## Server state and context during navigation

Client state is **never** overwritten automatically by server data during navigation:

- For **global state**: properties that already exist on the client are kept; only new properties from the new page are merged in.
- For **local context**: same rule. The Interactivity API tracks server context and client context separately.

To force the client to follow server changes for specific values, read them with `getServerState()` / `getServerContext()` inside a `data-wp-watch` callback (or any callback) and assign back manually. These functions return reactive, read-only objects that update on every navigation — even values that didn't change between pages.

```js
import {
  store,
  getContext,
  getServerState,
  getServerContext,
} from '@wordpress/interactivity';

const { state } = store( 'myPlugin', {
  callbacks: {
    syncWithServer() {
      const serverState   = getServerState();
      const serverContext = getServerContext();
      const context       = getContext();

      // Keep product count in sync across navigations.
      if ( serverState.productCount !== undefined ) {
        state.productCount = serverState.productCount;
      }
      // Reset expanded flag based on new page context.
      if ( serverContext.isExpanded !== undefined ) {
        context.isExpanded = serverContext.isExpanded;
      }
    },
  },
} );
```

Interactive elements **outside** any router region won't be re-rendered on navigation. They can still update if their directives read from `getServerState()`/`getServerContext()`, since those values do update.

```js
// A header outside the router region that stays in sync with the server.
const { state } = store( 'myShop', {
  state: {
    get cartCount() {
      return getServerState().cartCount;
    },
  },
} );
```

## Complete pagination example

```php
<?php
$current = isset( $_GET['paged'] ) ? absint( $_GET['paged'] ) : 1;
$query   = new WP_Query( array( 'paged' => $current, 'posts_per_page' => 5 ) );
?>
<div
  data-wp-interactive="myPagination"
  data-wp-router-region="myPagination/posts"
>
  <ul>
    <?php while ( $query->have_posts() ) : $query->the_post(); ?>
      <li data-wp-key="post-<?php echo get_the_ID(); ?>">
        <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
      </li>
    <?php endwhile; wp_reset_postdata(); ?>
  </ul>

  <nav>
    <?php if ( $current > 1 ) : ?>
      <a
        data-wp-on--mouseenter="actions.prefetch"
        data-wp-on--click="actions.navigate"
        href="?paged=<?php echo $current - 1; ?>"
      >Previous</a>
    <?php endif; ?>
    <?php if ( $query->max_num_pages > $current ) : ?>
      <a
        data-wp-on--mouseenter="actions.prefetch"
        data-wp-on--click="actions.navigate"
        href="?paged=<?php echo $current + 1; ?>"
      >Next</a>
    <?php endif; ?>
  </nav>
</div>
```

```js
import { store, withSyncEvent } from '@wordpress/interactivity';

store( 'myPagination', {
  actions: {
    prefetch: function* ( event ) {
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.prefetch( event.target.href );
    },
    navigate: withSyncEvent( function* ( event ) {
      event.preventDefault();
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.navigate( event.target.href );
      window.scrollTo( { top: 0, behavior: 'smooth' } );
    } ),
  },
} );
```

## `navigate()` options

```js
yield actions.navigate( url, {
  force: true,                 // Bypass in-memory cache; refetch from server.
  html: customHtmlString,      // Use given HTML instead of fetching.
  replace: true,               // history.replaceState instead of pushState.
  timeout: 5000,               // ms before falling back to a full reload (default 10000).
  loadingAnimation: false,     // Disable the built-in progress bar.
  screenReaderAnnouncement: false, // Disable built-in a11y announcement.
} );
```

`prefetch()` accepts `force` and `html`.

**Scroll and focus are not managed by the router** — handle them in your action (e.g. `window.scrollTo`, moving focus to the main heading). After a region update, focus may be on the navigation trigger or lost if the trigger was inside the replaced region.

`force: true` is useful after a mutation (POST/PUT/DELETE). Make sure the mutation has resolved before navigating:

```js
*deleteAndRefresh() {
  yield fetch( '/wp-json/wp/v2/posts/123', { method: 'DELETE' } );
  const { actions } = yield import( '@wordpress/interactivity-router' );
  yield actions.navigate( window.location.href, { force: true } );
}
```

## Dynamic regions — `attachTo`

A region that only exists on some pages (e.g. a modal) can be inserted dynamically during navigation. Use the JSON form of `data-wp-router-region` with an `attachTo` CSS selector:

```html
<div
  data-wp-interactive="myPlugin"
  data-wp-router-region='{ "id": "myPlugin/modal", "attachTo": "body" }'
>
  <div class="modal">…</div>
</div>
```

When navigating to a page that defines this region from a page that doesn't, the router creates the region and appends it to the element matching `attachTo`. When navigating away, the dynamically created region is removed.

## Error handling

When `navigate()` fails (network, timeout, server error), the router automatically falls back to a full reload. You can't catch fetch errors from `navigate()` directly. To handle errors yourself, fetch manually and pass the HTML in:

```js
*navigateWithErrorHandling( event ) {
  event.preventDefault();
  const url = event.target.href;
  try {
    const res = yield fetch( url );
    if ( ! res.ok ) {
      state.error = `Error: ${ res.status }`;
      return;
    }
    const html = yield res.text();
    const { actions } = yield import( '@wordpress/interactivity-router' );
    yield actions.navigate( url, { html } );
  } catch ( error ) {
    state.error = 'Network error.';
  }
}
```

## Disabling client navigation for specific pages

```php
add_action( 'wp', function() {
  if ( is_page_template( 'template-complex.php' ) ) {
    wp_interactivity_config(
      'core/router',
      array( 'clientNavigationDisabled' => true )
    );
  }
} );
```

When `clientNavigationDisabled` is true, `actions.navigate()` triggers a full page reload and `actions.prefetch()` is a no-op.

## Subscribing to URL changes

The `core/router` store exposes a reactive `state.url`. Read it in any callback to subscribe to client-side navigations:

```js
import { watch, store } from '@wordpress/interactivity';

watch( () => {
  const { state } = store( 'core/router' );
  sendAnalyticsPageView( state.url );
} );
```

The `core/router` store is available without importing `@wordpress/interactivity-router`.

## Full-page navigation (experimental)

Treats `<body>` as a single implicit region. Available only in the Gutenberg plugin (WP Admin → Gutenberg → Experiments → "Interactivity API: Full-page client-side navigation"). Imported from a separate entry point:

```js
import '@wordpress/interactivity-router/full-page';
```

Every interactive element on the page must use the Interactivity API (no jQuery, no other libraries) — full-page mode replaces all content, including elements that competing libraries might be managing.

## Implementation notes (when you need them)

These details usually don't affect how you write code, but help when debugging.

- **Page cache.** `prefetch()` and `navigate()` store a fully processed page (vDOM for each region, stylesheet refs, script module info, title, server state) keyed by a normalized URL. The cache stores promises, so concurrent calls to the same URL share one network request.
- **Region update vs create vs remove.** When patching, regions that exist on both pages are diffed in place; regions defined with `attachTo` are created and appended; regions that no longer exist are cleared (or removed if originally created via `attachTo`).
- **CSS handling.** New stylesheets are added with `media="preload"` so they download without applying. The router uses a Shortest Common Supersequence algorithm to maintain cascade order across navigations. On render it toggles the `media` attribute to enable/disable styles.
- **Script modules.** Identified by `data-wp-router-options='{"loadOnClientNavigation": true}'` (set automatically by `supports.interactivity` for block view modules, or by `add_client_navigation_support_to_script_module()` for classic-theme modules). The router resolves the full import graph, fetches each module, rewrites them to blob URLs, and dynamic-imports them on navigation. Already-loaded modules are not refetched.
- **Race conditions.** Rapid navigation calls supersede each other — only the most recent target renders. In-flight fetches for abandoned targets discard their results.
