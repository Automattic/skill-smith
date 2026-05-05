import { statSync } from "node:fs";

/**
 * `statSync(p).isDirectory()` with the EACCES/ENOENT surface area
 * collapsed to `false`. Used by directory walks where the only question
 * is "should I descend into this entry".
 */
export function isDirectorySafe(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}
