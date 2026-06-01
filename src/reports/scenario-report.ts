import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isMisconfiguredSkipReason } from "../config/misconfig";
import { isDirectorySafe } from "../util/fs";
import { classifyVerdict } from "./verdict";

export interface AggregateScenarioReportParams {
	scenarioDirectory: string;
	scenarioName: string;
	scenarioError?: string;
}

/**
 * One agent's row inside `<scenario>/report.json`. We keep the
 * `testing` block (duration / token usage) and the judge's `review`
 * block verbatim — the full rubrics/acceptance output the agent loop
 * wrote. A missing or unparseable per-agent report is reported as an
 * error string instead of an object.
 */
export interface ScenarioAgentEntry {
	testing?: unknown;
	review?: unknown;
	error?: string;
}

export interface ScenarioReport {
	scenario: string;
	pass: boolean;
	agents: Record<string, ScenarioAgentEntry>;
	error?: string;
	/**
	 * Set only when the scenario reached no verdict because every tester that
	 * was present was a misconfigured-skip cell (or no tester was present at
	 * all), with no enumeration `error`. Such a scenario is neither a silent
	 * pass nor an ordinary FAIL: `pass` is `false`, but consumers branch on
	 * this field rather than treating it as a failure. `agents` lists the ids
	 * of the misconfigured-skip cells that were excluded (empty when the
	 * scenario simply had zero agent directories).
	 */
	inconclusive?: { reason: "all-testers-misconfigured"; agents: string[] };
}

/**
 * Aggregate `${scenarioDirectory}/<agent>/report.json` into
 * `${scenarioDirectory}/report.json`. Missing report →
 * `error: "missing agent report"` for that agent and a failing
 * scenario. Each agent report carries a `testing` block and a
 * `review` block verbatim.
 *
 * Pass math excludes misconfigured-skip cells from both numerator and
 * denominator: an agent whose `review` classifies to `SKIPPED` with a
 * reason recognized by {@link isMisconfiguredSkipReason} neither fails the
 * scenario nor counts toward it. The scenario passes only when there is at
 * least one surviving (non-excluded) agent and every survivor's review
 * classifies `PASS`.
 *
 * When the surviving set is empty (no agent directories, or every present
 * tester was a misconfigured-skip cell) and there is no enumeration
 * `error`, the scenario is neither a silent pass nor a FAIL: `pass` is
 * `false` and the `inconclusive` marker is set, listing the excluded
 * misconfigured-skip ids. A genuine enumeration `error` keeps today's
 * behavior — `pass: false`, `error` set, and no `inconclusive` marker.
 */
export function aggregateScenarioReport(
	params: AggregateScenarioReportParams,
): ScenarioReport {
	const { scenarioDirectory, scenarioName, scenarioError } = params;

	const agents: Record<string, ScenarioAgentEntry> = {};

	if (isDirectorySafe(scenarioDirectory)) {
		for (const entry of readdirSync(scenarioDirectory)) {
			const full = join(scenarioDirectory, entry);
			if (!isDirectorySafe(full)) continue;
			const reportPath = join(full, "report.json");
			if (!existsSync(reportPath)) {
				agents[entry] = { error: "missing agent report" };
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(readFileSync(reportPath, "utf8"));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				agents[entry] = { error: `agent report unparseable: ${msg}` };
				continue;
			}
			if (parsed === null || typeof parsed !== "object") {
				agents[entry] = { error: "agent report empty" };
				continue;
			}
			const body = parsed as Record<string, unknown>;
			const out: ScenarioAgentEntry = {};
			if (body.testing !== undefined) out.testing = body.testing;
			if (body.review !== undefined) out.review = body.review;
			agents[entry] = out;
		}
	}

	// Partition the agent entries: misconfigured-skip cells are excluded from
	// the vote entirely (neither numerator nor denominator); everything else is
	// a "survivor" that the scenario pass/fail rule applies to.
	const misconfiguredSkipIds: string[] = [];
	const survivors: ScenarioAgentEntry[] = [];
	for (const [id, entry] of Object.entries(agents)) {
		const verdict =
			entry.error === undefined &&
			entry.review !== null &&
			typeof entry.review === "object"
				? classifyVerdict(entry.review)
				: undefined;
		if (
			verdict?.kind === "SKIPPED" &&
			isMisconfiguredSkipReason(verdict.reason)
		) {
			misconfiguredSkipIds.push(id);
			continue;
		}
		survivors.push(entry);
	}

	const allPass =
		scenarioError === undefined &&
		survivors.length > 0 &&
		survivors.every((entry) => {
			if (entry.error !== undefined) return false;
			if (entry.review === null || typeof entry.review !== "object") {
				return false;
			}
			return classifyVerdict(entry.review).kind === "PASS";
		});

	const body: ScenarioReport = {
		scenario: scenarioName,
		pass: allPass,
		agents,
	};
	if (scenarioError !== undefined) body.error = scenarioError;
	// An empty surviving set with no enumeration error is inconclusive, not a
	// silent pass or an ordinary FAIL: every present tester (if any) was a
	// misconfigured skip. An enumeration error stays a real scenario error.
	if (scenarioError === undefined && survivors.length === 0) {
		body.inconclusive = {
			reason: "all-testers-misconfigured",
			agents: misconfiguredSkipIds,
		};
	}

	mkdirSync(scenarioDirectory, { recursive: true });
	const target = join(scenarioDirectory, "report.json");
	writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
	return body;
}
