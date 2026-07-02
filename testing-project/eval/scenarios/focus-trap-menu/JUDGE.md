Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.

## Code checks

Verify in the produced source files:

- A single boolean state/context property (e.g. `isOpen`) drives both the drawer's open/closed rendering and the "Menu" button's `aria-expanded` value
- The "Menu" button uses `data-wp-on--click` (not a manual `addEventListener`) wired to a named store action that toggles the open state
- The "Menu" button's `aria-expanded` is wired with `data-wp-bind--aria-expanded` referencing the same boolean (no hand-written attribute writes)
- The drawer's visibility is driven reactively from the same boolean via a directive such as `data-wp-bind--hidden` (or an equivalent `data-wp-bind--*` / `data-wp-class--*`), not via `classList.*`, `style.*`, or `hidden` writes from JS
- The server-rendered HTML reflects the initial closed state (drawer hidden, `aria-expanded="false"`) so it is correct before hydration
- Tab / Shift+Tab keyboard handling is wired through Interactivity API directives (any of `data-wp-on--keydown` on the boundary links, or a drawer-/document-level `data-wp-on--keydown` / `data-wp-on-document--keydown` that detects the active element), not via a manual `addEventListener` in `view.js` and not by mutating `tabindex` on every focusable element on the page
- Escape handling is wired with `data-wp-on--keydown` (on the drawer, or via `data-wp-on-document--keydown` / `data-wp-on-window--keydown`) to a named store action that closes the drawer
- Focus is returned to the "Menu" button when the drawer closes, and the action's logic for locating that button is scoped to the block instance (e.g. via `getElement().ref` or a reference captured when the drawer opened) rather than relying on a global / document-wide `document.querySelector` lookup that could match unrelated buttons on the page
- The three drawer links are real anchors (`<a href="#home">`, `<a href="#about">`, `<a href="#contact">`) rendered server-side, not built or injected by `view.js`

As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.

## Behavior checks

Verify on the live, running site:

- The "Menu" button initially has `aria-expanded="false"` and the drawer is hidden.
- Clicking the "Menu" button flips its `aria-expanded` to `"true"` and makes the "Home", "About", and "Contact" links visible.
- With the drawer open, pressing Escape closes it — `aria-expanded` returns to `"false"` and the drawer is hidden — and returns keyboard focus to the "Menu" button.
- With the drawer open and focus on the "Contact" link, pressing Tab wraps focus to the "Home" link.
- With the drawer open and focus on the "Home" link, pressing Shift+Tab wraps focus to the "Contact" link.
