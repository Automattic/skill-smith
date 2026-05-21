import { execFileSync, execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunScenario, VerificationFailure } from "skillsmith";
import { defineConfig } from "skillsmith";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const BLOCK_NAME = "skillsmith/testing-block";
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const WP_ENV_PORT = Number(process.env.WP_ENV_PORT ?? 8987);

function pluginSlug(scenarioName: string, agentId: string): string {
	if (!SLUG_PATTERN.test(scenarioName)) {
		throw new Error(
			`scenario name must match ${SLUG_PATTERN}, got: ${JSON.stringify(scenarioName)}`,
		);
	}
	if (!SLUG_PATTERN.test(agentId)) {
		throw new Error(
			`agent id must match ${SLUG_PATTERN}, got: ${JSON.stringify(agentId)}`,
		);
	}
	return `plugin-${scenarioName}-${agentId}`;
}

function pluginIndexPhp(pluginSlug: string): string {
	return `<?php
/**
 * Plugin Name: ${pluginSlug}
 * Description: Auto-scaffolded by skillsmith. Plugin slug is preserved across the run — do not rename.
 * Version:     0.1.0
 * License:     GPL-3.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'init',
	static function () {
		// Prefer the wp-scripts build output (which ships view.asset.php
		// declaring script-module dependencies like @wordpress/interactivity-router);
		// fall back to raw src/ for plugins that don't need a build.
		$blocks_dir = __DIR__ . '/build/blocks';
		if ( ! is_dir( $blocks_dir ) ) {
			$blocks_dir = __DIR__ . '/src/blocks';
		}
		if ( ! is_dir( $blocks_dir ) ) {
			return;
		}
		foreach ( (array) glob( $blocks_dir . '/*', GLOB_ONLYDIR ) as $block_path ) {
			if ( file_exists( $block_path . '/block.json' ) ) {
				register_block_type( $block_path );
			}
		}
	}
);
`;
}

function agentsMd(slug: string): string {
	return `# Workspace instructions

A WordPress plugin scaffold lives at \`${slug}/\`. Implement the requested work inside this scaffold — do not create a new plugin or rename the existing one.
A block named \`${BLOCK_NAME}\` lives at \`${slug}/src/blocks/testing-block/\` and is registered in \`${slug}/index.php\`. Implement the block as needed for the task, but do not change the block name or registration mechanism.
The root element rendered by \`render.php\` must apply \`<?php echo get_block_wrapper_attributes(); ?>\` so WordPress emits the standard block class (\`wp-block-skillsmith-testing-block\`) and any block-supports attributes on the wrapper. Adding your own \`class="..."\` attribute alongside the helper is fine; replacing the helper with a hand-written class is not.
`;
}

function blockJson(): string {
	return `${JSON.stringify(
		{
			$schema: "https://schemas.wp.org/trunk/block.json",
			apiVersion: 3,
			name: BLOCK_NAME,
			title: "Testing Block",
			category: "widgets",
			// Add this manually until we improve WordPress skills.
			render: "file:./render.php",
		},
		null,
		2,
	)}\n`;
}

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
function runE2eVerification(
	iterationDirectory: string,
	scenarios: RunScenario[],
): VerificationFailure[] {
	const dirToName = new Map(
		scenarios.map((s) => [s.dirName, s.scenario.name]),
	);

	// Each iteration writes a fresh set of workspaces under
	// `iteration-N/<scenario>/<agent>/workspace`. Collect every plugin
	// to load and remember which scenario directories actually ran.
	const pluginPaths: string[] = [];
	const ranDirNames = new Set<string>();
	for (const scenarioEntry of readdirSync(iterationDirectory, {
		withFileTypes: true,
	})) {
		if (!scenarioEntry.isDirectory()) continue;
		const scenarioDir = join(iterationDirectory, scenarioEntry.name);
		for (const agentEntry of readdirSync(scenarioDir, { withFileTypes: true })) {
			if (!agentEntry.isDirectory()) continue;
			const workspaceDir = join(scenarioDir, agentEntry.name, "workspace");
			if (!existsSync(workspaceDir)) continue;
			for (const pluginEntry of readdirSync(workspaceDir, {
				withFileTypes: true,
			})) {
				if (!pluginEntry.isDirectory()) continue;
				if (!pluginEntry.name.startsWith("plugin-")) continue;
				pluginPaths.push(join(workspaceDir, pluginEntry.name));
				ranDirNames.add(scenarioEntry.name);
			}
		}
	}

	if (pluginPaths.length === 0) return [];

	const e2eSpecs = [...ranDirNames]
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

/** Extract the scenario directory name from a spec file path. */
function scenarioDirOf(file: string): string | undefined {
	const match = file.split(/[\\/]/);
	const idx = match.indexOf("scenarios");
	if (idx >= 0 && idx + 1 < match.length) return match[idx + 1];
	return undefined;
}

export default defineConfig({
	agents: {
		testing: [
			{
				id: "haiku",
				provider: "claude-code",
				model: "claude-haiku-4-5-20251001",
			},
			{
				id: "opus",
				provider: "claude-code",
				model: "claude-opus-4-6",
			},
			// {
			// 	id: "anthropic-sonnet",
			// 	provider: "anthropic-api",
			// 	model: "claude-sonnet-4-6",
			// },
			// {
			// 	id: "openai-api-nano",
			// 	provider: "openai-api",
			// 	model: "gpt-5.4-nano",
			// },
			{ id: "codex-mini", provider: "codex", model: "gpt-5.4-mini" },
			{
				id: "codex-gpt55",
				provider: "codex",
				model: "gpt-5.5",
			},
			// {
			// 	id: "gemini-flash",
			// 	provider: "gemini-api",
			// 	model: "gemini-2.5-flash",
			// },
		],
		judge: [
			{
				id: "codex",
				provider: "codex",
				model: "gpt-5.5",
				effort: "xhigh",
			},
		],
		// Single agent that edits the failing skills between iterations in
		// loop mode. It edits SKILL.md files in place — no proposal,
		// reviewer, or git.
		improver: {
			id: "improver",
			provider: "claude-code",
			model: "claude-opus-4-6",
		},
	},

	// Self-improvement is opt-in. With `agents.improver` set, a run with
	// `--mode loop` will, after each failing iteration, let the improver
	// edit the relevant SKILL.md files and re-run the failing scenarios.
	// `--mode test-only` (the default) ignores it entirely. Point
	// `paths.improverPrompt` at a file to replace the built-in improver
	// instructions with a project-specific strategy.
	selfImprovement: {
		mode: "test-only",
		maxIterations: 3,
		evaluationMode: "failed-scenarios",
		// paths: { improverPrompt: "./eval/improvement/improver.md" },
	},

	hooks: {
		// Plugin slug stays unique per (scenario, agent) so afterAll can
		// activate them independently; the block name is fixed because the
		// e2e specs reference it directly.
		beforeTestAgent: ({ scenario, agent, agentWorkspace }) => {
			const slug = pluginSlug(scenario.name, agent.id);
			const pluginDir = join(agentWorkspace, slug);
			const blockDir = join(pluginDir, "src", "blocks", "testing-block");

			mkdirSync(blockDir, { recursive: true });
			writeFileSync(join(pluginDir, "index.php"), pluginIndexPhp(slug));
			writeFileSync(
				join(pluginDir, "package.json"),
				`${JSON.stringify({ name: slug, version: "0.1.0", private: true }, null, 2)}\n`,
			);
			writeFileSync(join(blockDir, "block.json"), blockJson());
			writeFileSync(join(agentWorkspace, "AGENTS.md"), agentsMd(slug));
		},

		// Run the e2e suite against the artifacts this iteration produced,
		// after the judges have graded them but before the improver runs.
		// A spec failure marks that exact (scenario, agent) pair failed —
		// even if the judge passed it — so the improver learns the code
		// looked right but broke in a real runtime, and the loop iterates.
		verifyIteration: ({ scenarios, iterationDirectory }) => {
			const failures = runE2eVerification(iterationDirectory, scenarios);
			return failures.length > 0 ? { failures } : true;
		},
	},
});
