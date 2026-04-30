/**
 * Generate a `YYYYMMDD-HHMMSS` run id (per V6) from the local clock.
 */
export function makeRunId(now: Date = new Date()): string {
	const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
	const y = now.getFullYear();
	const mo = pad(now.getMonth() + 1);
	const d = pad(now.getDate());
	const h = pad(now.getHours());
	const mi = pad(now.getMinutes());
	const s = pad(now.getSeconds());
	return `${y}${mo}${d}-${h}${mi}${s}`;
}
