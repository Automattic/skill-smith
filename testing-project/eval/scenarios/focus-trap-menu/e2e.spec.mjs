import { expect, test } from "@wordpress/e2e-test-utils-playwright";

/**
 * E2E tests for the focus-trap-menu scenario.
 */

test.describe("focus-trap-menu scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		await requestUtils.activatePlugin(
			`plugin-focus-trap-menu-${workerInfo.project.metadata.agentId}`,
		);
		post = await requestUtils.createPost({
			content: "<!-- wp:skillsmith/testing-block /-->",
			status: "publish",
		});
	});

	test.beforeEach(async ({ page }) => {
		await page.goto(`/?p=${post.id}`);
	});

	test.afterAll(async ({ requestUtils }, workerInfo) => {
		await requestUtils.deleteAllPosts();
		await requestUtils.deactivatePlugin(
			`plugin-focus-trap-menu-${workerInfo.project.metadata.agentId}`,
		);
	});

	test("drawer is closed initially with aria-expanded='false'", async ({
		page,
	}) => {
		const hamburger = page.getByRole("button", { name: /menu/i });
		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByRole("link", { name: /^home$/i })).toBeHidden();
	});

	test("clicking the hamburger opens the drawer and exposes the links", async ({
		page,
	}) => {
		const hamburger = page.getByRole("button", { name: /menu/i });
		await hamburger.click();

		await expect(hamburger).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByRole("link", { name: /^home$/i })).toBeVisible();
		await expect(page.getByRole("link", { name: /^about$/i })).toBeVisible();
		await expect(page.getByRole("link", { name: /^contact$/i })).toBeVisible();
	});

	test("Escape closes the drawer and returns focus to the hamburger", async ({
		page,
	}) => {
		const hamburger = page.getByRole("button", { name: /menu/i });
		await hamburger.click();
		await expect(hamburger).toHaveAttribute("aria-expanded", "true");

		await page.keyboard.press("Escape");

		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByRole("link", { name: /^home$/i })).toBeHidden();
		await expect(hamburger).toBeFocused();
	});

	test("Tab focus is trapped within the three drawer links", async ({
		page,
	}) => {
		await page.getByRole("button", { name: /menu/i }).click();

		const home = page.getByRole("link", { name: /^home$/i });
		const contact = page.getByRole("link", { name: /^contact$/i });

		// Forward wrap: Tab on Contact -> Home
		await contact.focus();
		await page.keyboard.press("Tab");
		await expect(home).toBeFocused();

		// Backward wrap: Shift+Tab on Home -> Contact
		await page.keyboard.press("Shift+Tab");
		await expect(contact).toBeFocused();
	});
});
