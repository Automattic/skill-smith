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
	cells: Map<string, Cell>;
}

/**
 * Render the console summary table from `${runDirectory}report.yaml`
 * and emit `RUN RESULT: PASS|FAIL` (V25, V26). Returns the process
 * exit code: 0 if every cell is PASS, 1 otherwise.
 */
export async function printSummary(
	params: PrintSummaryParams,
): Promise<number> {
	const { runDirectory } = params;
	const reportPath = join(runDirectory, "report.yaml");
	if (!existsSync(reportPath)) {
		console.error(`No run report at ${reportPath}.`);
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
		const cells = new Map<string, Cell>();

		const scenarioErr = (scenarioReport as { error?: string }).error;
		const agents =
			(scenarioReport as { agents?: Record<string, unknown> }).agents ?? {};

		if (scenarioErr !== undefined) {
			cells.set("__scenario__", { kind: "SKIPPED", reason: scenarioErr });
		}

		for (const [agentId, verdictRaw] of Object.entries(agents)) {
			agentIds.add(agentId);
			cells.set(agentId, classify(verdictRaw));
		}

		rows.push({ scenario: name, cells });
	}

	const sortedAgents = Array.from(agentIds).sort();
	const scenarioCol = Math.max(
		"scenario".length,
		...rows.map((r) => r.scenario.length),
	);
	const colWidths = sortedAgents.map((a) => a.length);

	const fmtCell = (cell: Cell | undefined): string => {
		if (cell === undefined) return "—";
		if (cell.kind === "PASS") return "PASS";
		if (cell.kind === "FAIL") return "FAIL";
		return `SKIPPED (${cell.reason})`;
	};

	const headerCells = sortedAgents.map((a, i) =>
		a.padEnd(colWidths[i] ?? a.length),
	);
	const headerLine = ["scenario".padEnd(scenarioCol), ...headerCells].join(
		" | ",
	);
	console.log(headerLine);

	for (const row of rows) {
		const cells = sortedAgents.map((a, i) => {
			const cell = row.cells.get(a);
			const text = fmtCell(cell);
			return text.padEnd(Math.max(text.length, colWidths[i] ?? 0));
		});
		console.log([row.scenario.padEnd(scenarioCol), ...cells].join(" | "));
	}

	let allPass = rows.length > 0;
	const firstFailures: string[] = [];
	for (const row of rows) {
		if (row.cells.size === 0) {
			allPass = false;
			firstFailures.push(`${row.scenario}: no agents reported`);
			continue;
		}
		let scenarioPass = true;
		let firstReason: string | undefined;
		for (const a of sortedAgents) {
			const cell = row.cells.get(a);
			if (cell === undefined) {
				scenarioPass = false;
				firstReason ??= `${a}: missing`;
				continue;
			}
			if (cell.kind === "PASS") continue;
			scenarioPass = false;
			if (firstReason === undefined) {
				firstReason =
					cell.kind === "FAIL"
						? `${a}: ${cell.firstFailure}`
						: `${a}: SKIPPED ${cell.reason}`;
			}
		}
		const scenarioMeta = row.cells.get("__scenario__");
		if (scenarioMeta?.kind === "SKIPPED") {
			scenarioPass = false;
			firstReason ??= scenarioMeta.reason;
		}
		if (!scenarioPass) {
			allPass = false;
			firstFailures.push(`${row.scenario}: ${firstReason ?? "fail"}`);
		}
	}

	if (allPass) {
		console.log("RUN RESULT: PASS");
		return 0;
	}
	console.log("RUN RESULT: FAIL");
	for (const f of firstFailures) console.log(`  ${f}`);
	return 1;
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
