#!/usr/bin/env node
import "tsx/esm";

const { run } = await import("../src/runner.ts");

const verbose =
	process.argv.includes("--verbose") ||
	process.argv.includes("-v") ||
	process.env.SKILLSMITH_VERBOSE === "1";

process.exit(await run({ verbose }));
