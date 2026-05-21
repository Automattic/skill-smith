import type {
	IterationCompleteHookContext,
	VerificationFailure,
	VerifyHookFn,
} from "../config/types";
import type { IterationReport } from "../reports/iteration-report";
import type { RunLog } from "../util/run-log";

const DEFAULT_NOTE = "verification gate reported failure";

/** A verification hook's return value, normalized for the harness. */
export interface NormalizedVerification {
	pass: boolean;
	failures: VerificationFailure[];
	details?: string;
}

/**
 * Coerce whatever a verification hook returned into a stable shape.
 * The input is `unknown` because the hook is project-supplied JS:
 *
 *   - `undefined` / `true` (or any non-object, non-`false`) → pass.
 *   - `false` → fail, no specific scenarios (coarse).
 *   - object → `failures` as given; `pass` defaults to `false` when any
 *     failures were named, `true` otherwise.
 */
export function normalizeVerification(ret: unknown): NormalizedVerification {
	if (ret === false) return { pass: false, failures: [] };
	if (ret === null || typeof ret !== "object") {
		return { pass: true, failures: [] };
	}

	const obj = ret as {
		pass?: unknown;
		failures?: unknown;
		details?: unknown;
	};
	const failures = Array.isArray(obj.failures)
		? obj.failures.filter(
				(f): f is VerificationFailure =>
					f !== null && typeof f === "object" && typeof f.scenario === "string",
			)
		: [];
	const pass =
		typeof obj.pass === "boolean" ? obj.pass : failures.length === 0;
	const out: NormalizedVerification = { pass, failures };
	if (typeof obj.details === "string") out.details = obj.details;
	return out;
}

/**
 * Invoke the project's `verifyIteration` hook and normalize its return.
 * Unlike `tryHook`, the return value matters here; a throwing hook is
 * treated as a failed verification (so a broken gate fails safe).
 */
export async function runVerifyHook(
	fn: VerifyHookFn | undefined,
	ctx: IterationCompleteHookContext,
	scope: string,
	log: RunLog,
): Promise<NormalizedVerification> {
	if (fn === undefined) {
		log.hook("verifyIteration", scope, "noop");
		return { pass: true, failures: [] };
	}
	try {
		const norm = normalizeVerification(await fn(ctx));
		log.hook(
			"verifyIteration",
			scope,
			"invoked",
			`pass=${norm.pass} failures=${norm.failures.length}`,
		);
		return norm;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.hook("verifyIteration", scope, "error", msg);
		return { pass: false, failures: [], details: `verification hook threw: ${msg}` };
	}
}

/**
 * Fold a verification verdict into the iteration report. When the hook
 * passed, the report is untouched. When it failed, the named
 * (scenario, agent) pairs — or, with no names, every scenario that ran
 * — are marked failed with the hook's details, so the merged matrix,
 * exit code, next-iteration selection, and the improver's failure
 * summary all reflect the gate. Returns `true` when the report changed.
 */
export function applyVerification(
	report: IterationReport,
	verification: NormalizedVerification,
	ranScenarioNames: string[],
	log: RunLog,
): boolean {
	if (verification.pass) return false;

	report.pass = false;
	let changed = false;

	if (verification.failures.length > 0) {
		for (const failure of verification.failures) {
			const body = report.scenarios[failure.scenario];
			if (body === undefined || !("agents" in body)) {
				log.info(
					`verifyIteration: failure for unknown/errored scenario "${failure.scenario}" — ignored`,
				);
				continue;
			}
			const note = failure.details ?? DEFAULT_NOTE;
			if (failure.agent !== undefined) {
				const existing = body.agents[failure.agent] ?? {};
				body.agents[failure.agent] = {
					...existing,
					error: combine(existing.error, note),
				};
			} else {
				body.error = combine(body.error, note);
			}
			body.pass = false;
			changed = true;
		}
		return changed;
	}

	// Coarse failure: no scenarios named, so fail everything that ran.
	const note = verification.details ?? DEFAULT_NOTE;
	for (const name of ranScenarioNames) {
		const body = report.scenarios[name];
		if (body === undefined || !("agents" in body)) continue;
		body.error = combine(body.error, note);
		body.pass = false;
		changed = true;
	}
	return changed;
}

function combine(existing: string | undefined, note: string): string {
	return existing !== undefined && existing.length > 0
		? `${existing}; ${note}`
		: note;
}
