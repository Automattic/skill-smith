import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "loop-project");
const skillPath = join(projectRoot, "skills", "wp-foo", "SKILL.md");
const MARKER = "SKILLSMITH_LOOP_OK";

const PRISTINE_SKILL = `# wp-foo skill

MOCK_GATE

This skill is graded by the mock provider in the self-improvement loop
fixture. It starts without the success marker, so the first iteration
fails. The mock executor appends the marker between iterations, after
which grading passes.
`;

test("loop mode fails iteration 1, applies the executor edit, and passes iteration 2", async () => {
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });
	// Reset the skill to its marker-free state so iteration 1 fails even
	// if a previous run left the marker behind.
	writeFileSync(skillPath, PRISTINE_SKILL);

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	let skillAfterRun: string;
	try {
		exitCode = await run({ cwd: projectRoot });
		skillAfterRun = readFileSync(skillPath, "utf8");
	} finally {
		console.log = originalLog;
		// Leave the working tree clean regardless of outcome.
		writeFileSync(skillPath, PRISTINE_SKILL);
	}

	assert.equal(exitCode, 0, "loop should converge to all-pass and exit 0");
	assert.ok(
		skillAfterRun.includes(MARKER),
		"executor appended the success marker to the skill during the run",
	);

	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	const runDir = join(baseDir, runIds[0] ?? "");

	const runSummary = parseYaml(readFileSync(join(runDir, "run.yaml"), "utf8")) as {
		pass?: boolean;
		iterations?: Array<{ number?: number; pass?: boolean }>;
	};
	assert.equal(runSummary.pass, true, "run.yaml records an overall pass");
	assert.equal(runSummary.iterations?.length, 2, "the loop ran two iterations");
	assert.equal(
		runSummary.iterations?.[0]?.pass,
		false,
		"iteration 1 failed before the skill was edited",
	);
	assert.equal(
		runSummary.iterations?.[1]?.pass,
		true,
		"iteration 2 passed after the executor applied the marker",
	);

	// The improvement cycle ran between the two iterations: proposer,
	// reviewer, and executor each left an artifact.
	const iter1 = join(runDir, "iteration-1");
	assert.ok(existsSync(join(iter1, "proposal.md")), "proposer wrote proposal.md");
	assert.ok(
		existsSync(join(iter1, "proposal.reviewed.md")),
		"reviewer wrote proposal.reviewed.md",
	);
	assert.ok(existsSync(join(iter1, "skills.diff")), "executor captured skills.diff");

	// The merged matrix is all-pass.
	const mergedReport = parseYaml(
		readFileSync(join(runDir, "report.yaml"), "utf8"),
	) as { pass?: boolean };
	assert.equal(mergedReport.pass, true, "merged report.yaml is all-pass");

	// The working tree was restored to its marker-free state.
	assert.equal(
		readFileSync(skillPath, "utf8"),
		PRISTINE_SKILL,
		"finally-block restored the pristine skill",
	);

	rmSync(baseDir, { recursive: true, force: true });
});
