/**
 * Pipeline orchestrator. Filled in incrementally by SPEC.md §T tasks.
 *
 * The runner ({@link ../runner.ts}) hands off here once the project
 * root is resolved and a `runId` has been picked. Each subsequent task
 * (T2 config loader, T5 scenario enum, T6 scenario loop, etc.) plugs
 * its piece in here.
 */
export interface PipelineParams {
	projectRoot: string;
	runId: string;
}

export async function runPipeline(_params: PipelineParams): Promise<number> {
	throw new Error("pipeline: not yet implemented (filled in by T2+)");
}
