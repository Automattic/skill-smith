export type NodeStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped";

export type PhaseName = "testing" | "judge";

export interface PhaseNode {
	name: PhaseName;
	status: NodeStatus;
	durationMs?: number;
	detail?: string;
}

export interface AgentNode {
	id: string;
	phases: [PhaseNode, PhaseNode];
}

export interface ScenarioNode {
	name: string;
	status: NodeStatus;
	agents: AgentNode[];
	error?: string;
}

export interface RunTree {
	runId: string;
	startedAt: number;
	scenarios: ScenarioNode[];
}
