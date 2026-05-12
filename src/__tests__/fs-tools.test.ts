import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fsTools } from "../providers/lib/fs-tools";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "fs-tools-test-"));
}

async function exec(
	tools: ReturnType<typeof fsTools>,
	name: string,
	input: unknown,
) {
	const t = tools[name];
	if (!t || typeof t.execute !== "function") {
		throw new Error(`tool ${name} has no execute callback`);
	}
	return await t.execute(
		// biome-ignore lint/suspicious/noExplicitAny: opaque tool input type
		input as any,
		// biome-ignore lint/suspicious/noExplicitAny: opaque tool-call options
		{ toolCallId: "t", messages: [] } as any,
	);
}

test("Read returns file contents inside cwd", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "hello.txt"), "hi there");
	const tools = fsTools(cwd, "testing");
	const out = await exec(tools, "Read", { path: "hello.txt" });
	assert.equal(out, "hi there");
});

test("Read rejects paths that escape cwd", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Read", { path: "../escape.txt" }),
		/path escapes workspace/,
	);
	await assert.rejects(
		() => exec(tools, "Read", { path: "/etc/passwd" }),
		/path escapes workspace/,
	);
});

test("Read throws on missing file", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	await assert.rejects(() => exec(tools, "Read", { path: "missing.txt" }));
});

test("Write creates parent directories and overwrites", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	const out = await exec(tools, "Write", {
		path: "nested/dir/out.txt",
		contents: "v1",
	});
	assert.equal(out, "ok");
	assert.equal(readFileSync(join(cwd, "nested/dir/out.txt"), "utf8"), "v1");
	await exec(tools, "Write", { path: "nested/dir/out.txt", contents: "v2" });
	assert.equal(readFileSync(join(cwd, "nested/dir/out.txt"), "utf8"), "v2");
});

test("Write rejects paths that escape cwd", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Write", { path: "../escape.txt", contents: "x" }),
		/path escapes workspace/,
	);
});

test("Edit replaces the first (and only) occurrence", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "file.txt"), "alpha beta gamma");
	const tools = fsTools(cwd, "testing");
	const out = await exec(tools, "Edit", {
		path: "file.txt",
		old: "beta",
		new: "BETA",
	});
	assert.equal(out, "ok");
	assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "alpha BETA gamma");
});

test("Edit throws when pattern occurs zero times", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "f.txt"), "hello");
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Edit", { path: "f.txt", old: "absent", new: "x" }),
		/pattern not found/,
	);
});

test("Edit throws when pattern occurs multiple times", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "f.txt"), "foo foo foo");
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Edit", { path: "f.txt", old: "foo", new: "bar" }),
		/ambiguous/,
	);
});

test("Edit throws when old and new are identical", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "f.txt"), "stuff");
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Edit", { path: "f.txt", old: "stuff", new: "stuff" }),
		/no-op edit/,
	);
});

test("Glob returns relative matches sorted by mtime desc", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "old.ts"), "1");
	writeFileSync(join(cwd, "new.ts"), "2");
	utimesSync(join(cwd, "old.ts"), new Date(2000, 0, 1), new Date(2000, 0, 1));
	utimesSync(join(cwd, "new.ts"), new Date(2025, 0, 1), new Date(2025, 0, 1));
	const tools = fsTools(cwd, "testing");
	const out = await exec(tools, "Glob", { pattern: "*.ts" });
	const lines = String(out).split("\n").filter(Boolean);
	assert.deepEqual(lines, ["new.ts", "old.ts"]);
});

test("Glob caps results at 500", async () => {
	const cwd = makeCwd();
	for (let i = 0; i < 510; i++) {
		writeFileSync(join(cwd, `f${i}.txt`), String(i));
	}
	const tools = fsTools(cwd, "testing");
	const out = String(await exec(tools, "Glob", { pattern: "*.txt" }));
	const lines = out.split("\n").filter(Boolean);
	assert.equal(lines.length, 501);
	assert.match(lines[lines.length - 1] ?? "", /truncated at 500/);
});

test("Grep returns path:line:content matches", async () => {
	const cwd = makeCwd();
	writeFileSync(join(cwd, "a.txt"), "alpha\nneedle here\nzulu");
	writeFileSync(join(cwd, "b.txt"), "needle again");
	const tools = fsTools(cwd, "testing");
	const out = String(await exec(tools, "Grep", { pattern: "needle" }));
	const lines = out.split("\n").filter(Boolean).sort();
	assert.deepEqual(lines, ["a.txt:2:needle here", "b.txt:1:needle again"]);
});

test("Grep caps at 200 lines", async () => {
	const cwd = makeCwd();
	const body = Array.from({ length: 250 }, () => "match").join("\n");
	writeFileSync(join(cwd, "big.txt"), body);
	const tools = fsTools(cwd, "testing");
	const out = String(await exec(tools, "Grep", { pattern: "match" }));
	const lines = out.split("\n").filter(Boolean);
	assert.equal(lines.length, 201);
	assert.match(lines[lines.length - 1] ?? "", /truncated at 200/);
});

test("Bash returns combined stdout/stderr", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	const out = String(
		await exec(tools, "Bash", { command: "printf hello && printf world 1>&2" }),
	);
	assert.match(out, /hello/);
});

test("Bash throws on non-zero exit and includes output", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Bash", { command: "echo before && exit 7" }),
		/exit=7/,
	);
});

test("Bash throws on timeout", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	await assert.rejects(
		() => exec(tools, "Bash", { command: "sleep 5", timeoutMs: 50 }),
		/Bash failed/,
	);
});

test("All testing tools refuse '..' traversal and absolute paths", async () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	const cases: Array<[string, unknown]> = [
		["Read", { path: "../x" }],
		["Write", { path: "../x", contents: "y" }],
		["Edit", { path: "../x", old: "a", new: "b" }],
	];
	for (const [name, input] of cases) {
		await assert.rejects(
			() => exec(tools, name, input),
			/path escapes workspace/,
			`${name} should refuse traversal`,
		);
	}
	const absCases: Array<[string, unknown]> = [
		["Read", { path: "/etc/passwd" }],
		["Write", { path: "/tmp/x", contents: "y" }],
	];
	for (const [name, input] of absCases) {
		await assert.rejects(
			() => exec(tools, name, input),
			/path escapes workspace/,
			`${name} should refuse absolute paths`,
		);
	}
});

test("Judge role exposes only Read", () => {
	const cwd = makeCwd();
	mkdirSync(join(cwd, "sub"));
	const tools = fsTools(cwd, "judge");
	assert.deepEqual(Object.keys(tools).sort(), ["Read"]);
});

test("Testing role exposes the full toolset", () => {
	const cwd = makeCwd();
	const tools = fsTools(cwd, "testing");
	assert.deepEqual(Object.keys(tools).sort(), [
		"Bash",
		"Edit",
		"Glob",
		"Grep",
		"Read",
		"Write",
	]);
});
