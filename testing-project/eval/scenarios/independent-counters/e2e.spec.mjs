import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the independent-counters scenario.
 *
 * The post embeds the block twice so we can verify that each instance
 * keeps its own counter value (i.e. they use local context, not global state).
 */

test.describe("independent-counters scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-independent-counters-${workerInfo.project.metadata.agentId}`,
		);
		post = await requestUtils.createPost({
			content:
				"<!-- wp:skillsmith/testing-block /-->\n<!-- wp:skillsmith/testing-block /-->",
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

	test("renders two instances each starting at 0", async ({ page }) => {
		const wrappers = page.locator(".wp-block-skillsmith-testing-block");
		await expect(wrappers).toHaveCount(2);

		const counters = wrappers.locator("[data-wp-text]");
		await expect(counters.nth(0)).toHaveText("0");
		await expect(counters.nth(1)).toHaveText("0");
	});

	test("incrementing one instance does not affect the other", async ({
		page,
	}) => {
		const wrappers = page.locator(".wp-block-skillsmith-testing-block");
		const counters = wrappers.locator("[data-wp-text]");
		const buttons = wrappers.getByRole("button", { name: /increment/i });

		await buttons.nth(0).click();
		await buttons.nth(0).click();
		await expect(counters.nth(0)).toHaveText("2");
		await expect(counters.nth(1)).toHaveText("0");

		await buttons.nth(1).click();
		await expect(counters.nth(0)).toHaveText("2");
		await expect(counters.nth(1)).toHaveText("1");
	});
});
