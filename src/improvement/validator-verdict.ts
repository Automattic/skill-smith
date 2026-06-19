/**
 * The validator verdict: its types and the pure parse/shape/fail-open
 * classifier. The validator inspects the revised skills for eval-corpus
 * leakage and returns either `approve` or a `revise` with findings.
 *
 * `classifyValidatorVerdict` owns BOTH extraction (`parseAgentJson`) and the
 * shape-check, folding parse + classify into one table so AC2's string-level
 * rows (non-JSON, fenced JSON) are coverable in a single pure function. This
 * differs from `classifyVerdict` (`reports/verdict.ts`), which takes an
 * already-parsed object — for the validator the two steps are folded so the
 * unit test can feed raw strings. See design-doc §7.2/§7.3.
 *
 * Fail-open is the safety posture (R8): anything that does not parse to a
 * well-shaped `revise` is treated as `approve` so a broken validator never
 * blocks the loop. `failedOpen` records when that happened.
 */
import { parseAgentJson } from "../util/parse-agent-json";

export interface ValidatorFinding {
	leak_type: "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case";
	span: string; // the actual offending substring
	why: string; // 1 line
	suggested_fix: string; // how to generalize
}

export interface ValidatorOutcome {
	verdict: "approve" | "revise";
	findings: ValidatorFinding[]; // empty on approve
	failedOpen: boolean; // true when error/unparseable/malformed forced approve (R8 evidence)
	transcriptPath: string;
}

/** The canonical fail-open / approve outcome: approve with no findings. */
function approve(failedOpen: boolean): Omit<ValidatorOutcome, "transcriptPath"> {
	return { verdict: "approve", findings: [], failedOpen };
}

/**
 * Classify the validator's raw final text into a verdict outcome via the
 * 5-row decision table (design-doc §7.3 — THIS IS AC2). Pure: no fs, no path.
 * The caller (`runValidator`, T9) fills `transcriptPath`.
 *
 * | # | Input                                        | Result            | failedOpen |
 * |---|----------------------------------------------|-------------------|------------|
 * | 1 | parseAgentJson → undefined (non-JSON)        | approve, []       | true       |
 * | 2 | parsed, verdict ∉ {approve, revise}          | approve, []       | true       |
 * | 3 | verdict "approve" (findings absent/empty)    | approve, []       | false      |
 * | 4 | verdict "revise" + non-empty findings array  | revise, [...]     | false      |
 * | 5 | verdict "revise" + empty/absent findings     | approve, []       | true       |
 *
 * Row 4 is LENIENT: a non-empty `findings` array is enough — a finding missing
 * `suggested_fix` does NOT fail open. Every approve outcome (rows 1, 2, 3, 5)
 * emits canonical `findings: []` even if the raw JSON carried stray findings,
 * keeping the loop's `verdict !== "revise"` break clean (§7.3).
 */
export function classifyValidatorVerdict(
	finalText: string,
): Omit<ValidatorOutcome, "transcriptPath"> {
	const parsed = parseAgentJson(finalText);
	if (parsed === undefined) return approve(true); // row 1

	const v = parsed as Record<string, unknown>;
	if (v.verdict !== "approve" && v.verdict !== "revise") return approve(true); // row 2
	if (v.verdict === "approve") return approve(false); // row 3

	// verdict === "revise": well-shaped only if findings is a non-empty array.
	const findings = v.findings;
	if (Array.isArray(findings) && findings.length > 0) {
		return { verdict: "revise", findings: findings as ValidatorFinding[], failedOpen: false }; // row 4
	}
	return approve(true); // row 5
}
