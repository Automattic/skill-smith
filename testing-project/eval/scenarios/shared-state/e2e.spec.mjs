import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the shared-state scenario.
 *
 * The post embeds the block twice so we can verify that incrementing in one
 * instance updates the displayed value in BOTH (i.e. they share global state).
 */

test.describe("shared-state scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-shared-state-${workerInfo.project.metadata.agentId}`,
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

	test("renders two instances both at 0", async ({ page }) => {
		const counters = page.locator("[data-wp-text]");
		await expect(counters).toHaveCount(2);
		await expect(counters.nth(0)).toHaveText("0");
		await expect(counters.nth(1)).toHaveText("0");
	});

	test("clicking any button updates both displays in lockstep", async ({
		page,
	}) => {
		const counters = page.locator("[data-wp-text]");
		const buttons = page.getByRole("button", { name: /increment/i });
		await expect(buttons).toHaveCount(2);

		await buttons.nth(0).click();
		await expect(counters.nth(0)).toHaveText("1");
		await expect(counters.nth(1)).toHaveText("1");

		await buttons.nth(1).click();
		await expect(counters.nth(0)).toHaveText("2");
		await expect(counters.nth(1)).toHaveText("2");

		await buttons.nth(0).click();
		await expect(counters.nth(0)).toHaveText("3");
		await expect(counters.nth(1)).toHaveText("3");
	});
});
