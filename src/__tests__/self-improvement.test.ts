import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSelfImprovement } from "../config/self-improvement";
import type {
	SkillsmithConfig,
	SkillsmithConfigInput,
} from "../config/types";
import { collectConfigErrors } from "../config/validate";

const PATHS = {
	base: "./.skillsmith",
	skills: "./skills",
	scenarios: "./eval/scenarios",
	rubrics: "./eval/rubrics",
};

function baseInput(
	overrides: Partial<SkillsmithConfigInput> = {},
): SkillsmithConfigInput {
	return {
		mode: "test-only",
		agents: {
			t: { provider: "mock", model: "m" },
			j: { provider: "mock", model: "m" },
			i: { provider: "mock", model: "m" },
		},
		roles: {
			test: { agents: ["t"] },
			judge: "j",
			improver: "i",
		},
		paths: PATHS,
		...overrides,
	};
}

/**
 * Build a minimal normalized config for `resolveSelfImprovement` —
 * which only reads `mode` and `selfImprovement`. The richer normalized
 * fields are irrelevant to this unit.
 */
function baseConfig(
	overrides: Partial<SkillsmithConfig> = {},
): SkillsmithConfig {
	return {
		mode: "test-only",
		agents: {
			t: { id: "t", provider: "mock", model: "m" },
			j: { id: "j", provider: "mock", model: "m" },
			i: { id: "i", provider: "mock", model: "m" },
		},
		roles: {
			test: { agents: [{ id: "t", provider: "mock", model: "m" }] },
			judge: { agent: { id: "j", provider: "mock", model: "m" } },
			improver: { agent: { id: "i", provider: "mock", model: "m" } },
		},
		paths: PATHS,
		...overrides,
	};
}

test("resolveSelfImprovement returns harness defaults when nothing is set", () => {
	const resolved = resolveSelfImprovement(baseConfig());
	assert.equal(resolved.mode, "test-only");
	assert.equal(resolved.maxIterations, 3);
	assert.equal(resolved.scope, "failed-scenarios");
	assert.equal(resolved.finalPass, false);
});

test("config values override defaults", () => {
	const resolved = resolveSelfImprovement(
		baseConfig({
			mode: "self-improvement",
			selfImprovement: {
				maxIterations: 5,
				scope: "failed-pairs",
				finalPass: true,
			},
		}),
	);
	assert.equal(resolved.mode, "self-improvement");
	assert.equal(resolved.maxIterations, 5);
	assert.equal(resolved.scope, "failed-pairs");
	assert.equal(resolved.finalPass, true);
});

test("overrides win over config", () => {
	const resolved = resolveSelfImprovement(
		baseConfig({
			mode: "test-only",
			selfImprovement: {
				maxIterations: 2,
				scope: "all",
				finalPass: false,
			},
		}),
		{
			mode: "self-improvement",
			maxIterations: 7,
			scope: "failed-pairs",
			finalPass: true,
		},
	);
	assert.equal(resolved.mode, "self-improvement");
	assert.equal(resolved.maxIterations, 7);
	assert.equal(resolved.scope, "failed-pairs");
	assert.equal(resolved.finalPass, true);
});

test("maxIterations is clamped to at least 1", () => {
	const resolved = resolveSelfImprovement(baseConfig(), { maxIterations: 0 });
	assert.equal(resolved.maxIterations, 1);
});

test("validation accepts a fully-specified config with selfImprovement", () => {
	const errors = collectConfigErrors(
		baseInput({
			mode: "self-improvement",
			selfImprovement: {
				maxIterations: 3,
				scope: "failed-scenarios",
				finalPass: true,
			},
		}),
	);
	assert.deepEqual(errors, []);
});

test("validation flags non-integer maxIterations", () => {
	const errors = collectConfigErrors(
		baseInput({
			selfImprovement: {
				maxIterations: 0.5 as unknown as number,
			},
		}),
	);
	assert.ok(
		errors.some((e) => e.includes("maxIterations")),
		`expected a maxIterations error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags an invalid evaluation scope", () => {
	const errors = collectConfigErrors(
		baseInput({
			selfImprovement: {
				scope: "everything" as unknown as "all",
			},
		}),
	);
	assert.ok(
		errors.some((e) => e.includes("scope")),
		`expected a scope error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags a malformed improver agent entry", () => {
	const errors = collectConfigErrors(
		baseInput({
			agents: {
				t: { provider: "mock", model: "m" },
				j: { provider: "mock", model: "m" },
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				i: { provider: "mock", model: "" } as any,
			},
		}),
	);
	assert.ok(
		errors.some((e) => e.includes("agents.i.model")),
		`expected an agents.i.model error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags a non-string roles.improver.prompt", () => {
	const errors = collectConfigErrors(
		baseInput({
			roles: {
				test: { agents: ["t"] },
				judge: "j",
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				improver: { agent: "i", prompt: 42 as any },
			},
		}),
	);
	assert.ok(
		errors.some((e) => e.includes("roles.improver.prompt")),
		`expected an improver prompt error, got ${JSON.stringify(errors)}`,
	);
});
