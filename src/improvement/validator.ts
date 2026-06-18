import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	AgentDefinition,
	SkillsmithConfig,
} from "../config/types";
import { getProvider } from "../providers/registry";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import type { RunLog } from "../util/run-log";
import {
	classifyValidatorVerdict,
	type ValidatorOutcome,
} from "./validator-verdict";

export type { ValidatorFinding, ValidatorOutcome } from "./validator-verdict";

/**
 * The validator's system prompt. It encodes the ENTIRE anti-leakage
 * contract (R2/R3/R3a/R9), so a project-supplied prompt REPLACES it
 * wholesale (mirror `improver.ts:118-121`) rather than appending — diluting
 * the verdict-format contract would defeat the purpose. Opens with the
 * `"validator agent"` identity sentinel the mock branches on. It MUST NOT
 * contain the literal two-word sequence `"improver agent"` (the mock checks
 * that on the `role:"testing"` path; the validator runs `role:"judge"`, but
 * this is the belt-and-suspenders guard, §6.3).
 */
export const DEFAULT_VALIDATOR_PROMPT = `You are the validator agent in the skillsmith self-improvement loop.

# Mandate
You judge EDIT QUALITY, not scenario correctness. Your single question is:
did the improver's edits leak the evaluation corpus into the skill — baking
in answers that would let an agent pass the specific scenarios without
actually getting better at the underlying domain? Scenario correctness is the
job of the scenario judge on the next sweep, NOT yours. Do not grade whether
the skill is right; grade whether it generalizes.

# The four leak types
A finding's \`leak_type\` MUST be one of these exact spellings:

- \`scenario-name\`: a scenario name or its directory name appears in the
  skill. A scenario's directory name and its \`scenario.name\` can differ
  (e.g. dir \`counter\` → name \`counter-block\`); both forms count.
- \`scenario-value\`: a scenario-unique literal value (a quoted string, a
  number, an identifier, a URL) is hard-coded into the skill.
- \`verbatim-copy\`: acceptance-item or rubric wording is copied verbatim into
  the skill prose.
- \`single-case\`: guidance shaped "for THIS task do X" rather than "in general
  do X" — a single-case answer instead of a reusable principle.

# The bright line: specificity to one scenario
Leakage is the edit referencing something that identifies ONE SPECIFIC
scenario — its name, its unique value, or its verbatim wording. The DOMAIN —
the API surface that recurs across scenarios (it appears in two or more) and
is what the skill exists to teach — MUST pass clean. Specificity to one
scenario is the bright line.

Do NOT anchor on "this token appears in the rubric." The rubric and the skill
SHOULD share vocabulary; anchoring there would flag the very subject matter
the skill teaches. Likewise, leakage is not "the skill uses a concrete value"
— an illustrative example legitimately needs SOME concrete value. Leakage is
"the skill uses THE SCENARIO'S value." The rule the improver should follow:
pick an example value that is NOT one of the eval scenarios' values.

# Two prongs (AND) and a precision bias
Flag content ONLY when BOTH prongs hold:

1. Scenario-specific — the content fingerprints exactly one scenario: its name
   or directory name; a literal appearing in exactly one active scenario and
   absent from the rubric / shared domain surface; or a verbatim span from one
   scenario's acceptance or a rubric bullet.
2. Not necessary to teach — a generic substitute value or a different example
   would convey the same principle equally well.

If EITHER prong fails, APPROVE. When uncertain, APPROVE. A value appearing in
ZERO scenarios, or in TWO OR MORE scenarios (that is domain vocabulary), MUST
pass clean.

The harm is asymmetric, so bias toward precision. A false POSITIVE actively
harms: it blocks a legitimate fix, burns revise rounds, and pressures the
improver to water down good guidance — the worst outcome. A false NEGATIVE
merely slips a blatant leak to the working tree, where human PR review still
catches it. When the two are in tension, choose the false negative: APPROVE.

# What you are given
The user message contains the post-edit whole skill, the active scenario
corpus (name, description, prompt, and acceptance items per scenario), and the
rubric texts. Judge only what is there.

# Output format
Return a SINGLE JSON object and nothing else — no prose, no Markdown fences:

  {
    "verdict": "approve" | "revise",
    "findings": [
      {
        "leak_type": "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case",
        "span": "<the actual offending substring>",
        "why": "<1 line>",
        "suggested_fix": "<how to generalize>"
      }
    ]
  }

When \`verdict\` is \`"revise"\`, \`findings\` is REQUIRED and MUST be non-empty;
\`span\` MUST be the actual offending substring so the fix can locate it. On
\`"approve"\`, omit \`findings\` or pass an empty array. Strict JSON only: no
trailing commas, no comments, no single-quoted strings, no \`|\` block scalars.

# Recursion guard
Do not invoke \`skillsmith\` or any wrapper that would re-enter the harness.`;

export interface RunValidatorParams {
	agent: AgentDefinition;
	/**
	 * Optional project-specific prompt that fully REPLACES the built-in
	 * validator contract. Comes from `config.roles.validator.prompt`.
	 */
	validatorPrompt?: string;
	/** The post-edit "after" skill text, read by the caller via `readSkillsRoot`. */
	skillsBlob: string;
	/** The FULL enumerated scenario set (§4.3) — the validator sees the corpus. */
	corpus: EnumeratedScenario[];
	config: SkillsmithConfig;
	projectRoot: string;
	iterationDirectory: string;
	round: number;
	log: RunLog;
}

/**
 * Run the validator agent for one round. It inspects the improver's post-edit
 * skill text against the full scenario corpus and rubrics for eval-corpus
 * leakage, returning `approve` or `revise` with typed findings.
 *
 * Two fail-open entry points both set `failedOpen: true` (§7.4): (a) a
 * provider error short-circuits to approve BEFORE parsing; (b) a parse/shape
 * failure inside `classifyValidatorVerdict` (rows 1/2/5) approves on a
 * successful invoke. Either way the loop breaks as approve so a broken
 * validator never blocks the loop. The only write is the
 * `validation-round-{round}.md` transcript.
 */
export async function runValidator(
	params: RunValidatorParams,
): Promise<ValidatorOutcome> {
	const {
		agent,
		validatorPrompt,
		skillsBlob,
		corpus,
		config,
		projectRoot,
		iterationDirectory,
		round,
		log,
	} = params;

	// The skills root: the validator's subject and the read-only anchor for
	// real providers (== `improver.ts:117`). Inert for the mock judge branch,
	// but a REQUIRED `InvokeParams` field.
	const skillsDir = resolve(projectRoot, config.paths.skills);

	const systemPrompt =
		validatorPrompt !== undefined && validatorPrompt.length > 0
			? validatorPrompt
			: DEFAULT_VALIDATOR_PROMPT;
	const userMessage = buildUserMessage(corpus, skillsBlob, projectRoot, config);

	log.info(
		`validator round ${round} starting: provider=${agent.provider} model=${agent.model}`,
	);

	const provider = getProvider(agent.provider);
	const result = await provider.invoke({
		agent,
		systemPrompt,
		prompt: userMessage,
		cwd: skillsDir,
		role: "judge",
	});

	const transcriptPath = join(
		iterationDirectory,
		`validation-round-${round}.md`,
	);

	// (a) Provider error → fail open BEFORE parsing (§7.4). `finalText` is
	// meaningless on this path, so do not call `classifyValidatorVerdict`.
	if (result.error !== undefined) {
		log.info("validator dispatch failed → treated as approve");
		const outcome: ValidatorOutcome = {
			verdict: "approve",
			findings: [],
			failedOpen: true,
			transcriptPath,
		};
		writeTranscript(transcriptPath, outcome, round, result.finalText, {
			reason: `provider error: ${result.error}`,
		});
		return outcome;
	}

	// (b) Parse/shape fail-open lives inside the classifier (rows 1/2/5).
	const classified = classifyValidatorVerdict(result.finalText);
	const outcome: ValidatorOutcome = { ...classified, transcriptPath };
	writeTranscript(transcriptPath, outcome, round, result.finalText);
	return outcome;
}

function buildUserMessage(
	corpus: EnumeratedScenario[],
	skillsBlob: string,
	projectRoot: string,
	config: SkillsmithConfig,
): string {
	const sections: string[] = [
		"# Post-edit skill",
		skillsBlob || "(no skill text available)",
		"",
		"# Active scenario corpus",
	];

	// Skip stubs (empty prompt + acceptance from `stubScenario`); error'd but
	// non-stub scenarios still carry a parsed prompt/acceptance and are kept.
	for (const s of corpus) {
		const sc = s.scenario;
		if (sc.prompt.length === 0 && sc.acceptance.length === 0) continue;
		sections.push(
			`## ${sc.name}`,
			`description: ${sc.description}`,
			`prompt: ${sc.prompt}`,
			"acceptance:",
			...sc.acceptance.map((item) => `- ${item}`),
			"",
		);
	}

	sections.push("# Rubrics");
	// Dedupe rubric ids across the corpus, then read each as
	// `paths.rubrics/<id>.md` with the judge's `TO BE FILLED` fallback
	// (`judge-agent.ts:95-100`). Inlined deliberately — do NOT factor a shared
	// helper out of the judge (§4.3 protects the AC1/C1 judge proof).
	const rubricsRoot = resolve(projectRoot, config.paths.rubrics);
	const rubricIds = new Set(corpus.flatMap((s) => s.scenario.rubrics));
	for (const id of rubricIds) {
		const path = join(rubricsRoot, `${id}.md`);
		const body = existsSync(path) ? readFileSync(path, "utf8") : "TO BE FILLED";
		sections.push(`## Rubric: ${id}`, body, "");
	}

	return sections.join("\n");
}

/**
 * Write the `validation-round-{round}.md` transcript. The body leads with the
 * `failedOpen`-prominent header (§7.4/§9.3) so a chronically-broken validator
 * never hides behind a string of clean-looking approvals.
 */
function writeTranscript(
	transcriptPath: string,
	outcome: ValidatorOutcome,
	round: number,
	rawText: string,
	failOpen?: { reason: string },
): void {
	let header: string;
	if (outcome.failedOpen) {
		// On the provider-error path the precise reason is threaded; on the
		// parse/shape path the classifier collapses rows 1/2/5, so a generic
		// reason is used — the load-bearing requirement is the distinguishable
		// FAILED-OPEN marker, not the exact sub-reason (§7.4/AC7).
		const reason = failOpen?.reason ?? "verdict unparseable or malformed";
		header = `VALIDATOR round ${round}: approve (FAILED-OPEN: ${reason})`;
	} else {
		header = `VALIDATOR round ${round}: ${outcome.verdict} (clean)`;
	}

	const sections: string[] = [header, ""];

	if (outcome.findings.length > 0) {
		sections.push("# Findings");
		for (const f of outcome.findings) {
			sections.push(
				`- [${f.leak_type}] ${f.span}`,
				`  why: ${f.why}`,
				`  suggested_fix: ${f.suggested_fix}`,
			);
		}
		sections.push("");
	}

	sections.push("# Raw verdict", rawText);

	writeFileSync(transcriptPath, sections.join("\n"));
}
