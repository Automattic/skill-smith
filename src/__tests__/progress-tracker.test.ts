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

class FakeClock {
	t: number;
	constructor(start = 0) {
		this.t = start;
	}
	now = (): number => this.t;
	advance(ms: number): void {
		this.t += ms;
	}
}

function nextTick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

test("first event paints immediately in interactive mode", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 200,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? "", /scenarios/);
	assert.match(chunks[0] ?? "", /phases/);
});

test("throttle coalesces rapid events; trailing paint fires after delay", async () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [{ name: "s1", agentIds: ["sonnet", "opus"] }],
		},
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 50,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	assert.equal(chunks.length, 1, "first event paints");
	clock.advance(10);
	tracker.phaseStarted("s1", "opus", "testing");
	clock.advance(10);
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });
	assert.equal(chunks.length, 1, "throttled events coalesce");

	clock.advance(60);
	await new Promise((r) => setTimeout(r, 80));
	assert.equal(chunks.length, 2, "trailing paint after throttle window");
});

test("subsequent paints erase the prior block via cursor escape", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	const first = chunks[0] ?? "";
	const firstLines = first.replace(/\n$/, "").split("\n").length;

	clock.advance(1);
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 100,
	});

	const second = chunks[1] ?? "";
	const eraseRe = new RegExp(`^\\x1b\\[${firstLines}A\\x1b\\[0J`);
	assert.match(second, eraseRe);
});

test("erase prefix counts wrapped terminal rows, not logical lines", () => {
	const { stream, chunks } = captureStream();
	Object.assign(stream, { isTTY: true, columns: 40 });
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "failed",
		detail: "x".repeat(200),
	});
	const first = chunks.at(-1) ?? "";
	const logicalLines = first.replace(/\n$/, "").split("\n").length;

	clock.advance(1);
	tracker.phaseStarted("s1", "sonnet", "judge");
	const second = chunks.at(-1) ?? "";

	// biome-ignore lint/suspicious/noControlCharactersInRegex: asserts a repaint starts with real ANSI cursor-up + erase-display escapes; the ESC byte (0x1b) is the intended content.
	const match = second.match(/^\x1b\[(\d+)A\x1b\[0J/);
	assert.ok(match, "second paint must start with cursor-up + erase");
	const eraseRows = Number(match[1]);
	assert.ok(
		eraseRows > logicalLines,
		`erase rows (${eraseRows}) must exceed logical lines (${logicalLines}) when a detail wraps`,
	);
});

test("seeded skippedAgents ride the first paint, surviving beginIteration", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [{ name: "s1", agentIds: ["sonnet"] }],
			skippedAgents: [{ id: "gpt", reason: "OPENAI_API_KEY is not set" }],
		},
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 200,
			tickMs: 0,
			now: clock.now,
		},
	);

	// The real first paint comes from beginIteration; the seeded list must
	// survive that exact call (proving it is not cleared on the reset).
	tracker.beginIteration(1, 1);
	assert.equal(chunks.length, 1, "beginIteration drives the first paint");
	assert.match(chunks[0] ?? "", /SKIPPED AGENTS/);
	assert.match(chunks[0] ?? "", /gpt: OPENAI_API_KEY is not set/);
});

test("repaint erase count covers the block including the skip rows", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [{ name: "s1", agentIds: ["sonnet"] }],
			skippedAgents: [{ id: "gpt", reason: "OPENAI_API_KEY is not set" }],
		},
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	const first = chunks[0] ?? "";
	assert.match(first, /SKIPPED AGENTS/);
	const firstRows = first.replace(/\n$/, "").split("\n").length;

	clock.advance(1);
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "passed",
		durationMs: 100,
	});

	const second = chunks[1] ?? "";
	// biome-ignore lint/suspicious/noControlCharactersInRegex: asserts a repaint starts with real ANSI cursor-up + erase-display escapes; the ESC byte (0x1b) is the intended content.
	const match = second.match(/^\x1b\[(\d+)A\x1b\[0J/);
	assert.ok(match, "second paint must start with cursor-up + erase");
	const eraseRows = Number(match[1]);
	// The first block carried the SKIPPED AGENTS section, so the erase prefix
	// must walk up over every one of its rows (header, bars, elapsed, blank,
	// "SKIPPED AGENTS", and the gpt row) — not just the bars.
	assert.ok(
		eraseRows >= firstRows,
		`erase rows (${eraseRows}) must cover the full first block including skip rows (${firstRows})`,
	);
});

test("no seeded skippedAgents: no SKIPPED AGENTS section on any paint", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(1000);
	const tracker = new ProgressTracker(
		// skippedAgents omitted — defaults to [].
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.beginIteration(1, 1);
	tracker.phaseStarted("s1", "sonnet", "testing");
	clock.advance(1);
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });

	assert.doesNotMatch(chunks.join(""), /SKIPPED AGENTS/);
});

test("non-interactive mode writes only the final block on finish", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: false, throttleMs: 0 },
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });
	tracker.phaseStarted("s1", "sonnet", "judge");
	tracker.phaseFinished("s1", "sonnet", "judge", { status: "passed" });
	await nextTick();
	assert.equal(chunks.length, 0, "no mid-run output in non-interactive mode");

	tracker.finish();
	assert.equal(chunks.length, 1, "single final paint");
	assert.match(chunks[0] ?? "", /scenarios.*1\/1/);
});

test("failed phases push onto the failures list", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: false, throttleMs: 0 },
	);

	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "failed",
		detail: "rubric x not pass",
	});
	tracker.phaseFinished("s1", "sonnet", "judge", { status: "passed" });
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /failures \(1\):/);
	assert.match(out, /✗ s1 {2}sonnet {2}testing {2}rubric x not pass/);
});

test("scenarioSkipped is sticky and adds a failure row", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: false, throttleMs: 0 },
	);

	tracker.scenarioSkipped("s1", "rubric file missing");
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /scenarios.*skip 1/);
	assert.match(out, /✗ s1 {2}—.*rubric file missing/);
});

test("finish() always paints, even when throttled", () => {
	const { stream, chunks } = captureStream();
	const clock = new FakeClock(0);
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 1000,
			tickMs: 0,
			now: clock.now,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	clock.advance(10);
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });
	tracker.phaseStarted("s1", "sonnet", "judge");
	tracker.phaseFinished("s1", "sonnet", "judge", { status: "passed" });
	tracker.finish();

	assert.ok(chunks.length >= 2, "finish forces a paint inside throttle window");
	assert.match(chunks.at(-1) ?? "", /done/);
});

test("counters: scenario passes only when every phase is terminal-non-failed", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [
				{ name: "all-pass", agentIds: ["sonnet"] },
				{ name: "with-fail", agentIds: ["sonnet"] },
				{ name: "in-flight", agentIds: ["sonnet"] },
			],
		},
		{ stream, color: false, interactive: false, throttleMs: 0 },
	);

	tracker.phaseFinished("all-pass", "sonnet", "testing", { status: "passed" });
	tracker.phaseFinished("all-pass", "sonnet", "judge", { status: "passed" });
	tracker.phaseFinished("with-fail", "sonnet", "testing", {
		status: "failed",
		detail: "x",
	});
	tracker.phaseFinished("with-fail", "sonnet", "judge", { status: "passed" });
	tracker.phaseStarted("in-flight", "sonnet", "testing");
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /scenarios.*2\/3/);
	assert.match(out, /pass 1 · fail 1 · run 1/);
});

test("beginIteration resets phases, clears failures, and shows the iteration line", () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{
			runId: "r1",
			scenarios: [
				{ name: "s1", agentIds: ["sonnet"] },
				{ name: "s2", agentIds: ["sonnet"] },
			],
		},
		{ stream, color: false, interactive: false, throttleMs: 0 },
	);

	tracker.beginIteration(1, 3);
	tracker.phaseFinished("s1", "sonnet", "testing", {
		status: "failed",
		detail: "boom",
	});
	tracker.phaseFinished("s1", "sonnet", "judge", { status: "passed" });

	// Iteration 2 re-runs only the failing scenario; s2 drops out.
	tracker.beginIteration(2, 3, ["s1"]);
	tracker.phaseFinished("s1", "sonnet", "testing", { status: "passed" });
	tracker.phaseFinished("s1", "sonnet", "judge", { status: "passed" });
	tracker.finish();

	const out = chunks.join("");
	assert.match(out, /iteration 2\/3/);
	// Subset iteration counts only the active scenario.
	assert.match(out, /scenarios.*1\/1/);
	// Iteration 1's failure was cleared by the reset.
	assert.doesNotMatch(out, /failures/);
});

test("wall-clock tick repaints to refresh elapsed even with no events", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 25,
		},
	);

	tracker.phaseStarted("s1", "sonnet", "testing");
	const afterFirst = chunks.length;
	assert.equal(afterFirst, 1, "first event paints");

	await new Promise((r) => setTimeout(r, 90));
	tracker.finish();

	assert.ok(
		chunks.length >= afterFirst + 2,
		`expected wall-clock ticks to repaint while idle, got ${chunks.length} chunk(s)`,
	);
	assert.match(chunks.at(-1) ?? "", /done/);
});

test("tick is suppressed before the first event-driven paint", async () => {
	const { stream, chunks } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{
			stream,
			color: false,
			interactive: true,
			throttleMs: 0,
			tickMs: 15,
		},
	);

	await new Promise((r) => setTimeout(r, 60));
	assert.equal(
		chunks.length,
		0,
		"no paint before first event, even with ticks",
	);
	tracker.finish();
});

test("throws on unknown scenario", () => {
	const { stream } = captureStream();
	const tracker = new ProgressTracker(
		{ runId: "r1", scenarios: [{ name: "s1", agentIds: ["sonnet"] }] },
		{ stream, color: false, interactive: false },
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
		{ stream, color: false, interactive: false },
	);
	assert.throws(
		() => tracker.phaseStarted("s1", "haiku", "testing"),
		/unknown agent "haiku"/,
	);
});
