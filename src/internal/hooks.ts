import type { HookFn } from "../config/types";
import type { RunLog } from "./run-log";

/**
 * Try-fire a project hook. The harness never crashes on a hook —
 * undefined hooks are recorded as `noop`, throwing hooks as `error`,
 * everything else as `invoked` (V8). Always-fire semantics for
 * `after*` hooks (V9) come from the call site running this in a
 * `finally` block.
 */
export async function tryHook<Ctx>(
	name: string,
	scope: string,
	fn: HookFn<Ctx> | undefined,
	ctx: Ctx,
	log: RunLog,
): Promise<void> {
	if (fn === undefined) {
		log.hook(name, scope, "noop");
		return;
	}
	try {
		await fn(ctx);
		log.hook(name, scope, "invoked");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.hook(name, scope, "error", message);
	}
}
