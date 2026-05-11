import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify as stringifyYaml } from "yaml";
import { printSummary } from "../reports/summary";

function withReport(scenarios: Record<string, unknown>): {
	runDirectory: string;
} {
	const runDirectory = mkdtempSync(join(tmpdir(), "skillsmith-summary-"));
	mkdirSync(runDirectory, { recursive: true });
	writeFileSync(
		join(runDirectory, "report.yaml"),
		stringifyYaml({ runId: "20260101-000000", scenarios }),
	);
	return { runDirectory };
}

function captureStdout<T>(fn: () => T): { value: T; out: string } {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.join(" "));
	};
	try {
		const value = fn();
		return { value, out: lines.join("\n") };
	} finally {
		console.log = original;
	}
}

test("all-pass run exits 0 with RUN RESULT: PASS", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					rubrics: { r1: { pass: true } },
					acceptance: [{ item: "x", pass: true }],
				},
				opus: {
					rubrics: { r1: { pass: true } },
					acceptance: [{ item: "x", pass: true }],
				},
			},
		},
	});

	const { value, out } = captureStdout(() =>
		printSummary({ runDirectory, runId: "x" }),
	);

	assert.equal(value, 0);
	assert.match(out, /scenario\s*\|\s*haiku\s*\|\s*opus/);
	assert.match(out, /counter-block\s*\|\s*PASS\s*\|\s*PASS/);
	assert.match(out, /RUN RESULT: PASS/);
});

test("any failure → exit 1, FAIL, and per-scenario one-liner", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					rubrics: { r1: { pass: true } },
					acceptance: [{ item: "x", pass: true }],
				},
				opus: { rubrics: { r1: { pass: false, notes: "bad" } } },
			},
		},
	});

	const { value, out } = captureStdout(() =>
		printSummary({ runDirectory, runId: "x" }),
	);

	assert.equal(value, 1);
	assert.match(out, /counter-block\s*\|\s*PASS\s*\|\s*FAIL/);
	assert.match(out, /RUN RESULT: FAIL/);
	assert.match(out, /counter-block: opus: rubric r1 not pass/);
});

test("SKIPPED cells render with reason", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: { haiku: { skipped: "empty agent config" } },
		},
	});

	const { value, out } = captureStdout(() =>
		printSummary({ runDirectory, runId: "x" }),
	);

	assert.equal(value, 1);
	assert.match(out, /SKIPPED \(empty agent config\)/);
});
