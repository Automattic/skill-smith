#!/usr/bin/env node
import "tsx/esm";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

const { run } = await import("../src/runner.ts");

let values;
let scenarios;
try {
	({ values, positionals: scenarios } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		strict: true,
		options: {
			verbose: { type: "boolean", short: "v" },
		},
	}));
} catch (err) {
	console.error(err.message);
	console.error("Usage: skillsmith [--verbose] [scenario-dir ...]");
	process.exit(1);
}

const verbose =
	values.verbose === true || process.env.SKILLSMITH_VERBOSE === "1";

process.exit(await run({ verbose, scenarios }));
