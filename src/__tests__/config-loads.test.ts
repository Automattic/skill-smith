import assert from "node:assert/strict";
import { test } from "node:test";

// The testing-project config imports `@automattic/skillsmith` at module load.
// A regression where that entry point re-exported a value through a circular
// import made `defineConfig` resolve to `undefined`, so loading the config
// threw a TypeError before any agent ran. This is a fast, dependency-free
// guard: importing the config must resolve, and its default export must keep
// the expected shape. It runs alongside `config-smoke` as a second signal.
//
// The default export is the UNNORMALIZED `SkillsmithConfigInput`: `defineConfig`
// is an identity passthrough, so `roles.test.agents` is still a `string[]` of
// ids, not the normalized `AgentDefinition[]`. This is a pure import-and-shape
// check — it reads only the default export and never invokes `runE2eVerification`
// or any hook, so it needs no wp-env, Playwright, network, or credentials.
test("testing-project config imports without throwing and keeps its input shape", async () => {
	// Omit the `.ts` extension to match the project's import convention; tsx
	// resolves the `.ts` source. A rejected import fails the test, which is the
	// no-throw assertion.
	const configModule = await import(
		"../../testing-project/skillsmith.config"
	);
	const config = configModule.default;

	assert.deepEqual(config.roles.test.agents, ["haiku", "gpt"]);
	assert.deepEqual(Object.keys(config.agents), ["haiku", "opus", "gpt"]);
	assert.equal(config.mode, "test-only");
	assert.equal(typeof config.hooks?.afterAllScenarios, "function");
});
