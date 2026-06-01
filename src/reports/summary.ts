import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMisconfiguredSkipReason } from "../config/misconfig";
import type { MisconfiguredEntry } from "../config/types";
import { paint, shouldUseColor } from "../util/ansi";
import { type Cell, classifyVerdict } from "./verdict";

export interface PrintSummaryParams {
	runDirectory: string;
	runId: string;
}

export interface PreparedSummary {
	consoleLines: string[];
	exitCode: number;
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
	/**
	 * The scenario's `inconclusive` marker (Task 6), copied verbatim from
	 * `report.json` when present. A scenario carrying this reached no verdict
	 * because every tester present was a misconfigured-skip cell (or none was
	 * present): it is non-PASS but routes to the inconclusive path rather than
	 * the red FAIL block.
	 */
	inconclusive?: { reason: "all-testers-misconfigured"; agents: string[] };
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
 * Render the summary from `${runDirectory}/report.json` — the merged
 * matrix across every iteration the pipeline ran — write the plain-text
 * mirror to `${runDirectory}/summary.txt`, and return the console lines
 * + exit code so the caller can decide when to print. Exit code is 0
 * if every cell is PASS, 1 otherwise.
 *
 * The table is long-format: one line per (scenario, agent), carrying
 * the agent's verdict plus the testing agent's wall-clock duration and
 * total token usage. The scenario name is shown only on the first of
 * its rows.
 *
 * Misconfigured-skip cells (a `SKIPPED` cell whose reason is recognized by
 * {@link isMisconfiguredSkipReason}) are excluded from the pass/fail math —
 * neither numerator nor denominator — so a row of surviving-PASS plus
 * misconfigured-skip cells passes and a misconfigured id is never a phantom
 * failure. A scenario with no surviving cells (every tester present was a
 * misconfigured skip, surfaced by the `inconclusive` marker) is non-PASS but
 * routes to a distinct INCONCLUSIVE path rather than the red FAIL block. The
 * three verdicts and their exit codes are:
 *
 *   - PASS (exit 0): every scenario passes over its surviving set and none is
 *     inconclusive.
 *   - FAIL (exit 1): at least one genuine FAIL (a real failure dominates); any
 *     inconclusive scenarios are still listed distinctly.
 *   - INCONCLUSIVE (exit 1): non-PASS, at least one inconclusive scenario, and
 *     no genuine FAIL.
 *
 * The run's misconfiguration roster (`report.json` field `misconfigured`, the
 * ledger snapshot Task 10 persists) drives a single dedicated SKIPPED-AGENTS
 * announcement emitted once per run, replacing the N identical per-(scenario,
 * iteration) failure rows.
 */
export function prepareSummary(params: PrintSummaryParams): PreparedSummary {
	const { runDirectory } = params;
	const reportPath = join(runDirectory, "report.json");
	if (!existsSync(reportPath)) {
		const missingLines = [
			`No run report at ${reportPath}.`,
			"RUN RESULT: FAIL — missing run report",
		];
		writeRunSummary(runDirectory, missingLines);
		return { consoleLines: missingLines, exitCode: 1 };
	}

	const { rows, misconfigured } = loadReport(reportPath);
	const sortedAgents = collectAgentIds(rows);
	const misconfiguredIds = new Set(Object.keys(misconfigured));
	const verdict = computeVerdict(rows, sortedAgents, misconfiguredIds);

	const useColor = shouldUseColor(process.stdout);
	const rendered = renderSummaryLines(
		rows,
		sortedAgents,
		verdict,
		misconfigured,
		useColor,
	);
	const plain = useColor
		? renderSummaryLines(rows, sortedAgents, verdict, misconfigured, false)
		: rendered;
	writeRunSummary(runDirectory, plain);

	return { consoleLines: ["", ...rendered], exitCode: verdict.exitCode };
}

/**
 * The run-level verdict over the loaded rows. `kind` decides which result
 * banner and which sections render; `exitCode` is what the process exits
 * with (carried unchanged through {@link emitSummary} to pipeline.ts). A
 * clean run is `{ kind: "PASS", exitCode: 0 }`; both FAIL and INCONCLUSIVE
 * exit 1.
 */
interface RunVerdict {
	kind: "PASS" | "FAIL" | "INCONCLUSIVE";
	exitCode: number;
}

/**
 * Reduce the rows to a single run verdict. A row that genuinely fails (any
 * non-excluded cell that is not PASS, or a scenario error) makes the run FAIL.
 * A row that is inconclusive — its `inconclusive` marker is set or it has no
 * surviving (non-misconfigured-skip) cells — contributes INCONCLUSIVE only
 * when no genuine FAIL dominates. PASS requires every row to pass over its
 * surviving set with no inconclusive scenarios. An empty run (no rows) is FAIL,
 * matching today's `rows.length > 0` guard rather than a silent pass.
 *
 * `misconfiguredIds` is the run's roster of misconfigured agent ids; a cell for
 * such an id is excluded from the math in every scenario — including one where
 * the id is simply absent — so a misconfigured tester never becomes a phantom
 * `missing` failure in a healthy sibling scenario (AC11a).
 */
function computeVerdict(
	rows: Row[],
	sortedAgents: string[],
	misconfiguredIds: Set<string>,
): RunVerdict {
	if (rows.length === 0) return { kind: "FAIL", exitCode: 1 };
	let anyFail = false;
	let anyInconclusive = false;
	for (const row of rows) {
		if (isRowInconclusive(row, sortedAgents, misconfiguredIds)) {
			anyInconclusive = true;
			continue;
		}
		if (!isRowPass(row, sortedAgents, misconfiguredIds)) anyFail = true;
	}
	if (anyFail) return { kind: "FAIL", exitCode: 1 };
	if (anyInconclusive) return { kind: "INCONCLUSIVE", exitCode: 1 };
	return { kind: "PASS", exitCode: 0 };
}

/** Print previously prepared console lines and return the exit code. */
export function emitSummary(prepared: PreparedSummary): number {
	for (const line of prepared.consoleLines) console.log(line);
	return prepared.exitCode;
}

/**
 * Parse `${runDirectory}/report.json` into the rows the summary renders plus
 * the run's misconfiguration roster. The roster is read from the top-level
 * `misconfigured` field (Task 10's channel) — the ledger snapshot keyed by
 * agent id — defaulting to `{}` for older reports that predate the field, so
 * the announcement code never needs a presence check. Each scenario's
 * `inconclusive` marker (Task 6) is carried onto its row.
 */
function loadReport(reportPath: string): {
	rows: Row[];
	misconfigured: Record<string, MisconfiguredEntry>;
} {
	const parsed = (JSON.parse(readFileSync(reportPath, "utf8")) ?? {}) as Record<
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
		const inconclusive = (
			scenarioReport as {
				inconclusive?: { reason: "all-testers-misconfigured"; agents: string[] };
			}
		).inconclusive;
		rows.push({
			scenario: name,
			scenarioError: (scenarioReport as { error?: string }).error,
			cells,
			metrics,
			...(inconclusive !== undefined ? { inconclusive } : {}),
		});
	}

	const misconfigured =
		parsed.misconfigured !== null && typeof parsed.misconfigured === "object"
			? (parsed.misconfigured as Record<string, MisconfiguredEntry>)
			: {};

	return { rows, misconfigured };
}

function collectAgentIds(rows: Row[]): string[] {
	const ids = new Set<string>();
	for (const row of rows) {
		for (const id of Object.keys(row.cells)) ids.add(id);
	}
	return Array.from(ids).sort();
}

/**
 * True iff a cell is a misconfigured-skip — a `SKIPPED` cell whose reason was
 * produced via the misconfigured marker (Task 1's {@link isMisconfiguredSkipReason}).
 */
function isMisconfiguredSkipCell(cell: Cell | undefined): boolean {
	return (
		cell !== undefined &&
		cell.kind === "SKIPPED" &&
		isMisconfiguredSkipReason(cell.reason)
	);
}

/**
 * True iff the (id, cell) pair is excluded from the pass/fail math entirely —
 * it neither fails a row nor counts toward it, and it never appears in the red
 * FAIL block (it may still render in the table for transparency). A pair is
 * excluded when the cell is a misconfigured-skip *or* the id is on the run's
 * misconfigured roster. The roster clause matters for scenarios where a
 * misconfigured agent has no cell at all: without it, the id would surface as a
 * phantom `missing` failure in a sibling scenario where it was never run.
 */
function isExcludedCell(
	id: string,
	cell: Cell | undefined,
	misconfiguredIds: Set<string>,
): boolean {
	return misconfiguredIds.has(id) || isMisconfiguredSkipCell(cell);
}

function renderSummaryLines(
	rows: Row[],
	sortedAgents: string[],
	verdict: RunVerdict,
	misconfigured: Record<string, MisconfiguredEntry>,
	color: boolean,
): string[] {
	const misconfiguredIds = new Set(Object.keys(misconfigured));
	const lines: string[] = [];
	pushTable(lines, rows, sortedAgents, misconfiguredIds, color);
	lines.push("");

	if (verdict.kind === "PASS") {
		lines.push("RUN RESULT: PASS");
		pushMisconfiguredAnnouncement(lines, misconfigured, color);
		return lines;
	}

	const inconclusiveRows = rows.filter((r) =>
		isRowInconclusive(r, sortedAgents, misconfiguredIds),
	);

	if (verdict.kind === "INCONCLUSIVE") {
		// Non-PASS, at least one inconclusive scenario, and no genuine FAIL: a
		// distinct yellow banner (reusing the SKIPPED paint), separate from the
		// red FAIL block, listing the inconclusive scenarios and their reasons.
		const banner = `RUN RESULT: INCONCLUSIVE (${inconclusiveRows.length} ${
			inconclusiveRows.length === 1 ? "scenario" : "scenarios"
		}: all testers misconfigured)`;
		lines.push(color ? paint(banner, "yellow", true) : banner);
		pushInconclusiveSection(lines, inconclusiveRows, color);
		pushMisconfiguredAnnouncement(lines, misconfigured, color);
		return lines;
	}

	// FAIL: a real failure dominates. Render the red FAIL block over the
	// genuinely-failing rows (misconfigured-skip cells already excluded from
	// `failureLines`), then list any inconclusive scenarios distinctly.
	lines.push(
		color ? paint("RUN RESULT: FAIL", "red", true) : "RUN RESULT: FAIL",
	);
	lines.push("");
	const failingRows = rows.filter(
		(r) =>
			!isRowPass(r, sortedAgents, misconfiguredIds) &&
			!isRowInconclusive(r, sortedAgents, misconfiguredIds),
	);
	failingRows.forEach((row, i) => {
		const header = color ? paint(row.scenario, "red", true) : row.scenario;
		lines.push(header);
		for (const line of failureLines(row, sortedAgents, misconfiguredIds)) {
			lines.push(`  ${line}`);
		}
		if (i < failingRows.length - 1) lines.push("");
	});
	pushInconclusiveSection(lines, inconclusiveRows, color);
	pushMisconfiguredAnnouncement(lines, misconfigured, color);
	return lines;
}

/**
 * List the inconclusive scenarios in their own yellow section (reusing the
 * SKIPPED paint), distinct from the red FAIL block. Each scenario names the
 * misconfigured-skip ids that were excluded, when the marker carries them. A
 * no-op when there are no inconclusive scenarios.
 */
function pushInconclusiveSection(
	lines: string[],
	inconclusiveRows: Row[],
	color: boolean,
): void {
	if (inconclusiveRows.length === 0) return;
	lines.push("");
	const heading = "INCONCLUSIVE SCENARIOS (all testers misconfigured):";
	lines.push(color ? paint(heading, "yellow", true) : heading);
	for (const row of inconclusiveRows) {
		const ids = row.inconclusive?.agents ?? [];
		const detail = ids.length > 0 ? ` — ${ids.join(", ")}` : "";
		lines.push(`  ${row.scenario}${detail}`);
	}
}

/**
 * Emit the one-time SKIPPED-AGENTS announcement (R8, AC3): one line per
 * misconfigured agent in the run's roster, carrying its id, the roles it
 * filled, and its reason — painted yellow (distinct from the red FAIL block).
 * This replaces the N identical per-(scenario, iteration) failure rows. A
 * no-op for a clean run (empty roster), keeping a clean run's output
 * byte-for-byte identical (AC14).
 */
function pushMisconfiguredAnnouncement(
	lines: string[],
	misconfigured: Record<string, MisconfiguredEntry>,
	color: boolean,
): void {
	const entries = Object.entries(misconfigured).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	if (entries.length === 0) return;
	lines.push("");
	const heading = "SKIPPED AGENTS (misconfigured):";
	lines.push(color ? paint(heading, "yellow", true) : heading);
	const idWidth = Math.max(...entries.map(([id]) => id.length));
	const rolesWidth = Math.max(
		...entries.map(([, entry]) => entry.roles.join(", ").length),
	);
	for (const [id, entry] of entries) {
		const roles = entry.roles.join(", ");
		const line = `  ${id.padEnd(idWidth)}  ${roles.padEnd(rolesWidth)}  ${entry.reason}`;
		lines.push(color ? paint(line, "yellow", true) : line);
	}
}

function pushTable(
	lines: string[],
	rows: Row[],
	sortedAgents: string[],
	misconfiguredIds: Set<string>,
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
		// Only a genuine failure paints the scenario cell red; an inconclusive
		// row (all testers misconfigured) is non-PASS but not a red failure.
		const failing =
			!isRowPass(row, sortedAgents, misconfiguredIds) &&
			!isRowInconclusive(row, sortedAgents, misconfiguredIds);
		sortedAgents.forEach((agentId, i) => {
			const cell = row.cells[agentId];
			displayRows.push({
				scenario: i === 0 ? row.scenario : "",
				agent: agentId,
				result: fmtResult(cell),
				resultKind: cell?.kind ?? "missing",
				duration: fmtDuration(row.metrics[agentId]?.duration),
				tokens: fmtTokens(row.metrics[agentId]?.totalTokens),
				failing,
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
	const body = agentReport as { error?: unknown; review?: unknown };
	if (typeof body.error === "string") {
		return { kind: "FAIL", failures: [body.error] };
	}
	// The agent report nests the (already-simplified) verdict under
	// `review`; the `testing` block alongside it carries duration/token
	// metrics and is extracted separately by `extractMetrics`.
	return classifyVerdict(body.review);
}

/**
 * A row passes iff it has no scenario error and every *surviving* cell (after
 * excluding misconfigured-skip cells) is PASS. A row whose only cells are
 * misconfigured skips has no survivors and is therefore not a pass — it is
 * inconclusive (see {@link isRowInconclusive}), so this returns `false` rather
 * than vacuously passing over an empty survivor set.
 */
function isRowPass(
	row: Row,
	sortedAgents: string[],
	misconfiguredIds: Set<string>,
): boolean {
	if (row.scenarioError !== undefined) return false;
	let survivors = 0;
	for (const a of sortedAgents) {
		const cell = row.cells[a];
		if (isExcludedCell(a, cell, misconfiguredIds)) continue;
		survivors++;
		if (cell === undefined || cell.kind !== "PASS") return false;
	}
	return survivors > 0;
}

/**
 * A row is inconclusive when it reached no verdict because every tester present
 * was a misconfigured-skip cell (or none was present): it is non-PASS but not a
 * red FAIL. Recognized either by the persisted `inconclusive` marker (Task 6)
 * or by a row that has no surviving (non-misconfigured-skip) cells and carries
 * no scenario error. A scenario error is always a genuine FAIL, never
 * inconclusive.
 */
function isRowInconclusive(
	row: Row,
	sortedAgents: string[],
	misconfiguredIds: Set<string>,
): boolean {
	if (row.scenarioError !== undefined) return false;
	if (row.inconclusive !== undefined) return true;
	for (const a of sortedAgents) {
		if (!isExcludedCell(a, row.cells[a], misconfiguredIds)) return false;
	}
	// No surviving cells: either no agents at all, or all excluded.
	return true;
}

function failureLines(
	row: Row,
	sortedAgents: string[],
	misconfiguredIds: Set<string>,
): string[] {
	const out: string[] = [];
	if (row.scenarioError !== undefined) {
		out.push(`scenario error: ${row.scenarioError}`);
	}
	for (const a of sortedAgents) {
		const cell = row.cells[a];
		// Excluded cells (misconfigured-skips or roster ids) never appear in the
		// red FAIL block; they are surfaced once in the dedicated SKIPPED-AGENTS
		// announcement instead.
		if (isExcludedCell(a, cell, misconfiguredIds)) continue;
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
