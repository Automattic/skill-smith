You are grading a WordPress interactive expandable-note block with a show/hide toggle. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## What to check

- A single boolean in state or context drives both the button's `aria-expanded` value and the paragraph's hidden state, so the two cannot drift apart.
- The button uses `data-wp-bind--aria-expanded` bound to that boolean (so `aria-expanded` reflects it directly).
- The paragraph uses `data-wp-bind--hidden` bound to the negation of that boolean (or the button uses an equivalent bound directive that hides the paragraph when the boolean is false).

## Live checks

Open the published post. On initial load the paragraph must be hidden and the button must report `aria-expanded="false"`. Click the button: the paragraph becomes visible and `aria-expanded` flips to "true". Click the button again: the paragraph hides again and `aria-expanded` returns to "false". The button's `aria-expanded` value must always match whether the paragraph is visible.
