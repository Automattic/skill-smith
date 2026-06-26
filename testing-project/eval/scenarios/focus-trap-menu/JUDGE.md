You are grading a WordPress interactive block implementing an accessible hamburger menu with a Tab focus trap, Escape-to-close, and focus restoration. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The block should render a "Menu" button that toggles a drawer holding three links ("Home", "About", "Contact"). Confirm all of the following in the produced code:

- A single boolean state/context property (e.g. `isOpen`) drives both the drawer's open/closed rendering and the "Menu" button's `aria-expanded` value.
- The "Menu" button uses `data-wp-on--click` (not a manual `addEventListener`) wired to a named store action that toggles the open state.
- The button's `aria-expanded` is wired with `data-wp-bind--aria-expanded` referencing the same boolean (no hand-written attribute writes).
- The drawer's visibility is driven reactively from the same boolean via a directive such as `data-wp-bind--hidden` (or an equivalent `data-wp-bind--*` / `data-wp-class--*`), not via `classList.*`, `style.*`, or `hidden` writes from JS.
- The server-rendered HTML reflects the initial closed state (drawer hidden, `aria-expanded="false"`) so it is correct before hydration.
- Tab / Shift+Tab handling is wired through Interactivity API directives (`data-wp-on--keydown` on the boundary links, or a drawer-/document-level keydown directive that detects the active element), not via a manual `addEventListener` and not by mutating `tabindex` on every focusable element on the page.
- Escape handling is wired with `data-wp-on--keydown` (on the drawer, or via `data-wp-on-document--keydown` / `data-wp-on-window--keydown`) to a named store action that closes the drawer.
- Focus is returned to the "Menu" button when the drawer closes, and the action locates that button scoped to the block instance (e.g. via `getElement().ref` or a ref captured when the drawer opened) rather than a global `document.querySelector` lookup that could match unrelated buttons.
- The three drawer links are real anchors (`<a href="#home">`, `<a href="#about">`, `<a href="#contact">`) rendered server-side, not built or injected by `view.js`.

## Live checks

Open the published post. On initial load the "Menu" button must report `aria-expanded="false"` and the drawer (and its links) must be hidden. Click the "Menu" button: `aria-expanded` flips to "true" and the "Home", "About", and "Contact" links become visible. With the drawer open, move focus to the "Contact" link and press Tab — focus must wrap to "Home"; press Shift+Tab on "Home" — focus must wrap to "Contact". Press the Escape key: the drawer must close, `aria-expanded` returns to "false", and keyboard focus must return to the "Menu" button.

# Rubrics

- wp-interactivity-api-best-practices
