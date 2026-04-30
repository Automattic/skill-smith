import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type HookOutcome = "invoked" | "noop" | "error";

/**
 * In-memory accumulator for the run log (per run.md §8). Dumped to
 * `${runDirectory}run.log` at the end of the run. Hook outcomes are
 * recorded as `invoked | noop | error` per V8.
 *
 * Lines are also mirrored to stderr as they are appended so the user
 * sees live progress during long SDK queries; the dump on disk is the
 * authoritative artifact, the stderr stream is a tail.
 */
export class RunLog {
	private readonly lines: string[] = [];

	private append(line: string): void {
		this.lines.push(line);
		process.stderr.write(`${line}\n`);
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
