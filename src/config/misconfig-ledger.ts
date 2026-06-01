import { describeReason, type MisconfigReason } from "./misconfig";
import type { MisconfiguredEntry } from "./types";

/**
 * The role an agent fills in a run. A single agent id can fill more than one
 * role (e.g. it is both the test agent and an improver), which is why a ledger
 * entry carries an array rather than a single role.
 */
export type AgentRole = "test" | "judge" | "improver";

/**
 * One misconfigured agent as recorded in the run-scoped ledger.
 *
 *   - `id` — the agent id, the ledger's key.
 *   - `roles` — every role this id fills in the run; unioned across records so
 *     an id recorded once as a test agent and again as an improver lists both.
 *   - `reason` — why the agent was skipped, captured from the first record for
 *     this id (a pre-flight reason is not overwritten by a later runtime one).
 */
export interface SkippedAgent {
	id: string;
	roles: AgentRole[];
	reason: MisconfigReason;
}

/**
 * Run-scoped registry of every agent found misconfigured during a run, keyed by
 * agent id. It collects entries from two sources — the pre-flight probe (before
 * any dispatch) and runtime error classification (mid-run) — and exposes two
 * views over them:
 *
 *   - {@link preflight} — the entries known at the pre-flight boundary, frozen
 *     by {@link freezePreflight} so it never reflects later runtime additions.
 *   - {@link all} — every entry known so far, which grows as {@link record} is
 *     called.
 *
 * Entries are merged by id: recording an id more than once unions its roles
 * into a single entry and keeps the first reason recorded.
 */
export class MisconfigLedger {
	/** Live entries keyed by agent id; mutated by every {@link record} call. */
	private readonly entries = new Map<string, SkippedAgent>();

	/**
	 * The pre-flight roster, pinned by {@link freezePreflight}. `undefined` until
	 * the freeze happens, at which point {@link preflight} returns this snapshot
	 * instead of the empty default.
	 */
	private preflightView: ReadonlyMap<string, SkippedAgent> | undefined;

	/**
	 * Add or merge an agent into the ledger. A new id is inserted with the given
	 * roles and reason. An id already present has its roles unioned (each role is
	 * added at most once) while its reason is left unchanged — the first reason
	 * recorded wins, so a pre-flight verdict survives a later runtime record.
	 */
	record(id: string, roles: AgentRole[], reason: MisconfigReason): void {
		const existing = this.entries.get(id);
		if (existing === undefined) {
			this.entries.set(id, { id, roles: [...roles], reason });
			return;
		}
		for (const role of roles) {
			if (!existing.roles.includes(role)) {
				existing.roles.push(role);
			}
		}
	}

	/**
	 * True iff the given agent id has been recorded as misconfigured. The
	 * universal "should this agent be skipped?" predicate used by every caller.
	 */
	has(agentId: string): boolean {
		return this.entries.has(agentId);
	}

	/**
	 * Pin the current entry set as the pre-flight roster. Called once after the
	 * pre-flight probe seeds the ledger so {@link preflight} reflects exactly the
	 * boundary state and ignores any runtime records that follow. Idempotent in
	 * effect, though callers are expected to invoke it exactly once.
	 */
	freezePreflight(): void {
		this.preflightView = this.cloneFrozen();
	}

	/**
	 * The entries present at the pre-flight boundary, frozen by
	 * {@link freezePreflight}. Returns an empty map before the freeze; afterward
	 * it returns the pinned snapshot and never reflects later runtime additions.
	 */
	preflight(): ReadonlyMap<string, SkippedAgent> {
		return this.preflightView ?? new Map();
	}

	/**
	 * Every entry known so far — pre-flight plus runtime. The returned map is a
	 * frozen, read-only copy that reflects the ledger at call time and does not
	 * track subsequent {@link record} calls.
	 */
	all(): ReadonlyMap<string, SkippedAgent> {
		return this.cloneFrozen();
	}

	/**
	 * Snapshot the current {@link all} set into the keyed-by-id, human-readable
	 * shape the hook context and CLI roster consume: each id maps to a
	 * {@link MisconfiguredEntry} carrying the rendered reason string (via
	 * {@link describeReason}) and the full role list.
	 */
	snapshot(): Record<string, MisconfiguredEntry> {
		const out: Record<string, MisconfiguredEntry> = {};
		for (const [id, entry] of this.entries) {
			out[id] = {
				reason: describeReason(entry.reason),
				roles: [...entry.roles],
			};
		}
		return out;
	}

	/**
	 * Build a frozen, deep-enough copy of the live entries: each entry's `roles`
	 * array is copied so callers cannot mutate the ledger's internal state, and
	 * the map itself is frozen so `set`/`delete` throw in strict mode.
	 */
	private cloneFrozen(): ReadonlyMap<string, SkippedAgent> {
		const copy = new Map<string, SkippedAgent>();
		for (const [id, entry] of this.entries) {
			copy.set(id, { ...entry, roles: [...entry.roles] });
		}
		return frozenMap(copy);
	}
}

/**
 * Wrap a map so its mutators throw, giving callers a genuinely read-only view.
 * `Object.freeze` does not block `Map.prototype.set`, so the structural mutators
 * are overridden to throw instead.
 */
function frozenMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
	const reject = (): never => {
		throw new TypeError("Cannot mutate a read-only ledger view");
	};
	map.set = reject;
	map.delete = reject;
	map.clear = reject;
	return map;
}
