---
name: wp-interactivity-api
description: "Must use when building any type of interactivity in WordPress's frontend (not the admin), both in blocks or PHP themes."
---

The Interactivity API is WordPress's standard system for building interactive frontends. It uses server-rendered HTML enhanced with declarative directives (like `data-wp-interactive`, `data-wp-bind`, `data-wp-on`) and a reactive store (state, actions, callbacks) to add client-side behavior without replacing the server-rendered markup.

## MUST-HAVE KNOWLEDGE

Before working on any task, you MUST read all the reference files listed below.

- [Directives and Store](references/directives-and-store.md)
- [Reactive and declarative mindset](references/the-reactive-and-declarative-mindset.md)
- [Understanding global state, local context and derived state](references/undestanding-global-state-local-context-and-derived-state.md)
- [Server-side rendering](references/server-side-rendering.md)

## ADDITIONAL REFERENCES

Only read these if the task involves the specific topic.

- [Client-side Navigation](references/client-side-navigation.md) — read if the task involves client-side navigation or region-based routing.
- [Using TypeScript](references/using-typescript.md) — read if the task involves TypeScript.

## COMMON PITFALLS

Internalize these before writing code; they account for the bugs that most easily slip past a first pass.

- **Directive expressions are reference-only.** A directive value (`data-wp-bind--*`, `data-wp-text`, `data-wp-class--*`, …) is a single reference to a store property or callback, optionally prefixed with `!`. Move arithmetic, comparisons (`<=`, `>=`, `===`), function calls, and ternaries into a derived getter and reference the getter by name. The PHP Server Directive Processor only evaluates simple references — if you inline JS-style expressions, the directive does not affect the server-rendered HTML, so the page renders incorrectly until hydration. See [Values of directives are references to store properties](references/directives-and-store.md#values-of-directives-are-references-to-store-properties).
- **`getElement().ref` is the element that owns the directive — not the wrapper.** When a `data-wp-on--*` / `data-wp-on-document--*` / `data-wp-on-window--*` handler needs to reach DOM that is not a descendant of the listener element (e.g. an Escape handler that must restore focus to a "Menu" button which is a sibling of the drawer), attach the directive to the block's wrapper (or another common ancestor) — NOT to the drawer / nested element — so `getElement().ref` covers everything you need to query. See [`getElement()` → `ref`](references/directives-and-store.md#ref).
- **Per-instance UI state belongs in local context, not global state.** A toggle's `isOpen`, a counter that should be independent across instances, or a drawer's expanded flag must live in `wp_interactivity_data_wp_context()`. Putting per-instance UI in `wp_interactivity_state()` makes every block instance share the same value and toggle together.
- **Don't hand-duplicate values a directive will populate.** Leave `data-wp-text` targets empty, omit attributes that `data-wp-bind--*` writes, don't pre-add classes that `data-wp-class--*` toggles, and emit only the `<template>` for `data-wp-each` (no static `<li>`s). Seed the value once via `wp_interactivity_state()` or `wp_interactivity_data_wp_context()` and let Server Directive Processing fill it in.
- **A block with a `view.js` needs `viewScriptModule` in `block.json`.** `supports.interactivity: true` alone does NOT register the view module — `wp-scripts` only treats `view.js` as an entry point when `block.json` declares `"viewScriptModule": "file:./view.js"` (the script-module field, not the legacy `viewScript`). Without it, `view.js` is not built into the plugin's output directory, nothing is enqueued, no directives hydrate, and any `actions.navigate()` link silently falls back to a full-page reload. Do NOT compensate by calling `wp_register_script_module()` / `wp_enqueue_script_module()` from `render.php` — that is the classic-theme path and typically points at a `view.js` that `wp-scripts` never emitted.
