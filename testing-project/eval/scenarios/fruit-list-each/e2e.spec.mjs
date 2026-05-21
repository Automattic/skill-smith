import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the fruit-list-each scenario.
 */

test.describe("fruit-list-each scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-fruit-list-each-${workerInfo.project.metadata.agentId}`,
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

	test("renders the seeded fruits server-side", async ({ page }) => {
		const items = page.locator(".wp-block-skillsmith-testing-block li");
		await expect(items).toHaveCount(3);
		await expect(items.nth(0)).toContainText("Apple");
		await expect(items.nth(1)).toContainText("Banana");
		await expect(items.nth(2)).toContainText("Cherry");
	});

	test("Add Mango appends a new <li> at the end", async ({ page }) => {
		const items = page.locator(".wp-block-skillsmith-testing-block li");
		await page.getByRole("button", { name: /add mango/i }).click();

		await expect(items).toHaveCount(4);
		await expect(items.nth(3)).toContainText("Mango");
	});

	test("Add Mango clicked twice appends two Mangos", async ({ page }) => {
		const items = page.locator(".wp-block-skillsmith-testing-block li");
		const addBtn = page.getByRole("button", { name: /add mango/i });

		await addBtn.click();
		await addBtn.click();

		await expect(items).toHaveCount(5);
		await expect(items.nth(3)).toContainText("Mango");
		await expect(items.nth(4)).toContainText("Mango");
	});
});
