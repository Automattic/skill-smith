#!/usr/bin/env node
import { loadEnvFile } from "node:process";

try {
	loadEnvFile();
} catch (err) {
	if (err?.code !== "ENOENT") throw err;
}

import "tsx/esm";

const { run } = await import("../src/runner.ts");
process.exit(await run());
