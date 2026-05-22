/**
 * The human-readable shape we persist into per-agent `report.json`
 * under the `review` key. Pass collapses to `{ pass: true }`; fail
 * keeps only the rubrics / acceptance items that failed, with the
 * judge's notes inline. The full raw judge output is no longer kept
 * verbatim — the goal is a report a human (or the improver agent) can
 * scan without wading through every passing line.
 */
export interface AgentFailure {
	kind: "rubric" | "acceptance";
	id: string;
	notes?: string;
}

export type AgentVerdict =
	| { skipped: string }
	| { pass: true }
	| { pass: false; error?: string; failures?: AgentFailure[] };

/**
 * Collapse the raw judge verdict (a `{ rubrics, acceptance }` object,
 * a `{ skipped }`, or a `{ error }`) into the simplified shape stored
 * in `report.json`. Used both by the per-agent writer and by the
 * progress tracker when classifying the live judge result.
 */
export function collapseReview(raw: unknown): AgentVerdict {
	if (raw === null || raw === undefined || typeof raw !== "object") {
		return { pass: false, error: "verdict missing" };
	}
	const v = raw as Record<string, unknown>;

	if (typeof v.skipped === "string") return { skipped: v.skipped };
	if (typeof v.error === "string") return { pass: false, error: v.error };

	const rubrics = v.rubrics as
		| Record<string, { pass?: unknown; notes?: unknown }>
		| undefined;
	const acceptance = v.acceptance as
		| Array<{ item?: unknown; pass?: unknown; notes?: unknown }>
		| undefined;

	if (!rubrics && !acceptance) {
		return { pass: false, error: "no rubrics or acceptance in verdict" };
	}

	const failures: AgentFailure[] = [];
	if (rubrics) {
		for (const [id, body] of Object.entries(rubrics)) {
			if (body?.pass === true) continue;
			const f: AgentFailure = { kind: "rubric", id };
			if (typeof body?.notes === "string" && body.notes.length > 0) {
				f.notes = body.notes;
			}
			failures.push(f);
		}
	}
	if (acceptance) {
		for (const a of acceptance) {
			if (a?.pass === true) continue;
			const id = typeof a?.item === "string" ? a.item : "(unknown)";
			const f: AgentFailure = { kind: "acceptance", id };
			if (typeof a?.notes === "string" && a.notes.length > 0) {
				f.notes = a.notes;
			}
			failures.push(f);
		}
	}

	if (failures.length === 0) return { pass: true };
	return { pass: false, failures };
}
