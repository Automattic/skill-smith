import assert from "node:assert/strict";
import { test } from "node:test";
import { MisconfigLedger } from "../config/misconfig-ledger";
import type { MisconfiguredEntry, RunContext } from "../config/types";

// Task 3: `RunContext.misconfigured` is a required, read-only record of
// id -> { reason, roles }. These tests pin the type contract: a clean run
// carries `{}`, and the ledger snapshot structurally satisfies the field
// with no cast (the property below is typed exactly as the field).

test("a clean run carries an empty misconfigured object (AC14)", () => {
	const misconfigured: RunContext["misconfigured"] = {};
	assert.deepEqual(misconfigured, {});
});

test("the ledger snapshot structurally satisfies RunContext.misconfigured (no cast)", () => {
	const ledger = new MisconfigLedger();
	ledger.record("a", ["test", "improver"], {
		kind: "invalid-credential",
		status: 401,
	});

	// The snapshot is assigned directly into the field's type — if the ledger's
	// `MisconfiguredEntry` diverged from the canonical one in types.ts, this
	// assignment would fail to typecheck.
	const misconfigured: RunContext["misconfigured"] = ledger.snapshot();

	const entry: MisconfiguredEntry | undefined = misconfigured.a;
	assert.deepEqual(entry, {
		reason: "invalid-credential (HTTP 401)",
		roles: ["test", "improver"],
	});
});
