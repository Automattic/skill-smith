import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { ProgressTracker } from "../progress/tracker";

function captureStream(): { stream: Writable; chunks: string[] } {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(chunk.toString());
			cb();
		},
	});
	return { stream, chunks };
}

function nextTick(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(() => resolve());
	});
}

test("schedules a repaint after a state change", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	assert.equal(chunks.length, 0, "should not write synchronously");

	await nextTick();
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? "", /testing ◐/);
});

test("coalesces multiple synchronous changes into one repaint", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [{ name: "s1", agentIds: ["sonnet", "opus"] }],
		},
		{ stream, color: false },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	tracker.phaseStarted("s1", "opus", "testing");
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 100,
	});

	await nextTick();
	assert.equal(chunks.length, 1, "expected single coalesced repaint");
});

test("finish() flushes synchronously and cancels the pending repaint", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	tracker.finish();
	assert.equal(chunks.length, 1, "expected synchronous flush");

	await nextTick();
	assert.equal(chunks.length, 1, "pending repaint should have been cancelled");
});

test("renders skipped scenario with reason and no agent rows", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.scenarioSkipped("s1", "rubric file missing");
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /⊘ s1 {2}· {2}rubric file missing/);
	assert.doesNotMatch(out, /sonnet/);
});

test("any failed phase makes the scenario fail, even if others pass", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "failed",
		detail: "boom",
	});
	tracker.phaseFinished("s1", "sonnet", "judge", {
		status: "passed",
		durationMs: 50,
	});
	tracker.finish();

	assert.match(chunks.join(""), /✗ s1/);
});

test("full happy path renders passed scenario with durations", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 100,
	});
	tracker.phaseStarted("s1", "sonnet", "judge");
	tracker.phaseFinished("s1", "sonnet", "judge", {
		status: "passed",
		durationMs: 50,
	});
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /✓ s1/);
	assert.match(out, /testing ✓ 100ms/);
	assert.match(out, /judge ✓ 50ms/);
});

test("scenarioSkipped wins over later phase events (sticky)", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	tracker.scenarioSkipped("s1", "no rubrics");
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 10,
	});
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /⊘ s1 {2}· {2}no rubrics/);
});

test("interactive mode: first paint omits leading newline", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: true },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	await nextTick();

	assert.equal(chunks.length, 1);
	assert.ok(
		!chunks[0]?.startsWith("\n"),
		"first interactive paint should not lead with a blank line",
	);
	assert.ok(
		!chunks[0]?.startsWith("\x1b["),
		"first paint has no prior block to erase",
	);
});

test("interactive mode: subsequent paints erase the prior block in place", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: true },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	await nextTick();
	const firstPaint = chunks[0] ?? "";
	const firstLineCount = firstPaint.replace(/\n$/, "").split("\n").length;

	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 100,
	});
	await nextTick();

	assert.equal(chunks.length, 2);
	const second = chunks[1] ?? "";
	const eraseRe = new RegExp(`^\\x1b\\[${firstLineCount}A\\x1b\\[0J`);
	assert.match(second, eraseRe);
});

test("non-interactive mode keeps appending with leading newline", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: false },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	await nextTick();
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 10,
	});
	await nextTick();

	assert.equal(chunks.length, 2);
	for (const c of chunks) {
		assert.ok(c.startsWith("\n"), "non-interactive paints lead with newline");
		assert.ok(
			!c.includes("\x1b["),
			"non-interactive paints emit no cursor escapes",
		);
	}
});

test("throws on unknown scenario", () => {
	const { stream } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	assert.throws(
		() => tracker.phaseStarted("nope", "sonnet", "testing"),
		/unknown scenario "nope"/,
	);
});

test("throws on unknown agent", () => {
	const { stream } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false },
	);

	assert.throws(
		() => tracker.phaseStarted("s1", "haiku", "testing"),
		/unknown agent "haiku"/,
	);
});
