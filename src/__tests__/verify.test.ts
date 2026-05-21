import assert from "node:assert/strict";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { IterationReport } from "../reports/iteration-report";
import {
	applyVerification,
	normalizeVerification,
} from "../improvement/verify";
import { RunLog } from "../util/run-log";
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));

test("normalizeVerification coerces the shorthand returns", () => {
	assert.deepEqual(normalizeVerification(undefined), {
		pass: true,
		failures: [],
	});
	assert.deepEqual(normalizeVerification(true), { pass: true, failures: [] });
	assert.deepEqual(normalizeVerification(false), { pass: false, failures: [] });
});

test("normalizeVerification defaults pass from the failures list", () => {
	const withFailures = normalizeVerification({
		failures: [{ scenario: "a" }],
	});
	assert.equal(withFailures.pass, false);
	assert.equal(withFailures.failures.length, 1);

	const explicit = normalizeVerification({ pass: true, details: "noted" });
	assert.equal(explicit.pass, true);
	assert.equal(explicit.details, "noted");

	// Garbage entries without a scenario name are dropped.
	const dirty = normalizeVerification({
		failures: [{ scenario: "ok" }, null as never, { agent: "x" } as never],
	});
	assert.deepEqual(
		dirty.failures.map((f) => f.scenario),
		["ok"],
	);
});

function passingReport(): IterationReport {
	return {
		runId: "r",
		iteration: 1,
		pass: true,
		scenarios: {
			s1: {
				scenario: "s1",
				pass: true,
				agents: { a1: { review: { pass: true } } },
			},
			s2: {
				scenario: "s2",
				pass: true,
				agents: { a1: { review: { pass: true } } },
			},
		},
	};
}

test("applyVerification with a passing verdict leaves the report alone", () => {
	const report = passingReport();
	const changed = applyVerification(
		report,
		{ pass: true, failures: [] },
		["s1", "s2"],
		new RunLog(),
	);
	assert.equal(changed, false);
	assert.equal(report.pass, true);
});

test("applyVerification marks a named scenario failed with details", () => {
	const report = passingReport();
	const changed = applyVerification(
		report,
		{ pass: false, failures: [{ scenario: "s1", details: "boom" }] },
		["s1", "s2"],
		new RunLog(),
	);
	assert.equal(changed, true);
	assert.equal(report.pass, false);
	const s1 = report.scenarios.s1 as { pass: boolean; error?: string };
	assert.equal(s1.pass, false);
	assert.match(s1.error ?? "", /boom/);
	// s2 is untouched.
	const s2 = report.scenarios.s2 as { pass: boolean; error?: string };
	assert.equal(s2.pass, true);
	assert.equal(s2.error, undefined);
});

test("applyVerification can target a specific (scenario, agent) pair", () => {
	const report = passingReport();
	applyVerification(
		report,
		{
			pass: false,
			failures: [{ scenario: "s1", agent: "a1", details: "pair broke" }],
		},
		["s1"],
		new RunLog(),
	);
	const s1 = report.scenarios.s1 as {
		pass: boolean;
		agents: Record<string, { error?: string } | undefined>;
		error?: string;
	};
	assert.equal(s1.pass, false);
	assert.match(s1.agents.a1?.error ?? "", /pair broke/);
	// Scenario-level error stays clean — only the pair was named.
	assert.equal(s1.error, undefined);
});

test("applyVerification with no named failures fails everything that ran", () => {
	const report = passingReport();
	const changed = applyVerification(
		report,
		{ pass: false, failures: [], details: "global gate down" },
		["s1", "s2"],
		new RunLog(),
	);
	assert.equal(changed, true);
	for (const name of ["s1", "s2"]) {
		const s = report.scenarios[name] as { pass: boolean; error?: string };
		assert.equal(s.pass, false);
		assert.match(s.error ?? "", /global gate down/);
	}
});

test("verifyIteration hook fails a judge-passing iteration and the loop recovers", async () => {
	const projectRoot = join(here, "fixtures", "verify-project");
	const baseDir = join(projectRoot, ".skillsmith");
	const skillPath = join(projectRoot, "skills", "foo", "SKILL.md");
	const pristineSkill = readFileSync(skillPath, "utf8");
	rmSync(baseDir, { recursive: true, force: true });

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	try {
		exitCode = await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
		// The mock improver edits the skill in place; restore it so the
		// committed fixture stays clean regardless of outcome.
		writeFileSync(skillPath, pristineSkill);
	}

	assert.equal(exitCode, 0, "the loop converges once verification passes");

	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	const runDir = join(baseDir, runIds[0] ?? "");

	const runSummary = JSON.parse(
		readFileSync(join(runDir, "run.json"), "utf8"),
	) as { pass?: boolean; iterations?: Array<{ pass?: boolean }> };
	assert.equal(runSummary.pass, true);
	assert.equal(runSummary.iterations?.length, 2, "the gate forced a 2nd pass");
	assert.equal(
		runSummary.iterations?.[0]?.pass,
		false,
		"iteration 1 failed on verification despite the judge passing",
	);
	assert.equal(runSummary.iterations?.[1]?.pass, true);

	// The verification details landed in iteration 1's report so the
	// improver could see them.
	const iter1Report = JSON.parse(
		readFileSync(join(runDir, "iteration-1", "report.json"), "utf8"),
	) as { scenarios: Record<string, { error?: string }> };
	assert.match(
		iter1Report.scenarios["verify-scenario"]?.error ?? "",
		/e2e suite failed/,
	);

	// The improver ran between iterations.
	assert.ok(
		existsSync(join(runDir, "iteration-1", "improvement.md")),
		"improver wrote its transcript",
	);

	rmSync(baseDir, { recursive: true, force: true });
});
