import { PreconditionError, resolveProjectRoot } from "./internal/cwd";
import { makeRunId } from "./internal/run-id";

export interface RunOptions {
	cwd?: string;
}

/**
 * Entrypoint for the `skillsmith` CLI. Returns a process exit code.
 *
 * The runner is being built incrementally per SPEC.md §T. T1 wires
 * cwd-resolve, runId derivation, and a delegate to the pipeline module
 * (filled in by T2–T14). On precondition failure it prints the reason
 * list and exits 1, per V21.
 */
export async function run(options: RunOptions = {}): Promise<number> {
	let projectRoot: string;
	try {
		({ projectRoot } = resolveProjectRoot(options.cwd ?? process.cwd()));
	} catch (err) {
		if (err instanceof PreconditionError) {
			console.error(err.message);
			return 1;
		}
		throw err;
	}

	const runId = makeRunId();
	const { runPipeline } = await import("./internal/pipeline");
	return await runPipeline({ projectRoot, runId });
}
