import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { paint, shouldUseColor } from "../util/ansi";
import { type Cell, classifyVerdict } from "./verdict";

export interface PrintSummaryParams {
	iterationDirectory: string;
	runId: string;
}

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
	resultKind: Cell["kind"] | "missing";
	duration: string;
	tokens: string;
	failing: boolean;
}

/**
 * Render the console summary from `${iterationDirectory}/report.yaml`
 * and emit `RUN RESULT: PASS|FAIL`. Also writes a plain-text mirror
 * to `${iterationDirectory}/summary.txt`. Returns the process exit
 * code: 0 if every cell is PASS, 1 otherwise.
 *
 * The table is long-format: one line per (scenario, agent), carrying
 * the agent's verdict plus the testing agent's wall-clock duration and
 * total token usage. The scenario name is shown only on the first of
 * its rows.
 */
export function printSummary(params: PrintSummaryParams): number {
	const { iterationDirectory } = params;
	const reportPath = join(iterationDirectory, "report.yaml");
	if (!existsSync(reportPath)) {
		const missingLines = [
			`No iteration report at ${reportPath}.`,
			"RUN RESULT: FAIL — missing iteration report",
		];
		for (const line of missingLines) console.log(line);
		writeRunSummary(iterationDirectory, missingLines);
		return 1;
	}

	const rows = loadRows(reportPath);
	const sortedAgents = collectAgentIds(rows);
	const allPass =
		rows.length > 0 && rows.every((r) => isRowPass(r, sortedAgents));

	const useColor = shouldUseColor(process.stdout);
	const consoleLines = renderSummaryLines(
		rows,
		sortedAgents,
		allPass,
		useColor,
	);
	console.log("");
	for (const line of consoleLines) console.log(line);

	const plain = useColor
		? renderSummaryLines(rows, sortedAgents, allPass, false)
		: consoleLines;
	writeRunSummary(iterationDirectory, plain);

	return allPass ? 0 : 1;
}

function loadRows(reportPath: string): Row[] {
	const parsed = (parseYaml(readFileSync(reportPath, "utf8")) ?? {}) as Record<
		string,
		unknown
	>;
	const scenarios = parsed.scenarios as
		| Record<string, Record<string, unknown>>
		| undefined;

	const rows: Row[] = [];
	for (const [name, body] of Object.entries(scenarios ?? {})) {
		const scenarioReport = body ?? {};
		const cells: Record<string, Cell> = {};
		const metrics: Record<string, Metrics> = {};
		const agents =
			(scenarioReport as { agents?: Record<string, unknown> }).agents ?? {};
		for (const [agentId, agentReport] of Object.entries(agents)) {
			cells[agentId] = classifyAgentReport(agentReport);
			metrics[agentId] = extractMetrics(agentReport);
		}
		rows.push({
			scenario: name,
			scenarioError: (scenarioReport as { error?: string }).error,
			cells,
			metrics,
		});
	}
	return rows;
}

function collectAgentIds(rows: Row[]): string[] {
	const ids = new Set<string>();
	for (const row of rows) {
		for (const id of Object.keys(row.cells)) ids.add(id);
	}
	return Array.from(ids).sort();
}

function renderSummaryLines(
	rows: Row[],
	sortedAgents: string[],
	allPass: boolean,
	color: boolean,
): string[] {
	const lines: string[] = [];
	pushTable(lines, rows, sortedAgents, color);
	lines.push("");
	if (allPass) {
		lines.push("RUN RESULT: PASS");
		return lines;
	}
	lines.push(color ? paint("RUN RESULT: FAIL", "red", true) : "RUN RESULT: FAIL");
	lines.push("");
	const failingRows = rows.filter((r) => !isRowPass(r, sortedAgents));
	failingRows.forEach((row, i) => {
		const header = color ? paint(row.scenario, "red", true) : row.scenario;
		lines.push(header);
		for (const line of failureLines(row, sortedAgents)) {
			lines.push(`  ${line}`);
		}
		if (i < failingRows.length - 1) lines.push("");
	});
	return lines;
}

function pushTable(
	lines: string[],
	rows: Row[],
	sortedAgents: string[],
	color: boolean,
): void {
	const displayRows: DisplayRow[] = [];
	for (const row of rows) {
		if (sortedAgents.length === 0) {
			displayRows.push({
				scenario: row.scenario,
				agent: "—",
				result: "—",
				resultKind: "missing",
				duration: "—",
				tokens: "—",
				failing: row.scenarioError !== undefined,
			});
			continue;
		}
		sortedAgents.forEach((agentId, i) => {
			const cell = row.cells[agentId];
			displayRows.push({
				scenario: i === 0 ? row.scenario : "",
				agent: agentId,
				result: fmtResult(cell),
				resultKind: cell?.kind ?? "missing",
				duration: fmtDuration(row.metrics[agentId]?.duration),
				tokens: fmtTokens(row.metrics[agentId]?.totalTokens),
				failing: !isRowPass(row, sortedAgents),
			});
		});
	}

	const header: DisplayRow = {
		scenario: "scenario",
		agent: "agent",
		result: "result",
		resultKind: "missing",
		duration: "duration",
		tokens: "tokens",
		failing: false,
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

	const renderLine = (r: DisplayRow, isHeader: boolean): string => {
		const scenarioCell = r.scenario.padEnd(widths.scenario);
		const agentCell = r.agent.padEnd(widths.agent);
		const resultCell = r.result.padEnd(widths.result);
		const durationCell = r.duration.padEnd(widths.duration);
		const tokensCell = r.tokens.padEnd(widths.tokens);
		const scenarioOut =
			!isHeader && color && r.failing && r.scenario.length > 0
				? scenarioCell.replace(r.scenario, paint(r.scenario, "red", true))
				: scenarioCell;
		let resultOut = resultCell;
		if (!isHeader && color) {
			if (r.resultKind === "FAIL")
				resultOut = resultCell.replace("FAIL", paint("FAIL", "red", true));
			else if (r.resultKind === "SKIPPED")
				resultOut = resultCell.replace(
					"SKIPPED",
					paint("SKIPPED", "yellow", true),
				);
		}
		return [scenarioOut, agentCell, resultOut, durationCell, tokensCell].join(
			"  ",
		);
	};

	lines.push(renderLine(header, true));
	for (const r of displayRows) lines.push(renderLine(r, false));
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
 * agent report. Both are absent for skipped agents or for providers
 * that did not report usage.
 */
function extractMetrics(agentReport: unknown): Metrics {
	if (agentReport === null || typeof agentReport !== "object") return {};
	const testing = (agentReport as { testing?: unknown }).testing;
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

function classifyAgentReport(agentReport: unknown): Cell {
	if (agentReport === null || typeof agentReport !== "object") {
		return classifyVerdict(agentReport);
	}
	// The agent report nests the judge payload under `review`; the
	// `testing` block alongside it carries duration/token metrics and is
	// extracted separately by `extractMetrics`.
	const review = (agentReport as { review?: unknown }).review;
	return classifyVerdict(review);
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

function failureLines(row: Row, sortedAgents: string[]): string[] {
	const out: string[] = [];
	if (row.scenarioError !== undefined) {
		out.push(`scenario error: ${row.scenarioError}`);
	}
	for (const a of sortedAgents) {
		const cell = row.cells[a];
		if (cell === undefined) {
			out.push(`${a}: missing`);
			continue;
		}
		if (cell.kind === "PASS") continue;
		if (cell.kind === "SKIPPED") {
			out.push(`${a}: SKIPPED ${cell.reason}`);
			continue;
		}
		for (const f of cell.failures) out.push(`${a}: ${f}`);
	}
	return out;
}

function writeRunSummary(directory: string, lines: string[]): void {
	try {
		writeFileSync(join(directory, "summary.txt"), `${lines.join("\n")}\n`);
	} catch {
		// best-effort; we already printed to the console
	}
}
