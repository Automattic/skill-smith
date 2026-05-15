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

const VALID_MODES = new Set(["test-only", "loop"]);
const VALID_EVALUATION_MODES = new Set([
	"failed-pairs",
	"failed-scenarios",
	"all",
]);

let values;
let scenarios;
try {
	({ values, positionals: scenarios } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		strict: true,
		options: {
			verbose: { type: "boolean", short: "v" },
			mode: { type: "string" },
			iterations: { type: "string" },
			evaluation: { type: "string" },
			"final-pass": { type: "boolean" },
		},
	}));
} catch (err) {
	console.error(err.message);
	console.error(
		"Usage: skillsmith [--verbose] [--mode test-only|loop] [--iterations N] [--evaluation failed-pairs|failed-scenarios|all] [--final-pass] [scenario-dir ...]",
	);
	process.exit(1);
}

const verbose =
	values.verbose === true || process.env.SKILLSMITH_VERBOSE === "1";

const overrides = {};
if (values.mode !== undefined) {
	if (!VALID_MODES.has(values.mode)) {
		console.error(
			`--mode must be one of ${[...VALID_MODES].map((m) => `"${m}"`).join(", ")}`,
		);
		process.exit(1);
	}
	overrides.mode = values.mode;
}
if (values.iterations !== undefined) {
	const n = Number.parseInt(values.iterations, 10);
	if (!Number.isFinite(n) || n < 1) {
		console.error("--iterations must be an integer >= 1");
		process.exit(1);
	}
	overrides.maxIterations = n;
}
if (values.evaluation !== undefined) {
	if (!VALID_EVALUATION_MODES.has(values.evaluation)) {
		console.error(
			`--evaluation must be one of ${[...VALID_EVALUATION_MODES].map((m) => `"${m}"`).join(", ")}`,
		);
		process.exit(1);
	}
	overrides.evaluationMode = values.evaluation;
}
if (values["final-pass"] === true) {
	overrides.finalPass = true;
}

process.exit(
	await run({
		verbose,
		scenarios,
		selfImprovement: Object.keys(overrides).length > 0 ? overrides : undefined,
	}),
);
