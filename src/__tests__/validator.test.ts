import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentDefinition, SkillsmithConfig } from "../config/types";
import { PROVIDERS } from "../providers/registry";
import type { InvokeResult, Provider } from "../providers/types";
import { RunLog } from "../util/run-log";
import { runValidator } from "../improvement/validator";

const agent: AgentDefinition = { id: "v", provider: "mock", model: "m" };

function makeConfig(): SkillsmithConfig {
	return {
		mode: "self-improvement",
		agents: { v: agent },
		roles: {
			test: { agents: [agent] },
			judge: { agent },
			improver: { agent },
		},
		paths: { base: ".", skills: "skills", scenarios: "scenarios", rubrics: "rubrics" },
	};
}

/** Swap the `mock` provider for one returning `result`, restore after `fn`. */
async function withProvider<T>(
	result: InvokeResult,
	fn: () => Promise<T>,
): Promise<T> {
	const original = PROVIDERS.mock;
	const stub: Provider = { id: "mock", async invoke() { return result; } };
	PROVIDERS.mock = stub;
	try {
		return await fn();
	} finally {
		PROVIDERS.mock = original;
	}
}

test("provider error fails open to approve with failedOpen and a transcript (AC7)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "validator-"));
	const outcome = await withProvider(
		{ finalText: "", toolUseCount: 0, error: "boom" },
		() =>
			runValidator({
				agent,
				skillsBlob: "# Skill\nsome text",
				corpus: [],
				config: makeConfig(),
				projectRoot: dir,
				iterationDirectory: dir,
				round: 2,
				log: new RunLog(),
			}),
	);

	assert.equal(outcome.verdict, "approve");
	assert.equal(outcome.failedOpen, true);
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.transcriptPath, join(dir, "validation-round-2.md"));

	const body = readFileSync(outcome.transcriptPath, "utf8");
	assert.match(body, /VALIDATOR round 2: approve \(FAILED-OPEN: provider error: boom\)/);
});
