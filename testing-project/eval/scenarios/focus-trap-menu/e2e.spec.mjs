import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { deactivateAllPlugins } from "../../utils/wp-cli.mjs";

/**
 * E2E tests for the focus-trap-menu scenario.
 */

test.describe("focus-trap-menu scenario", () => {
	let post;
	test.beforeAll(async ({ requestUtils }, workerInfo) => {
		deactivateAllPlugins();
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

	test.afterAll(async ({ requestUtils }) => {
		deactivateAllPlugins();
		await requestUtils.deleteAllPosts();
	});

	// Scope to the testing-block so we don't pick up other navigation
	// blocks on the page (e.g. core/navigation) that may also render links
	// labelled "Home" / "About" / "Contact". We use the WP-emitted block
	// class (always derived from the fixed block name) rather than the
	// agent's chosen `data-wp-interactive` namespace, which is variable.
	const block = (page) => page.locator(".wp-block-skillsmith-testing-block");
	// `el.hidden` on the closest ancestor of the home link in the block
	// reflects the iAPI `data-wp-bind--hidden` wiring directly — and is
	// not silently defeated by user CSS like `display: flex` on the
	// drawer, the way Playwright's visibility-based `toBeHidden()` would
	// be. The scenario tests iAPI wiring; visual styling is not in scope.
	const isDrawerHidden = (page) =>
		page.evaluate(() => {
			const root = document.querySelector(".wp-block-skillsmith-testing-block");
			const link = root?.querySelector('a[href="#home"]');
			if (!link) return null;
			for (
				let el = link.parentElement;
				el && el !== root.parentElement;
				el = el.parentElement
			) {
				if (el.hidden) return true;
			}
			return false;
		});

	test("drawer is closed initially with aria-expanded='false'", async ({
		page,
	}) => {
		const hamburger = block(page).getByRole("button", { name: /menu/i });
		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
		expect(await isDrawerHidden(page)).toBe(true);
	});

	test("clicking the hamburger opens the drawer and exposes the links", async ({
		page,
	}) => {
		const hamburger = block(page).getByRole("button", { name: /menu/i });
		await hamburger.click();

		await expect(hamburger).toHaveAttribute("aria-expanded", "true");
		await expect
			.poll(() => isDrawerHidden(page), { timeout: 5000 })
			.toBe(false);
		await expect(
			block(page).getByRole("link", { name: /^home$/i }),
		).toBeVisible();
		await expect(
			block(page).getByRole("link", { name: /^about$/i }),
		).toBeVisible();
		await expect(
			block(page).getByRole("link", { name: /^contact$/i }),
		).toBeVisible();
	});

	test("Escape closes the drawer and returns focus to the hamburger", async ({
		page,
	}) => {
		const hamburger = block(page).getByRole("button", { name: /menu/i });
		await hamburger.click();
		await expect(hamburger).toHaveAttribute("aria-expanded", "true");

		await page.keyboard.press("Escape");

		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
		await expect.poll(() => isDrawerHidden(page), { timeout: 5000 }).toBe(true);
		await expect(hamburger).toBeFocused();
	});

	test("Tab focus is trapped within the three drawer links", async ({
		page,
	}) => {
		await block(page).getByRole("button", { name: /menu/i }).click();

		const home = block(page).getByRole("link", { name: /^home$/i });
		const contact = block(page).getByRole("link", { name: /^contact$/i });

		// Forward wrap: Tab on Contact -> Home
		await contact.focus();
		await page.keyboard.press("Tab");
		await expect(home).toBeFocused();

		// Backward wrap: Shift+Tab on Home -> Contact
		await page.keyboard.press("Shift+Tab");
		await expect(contact).toBeFocused();
	});
});
