import type {
	EvaluationMode,
	SelfImprovementAgents,
	SelfImprovementMode,
	SelfImprovementPaths,
	SkillsmithConfig,
} from "./types";

export interface ResolvedSelfImprovement {
	mode: SelfImprovementMode;
	maxIterations: number;
	evaluationMode: EvaluationMode;
	finalPass: boolean;
	agents: SelfImprovementAgents;
	paths: SelfImprovementPaths;
}

export interface SelfImprovementOverrides {
	mode?: SelfImprovementMode;
	maxIterations?: number;
	evaluationMode?: EvaluationMode;
	finalPass?: boolean;
}

const DEFAULTS: Pick<
	ResolvedSelfImprovement,
	"mode" | "maxIterations" | "evaluationMode" | "finalPass"
> = {
	mode: "test-only",
	maxIterations: 3,
	evaluationMode: "failed-scenarios",
	finalPass: false,
};

/**
 * Merge the config's `selfImprovement` block with CLI overrides and
 * the harness defaults. Precedence: CLI override > config > defaults.
 *
 * `maxIterations` is clamped to a minimum of 1 here so the rest of the
 * pipeline can treat the value as a loop bound without re-validating.
 */
export function resolveSelfImprovement(
	config: SkillsmithConfig,
	overrides: SelfImprovementOverrides = {},
): ResolvedSelfImprovement {
	const cfg = config.selfImprovement ?? {};
	const maxIterations =
		overrides.maxIterations ?? cfg.maxIterations ?? DEFAULTS.maxIterations;
	return {
		mode: overrides.mode ?? cfg.mode ?? DEFAULTS.mode,
		maxIterations: Math.max(1, maxIterations),
		evaluationMode:
			overrides.evaluationMode ?? cfg.evaluationMode ?? DEFAULTS.evaluationMode,
		finalPass: overrides.finalPass ?? cfg.finalPass ?? DEFAULTS.finalPass,
		agents: cfg.agents ?? {},
		paths: cfg.paths ?? {},
	};
}
