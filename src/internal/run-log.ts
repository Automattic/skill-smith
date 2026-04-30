import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogEntry =
	| { kind: "header"; line: string }
	| { kind: "section"; title: string }
	| { kind: "info"; line: string }
	| {
			kind: "hook";
			hook: string;
			scope: string;
			outcome: "invoked" | "noop" | "error";
			detail?: string;
	  }
	| { kind: "gap"; category: string; value: unknown };

/**
 * In-memory accumulator for the run log (per run.md §8). Dumped to
 * `${runDirectory}run.log` at the end of the run. Hook outcomes are
 * recorded as `invoked | noop | error` per V8.
 */
export class RunLog {
	private readonly entries: LogEntry[] = [];
	private readonly gaps: Record<string, unknown[]> = {};

	header(line: string): void {
		this.entries.push({ kind: "header", line });
	}

	section(title: string): void {
		this.entries.push({ kind: "section", title });
	}

	info(line: string): void {
		this.entries.push({ kind: "info", line });
	}

	hook(
		hook: string,
		scope: string,
		outcome: "invoked" | "noop" | "error",
		detail?: string,
	): void {
		this.entries.push({ kind: "hook", hook, scope, outcome, detail });
	}

	gap(category: string, value: unknown): void {
		const bucket = this.gaps[category] ?? [];
		bucket.push(value);
		this.gaps[category] = bucket;
		this.entries.push({ kind: "gap", category, value });
	}

	getGaps(): Record<string, unknown[]> {
		return this.gaps;
	}

	render(): string {
		const lines: string[] = [];
		for (const entry of this.entries) {
			switch (entry.kind) {
				case "header":
					lines.push(`# ${entry.line}`);
					break;
				case "section":
					lines.push("", `## ${entry.title}`);
					break;
				case "info":
					lines.push(entry.line);
					break;
				case "hook": {
					const detail = entry.detail ? ` — ${entry.detail}` : "";
					lines.push(
						`hook[${entry.scope}] ${entry.hook}: ${entry.outcome}${detail}`,
					);
					break;
				}
				case "gap":
					lines.push(
						`gap[${entry.category}] ${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}`,
					);
					break;
			}
		}
		lines.push("");
		return lines.join("\n");
	}

	dump(runDirectory: string): string {
		const target = join(runDirectory, "run.log");
		mkdirSync(dirname(target), { recursive: true });
		const text = this.render();
		writeFileSync(target, text);
		return target;
	}
}
