import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getProvider } from "../providers/registry";

const E2E_ENABLED = process.env.CODEX_E2E === "1";

/**
 * Live integration test against the real Codex CLI. Skipped by default to
 * keep `npm test` hermetic. Run with:
 *
 *   OPENAI_API_KEY=sk-... CODEX_E2E=1 npm test
 */
test("codex provider end-to-end (testing role)", {
	skip: !E2E_ENABLED,
}, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "codex-e2e-"));
	const provider = getProvider("codex");
	const result = await provider.invoke({
		agent: { id: "codex-e2e", provider: "codex", model: "gpt-5.5" },
		systemPrompt: "Write the file the user asks for and nothing else.",
		prompt: "Write hello world to hello.txt in the current directory.",
		cwd,
		role: "testing",
	});
	assert.equal(result.error, undefined);
	assert.ok(result.toolUseCount > 0, "expected at least one tool use");
	assert.ok(
		existsSync(join(cwd, "hello.txt")),
		"expected hello.txt to be written",
	);
});

test("codex provider end-to-end (judge role)", {
	skip: !E2E_ENABLED,
}, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "codex-e2e-judge-"));
	const provider = getProvider("codex");
	const result = await provider.invoke({
		agent: { id: "codex-e2e-judge", provider: "codex", model: "gpt-5.5" },
		systemPrompt:
			'Return a JSON object with a single top-level key `verdict` whose value is `"pass"`. Output only JSON.',
		prompt: "Grade this trivial submission.",
		cwd,
		role: "judge",
	});
	assert.equal(result.error, undefined);
	const trimmed = result.finalText.trim();
	const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
	const jsonText = fence?.[1] ?? trimmed;
	const parsed = JSON.parse(jsonText);
	assert.ok(
		parsed !== null && typeof parsed === "object",
		"judge output should parse as a JSON object",
	);
});
