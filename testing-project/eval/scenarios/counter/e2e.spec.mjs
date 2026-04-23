import { expect, test } from "@wordpress/e2e-test-utils-playwright";

/**
 * E2E tests for the counter-block scenario.
 */

test.describe("counter block scenario", () => {
  let post;
  test.beforeAll(async ({ requestUtils }) => {
    // Ensure the block plugin is active before tests run.
    await requestUtils.activatePlugin("testing-plugin");
    post = await requestUtils.createPost({
      content: "<!-- wp:testing-plugin/testing-block /-->",
      status: "publish",
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`/?p=${post.id}`);
  });

  test.afterAll(async ({ requestUtils }) => {
    await requestUtils.deleteAllPosts();
  });

  test("renders the initial counter value of 5", async ({ page }) => {
    const counter = page.locator("[data-wp-text]");
    await expect(counter).toHaveText("5");
  });

  test("increment and decrement buttons work", async ({ page }) => {
    const counter = page.locator("[data-wp-text]");
    const incrementBtn = page.getByRole("button", { name: /increment/i });
    const decrementBtn = page.getByRole("button", { name: /decrement/i });

    await incrementBtn.click();
    await expect(counter).toHaveText("6");

    await decrementBtn.click();
    await decrementBtn.click();
    await expect(counter).toHaveText("4");
  });
});
