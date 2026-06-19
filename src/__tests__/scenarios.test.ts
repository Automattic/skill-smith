import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PATHS } from "../config/defaults";
import type { Paths } from "../config/types";
import { enumerateScenarios } from "../scenarios/enumerate";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "proj1");

test("scenarios with unresolved refs are flagged but others continue", () => {
	const found = enumerateScenarios(DEFAULT_PATHS, projectRoot);

	const byName = new Map(found.map((s) => [s.scenario.name, s]));
	assert.equal(byName.size, 2, "two scenarios should be found");

	const good = byName.get("good-scenario");
	assert.ok(good, "good scenario present");
	assert.equal(good?.id, "good");
	assert.equal(good?.dirName, "good");
	assert.equal(good?.nameSource, "configured");
	assert.equal(good?.error, undefined, "good scenario has no error");

	const bad = byName.get("bad-scenario");
	assert.ok(bad, "bad scenario present");
	assert.equal(bad?.id, "bad");
	assert.equal(bad?.dirName, "bad");
	assert.equal(bad?.nameSource, "configured");
	assert.match(bad?.error ?? "", /unresolved reference/);
	assert.match(bad?.error ?? "", /missing-skill/);
	assert.match(bad?.error ?? "", /missing-rubric/);
});

test("scenario enumeration discovers nested scenarios in deterministic ID order", () => {
	const root = makeProject();
	try {
		writeScenario(root, "counter", { name: "counter-scenario" });
		writeScenario(root, "blocks", { name: "blocks-scenario" });
		writeScenario(root, "blocks/counter", { name: "nested-counter" });
		writeScenario(root, "groups/deeper", { name: "grouped-scenario" });
		writeFileSync(join(root, "scenarios", "notes.txt"), "not a directory");
		symlinkSync(
			join(root, "scenarios", "counter"),
			join(root, "scenarios", "linked-counter"),
			"dir",
		);

		const found = enumerateScenarios(TEST_PATHS, root);

		assert.deepEqual(
			found.map((scenario) => scenario.id),
			["blocks", "blocks/counter", "counter", "groups/deeper"],
		);
		assert.deepEqual(
			found.map((scenario) => scenario.dirName),
			found.map((scenario) => scenario.id),
		);
		assert.equal(
			found.find((scenario) => scenario.id === "groups")?.scenario.name,
			undefined,
			"grouping directories without scenario.yaml are not emitted",
		);
		assert.equal(
			found.find((scenario) => scenario.id === "linked-counter"),
			undefined,
			"symlinked directories are not emitted",
		);
		assert.ok(
			found.every((scenario) => scenario.nameSource === "configured"),
			"valid scenario names come from configuration",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scenario enumeration keeps nested errors isolated while recursing", () => {
	const root = makeProject();
	try {
		writeScenario(root, "valid", { name: "valid-scenario" });
		writeScenario(root, "missing", {
			name: "missing-reference-scenario",
			skills: ["absent-skill"],
			rubrics: ["absent-rubric"],
		});
		mkdirSync(join(root, "scenarios", "broken"), { recursive: true });
		mkdirSync(join(root, "scenarios", "malformed"), { recursive: true });
		writeFileSync(join(root, "scenarios", "broken", "scenario.yaml"), "name: [");
		writeFileSync(
			join(root, "scenarios", "malformed", "scenario.yaml"),
			"name: malformed-only\n",
		);
		writeScenario(root, "broken/child", { name: "broken-child-scenario" });
		writeScenario(root, "malformed/child", { name: "malformed-child-scenario" });

		const found = enumerateScenarios(TEST_PATHS, root);
		const byId = new Map(found.map((scenario) => [scenario.id, scenario]));

		assert.deepEqual(
			found.map((scenario) => scenario.id),
			["broken", "broken/child", "malformed", "malformed/child", "missing", "valid"],
		);
		assert.match(byId.get("broken")?.error ?? "", /parse error/);
		assert.equal(byId.get("broken")?.nameSource, "synthetic");
		assert.match(byId.get("malformed")?.error ?? "", /malformed/);
		assert.equal(byId.get("malformed")?.nameSource, "synthetic");
		assert.match(byId.get("missing")?.error ?? "", /unresolved reference/);
		assert.match(byId.get("missing")?.error ?? "", /absent-skill/);
		assert.match(byId.get("missing")?.error ?? "", /absent-rubric/);
		assert.equal(byId.get("missing")?.nameSource, "configured");
		assert.equal(byId.get("valid")?.error, undefined);
		assert.equal(byId.get("valid")?.nameSource, "configured");
		assert.equal(byId.get("broken/child")?.error, undefined);
		assert.equal(byId.get("malformed/child")?.error, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const TEST_PATHS: Paths = {
	base: ".",
	scenarios: "scenarios",
	skills: "skills",
	rubrics: "rubrics",
};

function makeProject(): string {
	const root = mkdtempSync(join(tmpdir(), "skillsmith-scenarios-"));
	mkdirSync(join(root, "scenarios"), { recursive: true });
	mkdirSync(join(root, "skills", "counter"), { recursive: true });
	mkdirSync(join(root, "rubrics"), { recursive: true });
	writeFileSync(join(root, "skills", "counter", "SKILL.md"), "# Counter\n");
	writeFileSync(join(root, "rubrics", "basic.md"), "# Basic\n");
	return root;
}

function writeScenario(
	root: string,
	id: string,
	options: { name: string; skills?: string[]; rubrics?: string[] },
): void {
	const scenarioDir = join(root, "scenarios", ...id.split("/"));
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "scenario.yaml"),
		[
			`name: ${options.name}`,
			"description: Test scenario",
			"skills:",
			...(options.skills ?? ["counter"]).map((skill) => `  - ${skill}`),
			"prompt: Run the scenario",
			"acceptance:",
			"  - It succeeds",
			"rubrics:",
			...(options.rubrics ?? ["basic"]).map((rubric) => `  - ${rubric}`),
			"",
		].join("\n"),
	);
}
