/**
 * Parse a single JSON object out of an agent's final text, tolerating one
 * leading/trailing Markdown code fence. Judge-agnostic: it does NOT validate
 * any particular payload shape — callers are responsible for that.
 *
 * Returns the parsed object, or `undefined` when the text is not parseable as
 * JSON or does not parse to a non-null object (arrays, `null`, and scalars all
 * yield `undefined`).
 */
export function parseAgentJson(finalText: string): object | undefined {
	const trimmed = finalText.trim();
	const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
	const jsonText = fence?.[1] ?? trimmed;
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") return undefined;
	return parsed;
}
