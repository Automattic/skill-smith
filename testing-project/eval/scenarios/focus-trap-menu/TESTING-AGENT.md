I need an interactive block for WordPress for an accessible hamburger
menu. Here is what it should do:

- Render a button with the accessible name "Menu" that toggles a drawer
  open and closed.
- The drawer holds exactly three navigation links with the visible text
  "Home", "About", and "Contact", and each must be a real anchor of the
  form <a href="#home">, <a href="#about">, <a href="#contact">.
- The drawer starts closed (not visible / not in the tab order) on
  initial page load, before and after hydration.
- The "Menu" button must expose its open/closed state to assistive
  technology so screen readers announce it correctly.
- When the drawer is open, keyboard focus should stay inside the three
  links: tabbing past the last link should wrap back to the first, and
  shift-tabbing past the first link should wrap to the last.
- Pressing the Escape key while the drawer is open should close it and
  move keyboard focus back to the "Menu" button so the user doesn't
  lose their place.

Accessibility (aria semantics, focus management, keyboard handling) is
the priority — please make sure a keyboard-only user can open the
menu, move through the links, and close it without ever losing focus.

# Skills

- wp-interactivity-api
