import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentJson } from "../util/parse-agent-json";

test("parses bare JSON object", () => {
	assert.deepEqual(parseAgentJson('{"a": 1}'), { a: 1 });
});

test("parses one-fence-wrapped JSON object", () => {
	const fenced = '```json\n{"a": 1}\n```';
	assert.deepEqual(parseAgentJson(fenced), { a: 1 });
});

test("parses fence without a language tag", () => {
	const fenced = '```\n{"a": 1}\n```';
	assert.deepEqual(parseAgentJson(fenced), { a: 1 });
});

test("trims surrounding whitespace before parsing", () => {
	assert.deepEqual(parseAgentJson('  \n{"a": 1}\n  '), { a: 1 });
});

test("returns undefined for non-JSON text", () => {
	assert.equal(parseAgentJson("not json at all"), undefined);
});

test("returns undefined for malformed JSON", () => {
	assert.equal(parseAgentJson('{"a": 1'), undefined);
});

test("returns the array for a JSON array (typeof is object)", () => {
	// Mirrors the lifted judge behavior: the `typeof !== "object"` guard does
	// not reject arrays, so a top-level array parses through. Callers that need
	// a plain object must validate the shape themselves.
	assert.deepEqual(parseAgentJson("[1, 2, 3]"), [1, 2, 3]);
});

test("returns undefined for JSON null", () => {
	assert.equal(parseAgentJson("null"), undefined);
});

test("returns undefined for a JSON scalar", () => {
	assert.equal(parseAgentJson("42"), undefined);
});
