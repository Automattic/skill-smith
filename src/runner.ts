import { PreconditionError, resolveProjectRoot } from "./internal/cwd";
import { runPipeline } from "./internal/pipeline";

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
 * Entrypoint for the `skillsmith` CLI. Returns a process exit code.
 * On precondition failure prints the reason list and exits 1 (V21).
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
