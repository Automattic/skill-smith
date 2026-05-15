#!/usr/bin/env node
import "tsx/esm";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

const { run } = await import("../src/runner.ts");
const scenarios = process.argv.slice(2);
const unsupported = scenarios.find((arg) => arg.startsWith("-"));
if (unsupported !== undefined) {
	console.error(`Unsupported option: ${unsupported}`);
	console.error("Usage: skillsmith [scenario-dir ...]");
	process.exit(1);
}

process.exit(await run({ scenarios }));
