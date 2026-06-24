import type { EvaluationScope, RunMode, SkillsmithConfig } from './types';

export interface ResolvedSelfImprovement {
	mode: RunMode;
	maxIterations: number;
	scope: EvaluationScope;
	finalPass: boolean;
}

export interface SelfImprovementOverrides {
	mode?: RunMode;
	maxIterations?: number;
	scope?: EvaluationScope;
	finalPass?: boolean;
}

const DEFAULTS: Pick<
	ResolvedSelfImprovement,
	'mode' | 'maxIterations' | 'scope' | 'finalPass'
> = {
	mode: 'test-only',
	maxIterations: 3,
	scope: 'failed-scenarios',
	finalPass: false,
};

/**
 * Merge the config's top-level `mode` plus its `selfImprovement` block
 * with CLI overrides and the harness defaults. Precedence:
 * CLI override > config > defaults.
 *
 * `maxIterations` is clamped to a minimum of 1 here so the rest of the
 * pipeline can treat the value as a loop bound without re-validating.
 * The improver agent itself lives in `config.roles.improver.agent`, not
 * in this block.
 */
export function resolveSelfImprovement(
	config: SkillsmithConfig,
	overrides: SelfImprovementOverrides = {}
): ResolvedSelfImprovement {
	const cfg = config.selfImprovement ?? {};
	const maxIterations =
		overrides.maxIterations ?? cfg.maxIterations ?? DEFAULTS.maxIterations;
	return {
		mode: overrides.mode ?? config.mode ?? DEFAULTS.mode,
		maxIterations: Math.max( 1, maxIterations ),
		scope: overrides.scope ?? cfg.scope ?? DEFAULTS.scope,
		finalPass: overrides.finalPass ?? cfg.finalPass ?? DEFAULTS.finalPass,
	};
}
