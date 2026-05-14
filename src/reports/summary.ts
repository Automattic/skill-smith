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

/** Testing-agent metrics pulled from the `testing` block of an agent report. */
interface Metrics {
	duration?: number;
	totalTokens?: number;
}

interface Row {
	scenario: string;
	scenarioError?: string;
	cells: Record<string, Cell>;
	metrics: Record<string, Metrics>;
}

/** One rendered line of the long-format table. */
interface DisplayRow {
	scenario: string;
	agent: string;
	result: string;
	duration: string;
	tokens: string;
}

/**
 * Render the console summary table from `${runDirectory}/report.yaml`
 * and emit `RUN RESULT: PASS|FAIL`. Returns the process exit code: 0
 * if every cell is PASS, 1 otherwise.
 *
 * The table is long-format: one line per (scenario, agent), carrying
 * the agent's verdict plus the testing agent's wall-clock duration and
 * total token usage. The scenario name is shown only on the first of
 * its rows.
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
		const metrics: Record<string, Metrics> = {};
		const agents =
			(scenarioReport as { agents?: Record<string, unknown> }).agents ?? {};
		for (const [agentId, verdictRaw] of Object.entries(agents)) {
			agentIds.add(agentId);
			cells[agentId] = classify(verdictRaw);
			metrics[agentId] = extractMetrics(verdictRaw);
		}
		rows.push({
			scenario: name,
			scenarioError: (scenarioReport as { error?: string }).error,
			cells,
			metrics,
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

/**
 * Print the long-format table: one line per (scenario, agent). The
 * scenario name is rendered only on the first row of each scenario
 * group; continuation rows leave that column blank.
 */
function printTable(rows: Row[], sortedAgents: string[]): void {
	const displayRows: DisplayRow[] = [];
	for (const row of rows) {
		if (sortedAgents.length === 0) {
			displayRows.push({
				scenario: row.scenario,
				agent: "—",
				result: "—",
				duration: "—",
				tokens: "—",
			});
			continue;
		}
		sortedAgents.forEach((agentId, i) => {
			displayRows.push({
				scenario: i === 0 ? row.scenario : "",
				agent: agentId,
				result: fmtResult(row.cells[agentId]),
				duration: fmtDuration(row.metrics[agentId]?.duration),
				tokens: fmtTokens(row.metrics[agentId]?.totalTokens),
			});
		});
	}

	const header: DisplayRow = {
		scenario: "scenario",
		agent: "agent",
		result: "result",
		duration: "duration",
		tokens: "tokens",
	};

	const widths = {
		scenario: colWidth(
			header.scenario,
			displayRows.map((r) => r.scenario),
		),
		agent: colWidth(
			header.agent,
			displayRows.map((r) => r.agent),
		),
		result: colWidth(
			header.result,
			displayRows.map((r) => r.result),
		),
		duration: colWidth(
			header.duration,
			displayRows.map((r) => r.duration),
		),
		tokens: colWidth(
			header.tokens,
			displayRows.map((r) => r.tokens),
		),
	};

	const line = (r: DisplayRow): string =>
		[
			r.scenario.padEnd(widths.scenario),
			r.agent.padEnd(widths.agent),
			r.result.padEnd(widths.result),
			r.duration.padEnd(widths.duration),
			r.tokens.padEnd(widths.tokens),
		].join("  ");

	console.log(line(header));
	for (const r of displayRows) console.log(line(r));
}

function colWidth(header: string, values: string[]): number {
	return Math.max(header.length, ...values.map((v) => v.length));
}

function fmtResult(cell: Cell | undefined): string {
	if (cell === undefined) return "—";
	return cell.kind;
}

/**
 * Testing-agent wall-clock duration. Sub-minute durations show one
 * decimal of seconds (`12.3s`); longer ones switch to `m`+`ss`.
 */
function fmtDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "—";
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const totalSeconds = Math.round(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/** Total token count, thousands-separated. */
function fmtTokens(total: number | undefined): string {
	if (total === undefined || !Number.isFinite(total)) return "—";
	return total.toLocaleString("en-US");
}

/**
 * Pull the testing agent's `duration` and total token usage out of an
 * agent verdict. Both are absent for skipped agents or for providers
 * that did not report usage.
 */
function extractMetrics(verdictRaw: unknown): Metrics {
	if (verdictRaw === null || typeof verdictRaw !== "object") return {};
	const testing = (verdictRaw as { testing?: unknown }).testing;
	if (testing === null || typeof testing !== "object") return {};
	const t = testing as { duration?: unknown; tokenUsage?: unknown };
	const metrics: Metrics = {};
	if (typeof t.duration === "number") metrics.duration = t.duration;
	if (t.tokenUsage !== null && typeof t.tokenUsage === "object") {
		const total = (t.tokenUsage as { totalTokens?: unknown }).totalTokens;
		if (typeof total === "number") metrics.totalTokens = total;
	}
	return metrics;
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
	// The agent report nests the judge payload under `review`; the
	// `testing` block alongside it carries duration/token metrics and is
	// extracted separately by `extractMetrics`.
	const review = (verdictRaw as { review?: unknown }).review;
	if (review === null || typeof review !== "object" || review === undefined) {
		return { kind: "FAIL", firstFailure: "verdict missing" };
	}
	const v = review as Record<string, unknown>;

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
