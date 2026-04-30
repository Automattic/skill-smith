import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type HookOutcome = "invoked" | "noop" | "error";

/**
 * In-memory accumulator for the run log (per run.md §8). Dumped to
 * `${runDirectory}run.log` at the end of the run. Hook outcomes are
 * recorded as `invoked | noop | error` per V8.
 */
export class RunLog {
	private readonly lines: string[] = [];

	header(line: string): void {
		this.lines.push(`# ${line}`);
	}

	section(title: string): void {
		this.lines.push("", `## ${title}`);
	}

	info(line: string): void {
		this.lines.push(line);
	}

	hook(
		hook: string,
		scope: string,
		outcome: HookOutcome,
		detail?: string,
	): void {
		const tail = detail ? ` — ${detail}` : "";
		this.lines.push(`hook[${scope}] ${hook}: ${outcome}${tail}`);
	}

	gap(category: string, value: unknown): void {
		const rendered = typeof value === "string" ? value : JSON.stringify(value);
		this.lines.push(`gap[${category}] ${rendered}`);
	}

	dump(runDirectory: string): string {
		const target = join(runDirectory, "run.log");
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${this.lines.join("\n")}\n`);
		return target;
	}
}
