import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isGitWorkTree } from "../improvement/git";

const here = dirname(fileURLToPath(import.meta.url));

test("isGitWorkTree is true inside the repo", () => {
	assert.equal(isGitWorkTree(here), true);
});

test("isGitWorkTree is false for a directory outside any repo", () => {
	const dir = mkdtempSync(join(tmpdir(), "skillsmith-nogit-"));
	try {
		assert.equal(isGitWorkTree(dir), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("isGitWorkTree is true after git init", () => {
	const dir = mkdtempSync(join(tmpdir(), "skillsmith-git-"));
	try {
		execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
		assert.equal(isGitWorkTree(dir), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
