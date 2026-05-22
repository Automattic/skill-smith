import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSelfImprovement } from "../config/self-improvement";
import type { SkillsmithConfig } from "../config/types";
import { collectConfigErrors } from "../config/validate";

const baseConfig: SkillsmithConfig = {
	agents: {
		testing: [{ id: "t", provider: "mock", model: "m" }],
		judge: [{ id: "j", provider: "mock", model: "m" }],
	},
	paths: {
		base: "./.skillsmith",
		skills: "./skills",
		scenarios: "./eval/scenarios",
		rubrics: "./eval/rubrics",
	},
};

test("resolveSelfImprovement returns harness defaults when nothing is set", () => {
	const resolved = resolveSelfImprovement(baseConfig);
	assert.equal(resolved.mode, "test-only");
	assert.equal(resolved.maxIterations, 3);
	assert.equal(resolved.evaluationMode, "failed-scenarios");
	assert.equal(resolved.finalPass, false);
	assert.deepEqual(resolved.paths, {});
});

test("config values override defaults", () => {
	const resolved = resolveSelfImprovement({
		...baseConfig,
		selfImprovement: {
			mode: "loop",
			maxIterations: 5,
			evaluationMode: "failed-pairs",
			finalPass: true,
		},
	});
	assert.equal(resolved.mode, "loop");
	assert.equal(resolved.maxIterations, 5);
	assert.equal(resolved.evaluationMode, "failed-pairs");
	assert.equal(resolved.finalPass, true);
});

test("overrides win over config", () => {
	const resolved = resolveSelfImprovement(
		{
			...baseConfig,
			selfImprovement: {
				mode: "test-only",
				maxIterations: 2,
				evaluationMode: "all",
				finalPass: false,
			},
		},
		{
			mode: "loop",
			maxIterations: 7,
			evaluationMode: "failed-pairs",
			finalPass: true,
		},
	);
	assert.equal(resolved.mode, "loop");
	assert.equal(resolved.maxIterations, 7);
	assert.equal(resolved.evaluationMode, "failed-pairs");
	assert.equal(resolved.finalPass, true);
});

test("maxIterations is clamped to at least 1", () => {
	const resolved = resolveSelfImprovement(baseConfig, { maxIterations: 0 });
	assert.equal(resolved.maxIterations, 1);
});

test("validation accepts a fully-specified selfImprovement block", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		agents: {
			...baseConfig.agents,
			improver: { id: "i", provider: "mock", model: "m" },
		},
		selfImprovement: {
			mode: "loop",
			maxIterations: 3,
			evaluationMode: "failed-scenarios",
			finalPass: true,
			paths: {
				improverPrompt: "./guides/improver.md",
			},
		},
	});
	assert.deepEqual(errors, []);
});

test("validation flags an invalid mode", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		selfImprovement: {
			mode: "nope" as unknown as "loop",
		},
	});
	assert.ok(
		errors.some((e) => e.includes("selfImprovement.mode")),
		`expected a mode error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags non-integer maxIterations", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		selfImprovement: {
			maxIterations: 0.5 as unknown as number,
		},
	});
	assert.ok(
		errors.some((e) => e.includes("maxIterations")),
		`expected a maxIterations error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags an invalid evaluation mode", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		selfImprovement: {
			evaluationMode: "everything" as unknown as "all",
		},
	});
	assert.ok(
		errors.some((e) => e.includes("evaluationMode")),
		`expected an evaluationMode error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags a malformed improver agent entry", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		agents: {
			...baseConfig.agents,
			improver: { id: "", provider: "mock", model: "m" },
		},
	});
	assert.ok(
		errors.some((e) => e.includes("agents.improver.id")),
		`expected an improver.id error, got ${JSON.stringify(errors)}`,
	);
});

test("validation flags a non-string improverPrompt", () => {
	const errors = collectConfigErrors({
		...baseConfig,
		selfImprovement: {
			paths: {
				improverPrompt: 42 as unknown as string,
			},
		},
	});
	assert.ok(
		errors.some((e) => e.includes("improverPrompt")),
		`expected an improverPrompt error, got ${JSON.stringify(errors)}`,
	);
});
