import assert from "node:assert/strict";
import { test } from "node:test";
import type { MisconfigReason } from "../config/misconfig";
import { MisconfigLedger } from "../config/misconfig-ledger";

// A representative reason reused across cases; the ledger is agnostic to which
// kind it stores, so any one stands in for all.
const REASON: MisconfigReason = { kind: "invalid-credential", status: 401 };
const OTHER_REASON: MisconfigReason = {
	kind: "missing-credential",
	envVar: "OPENAI_API_KEY",
};

test("a fresh ledger reports has() false and empty preflight()/all()", () => {
	const ledger = new MisconfigLedger();
	assert.equal(ledger.has("a"), false);
	assert.equal(ledger.preflight().size, 0);
	assert.equal(ledger.all().size, 0);
});

test("record adds an entry visible via has() and all()", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	assert.equal(ledger.has("a"), true);
	const entry = ledger.all().get("a");
	assert.deepEqual(entry, { id: "a", roles: ["test"], reason: REASON });
});

test("recording the same id twice unions the roles into one entry (AC10)", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	ledger.record("a", ["improver"], REASON);
	assert.equal(ledger.all().size, 1);
	const roles = ledger.all().get("a")?.roles ?? [];
	assert.deepEqual([...roles].sort(), ["improver", "test"]);
});

test("re-recording a role already present does not duplicate it", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["judge"], REASON);
	ledger.record("a", ["judge"], REASON);
	assert.deepEqual(ledger.all().get("a")?.roles, ["judge"]);
});

test("the first recorded reason wins; a later runtime record is a no-op on reason", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	ledger.record("a", ["judge"], OTHER_REASON);
	assert.deepEqual(ledger.all().get("a")?.reason, REASON);
});

test("a record of multiple roles at once stores them all", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test", "judge"], REASON);
	assert.deepEqual([...(ledger.all().get("a")?.roles ?? [])].sort(), [
		"judge",
		"test",
	]);
});

test("freezePreflight pins preflight() so later records appear only in all()", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	ledger.freezePreflight();

	ledger.record("b", ["judge"], OTHER_REASON);

	// `a` was present at the freeze boundary: in both views.
	assert.equal(ledger.preflight().has("a"), true);
	assert.equal(ledger.all().has("a"), true);
	// `b` was recorded after the freeze: only in the live view.
	assert.equal(ledger.preflight().has("b"), false);
	assert.equal(ledger.all().has("b"), true);
});

test("preflight() before freeze is empty even after records", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	// No freeze called yet: the pre-flight roster has not been pinned.
	assert.equal(ledger.preflight().size, 0);
});

test("a post-freeze record that merges roles into a pre-flight id leaves preflight() snapshot intact", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	ledger.freezePreflight();
	ledger.record("a", ["judge"], REASON);

	// The live view reflects the merged roles.
	assert.deepEqual([...(ledger.all().get("a")?.roles ?? [])].sort(), [
		"judge",
		"test",
	]);
	// The frozen pre-flight snapshot keeps only what was known at the boundary.
	assert.deepEqual(ledger.preflight().get("a")?.roles, ["test"]);
});

test("snapshot renders each id as a human-readable { reason, roles } object", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test", "improver"], REASON);
	ledger.record("b", ["judge"], OTHER_REASON);

	const snap = ledger.snapshot();
	assert.deepEqual(snap.a, {
		reason: "invalid-credential (HTTP 401)",
		roles: ["test", "improver"],
	});
	assert.deepEqual(snap.b, {
		reason: "OPENAI_API_KEY is not set",
		roles: ["judge"],
	});
});

test("snapshot reflects all() and grows with runtime records", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	ledger.freezePreflight();
	ledger.record("b", ["judge"], OTHER_REASON);

	const snap = ledger.snapshot();
	assert.deepEqual(Object.keys(snap).sort(), ["a", "b"]);
});

test("preflight() and all() are read-only views the caller cannot mutate", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test"], REASON);
	const view = ledger.all();
	assert.throws(() => {
		(view as Map<string, unknown>).set("x", {});
	});
});
