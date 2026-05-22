import { execFileSync, execSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunScenario, VerificationFailure } from "skillsmith";

// This file lives at `<projectRoot>/eval/utils/verify-e2e.ts`, so the
// project root — where `node_modules`, `.wp-env.json`, and the npm
// scripts live — is two directories up (matching `wp-cli.mjs`).
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WP_ENV_PORT = Number(process.env.WP_ENV_PORT ?? 8987);

/**
 * Build every plugin produced in `iterationDirectory`, boot wp-env, run
 * the e2e specs for the scenarios that ran this iteration, then tear it
 * all down. Returns a `VerificationFailure` for every (scenario, agent)
 * whose spec failed. Throws if the run could not produce a report at
 * all — the harness treats that as a coarse iteration failure.
 *
 * Playwright projects are named after the testing-agent ids (see
 * playwright.config.ts), so a failing spec's `projectName` maps back to
 * the agent, and its file path maps back to the scenario directory.
 */
export function runE2eVerification(
	iterationDirectory: string,
	scenarios: RunScenario[],
): VerificationFailure[] {
	// The iteration subdirectories are named after `scenario.name`, while
	// the spec files live under `eval/scenarios/<dirName>/`. Playwright's
	// JSON report carries the dirName (from the spec path), so we need
	// both directions: name→dir to locate specs, dir→name to attribute
	// failures back to the report's scenario keys.
	const nameToDir = new Map(scenarios.map((s) => [s.scenario.name, s.dirName]));
	const dirToName = new Map(scenarios.map((s) => [s.dirName, s.scenario.name]));

	// Each iteration writes a fresh set of workspaces under
	// `iteration-N/<scenario.name>/<agent>/workspace`. Collect every
	// plugin to load and remember which scenarios actually ran.
	const pluginPaths: string[] = [];
	const ranScenarioNames = new Set<string>();
	for (const scenarioEntry of readdirSync(iterationDirectory, {
		withFileTypes: true,
	})) {
		if (!scenarioEntry.isDirectory()) continue;
		const scenarioDir = join(iterationDirectory, scenarioEntry.name);
		for (const agentEntry of readdirSync(scenarioDir, {
			withFileTypes: true,
		})) {
			if (!agentEntry.isDirectory()) continue;
			const workspaceDir = join(scenarioDir, agentEntry.name, "workspace");
			if (!existsSync(workspaceDir)) continue;
			for (const pluginEntry of readdirSync(workspaceDir, {
				withFileTypes: true,
			})) {
				if (!pluginEntry.isDirectory()) continue;
				if (!pluginEntry.name.startsWith("plugin-")) continue;
				pluginPaths.push(join(workspaceDir, pluginEntry.name));
				ranScenarioNames.add(scenarioEntry.name);
			}
		}
	}

	if (pluginPaths.length === 0) return [];

	const e2eSpecs = [...ranScenarioNames]
		.map((name) => nameToDir.get(name))
		.filter((dirName): dirName is string => dirName !== undefined)
		.map((dirName) => join("eval", "scenarios", dirName, "e2e.spec.mjs"))
		.filter((spec) => existsSync(join(PROJECT_ROOT, spec)));
	if (e2eSpecs.length === 0) return [];

	// Build each plugin with wp-scripts so view.asset.php is emitted next
	// to view.js, declaring script-module dependencies.
	const wpScriptsBin = join(PROJECT_ROOT, "node_modules", ".bin", "wp-scripts");
	for (const pluginPath of pluginPaths) {
		if (!existsSync(join(pluginPath, "src", "blocks"))) continue;
		try {
			execFileSync(wpScriptsBin, ["build"], {
				stdio: "inherit",
				cwd: pluginPath,
				env: { ...process.env, WP_EXPERIMENTAL_MODULES: "1" },
			});
		} catch (err) {
			console.error(`wp-scripts build failed for ${pluginPath}:`, err);
		}
	}

	// `.wp-env.json` is gitignored and owned by this hook: it lives only
	// for the duration of the run and is removed afterwards.
	const wpEnvConfigPath = join(PROJECT_ROOT, ".wp-env.json");
	const reportPath = join(iterationDirectory, "tests-report.json");
	writeFileSync(
		wpEnvConfigPath,
		`${JSON.stringify(
			{
				plugins: pluginPaths,
				port: WP_ENV_PORT,
				testsEnvironment: false,
				// wp-env activates every listed plugin on start; `afterStart`
				// fires after that, so deactivating everything here gives each
				// spec a clean slate to activate exactly the plugin it exercises.
				lifecycleScripts: {
					afterStart: "npx wp-env run cli wp plugin deactivate --all",
				},
			},
			null,
			2,
		)}\n`,
	);

	const wpEnv = {
		...process.env,
		WP_ENV_PORT: String(WP_ENV_PORT),
		WP_BASE_URL: `http://localhost:${WP_ENV_PORT}`,
	};
	try {
		execSync("npm run env:start", {
			stdio: "inherit",
			cwd: PROJECT_ROOT,
			env: wpEnv,
		});
		try {
			execFileSync("npm", ["run", "test:e2e", "--", ...e2eSpecs], {
				stdio: "inherit",
				cwd: PROJECT_ROOT,
				env: { ...wpEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
			});
		} catch {
			// Playwright exits non-zero when specs fail. That is exactly the
			// signal we are after — swallow it and read the JSON report.
		}
	} finally {
		try {
			execSync("npm run env:stop", {
				stdio: "inherit",
				cwd: PROJECT_ROOT,
				env: wpEnv,
			});
		} catch (err) {
			console.error("wp-env stop failed:", err);
		}
		rmSync(wpEnvConfigPath, { force: true });
	}

	if (!existsSync(reportPath)) {
		throw new Error(`e2e run produced no report at ${reportPath}`);
	}
	return parsePlaywrightReport(reportPath, dirToName);
}

interface PwTest {
	projectName?: string;
	status?: string;
}
interface PwSpec {
	title?: string;
	file?: string;
	tests?: PwTest[];
}
interface PwSuite {
	file?: string;
	specs?: PwSpec[];
	suites?: PwSuite[];
}

/**
 * Walk a Playwright JSON report and turn every failing spec into a
 * `VerificationFailure`. `status: "unexpected"` is Playwright's term
 * for a test that failed without being marked as expected-to-fail.
 */
function parsePlaywrightReport(
	reportPath: string,
	dirToName: Map<string, string>,
): VerificationFailure[] {
	let parsed: { suites?: PwSuite[] };
	try {
		parsed = JSON.parse(readFileSync(reportPath, "utf8"));
	} catch (err) {
		throw new Error(
			`could not parse Playwright report: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const failures: VerificationFailure[] = [];
	const seen = new Set<string>();
	const visit = (suite: PwSuite): void => {
		for (const spec of suite.specs ?? []) {
			const dirName = scenarioDirOf(spec.file ?? suite.file ?? "");
			const scenario = dirName ? dirToName.get(dirName) : undefined;
			if (scenario === undefined) continue;
			for (const t of spec.tests ?? []) {
				if (t.status !== "unexpected") continue;
				const agent = t.projectName;
				const key = `${scenario}::${agent ?? ""}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const failure: VerificationFailure = {
					scenario,
					details: `e2e failed: ${spec.title ?? "spec"}`,
				};
				if (agent !== undefined) failure.agent = agent;
				failures.push(failure);
			}
		}
		for (const child of suite.suites ?? []) visit(child);
	};
	for (const suite of parsed.suites ?? []) visit(suite);
	return failures;
}

/**
 * Extract the scenario directory name from a spec file path. Specs live
 * at `<scenarioDir>/e2e.spec.mjs`, so the scenario directory is the
 * spec's immediate parent. Playwright reports file paths relative to its
 * testDir (`eval/scenarios`), e.g. `counter/e2e.spec.mjs` — there is no
 * `scenarios` segment to anchor on, so we take the parent segment
 * directly. This also handles absolute paths that do include `scenarios`.
 */
function scenarioDirOf(file: string): string | undefined {
	const segments = file.split(/[\\/]/).filter((s) => s.length > 0);
	if (segments.length >= 2) return segments[segments.length - 2];
	return undefined;
}
