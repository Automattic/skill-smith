import { renderTree } from "./render";
import type {
	AgentNode,
	NodeStatus,
	PhaseName,
	PhaseNode,
	RunTree,
	ScenarioNode,
} from "./types";

export interface TrackerInit {
	runId: string;
	scenarios: { name: string; agentIds: string[] }[];
}

export interface TrackerOptions {
	stream?: NodeJS.WritableStream;
	color?: boolean;
}

export interface PhaseResult {
	status: Extract<NodeStatus, "passed" | "failed" | "skipped">;
	durationMs?: number;
	detail?: string;
}

/**
 * Owns a `RunTree` and writes a snapshot of it to `stream` (default
 * stderr) whenever a state-change method is called. Repaints are
 * coalesced via `setImmediate` so a burst of synchronous events
 * produces a single snapshot.
 */
export class ProgressTracker {
	private readonly stream: NodeJS.WritableStream;
	private readonly color: boolean;
	private readonly tree: RunTree;
	private pending: NodeJS.Immediate | null = null;

	constructor(init: TrackerInit, opts: TrackerOptions = {}) {
		this.stream = opts.stream ?? process.stderr;
		this.color = opts.color ?? defaultColor(this.stream);
		this.tree = {
			runId: init.runId,
			startedAt: Date.now(),
			scenarios: init.scenarios.map((s) => ({
				name: s.name,
				status: "pending",
				agents: s.agentIds.map((id) => ({
					id,
					phases: [
						{ name: "testing", status: "pending" },
						{ name: "judge", status: "pending" },
					],
				})),
			})),
		};
	}

	scenarioSkipped(name: string, reason: string): void {
		const s = this.scenario(name);
		s.status = "skipped";
		s.error = reason;
		this.scheduleRepaint();
	}

	phaseStarted(scenarioName: string, agentId: string, phase: PhaseName): void {
		const s = this.scenario(scenarioName);
		const p = this.phase(this.agent(s, agentId), phase);
		p.status = "running";
		if (s.status === "pending") s.status = "running";
		this.scheduleRepaint();
	}

	phaseFinished(
		scenarioName: string,
		agentId: string,
		phase: PhaseName,
		result: PhaseResult,
	): void {
		const s = this.scenario(scenarioName);
		const p = this.phase(this.agent(s, agentId), phase);
		p.status = result.status;
		if (result.durationMs !== undefined) p.durationMs = result.durationMs;
		if (result.detail !== undefined) p.detail = result.detail;
		recomputeScenarioStatus(s);
		this.scheduleRepaint();
	}

	finish(): void {
		if (this.pending) {
			clearImmediate(this.pending);
			this.pending = null;
		}
		this.flush();
	}

	private scheduleRepaint(): void {
		if (this.pending) return;
		this.pending = setImmediate(() => {
			this.pending = null;
			this.flush();
		});
	}

	private flush(): void {
		this.stream.write(`\n${renderTree(this.tree, { color: this.color })}\n`);
	}

	private scenario(name: string): ScenarioNode {
		const s = this.tree.scenarios.find((x) => x.name === name);
		if (!s) throw new Error(`progress: unknown scenario "${name}"`);
		return s;
	}

	private agent(s: ScenarioNode, agentId: string): AgentNode {
		const a = s.agents.find((x) => x.id === agentId);
		if (!a) {
			throw new Error(
				`progress: unknown agent "${agentId}" in scenario "${s.name}"`,
			);
		}
		return a;
	}

	private phase(a: AgentNode, phase: PhaseName): PhaseNode {
		return phase === "testing" ? a.phases[0] : a.phases[1];
	}
}

function defaultColor(stream: NodeJS.WritableStream): boolean {
	const isTty =
		"isTTY" in stream && (stream as { isTTY?: boolean }).isTTY === true;
	const noColor = process.env.NO_COLOR !== undefined;
	return isTty && !noColor;
}

function recomputeScenarioStatus(s: ScenarioNode): void {
	if (s.status === "skipped") return;
	const phases = s.agents.flatMap((a) => a.phases);
	if (phases.some((p) => p.status === "failed")) {
		s.status = "failed";
		return;
	}
	if (phases.length > 0 && phases.every((p) => p.status === "passed")) {
		s.status = "passed";
		return;
	}
	if (phases.length > 0 && phases.every((p) => p.status === "skipped")) {
		s.status = "skipped";
		return;
	}
	if (phases.some((p) => p.status !== "pending")) {
		s.status = "running";
		return;
	}
	s.status = "pending";
}
