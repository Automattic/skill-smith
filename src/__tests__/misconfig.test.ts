import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
	classifyRuntimeError,
	describeReason,
	isMisconfiguredSkipReason,
	MISCONFIG_SKIP_PREFIX,
	preflightMisconfig,
} from "../config/misconfig";
import type { AgentDefinition } from "../config/types";

function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
	return {
		id: "a",
		provider: "claude-code",
		model: "m",
		...overrides,
	} as AgentDefinition;
}

// The three credential providers and the env var each pre-flights on.
const ENV_VAR_PROVIDERS = [
	["anthropic-api", "ANTHROPIC_API_KEY"],
	["openai-api", "OPENAI_API_KEY"],
	["gemini-api", "GOOGLE_GENERATIVE_AI_API_KEY"],
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = {};
	for (const [, envVar] of ENV_VAR_PROVIDERS) {
		savedEnv[envVar] = process.env[envVar];
	}
});

afterEach(() => {
	for (const [, envVar] of ENV_VAR_PROVIDERS) {
		if (savedEnv[envVar] === undefined) {
			delete process.env[envVar];
		} else {
			process.env[envVar] = savedEnv[envVar];
		}
	}
});

test("preflightMisconfig flags missing-credential when env var is unset", () => {
	for (const [provider, envVar] of ENV_VAR_PROVIDERS) {
		delete process.env[envVar];
		assert.deepEqual(preflightMisconfig(agent({ provider })), {
			kind: "missing-credential",
			envVar,
		});
	}
});

test("preflightMisconfig flags missing-credential when env var is empty", () => {
	for (const [provider, envVar] of ENV_VAR_PROVIDERS) {
		process.env[envVar] = "";
		assert.deepEqual(preflightMisconfig(agent({ provider })), {
			kind: "missing-credential",
			envVar,
		});
	}
});

test("preflightMisconfig returns undefined when env var is set", () => {
	for (const [provider, envVar] of ENV_VAR_PROVIDERS) {
		process.env[envVar] = "sk-present";
		assert.equal(preflightMisconfig(agent({ provider })), undefined);
	}
});

test("preflightMisconfig flags unknown-provider for an id not in PROVIDER_IDS", () => {
	assert.deepEqual(
		preflightMisconfig(agent({ provider: "claud-code" as never })),
		{ kind: "unknown-provider", provider: "claud-code" },
	);
});

test("preflightMisconfig returns undefined for providers with no pre-flight signal", () => {
	for (const provider of ["claude-code", "codex", "mock"] as const) {
		assert.equal(preflightMisconfig(agent({ provider })), undefined);
	}
});

test("classifyRuntimeError flags missing-credential for the providers' literals", () => {
	for (const [, envVar] of ENV_VAR_PROVIDERS) {
		assert.deepEqual(classifyRuntimeError(`${envVar} is not set`), {
			kind: "missing-credential",
			envVar,
		});
	}
});

test("classifyRuntimeError flags invalid-credential for 401 and 403", () => {
	assert.deepEqual(classifyRuntimeError("[HTTP 401] Unauthorized"), {
		kind: "invalid-credential",
		status: 401,
	});
	assert.deepEqual(classifyRuntimeError("[HTTP 403] Forbidden"), {
		kind: "invalid-credential",
		status: 403,
	});
});

test("classifyRuntimeError flags model-not-found for 404", () => {
	assert.deepEqual(classifyRuntimeError("[HTTP 404] model does not exist"), {
		kind: "model-not-found",
		status: 404,
	});
});

test("classifyRuntimeError accepts an Error instance, not just a string", () => {
	assert.deepEqual(classifyRuntimeError(new Error("[HTTP 401] nope")), {
		kind: "invalid-credential",
		status: 401,
	});
});

test("classifyRuntimeError returns undefined for transient and unknown errors", () => {
	const transient = [
		"[HTTP 429] rate limited",
		"[HTTP 500] internal server error",
		"[HTTP 503] service unavailable",
		"network timeout after 60s",
		"context length exceeded: 200000 tokens",
		"content filter triggered",
		"MAX_STEPS reached",
		"some error mentioning 401 deep in the text",
		"connection reset",
	];
	for (const message of transient) {
		assert.equal(classifyRuntimeError(message), undefined, message);
	}
});

test("describeReason renders each reason kind", () => {
	assert.equal(
		describeReason({ kind: "missing-credential", envVar: "ANTHROPIC_API_KEY" }),
		"ANTHROPIC_API_KEY is not set",
	);
	assert.equal(
		describeReason({ kind: "unknown-provider", provider: "claud-code" }),
		'unknown-provider "claud-code"',
	);
	assert.equal(
		describeReason({ kind: "invalid-credential", status: 401 }),
		"invalid-credential (HTTP 401)",
	);
	assert.equal(
		describeReason({ kind: "model-not-found", status: 404 }),
		"model-not-found (HTTP 404)",
	);
});

test("isMisconfiguredSkipReason is true only for the misconfigured marker prefix", () => {
	assert.equal(
		isMisconfiguredSkipReason(
			`${MISCONFIG_SKIP_PREFIX}invalid-credential (HTTP 401)`,
		),
		true,
	);
	assert.equal(isMisconfiguredSkipReason("testing failed: boom"), false);
	assert.equal(isMisconfiguredSkipReason("judge dispatch failed: boom"), false);
	assert.equal(isMisconfiguredSkipReason(""), false);
});
