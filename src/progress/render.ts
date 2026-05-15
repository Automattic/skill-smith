import type { Failure, RunSnapshot } from "./types";

export interface RenderOptions {
	color?: boolean;
	barWidth?: number;
}

/**
 * Render a `RunSnapshot` as the compact dashboard:
 *
 *   skillsmith run <runId>
 *   scenarios  ████░░░░  N/M  pass A · fail B · skip C
 *   phases     ███░░░░░  N/M  pass A · fail B · skip C
 *   elapsed mm:ss   ETA ~mm:ss          (or "done" when finished)
 *
 *   failures (K):
 *     ✗ <scenario>  <agent>  <phase>  <detail>
 *
 * Pure: no I/O, no time, no environment lookups.
 */
export function renderSnapshot(
	snap: RunSnapshot,
	opts: RenderOptions = {},
): string {
	const color = opts.color ?? false;
	const barWidth = opts.barWidth ?? 30;

	const lines: string[] = [];
	lines.push(`skillsmith run ${snap.runId}`);

	const sc = snap.counters.scenarios;
	const ph = snap.counters.phases;
	const sDone = sc.passed + sc.failed + sc.skipped;
	const pDone = ph.passed + ph.failed + ph.skipped;

	lines.push(
		`scenarios  ${bar(sDone, sc.total, barWidth, color)}  ` +
			`${pad(`${sDone}/${sc.total}`, countWidth(sc.total))}  ` +
			`${counterSummary(sc, color)}`,
	);
	lines.push(
		`phases     ${bar(pDone, ph.total, barWidth, color)}  ` +
			`${pad(`${pDone}/${ph.total}`, countWidth(ph.total))}  ` +
			`${counterSummary(ph, color)}`,
	);

	const elapsedMs = Math.max(0, snap.now - snap.startedAt);
	if (snap.finished) {
		lines.push(`elapsed ${formatClock(elapsedMs)}   done`);
	} else {
		const etaMs = estimateEta(pDone, ph.total, elapsedMs);
		const etaText = etaMs === undefined ? "—" : `~${formatClock(etaMs)}`;
		lines.push(`elapsed ${formatClock(elapsedMs)}   ETA ${etaText}`);
	}

	if (snap.failures.length > 0) {
		lines.push("");
		lines.push(`failures (${snap.failures.length}):`);
		const widths = failureColumnWidths(snap.failures);
		for (const f of snap.failures) {
			lines.push(`  ${formatFailure(f, widths, color)}`);
		}
	}

	return lines.join("\n");
}

interface CounterSlice {
	passed: number;
	failed: number;
	skipped: number;
	running: number;
	pending: number;
}

function counterSummary(c: CounterSlice, color: boolean): string {
	const parts = [
		`pass ${paint(String(c.passed), "green", color)}`,
		`fail ${paint(String(c.failed), c.failed > 0 ? "red" : undefined, color)}`,
	];
	if (c.skipped > 0)
		parts.push(`skip ${paint(String(c.skipped), "yellow", color)}`);
	if (c.running > 0)
		parts.push(`run ${paint(String(c.running), "cyan", color)}`);
	return parts.join(" · ");
}

function bar(
	done: number,
	total: number,
	width: number,
	color: boolean,
): string {
	if (total <= 0) return paint("░".repeat(width), "gray", color);
	const fillCount = Math.min(width, Math.round((done / total) * width));
	const filled = "█".repeat(fillCount);
	const empty = "░".repeat(width - fillCount);
	return `${paint(filled, "cyan", color)}${paint(empty, "gray", color)}`;
}

function estimateEta(
	done: number,
	total: number,
	elapsedMs: number,
): number | undefined {
	if (done <= 0 || elapsedMs <= 0 || total <= done) return undefined;
	const perUnit = elapsedMs / done;
	return Math.round(perUnit * (total - done));
}

function formatClock(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}:${two(m)}:${two(s)}`;
	return `${two(m)}:${two(s)}`;
}

function two(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function countWidth(total: number): number {
	const t = String(total).length;
	return t * 2 + 1;
}

function pad(s: string, width: number): string {
	return s.length >= width ? s : `${s}${" ".repeat(width - s.length)}`;
}

function failureColumnWidths(failures: Failure[]): {
	scenario: number;
	agent: number;
	phase: number;
} {
	let scenario = 0;
	let agent = 0;
	let phase = 0;
	for (const f of failures) {
		if (f.scenario.length > scenario) scenario = f.scenario.length;
		if (f.agentId.length > agent) agent = f.agentId.length;
		const phaseLabel = f.phase ?? "—";
		if (phaseLabel.length > phase) phase = phaseLabel.length;
	}
	return { scenario, agent, phase };
}

function formatFailure(
	f: Failure,
	widths: { scenario: number; agent: number; phase: number },
	color: boolean,
): string {
	const cross = paint("✗", "red", color);
	const scenario = pad(f.scenario, widths.scenario);
	const agent = pad(f.agentId, widths.agent);
	const phase = pad(f.phase ?? "—", widths.phase);
	return `${cross} ${scenario}  ${agent}  ${phase}  ${f.detail}`;
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
