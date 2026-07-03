## Code checks

Verify in the produced source files:

- Has increment and decrement actions that modify the counter state
- Uses data-wp-on--click on both increment and decrement buttons
- Uses data-wp-text or equivalent to display the counter value reactively
- Server-rendered HTML includes the initial counter value (5)

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- The block initially displays the counter value 5.
- Clicking the increment button updates the displayed value to 6.
- Clicking the decrement button twice from there updates the displayed value to 4.
