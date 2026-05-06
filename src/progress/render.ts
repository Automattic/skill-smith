import type { AgentNode, NodeStatus, RunTree } from "./types";

export interface RenderOptions {
	color?: boolean;
}

const GLYPH: Record<NodeStatus, string> = {
	pending: "◯",
	running: "◐",
	passed: "✓",
	failed: "✗",
	skipped: "⊘",
};

const COLOR: Record<NodeStatus, AnsiColor | undefined> = {
	pending: undefined,
	running: "cyan",
	passed: "green",
	failed: "red",
	skipped: "yellow",
};

/**
 * Render a `RunTree` snapshot as a multi-line string. Pure — no I/O,
 * no time, no environment lookups. The caller decides whether to
 * enable color (`opts.color`).
 */
export function renderTree(tree: RunTree, opts: RenderOptions = {}): string {
	const color = opts.color ?? false;
	const lines: string[] = [];

	lines.push(`skillsmith run ${tree.runId}`);
	lines.push(`└─ scenarios (${tree.scenarios.length})`);

	const lastScenarioIdx = tree.scenarios.length - 1;
	for (let i = 0; i < tree.scenarios.length; i++) {
		const scenario = tree.scenarios[i];
		if (!scenario) continue;
		const isLast = i === lastScenarioIdx;
		const branch = isLast ? "└─" : "├─";
		const childPrefix = isLast ? "   " : "│  ";

		const glyph = paint(GLYPH[scenario.status], COLOR[scenario.status], color);
		let scenarioLine = `   ${branch} ${glyph} ${scenario.name}`;
		if (scenario.error) {
			scenarioLine += `  ·  ${dim(scenario.error, color)}`;
		}
		lines.push(scenarioLine);

		if (scenario.status === "skipped") continue;

		const idWidth = Math.max(0, ...scenario.agents.map((a) => a.id.length));
		const lastAgentIdx = scenario.agents.length - 1;
		for (let j = 0; j < scenario.agents.length; j++) {
			const agent = scenario.agents[j];
			if (!agent) continue;
			const isLastAgent = j === lastAgentIdx;
			const agentBranch = isLastAgent ? "└─" : "├─";
			const agentStatus = deriveAgentStatus(agent);
			const agentGlyph = paint(GLYPH[agentStatus], COLOR[agentStatus], color);
			const id = agent.id.padEnd(idWidth);

			let agentLine = `   ${childPrefix}${agentBranch} ${agentGlyph} ${id}`;
			for (const phase of agent.phases) {
				const pg = paint(GLYPH[phase.status], COLOR[phase.status], color);
				agentLine += `  ${phase.name} ${pg}`;
				if (phase.durationMs !== undefined) {
					agentLine += ` ${formatDuration(phase.durationMs)}`;
				}
				if (phase.status === "failed" && phase.detail) {
					agentLine += ` ${dim(`(${truncate(phase.detail, 60)})`, color)}`;
				}
			}
			lines.push(agentLine);
		}
	}

	return lines.join("\n");
}

function deriveAgentStatus(agent: AgentNode): NodeStatus {
	const [a, b] = agent.phases;
	const s = [a.status, b.status];
	if (s.includes("failed")) return "failed";
	if (s.every((x) => x === "skipped")) return "skipped";
	if (s.every((x) => x === "passed")) return "passed";
	if (s.every((x) => x === "pending")) return "pending";
	return "running";
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

type AnsiColor = "red" | "green" | "yellow" | "cyan" | "gray";

const ANSI_CODES: Record<AnsiColor, string> = {
	red: "31",
	green: "32",
	yellow: "33",
	cyan: "36",
	gray: "90",
};

function paint(
	text: string,
	color: AnsiColor | undefined,
	enabled: boolean,
): string {
	if (!enabled || !color) return text;
	return `\x1b[${ANSI_CODES[color]}m${text}\x1b[0m`;
}

function dim(text: string, enabled: boolean): string {
	if (!enabled) return text;
	return `\x1b[2m${text}\x1b[0m`;
}
