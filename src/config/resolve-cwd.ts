import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDirectorySafe } from "../util/fs";

export const CONFIG_FILENAME = "skillsmith.config.ts";

export interface ResolveCwdResult {
	projectRoot: string;
}

/**
 * Locate the project-under-test root.
 *
 * - If `${cwd}/skillsmith.config.ts` exists → already there.
 * - Else, if exactly one immediate child directory contains it → use that.
 * - Else throw with the list of paths that were checked.
 */
export function resolveProjectRoot(
	startCwd: string = process.cwd(),
): ResolveCwdResult {
	const here = resolve(startCwd);
	if (existsSync(join(here, CONFIG_FILENAME))) {
		return { projectRoot: here };
	}

	const candidates: string[] = [];
	let entries: string[] = [];
	try {
		entries = readdirSync(here);
	} catch {
		entries = [];
	}
	for (const entry of entries) {
		const childPath = join(here, entry);
		if (!isDirectorySafe(childPath)) continue;
		if (existsSync(join(childPath, CONFIG_FILENAME))) {
			candidates.push(childPath);
		}
	}

	if (candidates.length === 1) {
		const projectRoot = candidates[0];
		if (projectRoot !== undefined) return { projectRoot };
	}

	const reasons: string[] = [];
	reasons.push(`No ${CONFIG_FILENAME} found at ${here}.`);
	if (candidates.length === 0) {
		reasons.push(`No immediate child of ${here} contains ${CONFIG_FILENAME}.`);
	} else {
		reasons.push(
			`Ambiguous: multiple children contain ${CONFIG_FILENAME}: ${candidates.join(", ")}`,
		);
	}
	throw new PreconditionError(reasons);
}

export class PreconditionError extends Error {
	readonly reasons: string[];
	constructor(reasons: string[]) {
		super(`skillsmith: precondition failed\n  - ${reasons.join("\n  - ")}`);
		this.name = "PreconditionError";
		this.reasons = reasons;
	}
}
