import assert from "node:assert/strict";
import { test } from "node:test";
import type { SkillsmithConfigInput } from "../config/types";
import { decideRunnability } from "../policy/runnability";
import { agentRunnable, runnableTestAgentIds } from "../index";

/**
 * Minimal raw config: `agents` keyed by id, `roles.test.agents` as string
 * ids. The judge/improver roles are filled with whichever id the test
 * cares about so the shape type-checks; tests that don't touch them ignore
 * them.
 */
function makeConfig(
	agents: SkillsmithConfigInput["agents"],
	testAgentIds: string[],
): SkillsmithConfigInput {
	const firstId = Object.keys(agents)[0] ?? "claude";
	return {
		mode: "test-only",
		agents,
		roles: {
			test: { agents: testAgentIds },
			judge: firstId,
			improver: firstId,
		},
	};
}

test("openai-api agent is not runnable without OPENAI_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "openai-api", model: "gpt-5" } },
		["writer"],
	);
	assert.equal(agentRunnable(config, "writer", {}), false);
});

test("openai-api agent is runnable with OPENAI_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "openai-api", model: "gpt-5" } },
		["writer"],
	);
	assert.equal(
		agentRunnable(config, "writer", { OPENAI_API_KEY: "x" }),
		true,
	);
});

test("anthropic-api agent is not runnable without ANTHROPIC_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "anthropic-api", model: "claude" } },
		["writer"],
	);
	assert.equal(agentRunnable(config, "writer", {}), false);
});

test("anthropic-api agent is runnable with ANTHROPIC_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "anthropic-api", model: "claude" } },
		["writer"],
	);
	assert.equal(
		agentRunnable(config, "writer", { ANTHROPIC_API_KEY: "x" }),
		true,
	);
});

test("gemini-api agent is not runnable without GOOGLE_GENERATIVE_AI_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "gemini-api", model: "gemini" } },
		["writer"],
	);
	assert.equal(agentRunnable(config, "writer", {}), false);
});

test("gemini-api agent is runnable with GOOGLE_GENERATIVE_AI_API_KEY", () => {
	const config = makeConfig(
		{ writer: { provider: "gemini-api", model: "gemini" } },
		["writer"],
	);
	assert.equal(
		agentRunnable(config, "writer", {
			GOOGLE_GENERATIVE_AI_API_KEY: "x",
		}),
		true,
	);
});

test("claude-code agent is runnable regardless of env", () => {
	const config = makeConfig(
		{ writer: { provider: "claude-code", model: "sonnet" } },
		["writer"],
	);
	assert.equal(agentRunnable(config, "writer", {}), true);
	assert.equal(
		agentRunnable(config, "writer", { OPENAI_API_KEY: "x" }),
		true,
	);
});

test("mock agent is runnable regardless of env", () => {
	const config = makeConfig(
		{ writer: { provider: "mock", model: "mock" } },
		["writer"],
	);
	assert.equal(agentRunnable(config, "writer", {}), true);
	assert.equal(
		agentRunnable(config, "writer", { ANTHROPIC_API_KEY: "x" }),
		true,
	);
});

test("agentRunnable reads process.env when no env is passed", () => {
	const config = makeConfig(
		{ writer: { provider: "openai-api", model: "gpt-5" } },
		["writer"],
	);
	const prior = process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_API_KEY;
	try {
		assert.equal(agentRunnable(config, "writer"), false);
		process.env.OPENAI_API_KEY = "x";
		assert.equal(agentRunnable(config, "writer"), true);
	} finally {
		if (prior === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = prior;
		}
	}
});

test("runnableTestAgentIds drops misconfigured ids and preserves order", () => {
	const config = makeConfig(
		{
			alpha: { provider: "claude-code", model: "sonnet" },
			beta: { provider: "openai-api", model: "gpt-5" },
			gamma: { provider: "mock", model: "mock" },
			delta: { provider: "gemini-api", model: "gemini" },
		},
		["alpha", "beta", "gamma", "delta"],
	);
	// No credential env vars: only the credential-free providers survive,
	// in their original order.
	assert.deepEqual(runnableTestAgentIds(config, {}), ["alpha", "gamma"]);
	// With the OpenAI credential present, beta is restored between alpha
	// and gamma — order is preserved, not appended.
	assert.deepEqual(
		runnableTestAgentIds(config, { OPENAI_API_KEY: "x" }),
		["alpha", "beta", "gamma"],
	);
});

test("decideRunnability is reachable from the policy seam", () => {
	// Smoke-check the seam used by the rest of the harness; it consumes the
	// normalized config, so a single credential-free test agent suffices to
	// exercise the run/excluded split without invoking any model.
	const agent = {
		id: "alpha",
		provider: "mock" as const,
		model: "mock",
	};
	const normalized = {
		mode: "test-only" as const,
		agents: { alpha: agent },
		roles: {
			test: { agents: [agent] },
			judge: { agent },
			improver: { agent },
		},
		paths: { base: ".", skills: ".", scenarios: ".", rubrics: "." },
	};
	const plan = decideRunnability(normalized, {});
	assert.deepEqual(plan.testAgents.run, [agent]);
	assert.deepEqual(plan.testAgents.excluded, []);
	assert.equal(plan.judge.stop, false);
	assert.equal(plan.improver.degrade, false);
});
