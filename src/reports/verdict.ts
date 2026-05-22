/**
 * Classify a judge verdict (parsed JSON from the per-agent `review`
 * block) into a pass/fail/skipped Cell with every failing rubric or
 * acceptance item, rendered with judge notes when available.
 *
 * Shared by the console summary and the progress tracker so the
 * two views agree on what "passed" means.
 */
export type Cell =
	| { kind: "PASS" }
	| { kind: "FAIL"; failures: string[] }
	| { kind: "SKIPPED"; reason: string };

/**
 * Classify a parsed `review` payload — the verbatim judge output
 * persisted under `review` — into a pass/fail/skipped Cell. Handles
 * both the simplified `{ pass, failures }` shape and the raw
 * `{ rubrics, acceptance }` judge shape.
 */
export function classifyVerdict(raw: unknown): Cell {
	if (raw === null || raw === undefined || typeof raw !== "object") {
		return { kind: "FAIL", failures: ["verdict missing"] };
	}
	const v = raw as Record<string, unknown>;

	if (typeof v.skipped === "string") {
		return { kind: "SKIPPED", reason: v.skipped };
	}
	if (v.pass === true) return { kind: "PASS" };
	if (v.pass === false) {
		const failures: string[] = [];
		if (typeof v.error === "string") failures.push(v.error);
		const items = v.failures as
			| Array<{ kind?: unknown; id?: unknown; notes?: unknown }>
			| undefined;
		if (items !== undefined) {
			for (const f of items) {
				const kind = typeof f?.kind === "string" ? f.kind : "rubric";
				const id = typeof f?.id === "string" ? f.id : "(unknown)";
				const head = `${kind} ${id}`;
				const notes = typeof f?.notes === "string" ? f.notes : "";
				failures.push(notes.length > 0 ? `${head} — ${notes}` : head);
			}
		}
		if (failures.length === 0) failures.push("verdict failed without detail");
		return { kind: "FAIL", failures };
	}

	// Fall back to the raw judge shape so legacy verdict payloads still classify.
	if (typeof v.error === "string") {
		return { kind: "FAIL", failures: [v.error] };
	}

	const rubrics = v.rubrics as Record<string, { pass?: unknown }> | undefined;
	const acceptance = v.acceptance as
		| Array<{ pass?: unknown; item?: unknown }>
		| undefined;

	const failures: string[] = [];
	if (rubrics) {
		for (const [id, r] of Object.entries(rubrics)) {
			if (r?.pass !== true) {
				failures.push(`rubric ${id}`);
			}
		}
	}
	if (acceptance) {
		for (const a of acceptance) {
			if (a?.pass !== true) {
				const item = typeof a?.item === "string" ? a.item : "(unknown)";
				failures.push(`acceptance ${item}`);
			}
		}
	}

	if (!rubrics && !acceptance) {
		return { kind: "FAIL", failures: ["no rubrics or acceptance in verdict"] };
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
