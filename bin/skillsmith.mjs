#!/usr/bin/env node
import "tsx/esm";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

const { run } = await import("../src/runner.ts");
process.exit(await run());
