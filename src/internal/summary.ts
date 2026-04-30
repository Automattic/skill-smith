import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface PrintSummaryParams {
	runDirectory: string;
	runId: string;
}

type Cell =
	| { kind: "PASS" }
	| { kind: "FAIL"; firstFailure: string }
	| { kind: "SKIPPED"; reason: string };

interface Row {
	scenario: string;
	scenarioError?: string;
	cells: Record<string, Cell>;
}

/**
 * Render the console summary table from `${runDirectory}report.yaml`
 * and emit `RUN RESULT: PASS|FAIL` (V25, V26). Returns the process
 * exit code: 0 if every cell is PASS, 1 otherwise.
 */
export function printSummary(params: PrintSummaryParams): number {
	const { runDirectory } = params;
	const reportPath = join(runDirectory, "report.yaml");
	if (!existsSync(reportPath)) {
		console.log(`No run report at ${reportPath}.`);
		console.log("RUN RESULT: FAIL — missing run report");
		return 1;
	}

	const parsed = (parseYaml(readFileSync(reportPath, "utf8")) ?? {}) as Record<
		string,
		unknown
	>;
	const scenarios = parsed.scenarios as
		| Record<string, Record<string, unknown>>
		| undefined;

	const rows: Row[] = [];
	const agentIds = new Set<string>();

	for (const [name, body] of Object.entries(scenarios ?? {})) {
		const scenarioReport = body ?? {};
		const cells: Record<string, Cell> = {};
		const agents =
			(scenarioReport as { agents?: Record<string, unknown> }).agents ?? {};
		for (const [agentId, verdictRaw] of Object.entries(agents)) {
			agentIds.add(agentId);
			cells[agentId] = classify(verdictRaw);
		}
		rows.push({
			scenario: name,
			scenarioError: (scenarioReport as { error?: string }).error,
			cells,
		});
	}

	const sortedAgents = Array.from(agentIds).sort();
	printTable(rows, sortedAgents);

	const allPass =
		rows.length > 0 && rows.every((r) => isRowPass(r, sortedAgents));
	if (allPass) {
		console.log("RUN RESULT: PASS");
		return 0;
	}

	console.log("RUN RESULT: FAIL");
	for (const row of rows) {
		if (isRowPass(row, sortedAgents)) continue;
		console.log(`  ${row.scenario}: ${firstFailureReason(row, sortedAgents)}`);
	}
	return 1;
}

function printTable(rows: Row[], sortedAgents: string[]): void {
	const scenarioCol = Math.max(
		"scenario".length,
		...rows.map((r) => r.scenario.length),
	);
	const colWidths = sortedAgents.map((a) => a.length);

	const header = ["scenario".padEnd(scenarioCol)]
		.concat(sortedAgents.map((a, i) => a.padEnd(colWidths[i] ?? a.length)))
		.join(" | ");
	console.log(header);

	for (const row of rows) {
		const cells = sortedAgents.map((a, i) => {
			const text = fmtCell(row.cells[a]);
			return text.padEnd(Math.max(text.length, colWidths[i] ?? 0));
		});
		console.log([row.scenario.padEnd(scenarioCol), ...cells].join(" | "));
	}
}

function fmtCell(cell: Cell | undefined): string {
	if (cell === undefined) return "—";
	if (cell.kind === "PASS") return "PASS";
	if (cell.kind === "FAIL") return "FAIL";
	return `SKIPPED (${cell.reason})`;
}

function isRowPass(row: Row, sortedAgents: string[]): boolean {
	if (row.scenarioError !== undefined) return false;
	if (sortedAgents.length === 0) return false;
	for (const a of sortedAgents) {
		const cell = row.cells[a];
		if (cell === undefined || cell.kind !== "PASS") return false;
	}
	return true;
}

function firstFailureReason(row: Row, sortedAgents: string[]): string {
	for (const a of sortedAgents) {
		const cell = row.cells[a];
		if (cell === undefined) return `${a}: missing`;
		if (cell.kind === "PASS") continue;
		return cell.kind === "FAIL"
			? `${a}: ${cell.firstFailure}`
			: `${a}: SKIPPED ${cell.reason}`;
	}
	if (row.scenarioError !== undefined) return row.scenarioError;
	return "no agents reported";
}

function classify(verdictRaw: unknown): Cell {
	if (verdictRaw === null || typeof verdictRaw !== "object") {
		return { kind: "FAIL", firstFailure: "verdict missing" };
	}
	const v = verdictRaw as Record<string, unknown>;

	if (typeof v.skipped === "string") {
		return { kind: "SKIPPED", reason: v.skipped };
	}
	if (typeof v.error === "string") {
		return { kind: "FAIL", firstFailure: v.error };
	}

	const rubrics = v.rubrics as Record<string, { pass?: unknown }> | undefined;
	const acceptance = v.acceptance as
		| Array<{ pass?: unknown; item?: unknown }>
		| undefined;

	if (rubrics) {
		for (const [id, r] of Object.entries(rubrics)) {
			if (r?.pass !== true) {
				return { kind: "FAIL", firstFailure: `rubric ${id} not pass` };
			}
		}
	}
	if (acceptance) {
		for (const a of acceptance) {
			if (a?.pass !== true) {
				const item = typeof a?.item === "string" ? a.item : "(unknown)";
				return { kind: "FAIL", firstFailure: `acceptance ${item} not pass` };
			}
		}
	}

	if (!rubrics && !acceptance) {
		return {
			kind: "FAIL",
			firstFailure: "no rubrics or acceptance in verdict",
		};
	}

	return { kind: "PASS" };
}
