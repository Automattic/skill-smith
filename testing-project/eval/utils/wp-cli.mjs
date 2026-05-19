import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function wpCli(args, options = {}) {
	return execFileSync("npx", ["wp-env", "run", "cli", "wp", ...args], {
		cwd: PROJECT_ROOT,
		stdio: options.stdio ?? "inherit",
		encoding: "utf8",
	});
}

export function deactivateAllPlugins() {
	try {
		wpCli(["plugin", "deactivate", "--all", "--quiet"], { stdio: "pipe" });
	} catch (err) {
		if (err.stdout) process.stdout.write(err.stdout);
		if (err.stderr) process.stderr.write(err.stderr);
		throw err;
	}
}
