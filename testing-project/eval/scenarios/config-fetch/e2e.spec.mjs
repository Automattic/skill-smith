import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the config-fetch scenario.
 *
 * The REST endpoint is mocked with page.route() so the test is independent
 * of the wp-env post seed and so we can capture the X-WP-Nonce header to
 * verify the agent's view.js used the config-supplied nonce.
 */

test.describe("config-fetch scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-config-fetch-${workerInfo.project.metadata.agentId}`,
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

	test("clicking the button fetches /wp/v2/posts/1 with the nonce header and renders the title", async ({
		page,
	}) => {
		let capturedNonce = null;
		let capturedUrl = null;

		await page.route("**/wp-json/wp/v2/posts/1**", (route) => {
			capturedNonce = route.request().headers()["x-wp-nonce"] ?? null;
			capturedUrl = route.request().url();
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					id: 1,
					title: { rendered: "Mocked Greeting Title" },
				}),
			});
		});

		await page.goto(`/?p=${post.id}`);

		await page.getByRole("button", { name: /load post|fetch/i }).click();

		await expect(
			page.locator(".wp-block-skillsmith-testing-block"),
		).toContainText("Mocked Greeting Title");

		expect(capturedUrl).toBeTruthy();
		expect(capturedNonce).toBeTruthy();
		expect(capturedNonce).not.toBe("undefined");
	});
});
