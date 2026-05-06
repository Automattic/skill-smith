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
