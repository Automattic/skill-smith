import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { getProvider } from "../providers/registry";

const E2E_ENABLED = process.env.GEMINI_E2E === "1";

/**
 * Live integration test against the real Gemini API. Skipped by default to
 * keep `npm test` hermetic. Run with:
 *
 *   GEMINI_API_KEY=... GEMINI_E2E=1 npm test
 *
 * (or `GOOGLE_API_KEY` instead of `GEMINI_API_KEY`).
 */
test(
	"gemini provider end-to-end (testing role)",
	{ skip: !E2E_ENABLED, timeout: 120000 },
	async () => {
		const cwd = mkdtempSync(join(tmpdir(), "gemini-e2e-"));
		const provider = getProvider("gemini");
		const result = await provider.invoke({
			agent: {
				id: "gemini-e2e",
				provider: "gemini",
				model: "gemini-2.5-flash",
			},
			systemPrompt:
				"Write the file the user asks for and nothing else. Use the Write tool.",
			prompt: "Write the text 'hello world' to hello.txt in the current directory.",
			cwd,
			role: "testing",
		});
		assert.equal(result.error, undefined);
		assert.ok(result.toolUseCount > 0, "expected at least one tool use");
		assert.ok(
			existsSync(join(cwd, "hello.txt")),
			"expected hello.txt to be written",
		);
	},
);

test(
	"gemini provider end-to-end (judge role)",
	{ skip: !E2E_ENABLED, timeout: 120000 },
	async () => {
		const cwd = mkdtempSync(join(tmpdir(), "gemini-e2e-judge-"));
		const provider = getProvider("gemini");
		const result = await provider.invoke({
			agent: {
				id: "gemini-e2e-judge",
				provider: "gemini",
				model: "gemini-2.5-flash",
			},
			systemPrompt:
				"Return a YAML document with a single top-level key `verdict` whose value is `pass`. Output only YAML.",
			prompt: "Grade this trivial submission.",
			cwd,
			role: "judge",
		});
		assert.equal(result.error, undefined);
		const trimmed = result.finalText.trim();
		const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
		const yamlText = fence?.[1] ?? trimmed;
		const parsed = parseYaml(yamlText);
		assert.ok(
			parsed !== null && typeof parsed === "object",
			"judge output should parse as a YAML object",
		);
	},
);
