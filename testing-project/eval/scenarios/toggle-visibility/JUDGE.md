## Code checks

Verify in the produced source files:

- A single boolean in state or context drives both the button's aria-expanded value and the paragraph's hidden state, so the two cannot drift apart
- The button uses data-wp-on--click bound to a named toggle action that flips that boolean
- The button uses data-wp-bind--aria-expanded bound to that boolean (so aria-expanded reflects it directly)
- The paragraph uses data-wp-bind--hidden bound to the negation of that boolean (or the button uses an equivalent bound directive that hides the paragraph when the boolean is false)
- Server-rendered HTML reflects the initial closed state: the paragraph carries the hidden attribute and the button has aria-expanded="false"

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- On initial load, the paragraph is hidden and the button reports aria-expanded="false".
- Clicking the button reveals the paragraph and flips aria-expanded to "true".
- Clicking the button again hides the paragraph and flips aria-expanded back to "false".
