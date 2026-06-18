import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { InvokeParams, InvokeResult, Provider } from "./types";

/**
 * Sentinels that opt a fixture into the deterministic self-improvement
 * loop behaviour exercised by `self-improvement-loop.test.ts`. A skill
 * carrying `MOCK_GATE` is "fixed" once it also carries `MOCK_MARKER`;
 * the mock improver is what appends the marker between iterations.
 * Fixtures without `MOCK_GATE` keep the original always-pass behaviour
 * relied on by the smoke and agent-loop tests.
 */
const GATE = "MOCK_GATE";
const MARKER = "SKILLSMITH_LOOP_OK";

// Sentinel the validator-loop fixtures use to drive the revise→approve
// path: the gated improver appends this on round 0 (the leak the mock
// validator flags), then strips it on the revise round so validate#2
// approves. The literal doubles as the prompt sentinel both the mock
// validator and improver branch on.
const LEAK = "LEAK_TOKEN";

const PASS_JSON = JSON.stringify({
	rubrics: { r1: { pass: true, notes: "mock" } },
	acceptance: [{ item: "mock acceptance", pass: true, notes: "mock" }],
});

const FAIL_JSON = JSON.stringify({
	rubrics: { r1: { pass: false, notes: "skill is missing the marker" } },
	acceptance: [
		{ item: "skill carries the marker", pass: false, notes: "marker absent" },
	],
});

const MOCK_USAGE = {
	inputTokens: 100,
	cachedInputTokens: 0,
	outputTokens: 50,
	totalTokens: 150,
};

/**
 * Deterministic provider used by tests and dry runs. Drops a sentinel
 * file in the workspace for the testing role; returns a passing JSON
 * verdict for the judge role. Gated branches (see `GATE`) let a fixture
 * drive a full multi-iteration improvement loop with no real model.
 */
export const mockProvider: Provider = {
	id: "mock",
	async invoke(params: InvokeParams): Promise<InvokeResult> {
		if (params.role === "testing") {
			return invokeTesting(params);
		}
		return invokeJudge(params);
	},
};

function invokeTesting(params: InvokeParams): InvokeResult {
	// Improver agent: its cwd is the skills root. Edit the skills
	// directly by appending the success marker to every SKILL.md it
	// finds — no proposal, no reviewer, no executor.
	if (params.systemPrompt.includes("improver agent")) {
		// Validator-loop fixtures opt in via VALIDATOR_LOOP_FIXTURE. On round
		// 0 (no findings yet) add the marker AND the leak; on a revise round
		// the rendered finding names LEAK_TOKEN, so strip the leak and keep
		// the marker. The no-validator `loop-project` path lacks the opt-in
		// and keeps the unchanged `applyMarkerToSkills` behaviour (AC4).
		if (params.prompt.includes("VALIDATOR_LOOP_FIXTURE")) {
			const isReviseRound = params.prompt.includes("LEAK_TOKEN");
			const edited = isReviseRound
				? removeLeakTokenFromSkills(params.cwd)
				: applyMarkerAndLeakToSkills(params.cwd);
			return {
				finalText: `improver edited ${edited} skill(s)`,
				toolUseCount: edited,
			};
		}

		const edited = applyMarkerToSkills(params.cwd);
		return {
			finalText: `improver applied marker to ${edited} skill(s)`,
			toolUseCount: edited,
		};
	}

	// Sentinel id used by `agent-loop.test.ts` to exercise the
	// "testing failed → judge skipped" branch deterministically.
	if (params.agent.id === "mock-fail-testing") {
		return { finalText: "", toolUseCount: 0, error: "mock testing failure" };
	}

	// Gated testing agent: the skill text is inlined into the system
	// prompt, so surface whether it already carries the marker. The
	// judge keys off the file we write here.
	if (params.systemPrompt.includes(GATE)) {
		const ok = params.systemPrompt.includes(MARKER);
		const verdict = ok ? "GATE_PASS" : "GATE_FAIL";
		writeFileSync(join(params.cwd, "result.txt"), `${verdict}\n`);
		return { finalText: verdict, toolUseCount: 1, usage: MOCK_USAGE };
	}

	writeFileSync(
		join(params.cwd, "mock-output.txt"),
		`mock testing output for ${params.agent.id}\n`,
	);
	return {
		finalText: `mock testing output for ${params.agent.id}`,
		toolUseCount: 0,
		usage: MOCK_USAGE,
	};
}

function invokeJudge(params: InvokeParams): InvokeResult {
	// Validator agent: runs role:"judge", so it lands here. Branch before
	// the generic judge PASS/FAIL fallthrough. It inspects the post-edit
	// skill via the user prompt's skillsBlob, so we key off `params.prompt`.
	if (params.systemPrompt.includes("validator agent")) {
		return invokeValidator(params);
	}

	// Gated judge: the testing agent's workspace files are inlined into
	// the user prompt. Fail until the skill edit propagates a pass.
	if (params.prompt.includes("GATE_FAIL")) {
		return { finalText: FAIL_JSON, toolUseCount: 0 };
	}
	if (params.prompt.includes("GATE_PASS")) {
		return { finalText: PASS_JSON, toolUseCount: 0 };
	}

	return { finalText: PASS_JSON, toolUseCount: 0 };
}

// Deterministic validator: returns an R9-shaped verdict off sentinels in
// the post-edit skill (surfaced via the user prompt's skillsBlob). A leak
// (or the AC5 cap control) yields `revise` with a finding naming the leak;
// otherwise `approve` with no findings.
function invokeValidator(params: InvokeParams): InvokeResult {
	const neverApprove = params.prompt.includes("NEVER_APPROVE");
	const leaked = params.prompt.includes("LEAK_TOKEN");
	if (neverApprove || leaked) {
		return {
			finalText: JSON.stringify({
				verdict: "revise",
				findings: [
					{
						leak_type: "scenario-value",
						span: "LEAK_TOKEN",
						why: "scenario-unique token copied into the skill",
						suggested_fix: "use a generic example value",
					},
				],
			}),
			toolUseCount: 0,
		};
	}
	return {
		finalText: JSON.stringify({ verdict: "approve", findings: [] }),
		toolUseCount: 0,
	};
}

// Append the success marker to every immediate <dir>/SKILL.md under
// skillsDir that doesn't already carry it. Returns the count edited.
function applyMarkerToSkills(skillsDir: string): number {
	let edited = 0;
	let entries: Dirent[];
	try {
		entries = readdirSync(skillsDir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillPath = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(skillPath)) continue;
		const body = readFileSync(skillPath, "utf8");
		if (body.includes(MARKER)) continue;
		writeFileSync(skillPath, `${body}\n${MARKER}\n`);
		edited++;
	}
	return edited;
}

// Round 0 of the validator loop: append BOTH the success marker (so the
// gated judge flips GATE_FAIL→GATE_PASS) AND the leak token (which the
// mock validator flags) to every immediate <dir>/SKILL.md under skillsDir
// that doesn't already carry the marker. Returns the count edited.
function applyMarkerAndLeakToSkills(skillsDir: string): number {
	let edited = 0;
	let entries: Dirent[];
	try {
		entries = readdirSync(skillsDir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillPath = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(skillPath)) continue;
		const body = readFileSync(skillPath, "utf8");
		if (body.includes(MARKER)) continue;
		writeFileSync(skillPath, `${body}\n${MARKER}\n${LEAK}\n`);
		edited++;
	}
	return edited;
}

// Revise round of the validator loop: strip the leak token from every
// immediate <dir>/SKILL.md under skillsDir that carries it, leaving the
// marker intact so the scenario still passes. The post-edit skill becomes
// leak-free, so validate#2 approves. Returns the count edited.
function removeLeakTokenFromSkills(skillsDir: string): number {
	let edited = 0;
	let entries: Dirent[];
	try {
		entries = readdirSync(skillsDir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillPath = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(skillPath)) continue;
		const body = readFileSync(skillPath, "utf8");
		if (!body.includes(LEAK)) continue;
		const stripped = body
			.split("\n")
			.filter((line) => line !== LEAK)
			.join("\n");
		writeFileSync(skillPath, stripped);
		edited++;
	}
	return edited;
}
