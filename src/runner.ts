import { PreconditionError, resolveProjectRoot } from "./config/resolve-cwd";
import { runPipeline } from "./pipeline/pipeline";

export interface RunOptions {
	cwd?: string;
}

function makeRunId(now: Date = new Date()): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	);
}

/**
 * Entrypoint for the `skillsmith` CLI. Returns a process exit code:
 * 0 on all-pass, 1 on any failure or precondition error.
 */
export async function run(options: RunOptions = {}): Promise<number> {
	try {
		const { projectRoot } = resolveProjectRoot(options.cwd ?? process.cwd());
		return await runPipeline({ projectRoot, runId: makeRunId() });
	} catch (err) {
		if (err instanceof PreconditionError) {
			console.error(err.message);
			return 1;
		}
		throw err;
	}
}
