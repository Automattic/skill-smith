import assert from "node:assert/strict";
import { test } from "node:test";
import { collectConfigErrors } from "../config/validate";
import type { SkillsmithConfig } from "../config/types";

const PATHS = {
	base: "./.skillsmith",
	skills: "./skills",
	scenarios: "./eval/scenarios",
	rubrics: "./eval/rubrics",
};

function build(agents: SkillsmithConfig["agents"]): SkillsmithConfig {
	return { agents, paths: PATHS };
}

test("rejects empty agent slots", () => {
	const errors = collectConfigErrors(build({ testing: [], judge: [] }));
	assert.match(
		errors.join("\n"),
		/agents\.testing must contain at least one entry/,
	);
	assert.match(
		errors.join("\n"),
		/agents\.judge must contain at least one entry/,
	);
});

test("rejects missing provider", () => {
	const errors = collectConfigErrors(
		build({
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
			testing: [{ id: "x", model: "m" } as any],
			judge: [{ id: "j", provider: "claude-code", model: "m" }],
		}),
	);
	assert.match(errors.join("\n"), /testing\[0\]\.provider must be one of/);
});

test("rejects unknown provider", () => {
	const errors = collectConfigErrors(
		build({
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
			testing: [{ id: "x", provider: "bogus" as any, model: "m" }],
			judge: [{ id: "j", provider: "claude-code", model: "m" }],
		}),
	);
	assert.match(errors.join("\n"), /testing\[0\]\.provider must be one of/);
});

test("rejects missing id and model", () => {
	const errors = collectConfigErrors(
		build({
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
			testing: [{ provider: "claude-code" } as any],
			judge: [{ id: "j", provider: "claude-code", model: "m" }],
		}),
	);
	const joined = errors.join("\n");
	assert.match(joined, /testing\[0\]\.id must be a non-empty string/);
	assert.match(joined, /testing\[0\]\.model must be a non-empty string/);
});

test("rejects duplicate ids within a slot", () => {
	const errors = collectConfigErrors(
		build({
			testing: [
				{ id: "a", provider: "claude-code", model: "m1" },
				{ id: "a", provider: "claude-code", model: "m2" },
			],
			judge: [{ id: "j", provider: "claude-code", model: "m" }],
		}),
	);
	assert.match(errors.join("\n"), /agents\.testing: duplicate id "a"/);
});

test("accepts valid config with extra pass-through keys", () => {
	const errors = collectConfigErrors(
		build({
			testing: [
				{ id: "opus", provider: "claude-code", model: "claude-opus-4-7" },
			],
			judge: [
				{
					id: "opus",
					provider: "claude-code",
					model: "claude-opus-4-7",
					effort: "xhigh",
				},
			],
		}),
	);
	assert.deepEqual(errors, []);
});
