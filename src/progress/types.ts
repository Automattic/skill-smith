export type PhaseName = 'testing' | 'judge';

export type TerminalStatus = 'passed' | 'failed' | 'skipped';

/**
 * One row in the failures list rendered below the progress bars.
 * `phase` is undefined when the failure is a scenario-level skip
 * recorded as a precondition error rather than a phase outcome.
 */
export interface Failure {
	scenario: string;
	agentId: string;
	phase: PhaseName | undefined;
	detail: string;
}

/**
 * Two-dimensional aggregate over the run. `scenarios` counts
 * scenario-level outcomes; `phases` counts every (scenario, agent,
 * phase) cell. Both totals are fixed at construction; the others
 * shift as events arrive.
 */
export interface RunCounters {
	scenarios: {
		total: number;
		passed: number;
		failed: number;
		skipped: number;
		running: number;
		pending: number;
	};
	phases: {
		total: number;
		passed: number;
		failed: number;
		skipped: number;
		running: number;
		pending: number;
	};
}

export interface RunSnapshot {
	runId: string;
	startedAt: number;
	now: number;
	/**
	 * Present in self-improvement loop runs. `current` is the iteration
	 * being shown; `total` is the iteration cap. Single-iteration runs
	 * (test-only mode) leave this undefined so the line is omitted.
	 */
	iteration?: { current: number; total: number };
	counters: RunCounters;
	failures: Failure[];
	finished: boolean;
}
