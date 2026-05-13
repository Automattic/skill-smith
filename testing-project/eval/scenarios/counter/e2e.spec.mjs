import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the counter-block scenario.
 */

test.describe("counter block scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		// Ensure the block plugin is active before tests run.
		await requestUtils.activatePlugin(
			`plugin-counter-block-${workerInfo.project.metadata.agentId}`,
		);
		post = await requestUtils.createPost({
			content: "<!-- wp:skillsmith/testing-block /-->",
			status: "publish",
		});
	});

	test.beforeEach(async ({ page }) => {
		await page.goto(`/?p=${post.id}`);
	});

	test.afterAll(async ({ requestUtils }) => {
		deactivateAllPlugins();
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
