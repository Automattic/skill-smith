import { execFileSync } from "node:child_process";

/**
 * True when `dir` sits inside a git work tree. The self-improvement
 * loop captures `skills.diff` via `git diff`, so loop mode requires a
 * repo; the pipeline checks this upfront to fail with a friendly
 * message instead of producing an empty diff mid-cycle.
 */
export function isGitWorkTree(dir: string): boolean {
	try {
		const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim() === "true";
	} catch {
		return false;
	}
}
