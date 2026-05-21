/**
 * Classify a judge verdict (parsed JSON from the per-agent `review`
 * block) into a pass/fail/skipped Cell with every failing rubric or
 * acceptance item.
 *
 * Shared by the console summary and the progress tracker so the
 * two views agree on what "passed" means.
 */
export type Cell =
	| { kind: "PASS" }
	| { kind: "FAIL"; failures: string[] }
	| { kind: "SKIPPED"; reason: string };

export function classifyVerdict(verdictRaw: unknown): Cell {
	if (verdictRaw === null || typeof verdictRaw !== "object") {
		return { kind: "FAIL", failures: ["verdict missing"] };
	}
	const v = verdictRaw as Record<string, unknown>;

	if (typeof v.skipped === "string") {
		return { kind: "SKIPPED", reason: v.skipped };
	}
	if (typeof v.error === "string") {
		return { kind: "FAIL", failures: [v.error] };
	}

	const rubrics = v.rubrics as
		| Record<string, { pass?: unknown }>
		| unknown[]
		| null
		| undefined;
	const acceptance = v.acceptance as
		| Array<{ pass?: unknown; item?: unknown }>
		| Record<string, unknown>
		| undefined;

	// Defensive guards for shape drifts the producer-side normalizer in
	// `judge-agent.ts` didn't (or couldn't) lift. These reach this code
	// path when (a) a hand-written test fixture is handed straight to
	// `classifyVerdict`, (b) a future shape drift slips past
	// `validateReview`, or (c) someone replays a historical/external
	// artifact through the classifier.
	if (
		rubrics !== null &&
		typeof rubrics === "object" &&
		!Array.isArray(rubrics) &&
		Array.isArray(
			(rubrics as Record<string, unknown>).acceptance,
		) &&
		acceptance === undefined
	) {
		return {
			kind: "FAIL",
			failures: ["judge output malformed: acceptance nested under rubrics"],
		};
	}
	if (Array.isArray(rubrics)) {
		return {
			kind: "FAIL",
			failures: ["judge output malformed: rubrics is an array"],
		};
	}
	if (rubrics === null) {
		return {
			kind: "FAIL",
			failures: ["judge output malformed: rubrics is null"],
		};
	}
	if (acceptance !== undefined && !Array.isArray(acceptance)) {
		return {
			kind: "FAIL",
			failures: ["judge output malformed: acceptance is not an array"],
		};
	}

	const failures: string[] = [];

	if (rubrics) {
		for (const [id, r] of Object.entries(
			rubrics as Record<string, unknown>,
		)) {
			if (r === null || typeof r !== "object" || Array.isArray(r)) {
				failures.push(`rubric ${id}: malformed entry`);
				continue;
			}
			if ((r as { pass?: unknown }).pass !== true) {
				failures.push(`rubric ${id}`);
			}
		}
	}
	if (acceptance) {
		for (const a of acceptance as Array<{ pass?: unknown; item?: unknown }>) {
			if (a?.pass !== true) {
				const item = typeof a?.item === "string" ? a.item : "(unknown)";
				failures.push(`acceptance ${item}`);
			}
		}
	}

	if (!rubrics && !acceptance) {
		return {
			kind: "FAIL",
			failures: ["no rubrics or acceptance in verdict"],
		};
	}

	if (failures.length > 0) return { kind: "FAIL", failures };
	return { kind: "PASS" };
}

/**
 * One-line summary of a FAIL cell's `failures` for the live dashboard,
 * where the full list is too long to fit (a single judge can fail many
 * rubrics/acceptance items). Diagnostic strings that don't match the
 * `rubric X` / `acceptance Y` shape are passed through unchanged, since
 * they're already short and carry information the user needs (env-var
 * names, dispatch errors, etc.).
 */
export function summarizeFailures(failures: string[]): string {
	let rubrics = 0;
	let acceptance = 0;
	for (const f of failures) {
		if (f.startsWith("rubric ")) rubrics++;
		else if (f.startsWith("acceptance ")) acceptance++;
	}
	if (rubrics === 0 && acceptance === 0) return failures.join(", ");
	const parts: string[] = [];
	if (rubrics > 0) parts.push(`${rubrics} rubric${rubrics === 1 ? "" : "s"}`);
	if (acceptance > 0) {
		parts.push(`${acceptance} acceptance${acceptance === 1 ? "" : "s"}`);
	}
	return `${parts.join(", ")} failed`;
}
