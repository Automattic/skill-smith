import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the paginated-list scenario.
 *
 * Creates 5 plain posts plus a host post that embeds the block. With 6
 * posts total at 3 per page, we expect 2 pages. The test asserts that:
 *   - Page 1 contains the newest test post.
 *   - Clicking Next updates the URL to ?pg=2 WITHOUT a full page reload
 *     (a JS sentinel set on window before the click survives).
 *   - Page 2 contains the oldest test post.
 */

test.describe("paginated-list scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
		await requestUtils.activatePlugin(
			`plugin-paginated-list-${workerInfo.project.metadata.agentId}`,
		);
		// Five test posts, oldest first so requestUtils assigns ascending IDs.
		for (let i = 1; i <= 5; i++) {
			await requestUtils.createPost({
				title: `Test post ${i}`,
				status: "publish",
			});
		}
		post = await requestUtils.createPost({
			title: "Block host",
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

	test("renders the first page of 3 newest posts server-side", async ({
		page,
	}) => {
		const region = page.locator("[data-wp-router-region]");
		await expect(region).toBeVisible();

		// Newest first: the host post + Test post 5 + Test post 4.
		await expect(region).toContainText("Test post 5");
		await expect(region).toContainText("Test post 4");
		// Test post 1 is the oldest — should not be on page 1.
		await expect(region).not.toContainText("Test post 1");

		// Previous link should not be available on page 1. The link may be
		// either omitted server-side, or rendered with `data-wp-bind--hidden`
		// bound to a derived getter that the Server Directive Processor
		// turns into the `hidden` attribute server-side; both pull the link
		// out of the accessibility tree so `getByRole('link')` does not
		// match it. (Inline expressions like `context.pg <= 1` do NOT work
		// because SDP doesn't evaluate them, leaving the link in the
		// accessibility tree on the initial render.)
		await expect(
			page
				.locator(".wp-block-skillsmith-testing-block")
				.getByRole("link", { name: /^previous$/i }),
		).toHaveCount(0);
	});

	test("Next link navigates client-side to page 2 without a full reload", async ({
		page,
	}) => {
		// Plant a sentinel on window. A full reload would wipe it.
		await page.evaluate(() => {
			window.__noReloadSentinel = true;
		});

		// Scope the Next link to the testing block so it never collides
		// with theme-emitted post navigation that might also expose a
		// "Next" link in some themes.
		await page
			.locator(".wp-block-skillsmith-testing-block")
			.getByRole("link", { name: /^next$/i })
			.click();

		// Wait for the in-place swap to land: page 2 should now show
		// the oldest test post and no longer show the newest. This is
		// the most diagnostic signal — if the router never fires, the
		// content stays on page 1 and this assertion fails clearly,
		// instead of `waitForURL` timing out opaquely.
		//
		// The router has to dynamically import its module, fetch the
		// target page, parse it, and swap in the new region content;
		// without a prior `prefetch` (we never hover in this test),
		// that whole pipeline runs cold on a wp-env instance that can
		// be slow on the first request after env startup. The 30s
		// ceiling absorbs that cold-start latency while still flagging
		// a genuinely stuck navigation.
		const region = page.locator("[data-wp-router-region]");
		await expect(region).toContainText("Test post 1", { timeout: 30_000 });
		await expect(region).not.toContainText("Test post 5");

		// URL must reflect ?pg=2 either via pushState (router) or a
		// full reload (fallback). The sentinel check below distinguishes.
		expect(page.url()).toMatch(/[?&]pg=2(\b|&|$)/);

		// The sentinel survived → no full reload → this was client-side.
		const survived = await page.evaluate(
			() => window.__noReloadSentinel === true,
		);
		expect(survived).toBe(true);
	});
});
