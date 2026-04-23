import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import { RequestUtils } from "@wordpress/e2e-test-utils-playwright";

export default async function globalSetup(config) {
	const { storageState, baseURL } = config.projects[0].use;
	const storageStatePath =
		typeof storageState === "string" ? storageState : undefined;

	if (storageStatePath) {
		fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
	}

	const requestContext = await request.newContext({ baseURL });
	const requestUtils = new RequestUtils(requestContext, {
		baseURL,
		storageStatePath,
	});

	// Logs in as the wp-env default admin, issues an application password,
	// and persists the auth state to storageStatePath for each test to reuse.
	await requestUtils.setupRest();

	await requestContext.dispose();
}
