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
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));

const MARKER = "SKILLSMITH_LOOP_OK";
const LEAK = "LEAK_TOKEN";
const CAP_WARNING = "WARNING: validation cap reached without approval";

// Convergence fixture (AC3 / AC6): the gated improver adds MARKER + LEAK on
// round 0, the validator flags the leak, the improver strips it, and the next
// validation approves — the inner loop converges with exactly one revise round.
const convergeRoot = join(here, "fixtures", "validator-loop-project");
const convergeSkill = join(convergeRoot, "skills", "wp-foo", "SKILL.md");
const CONVERGE_PRISTINE = readFileSync(convergeSkill, "utf8");

// Cap fixture (AC5): the NEVER_APPROVE sentinel makes the validator return
// `revise` on every round, so the inner loop runs to its cap and warns.
const capRoot = join(here, "fixtures", "validator-loop-cap-project");
const capSkill = join(capRoot, "skills", "wp-foo", "SKILL.md");
const CAP_PRISTINE = readFileSync(capSkill, "utf8");

// The single runId a self-improvement run writes under `<base>/`.
function readRunDir(baseDir: string): string {
	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	return join(baseDir, runIds[0] ?? "");
}

// Count `validation-round-K.md` transcripts in an iteration directory.
function validationRounds(iterationDir: string): string[] {
	return readdirSync(iterationDir)
		.filter((n) => /^validation-round-\d+\.md$/.test(n))
		.sort();
}

test("AC3/AC6: the inner loop converges — validator flags the leak, the improver strips it, validate#2 approves", async () => {
	const baseDir = join(convergeRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });
	// Reset the skill to its marker-free, leak-free state so the run starts
	// from a known point even if a previous run left edits behind.
	writeFileSync(convergeSkill, CONVERGE_PRISTINE);

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	let skillAfterRun: string;
	try {
		exitCode = await run({ cwd: convergeRoot });
		skillAfterRun = readFileSync(convergeSkill, "utf8");
	} finally {
		console.log = originalLog;
		// Leave the working tree clean regardless of outcome.
		writeFileSync(convergeSkill, CONVERGE_PRISTINE);
	}

	assert.equal(exitCode, 0, "the loop converged to all-pass and exited 0");

	const runDir = readRunDir(baseDir);
	const iter1 = join(runDir, "iteration-1");

	// Exactly two validator transcripts: round-0 revise + round-1 approve.
	const rounds = validationRounds(iter1);
	assert.equal(
		rounds.length,
		2,
		`exactly two validation-round-*.md; got ${rounds.join(", ")}`,
	);
	assert.ok(
		existsSync(join(iter1, "validation-round-1.md")),
		"the validator ran past round 0 (a revise round happened)",
	);

	// Exactly one revise round: round-0 = revise, round-1 = approve.
	const round0 = readFileSync(join(iter1, "validation-round-0.md"), "utf8");
	const round1 = readFileSync(join(iter1, "validation-round-1.md"), "utf8");
	assert.match(
		round0,
		/^VALIDATOR round 0: revise/m,
		"round 0 flagged the leak (revise)",
	);
	assert.match(
		round1,
		/^VALIDATOR round 1: approve/m,
		"round 1 accepted the leak-free skill (approve)",
	);

	// The improver stripped the leak: the final on-disk skill is leak-free
	// but kept the success marker (so the scenario passes the next sweep).
	assert.ok(
		!skillAfterRun.includes(LEAK),
		"the improver removed the leak token on the revise round",
	);
	assert.ok(
		skillAfterRun.includes(MARKER),
		"the success marker survived the revise round",
	);

	// The working tree was restored to its pristine state.
	assert.equal(
		readFileSync(convergeSkill, "utf8"),
		CONVERGE_PRISTINE,
		"finally-block restored the pristine skill",
	);

	rmSync(baseDir, { recursive: true, force: true });
});

test("AC5: a never-approving validator runs the inner loop to its cap, warns, and keeps the last edit", async () => {
	const baseDir = join(capRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });
	writeFileSync(capSkill, CAP_PRISTINE);

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	let skillAfterRun: string;
	try {
		exitCode = await run({ cwd: capRoot });
		skillAfterRun = readFileSync(capSkill, "utf8");
	} finally {
		console.log = originalLog;
		writeFileSync(capSkill, CAP_PRISTINE);
	}

	// The run completes and returns a number — the cap breaks the loop, no
	// hang. The exit value is the scenario matrix's, not the validator's
	// (the validator is advisory, §9.2), so we do not assert a specific code.
	assert.equal(typeof exitCode, "number", "the run returned an exit code");

	const runDir = readRunDir(baseDir);
	const iter1 = join(runDir, "iteration-1");

	// maxValidationRounds = 2 → exactly N+1 = 3 transcripts: each edit, plus
	// the terminal review of the last un-revised edit that feeds the warning.
	const rounds = validationRounds(iter1);
	assert.equal(
		rounds.length,
		3,
		`exactly three validation-round-*.md; got ${rounds.join(", ")}`,
	);

	// The warning literal is dumped to run.log (RunLog dumps regardless of
	// mirrorStderr, §9.1), so it is readable even with console suppressed.
	const runLog = readFileSync(join(iter1, "run.log"), "utf8");
	assert.ok(
		runLog.includes(CAP_WARNING),
		"run.log carries the validation-cap warning literal",
	);

	// The last improver edit is KEPT, not reverted: the skill still carries
	// the success marker the improver applied (the advisory-gate contract, D2).
	assert.ok(
		skillAfterRun.includes(MARKER),
		"the last improver edit (the marker) was kept, not reverted",
	);

	assert.equal(
		readFileSync(capSkill, "utf8"),
		CAP_PRISTINE,
		"finally-block restored the pristine skill",
	);

	rmSync(baseDir, { recursive: true, force: true });
});
