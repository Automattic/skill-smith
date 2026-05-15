import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the toggle-visibility scenario.
 */

test.describe("toggle-visibility scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-toggle-visibility-${workerInfo.project.metadata.agentId}`,
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

	test("paragraph is hidden initially with aria-expanded='false'", async ({
		page,
	}) => {
		const toggle = page.locator("button[aria-expanded]").first();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");

		const paragraph = page.locator("[data-wp-interactive] p").first();
		await expect(paragraph).toBeHidden();
	});

	test("clicking the button reveals the paragraph and flips aria-expanded", async ({
		page,
	}) => {
		const toggle = page.locator("button[aria-expanded]").first();
		const paragraph = page.locator("[data-wp-interactive] p").first();

		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(paragraph).toBeVisible();

		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await expect(paragraph).toBeHidden();
	});
});
