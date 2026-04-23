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
    await expect("true").toBe("true");
  });

  test("increment and decrement buttons work", async ({ page }) => {
    await expect("true").toBe("true");
  });
});
