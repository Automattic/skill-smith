# Client-side navigation

`@wordpress/interactivity-router` patches marked page regions on navigation instead of doing a full reload. Bundled with WordPress 6.5+.

## Model

- Mark a wrapper with `data-wp-router-region="<id>"` (and `data-wp-interactive="<namespace>"` on the same element).
- A link's handler calls `actions.navigate( href )` from the router.
- The router fetches the destination, extracts regions with matching IDs, patches them in.
- Browser history is updated; styles and script modules for the new page load as needed.

## Setup checklist

1. **`block.json` declares `viewScriptModule`** — without it, nothing hydrates and navigation falls back to a full reload.
2. **Wrapper has BOTH `data-wp-interactive` AND `data-wp-router-region="<unique-id>"`**.
3. **Navigation action is a generator wrapped with `withSyncEvent`** that calls `event.preventDefault()`, then dynamically imports the router and yields `actions.navigate(href)`.

## Complete pagination example

```php
<?php
$pg = isset( $_GET['pg'] ) ? max( 1, absint( $_GET['pg'] ) ) : 1;
$query = new WP_Query( array(
  'posts_per_page'      => 3,
  'paged'               => $pg,
  'post_status'         => 'publish',
  'ignore_sticky_posts' => true,
) );
?>
<div
  data-wp-interactive="my-plugin/posts"
  data-wp-router-region="my-plugin/posts"
  <?php echo get_block_wrapper_attributes(); ?>
>
  <ul>
    <?php while ( $query->have_posts() ) : $query->the_post(); ?>
      <li data-wp-key="post-<?php echo get_the_ID(); ?>">
        <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
      </li>
    <?php endwhile; wp_reset_postdata(); ?>
  </ul>

  <?php if ( $pg > 1 ) : ?>
    <a
      data-wp-on--mouseenter="actions.prefetch"
      data-wp-on--click="actions.navigate"
      href="<?php echo esc_url( add_query_arg( 'pg', $pg - 1 ) ); ?>"
    >Previous</a>
  <?php endif; ?>
  <?php if ( $pg < $query->max_num_pages ) : ?>
    <a
      data-wp-on--mouseenter="actions.prefetch"
      data-wp-on--click="actions.navigate"
      href="<?php echo esc_url( add_query_arg( 'pg', $pg + 1 ) ); ?>"
    >Next</a>
  <?php endif; ?>
</div>
```

Pagination hrefs use `add_query_arg` (not bare `?pg=N`) so the current URL's other query vars are preserved. When the block lives inside a singular post page (URL like `/?p=<id>`), a bare `?pg=N` href replaces the entire query string and drops the post ID, breaking the route — the router fetches a page where the region doesn't exist and navigation can't complete.

```js
import { store, withSyncEvent } from '@wordpress/interactivity';

store( 'my-plugin/posts', {
  actions: {
    prefetch: function* ( event ) {
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.prefetch( event.target.href );
    },
    navigate: withSyncEvent( function* ( event ) {
      event.preventDefault();
      const href = event.target.href;
      const { actions } = yield import( '@wordpress/interactivity-router' );
      yield actions.navigate( href );
    } ),
  },
} );
```

`withSyncEvent` is required only on `navigate` because it calls `event.preventDefault()`. `prefetch` doesn't need it.

After a `yield`, `event.target` is preserved but `event.currentTarget` is `null` — capture it synchronously before the first yield if you need it.

## Reconciliation: `data-wp-key`

When patching a region, the router diffs the old/new vDOM. Heuristics work most of the time but can fail when elements share type and position but represent different things. Use `data-wp-key` on:

- Repeated siblings whose order can change (lists across pages, filters, sorts).
- Top-level region sections that differ structurally between pages.

```php
<li data-wp-key="post-<?php echo get_the_ID(); ?>">…</li>
```

Use stable identifiers (post ID, slug). Avoid array indices.

## Server state and context during navigation

Client state is NOT overwritten by server data on navigation — only new properties merge in.

To force-sync specific values, read `getServerState()` / `getServerContext()` (reactive, read-only) inside a callback and assign back:

```js
import { store, getContext, getServerContext } from '@wordpress/interactivity';

store( 'my-plugin/x', {
  callbacks: {
    syncOnNav() {
      const context = getContext();
      const server = getServerContext();
      if ( server.currentPage !== undefined ) {
        context.currentPage = server.currentPage;
      }
    },
  },
} );
```

Elements outside any router region won't re-render on navigation, but they can still update via getters that read `getServerState()` / `getServerContext()` — those update on every navigation.

## `navigate()` options

```js
yield actions.navigate( url, {
  force: true,                 // Bypass cache, refetch.
  html: customHtml,            // Use this HTML instead of fetching.
  replace: true,               // history.replaceState instead of pushState.
  timeout: 5000,               // ms before full-reload fallback (default 10000).
  loadingAnimation: false,
  screenReaderAnnouncement: false,
} );
```

Scroll and focus are NOT managed by the router — handle them in your action (`window.scrollTo`, focus the main heading, etc.).

`force: true` is useful after a mutation:

```js
*deleteAndRefresh() {
  yield fetch( '/wp-json/wp/v2/posts/123', { method: 'DELETE' } );
  const { actions } = yield import( '@wordpress/interactivity-router' );
  yield actions.navigate( window.location.href, { force: true } );
}
```

## Dynamic regions — `attachTo`

A region that exists only on some pages can be inserted dynamically:

```html
<div
  data-wp-interactive="my-plugin/x"
  data-wp-router-region='{ "id": "my-plugin/modal", "attachTo": "body" }'
>
  <div class="modal">…</div>
</div>
```

When the router navigates to a page defining this region from a page without it, the region is created and appended to the `attachTo` element.

## Error handling

`navigate()` errors fall back to a full reload automatically. To handle errors yourself, fetch manually and pass HTML in:

```js
*navigate( event ) {
  event.preventDefault();
  const url = event.target.href;
  try {
    const res = yield fetch( url );
    if ( ! res.ok ) { state.error = `${ res.status }`; return; }
    const html = yield res.text();
    const { actions } = yield import( '@wordpress/interactivity-router' );
    yield actions.navigate( url, { html } );
  } catch ( e ) {
    state.error = 'Network error.';
  }
}
```

## Disabling client navigation for specific pages

```php
add_action( 'wp', function() {
  if ( is_page_template( 'complex.php' ) ) {
    wp_interactivity_config( 'core/router', array( 'clientNavigationDisabled' => true ) );
  }
} );
```

When disabled, `navigate()` triggers a full reload and `prefetch()` is a no-op.

## Subscribing to URL changes

```js
import { watch, store } from '@wordpress/interactivity';

watch( () => {
  const { state } = store( 'core/router' );
  trackPageView( state.url );
} );
```
