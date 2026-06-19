import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { run } from "../runner";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "target-project");
const binPath = resolve(here, "..", "..", "bin", "skillsmith.mjs");
const scenariosRoot = join(projectRoot, "eval", "scenarios");

declare global {
	var __skillsmithTargetProjectHooks: string[] | undefined;
}

interface CapturedRun {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function runApi(scenarios?: string[]): Promise<CapturedRun> {
	cleanProject();
	globalThis.__skillsmithTargetProjectHooks = undefined;

	const originalLog = console.log;
	const originalError = console.error;
	const stdout: string[] = [];
	const stderr: string[] = [];
	console.log = (...args: unknown[]) => {
		stdout.push(args.join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderr.push(args.join(" "));
	};
	try {
		const exitCode = await run({ cwd: projectRoot, scenarios });
		return {
			exitCode,
			stdout: stdout.join("\n"),
			stderr: stderr.join("\n"),
		};
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

async function runCli(args: string[]): Promise<CapturedRun> {
	cleanProject();
	const hookLog = join(projectRoot, "hooks.log");

	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[binPath, ...args],
			{
				cwd: projectRoot,
				env: { ...process.env, SKILLSMITH_HOOK_LOG: hookLog },
			},
		);
		return { exitCode: 0, stdout, stderr };
	} catch (err) {
		const e = err as Error & {
			code?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			exitCode: typeof e.code === "number" ? e.code : 1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
		};
	}
}

function cleanProject(): void {
	rmSync(join(projectRoot, ".skillsmith"), { recursive: true, force: true });
	rmSync(join(projectRoot, "hooks.log"), { force: true });
}

function writeScenario(id: string, name: string): void {
	const scenarioDir = join(scenariosRoot, ...id.split("/"));
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "scenario.yaml"),
		`name: ${name}
description: ${name}
skills:
  - foo
prompt: ${name}
acceptance:
  - passes
rubrics:
  - r1
`,
	);
}

function removeScenario(id: string): void {
	rmSync(join(scenariosRoot, ...id.split("/")), { recursive: true, force: true });
}

function latestRunDir(): string {
	const baseDir = join(projectRoot, ".skillsmith");
	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(
		runIds.length,
		1,
		`expected one runId, got ${runIds.join(", ")}`,
	);
	return join(baseDir, runIds[0] ?? "");
}

function reportScenarioNames(): string[] {
	const report = JSON.parse(
		readFileSync(join(latestRunDir(), "report.json"), "utf8"),
	) as { scenarios: Record<string, unknown> };
	return Object.keys(report.scenarios).sort();
}

function hookEvents(): string[] {
	return globalThis.__skillsmithTargetProjectHooks ?? [];
}

function cliHookEvents(): string[] {
	const hookLog = join(projectRoot, "hooks.log");
	if (!existsSync(hookLog)) return [];
	return readFileSync(hookLog, "utf8").trim().split("\n").filter(Boolean);
}

test("API run without scenarios runs all scenarios", async () => {
	const result = await runApi();

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), [
		"config-fetch-scenario",
		"counter-scenario",
	]);
	assert.match(result.stdout, /counter-scenario\s+\S+\s+PASS/);
	assert.match(result.stdout, /config-fetch-scenario\s+\S+\s+PASS/);
});

test("API run with an empty scenario list runs all scenarios", async () => {
	const result = await runApi([]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), [
		"config-fetch-scenario",
		"counter-scenario",
	]);
});

test("API run with an empty scenario list uses deterministic scenario ID order", async () => {
	writeScenario("z-group/nested", "nested-scenario");
	try {
		const result = await runApi([]);

		assert.equal(result.exitCode, 0);
		assert.ok(
			hookEvents().includes(
				"afterAllScenarios:config-fetch,counter,z-group/nested",
			),
		);
	} finally {
		removeScenario("z-group/nested");
	}
});

test("API run targets one scenario directory ID", async () => {
	const result = await runApi(["counter"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
	assert.deepEqual(
		hookEvents().filter((event) => event.startsWith("beforeScenario:")),
		["beforeScenario:counter-scenario"],
	);
	assert.ok(hookEvents().includes("afterAllScenarios:counter"));
});

test("API run trims scenario IDs before exact matching", async () => {
	const result = await runApi([" counter "]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
	assert.deepEqual(
		hookEvents().filter((event) => event.startsWith("beforeScenario:")),
		["beforeScenario:counter-scenario"],
	);
});

test("API run normalizes harmless scenario ID spelling", async () => {
	const result = await runApi([" ./counter/ ", "counter"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
	assert.deepEqual(
		hookEvents().filter((event) => event === "beforeScenario:counter-scenario"),
		["beforeScenario:counter-scenario"],
	);
});

test("API run targets multiple scenario directory IDs", async () => {
	const result = await runApi(["counter", "config-fetch"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), [
		"config-fetch-scenario",
		"counter-scenario",
	]);
	assert.deepEqual(
		hookEvents().filter((event) => event.startsWith("beforeScenario:")),
		["beforeScenario:counter-scenario", "beforeScenario:config-fetch-scenario"],
	);
	assert.ok(hookEvents().includes("afterAllScenarios:counter,config-fetch"));
});

test("API run de-dupes duplicate scenario IDs", async () => {
	const result = await runApi(["counter", "counter"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
	assert.deepEqual(
		hookEvents().filter((event) => event === "beforeScenario:counter-scenario"),
		["beforeScenario:counter-scenario"],
	);
});

test("API run rejects empty scenario values before hooks", async () => {
	const result = await runApi(["counter", "   "]);

	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /Scenario IDs must not be empty\./);
	assert.deepEqual(hookEvents(), []);
	assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
});

test("API run rejects unknown scenario IDs before hooks and lists available IDs", async () => {
	const result = await runApi(["missing", "absent"]);

	assert.equal(result.exitCode, 1);
	assert.match(
		result.stderr,
		/Unknown scenarios: missing, absent\n\nAvailable scenarios:\n- config-fetch\n- counter|- counter\n- config-fetch/,
	);
	assert.deepEqual(hookEvents(), []);
	assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
});

test("API run rejects invalid filters before duplicate-name validation or side effects", async () => {
	writeScenario("duplicates/counter", "counter-scenario");
	try {
		const result = await runApi(["../counter"]);

		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /Invalid scenario filter: \.\.\/counter/);
		assert.doesNotMatch(result.stderr, /Duplicate scenario\.name/);
		assert.deepEqual(hookEvents(), []);
		assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
	} finally {
		removeScenario("duplicates/counter");
	}
});

test("API run rejects duplicate configured names before hooks and agents", async () => {
	writeScenario("duplicates/counter", "counter-scenario");
	try {
		const result = await runApi(["counter"]);

		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /Duplicate scenario\.name "counter-scenario"/);
		assert.deepEqual(hookEvents(), []);
		assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
	} finally {
		removeScenario("duplicates/counter");
	}
});

test("API run with a nested folder filter exposes normalized IDs to hooks", async () => {
	writeScenario("z-group/nested", "nested-scenario");
	try {
		const result = await runApi(["z-group"]);

		assert.equal(result.exitCode, 0);
		assert.deepEqual(reportScenarioNames(), ["nested-scenario"]);
		assert.ok(hookEvents().includes("afterAllScenarios:z-group/nested"));
		assert.ok(hookEvents().includes("afterAllScenarioIds:z-group/nested"));
		assert.ok(hookEvents().includes("afterAllScenarioKeys:dirName+id+scenario"));
	} finally {
		removeScenario("z-group/nested");
	}
});

test("CLI parser passes no args as all scenarios", async () => {
	const result = await runCli([]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), [
		"config-fetch-scenario",
		"counter-scenario",
	]);
});

test("CLI parser passes one positional scenario", async () => {
	const result = await runCli(["counter"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
});

test("CLI parser passes multiple positional scenarios", async () => {
	const result = await runCli(["counter", "config-fetch"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), [
		"config-fetch-scenario",
		"counter-scenario",
	]);
});

test("CLI parser preserves duplicate positional args for shared de-duping", async () => {
	const result = await runCli(["counter", "counter"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
	assert.deepEqual(
		cliHookEvents().filter(
			(event) => event === "beforeScenario:counter-scenario",
		),
		["beforeScenario:counter-scenario"],
	);
});

test("CLI parser uses shared harmless scenario ID normalization", async () => {
	const result = await runCli(["./counter/"]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(reportScenarioNames(), ["counter-scenario"]);
});

test("CLI parser returns user-facing errors for unknown positional scenarios", async () => {
	const result = await runCli(["missing"]);

	assert.equal(result.exitCode, 1);
	assert.match(
		result.stderr,
		/Unknown scenario: missing\n\nAvailable scenarios:\n(- config-fetch\n- counter|- counter\n- config-fetch)/,
	);
	assert.doesNotMatch(result.stderr, /Error:/);
	assert.deepEqual(cliHookEvents(), []);
	assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
});

test("CLI parser rejects unsupported option-like args before run", async () => {
	const result = await runCli(["--scenario", "counter"]);

	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /Unknown option '--scenario'/);
	assert.match(result.stderr, /Usage: skillsmith \[--verbose\]/);
	assert.match(result.stderr, /\[scenario-or-folder-filter \.\.\.\]/);
	assert.doesNotMatch(result.stderr, /\[scenario-dir \.\.\.\]/);
	assert.doesNotMatch(result.stderr, /Error:/);
	assert.deepEqual(cliHookEvents(), []);
	assert.equal(existsSync(join(projectRoot, ".skillsmith")), false);
});
