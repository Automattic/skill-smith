import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	mergeIntoRunningReport,
	writeRunReport,
} from "../reports/iteration-report";
import type { ScenarioAgentEntry, ScenarioReport } from "../reports/scenario-report";

/** A PASS agent row. */
function pass(): ScenarioAgentEntry {
	return { review: { pass: true } };
}

/** A FAIL agent row. */
function fail(): ScenarioAgentEntry {
	return { review: { pass: false } };
}

/** A misconfigured-skip agent row (excluded from pass math). */
function misconfiguredSkip(): ScenarioAgentEntry {
	return { review: { skipped: "misconfigured: ANTHROPIC_API_KEY is not set" } };
}

/** An ordinary (non-misconfigured) skip agent row. */
function ordinarySkip(): ScenarioAgentEntry {
	return { review: { skipped: "testing failed: harness crashed" } };
}

/**
 * A `prev` running report that already holds scenario `s1`, so a `curr` `s1`
 * forces `mergeIntoRunningReport`'s agent-merge + recompute path (the branch
 * that calls `agentsAllPass`). With an absent `prev`, the merge copies `curr`
 * verbatim and never recomputes, so these cases must seed `prev`.
 */
function seededPrev(): Record<string, ScenarioReport | { error: string }> {
	return { s1: { scenario: "s1", pass: true, agents: { good: pass() } } };
}

test("merged scenario with surviving PASS plus a misconfigured-skip cell passes", () => {
	const curr: Record<string, ScenarioReport | { error: string }> = {
		s1: {
			scenario: "s1",
			// A literal that must be overwritten by the recomputed verdict.
			pass: false,
			agents: { broken: misconfiguredSkip() },
		},
	};

	const merged = mergeIntoRunningReport(seededPrev(), curr);
	const s1 = merged.s1 as ScenarioReport;
	assert.equal(s1.pass, true, "recomputed pass excludes the misconfigured skip");
});

test("merged scenario whose survivors are all misconfigured skips is not a pass", () => {
	// Seed prev with a misconfigured skip too, so every survivor is excluded.
	const merged = mergeIntoRunningReport(
		{ s1: { scenario: "s1", pass: false, agents: { a: misconfiguredSkip() } } },
		{
			s1: {
				scenario: "s1",
				pass: true,
				agents: { b: misconfiguredSkip() },
			},
		},
	);
	const s1 = merged.s1 as ScenarioReport;
	assert.equal(
		s1.pass,
		false,
		"an all-misconfigured-skip survivor set is not a pass",
	);
});

test("an ordinary skip survives the vote and fails the scenario", () => {
	const merged = mergeIntoRunningReport(seededPrev(), {
		s1: {
			scenario: "s1",
			pass: true,
			agents: { other: ordinarySkip() },
		},
	});
	const s1 = merged.s1 as ScenarioReport;
	assert.equal(
		s1.pass,
		false,
		"an ordinary (non-misconfigured) skip is a survivor and is not PASS",
	);
});

test("writeRunReport / scenariosAllPass treats an inconclusive scenario as non-PASS", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-iteration-report-"));
	const scenarios: Record<string, ScenarioReport | { error: string }> = {
		ok: { scenario: "ok", pass: true, agents: { good: pass() } },
		inconclusive: {
			scenario: "inconclusive",
			pass: false,
			agents: { broken: misconfiguredSkip() },
			inconclusive: { reason: "all-testers-misconfigured", agents: ["broken"] },
		},
	};

	const pass_ = writeRunReport(runDir, "run-1", scenarios);
	assert.equal(pass_, false, "a run with an inconclusive scenario is non-PASS");
});

test("writeRunReport returns PASS when every scenario passes over its surviving set", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-iteration-report-"));
	const scenarios: Record<string, ScenarioReport | { error: string }> = {
		a: { scenario: "a", pass: true, agents: { good: pass() } },
		b: { scenario: "b", pass: true, agents: { good: pass() } },
	};
	assert.equal(writeRunReport(runDir, "run-1", scenarios), true);
});

test("forward-only merge preserves an earlier PASS row absent from a later selection (KD7)", () => {
	// Iteration 1: agent `a` passes scenario s1.
	const prev: Record<string, ScenarioReport | { error: string }> = {
		s1: { scenario: "s1", pass: true, agents: { a: pass() } },
	};
	// Iteration 2: scenario s1 re-runs with only agent `b` (a is absent).
	const curr: Record<string, ScenarioReport | { error: string }> = {
		s1: { scenario: "s1", pass: true, agents: { b: pass() } },
	};

	const merged = mergeIntoRunningReport(prev, curr);
	const s1 = merged.s1 as ScenarioReport;
	assert.ok("a" in s1.agents, "agent a's earlier PASS row is retained");
	assert.ok("b" in s1.agents, "agent b's new row is present");
	assert.equal(s1.pass, true, "both surviving rows pass");
});

test("inconclusive field rides along when a ScenarioReport is carried forward by the merge", () => {
	const prev: Record<string, ScenarioReport | { error: string }> = {};
	const curr: Record<string, ScenarioReport | { error: string }> = {
		s1: {
			scenario: "s1",
			pass: false,
			agents: { broken: misconfiguredSkip() },
			inconclusive: { reason: "all-testers-misconfigured", agents: ["broken"] },
		},
	};
	const merged = mergeIntoRunningReport(prev, curr);
	const s1 = merged.s1 as ScenarioReport;
	assert.deepEqual(s1.inconclusive, {
		reason: "all-testers-misconfigured",
		agents: ["broken"],
	});
});

test("a clean run's in-memory verdict is identical to today (AC14)", () => {
	// No misconfigured skips anywhere: every scenario is plain PASS/FAIL.
	const merged = mergeIntoRunningReport(
		{ s1: { scenario: "s1", pass: true, agents: { a: pass() } } },
		{ s2: { scenario: "s2", pass: true, agents: { b: pass() } } },
	);
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-iteration-report-"));
	assert.equal(
		writeRunReport(runDir, "run-1", merged),
		true,
		"a clean all-PASS run is PASS",
	);

	// A clean run with a genuine FAIL stays FAIL exactly as before.
	const withFail = mergeIntoRunningReport(
		{},
		{ s1: { scenario: "s1", pass: false, agents: { a: pass(), b: fail() } } },
	);
	const s1 = withFail.s1 as ScenarioReport;
	assert.equal(s1.pass, false, "a surviving FAIL still fails the scenario");
	const runDir2 = mkdtempSync(join(tmpdir(), "skillsmith-iteration-report-"));
	assert.equal(writeRunReport(runDir2, "run-1", withFail), false);

	// The written report round-trips with the recomputed verdict.
	const parsed = JSON.parse(
		readFileSync(join(runDir2, "report.json"), "utf8"),
	) as { pass: boolean };
	assert.equal(parsed.pass, false);
});
