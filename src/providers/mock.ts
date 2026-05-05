import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvokeParams, InvokeResult, Provider } from "./types";

/**
 * Deterministic provider used by tests and dry runs. Simulates the two
 * sub-agent shapes by inspecting the tool set: Write present → testing
 * agent, drops a sentinel file in cwd; Read-only → judge, returns a
 * passing YAML verdict.
 */
export const mockProvider: Provider = {
	id: "mock",
	async invoke(params: InvokeParams): Promise<InvokeResult> {
		const isTesting = params.tools.includes("Write");
		if (isTesting) {
			writeFileSync(
				join(params.cwd, "mock-output.txt"),
				`mock testing output for ${params.agent.id}\n`,
			);
			return { finalText: `mock testing output for ${params.agent.id}`, toolUseCount: 0 };
		}
		const yaml = [
			"rubrics:",
			"  r1:",
			"    pass: true",
			"    notes: mock",
			"acceptance:",
			'  - item: "mock acceptance"',
			"    pass: true",
			"    notes: mock",
		].join("\n");
		return { finalText: yaml, toolUseCount: 0 };
	},
};
