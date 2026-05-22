import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the async-fetch scenario.
 *
 * The remote URL is mocked with page.route() so the test is fully isolated.
 */

test.describe("async-fetch scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-async-fetch-${workerInfo.project.metadata.agentId}`,
		);
		post = await requestUtils.createPost({
			content: "<!-- wp:skillsmith/testing-block /-->",
			status: "publish",
		});
	});

	test.afterAll(async ({ requestUtils }) => {
		deactivateAllPlugins();
		await requestUtils.deleteAllPosts();
	});

	test("clicking Fetch joke renders the mocked joke text", async ({ page }) => {
		let requestCount = 0;
		await page.route("**/jsonplaceholder.example/joke", (route) => {
			requestCount++;
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					joke: "Why did the chicken cross the road? To yield a Promise.",
				}),
			});
		});

		await page.goto(`/?p=${post.id}`);

		await page.getByRole("button", { name: /fetch joke/i }).click();

		await expect(
			page.locator(".wp-block-skillsmith-testing-block"),
		).toContainText("Why did the chicken cross the road? To yield a Promise.");
		expect(requestCount).toBe(1);
	});

	test("paragraph is empty until the button is clicked", async ({ page }) => {
		// Mock with a delayed response so we can observe the empty pre-click state.
		await page.route("**/jsonplaceholder.example/joke", async (route) => {
			await new Promise((r) => setTimeout(r, 300));
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ joke: "Eventually-resolved joke." }),
			});
		});

		await page.goto(`/?p=${post.id}`);

		// Before any click, the joke text must not be present.
		await expect(
			page.locator(".wp-block-skillsmith-testing-block"),
		).not.toContainText("Eventually-resolved joke.");

		await page.getByRole("button", { name: /fetch joke/i }).click();

		await expect(
			page.locator(".wp-block-skillsmith-testing-block"),
		).toContainText("Eventually-resolved joke.");
	});
});
