import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the minimal-scaffold scenario.
 *
 * If the runtime never picks the block up, the data-wp-init callback never
 * runs and the "iapi-ready" log never appears — that's the trip-wire.
 */

test.describe("minimal-scaffold scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-minimal-scaffold-${workerInfo.project.metadata.agentId}`,
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

	test("renders the Hello text and logs 'iapi-ready' on hydration", async ({
		page,
	}) => {
		const consoleMessages = [];
		page.on("console", (msg) => consoleMessages.push(msg.text()));

		await page.goto(`/?p=${post.id}`);

		await expect(
			page.locator(".wp-block-skillsmith-testing-block"),
		).toContainText("Hello from iAPI");

		// Hydration is async — poll for the marker.
		await expect
			.poll(() => consoleMessages.some((m) => m.includes("iapi-ready")), {
				timeout: 5000,
			})
			.toBe(true);
	});

	test("the wrapper carries a data-wp-interactive namespace", async ({
		page,
	}) => {
		await page.goto(`/?p=${post.id}`);

		const wrapper = page
			.locator(".wp-block-skillsmith-testing-block[data-wp-interactive]")
			.first();
		await expect(wrapper).toBeVisible();
		const namespace = await wrapper.getAttribute("data-wp-interactive");
		expect(namespace).toBeTruthy();
		expect(namespace.length).toBeGreaterThan(0);
	});
});
