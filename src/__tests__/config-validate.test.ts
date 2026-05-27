import assert from "node:assert/strict";
import { test } from "node:test";
import type { SkillsmithConfigInput } from "../config/types";
import { collectConfigErrors } from "../config/validate";

const PATHS = {
	base: "./.skillsmith",
	skills: "./skills",
	scenarios: "./eval/scenarios",
	rubrics: "./eval/rubrics",
};

function build(
	overrides: Partial<SkillsmithConfigInput> = {},
): SkillsmithConfigInput {
	return {
		mode: "test-only",
		agents: {
			tester: { provider: "claude-code", model: "claude-haiku-4-5" },
			grader: { provider: "claude-code", model: "claude-opus-4-7" },
			improver: { provider: "claude-code", model: "claude-opus-4-7" },
		},
		roles: {
			test: { agents: ["tester"] },
			judge: "grader",
			improver: "improver",
		},
		paths: PATHS,
		...overrides,
	};
}

test("rejects an unknown top-level mode", () => {
	const errors = collectConfigErrors(
		build({ mode: "loop" as unknown as "test-only" }),
	);
	assert.match(errors.join("\n"), /mode must be one of "test-only"/);
});

test("rejects an empty agents map", () => {
	const errors = collectConfigErrors(build({ agents: {} }));
	assert.match(
		errors.join("\n"),
		/agents must contain at least one entry/,
	);
});

test("rejects an empty roles.test.agents", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: [] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(
		errors.join("\n"),
		/roles\.test\.agents must be a non-empty string array/,
	);
});

test("rejects an unknown agent referenced from roles.test", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["nope"] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(
		errors.join("\n"),
		/roles\.test\.agents references unknown agent "nope"/,
	);
});

test("rejects an unknown agent referenced by roles.judge string shorthand", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["tester"] },
				judge: "nope",
				improver: "improver",
			},
		}),
	);
	assert.match(
		errors.join("\n"),
		/roles\.judge references unknown agent "nope"/,
	);
});

test("rejects an unknown agent referenced by roles.improver object form", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["tester"] },
				judge: "grader",
				improver: { agent: "nope" },
			},
		}),
	);
	assert.match(
		errors.join("\n"),
		/roles\.improver references unknown agent "nope"/,
	);
});

test("rejects missing provider on an agent entry", () => {
	const errors = collectConfigErrors(
		build({
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				broken: { model: "m" } as any,
				grader: { provider: "claude-code", model: "m" },
				improver: { provider: "claude-code", model: "m" },
			},
			roles: {
				test: { agents: ["broken"] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(errors.join("\n"), /agents\.broken\.provider must be one of/);
});

test("rejects an unknown provider on an agent entry", () => {
	const errors = collectConfigErrors(
		build({
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				bogus: { provider: "bogus" as any, model: "m" },
				grader: { provider: "claude-code", model: "m" },
				improver: { provider: "claude-code", model: "m" },
			},
			roles: {
				test: { agents: ["bogus"] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(errors.join("\n"), /agents\.bogus\.provider must be one of/);
});

test("rejects missing model on an agent entry", () => {
	const errors = collectConfigErrors(
		build({
			agents: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				half: { provider: "claude-code" } as any,
				grader: { provider: "claude-code", model: "m" },
				improver: { provider: "claude-code", model: "m" },
			},
			roles: {
				test: { agents: ["half"] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(
		errors.join("\n"),
		/agents\.half\.model must be a non-empty string/,
	);
});

test("rejects duplicate ids within roles.test.agents", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["tester", "tester"] },
				judge: "grader",
				improver: "improver",
			},
		}),
	);
	assert.match(errors.join("\n"), /roles\.test\.agents: duplicate id "tester"/);
});

test("accepts a valid config with extra pass-through keys on an agent", () => {
	const errors = collectConfigErrors(
		build({
			agents: {
				tester: { provider: "claude-code", model: "claude-opus-4-7" },
				grader: {
					provider: "claude-code",
					model: "claude-opus-4-7",
					effort: "xhigh",
				},
				improver: { provider: "claude-code", model: "claude-opus-4-7" },
			},
		}),
	);
	assert.deepEqual(errors, []);
});

test("accepts roles with prompts (object form)", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["tester"], prompt: "be terse" },
				judge: { agent: "grader", prompt: "strict" },
				improver: { agent: "improver", prompt: "edit minimally" },
			},
		}),
	);
	assert.deepEqual(errors, []);
});

test("rejects a non-string role prompt", () => {
	const errors = collectConfigErrors(
		build({
			roles: {
				test: { agents: ["tester"] },
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				judge: { agent: "grader", prompt: 42 as any },
				improver: "improver",
			},
		}),
	);
	assert.match(errors.join("\n"), /roles\.judge\.prompt must be a string/);
});
