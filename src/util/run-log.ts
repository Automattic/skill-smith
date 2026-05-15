import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type HookOutcome = "invoked" | "noop" | "error";

export interface RunLogOptions {
	mirrorStderr?: boolean;
}

/**
 * In-memory accumulator for the run log. Optionally mirrored to stderr
 * (off by default; the progress tracker owns the live stderr view).
 * Dumped to `${runDirectory}/run.log` at the end as the authoritative
 * artifact regardless of the mirror setting.
 */
export class RunLog {
	private readonly lines: string[] = [];
	private readonly mirrorStderr: boolean;

	constructor(opts: RunLogOptions = {}) {
		this.mirrorStderr = opts.mirrorStderr ?? false;
	}

	private append(line: string): void {
		this.lines.push(line);
		if (this.mirrorStderr) process.stderr.write(`${line}\n`);
	}

	header(line: string): void {
		this.append(`# ${line}`);
	}

	section(title: string): void {
		this.append("");
		this.append(`## ${title}`);
	}

	info(line: string): void {
		this.append(line);
	}

	hook(
		hook: string,
		scope: string,
		outcome: HookOutcome,
		detail?: string,
	): void {
		const tail = detail ? ` — ${detail}` : "";
		this.append(`hook[${scope}] ${hook}: ${outcome}${tail}`);
	}

	gap(category: string, value: unknown): void {
		const rendered = typeof value === "string" ? value : JSON.stringify(value);
		this.append(`gap[${category}] ${rendered}`);
	}

	dump(runDirectory: string): string {
		const target = join(runDirectory, "run.log");
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${this.lines.join("\n")}\n`);
		return target;
	}
}
