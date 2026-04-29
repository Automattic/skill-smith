import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const STORAGE_STATE_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	".auth/admin.json",
);

// @wordpress/e2e-test-utils-playwright reads WP_BASE_URL and STORAGE_STATE_PATH
// at module load. Pin them here so both global-setup and the package's own
// per-worker requestUtils fixture write to the same file.
process.env.WP_BASE_URL ??= "http://localhost:8888";
process.env.STORAGE_STATE_PATH ??= STORAGE_STATE_PATH;

export default defineConfig({
	testDir: "./eval/scenarios",
	testMatch: "**/e2e.spec.mjs",
	globalSetup: "./global-setup.mjs",
	reporter: [["list"], ["json"]],
	use: {
		baseURL: process.env.WP_BASE_URL,
		storageState: STORAGE_STATE_PATH,
	},
});
