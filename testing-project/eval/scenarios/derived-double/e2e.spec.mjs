import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the derived-double scenario.
 *
 * Asserts that two reactive numeric values render where one is always
 * twice the other, regardless of which order the agent rendered them in.
 */

test.describe("derived-double scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-derived-double-${workerInfo.project.metadata.agentId}`,
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

	/**
	 * Read the two reactive numeric values, sorted ascending so the test is
	 * order-independent.
	 */
	async function readValues(page) {
		const reactive = page.locator("[data-wp-interactive] [data-wp-text]");
		await expect(reactive).toHaveCount(2);
		const texts = await reactive.allTextContents();
		return texts.map((t) => parseInt(t.trim(), 10)).sort((a, b) => a - b);
	}

	test("renders counter=1 and double=2 initially", async ({ page }) => {
		expect(await readValues(page)).toEqual([1, 2]);
	});

	test("incrementing keeps double = counter * 2", async ({ page }) => {
		const button = page.getByRole("button", { name: /increment/i });

		await button.click();
		expect(await readValues(page)).toEqual([2, 4]);

		await button.click();
		expect(await readValues(page)).toEqual([3, 6]);

		await button.click();
		await button.click();
		expect(await readValues(page)).toEqual([5, 10]);
	});
});
