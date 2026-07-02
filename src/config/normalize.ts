import { DEFAULT_PATHS } from './defaults';
import type {
	AgentDefinition,
	JudgeRoleInput,
	NormalizedRoles,
	SingleRoleInput,
	SkillsmithConfig,
	SkillsmithConfigInput,
} from './types';

/**
 * Resolve a user-authored `SkillsmithConfigInput` into the
 * `SkillsmithConfig` the rest of the harness consumes. This runs after
 * validation, so we can assume the shape is well-formed and every id
 * referenced by a role resolves in `agents`.
 *
 * The map of `AgentDefinitionInput`s becomes a map of `AgentDefinition`s
 * with `id` injected from the key. Role string shorthands are lifted to
 * object form. Defaults are merged into `paths`.
 */
export function normalizeConfig(
	input: SkillsmithConfigInput
): SkillsmithConfig {
	const agents: Record< string, AgentDefinition > = {};
	for ( const [ id, def ] of Object.entries( input.agents ) ) {
		agents[ id ] = { ...def, id };
	}

	const roles: NormalizedRoles = {
		test: {
			agents: input.roles.test.agents.map(
				( id ) => agents[ id ] as AgentDefinition
			),
			...( input.roles.test.prompt !== undefined
				? { prompt: input.roles.test.prompt }
				: {} ),
		},
		judge: normalizeJudgeRole( input.roles.judge, agents ),
		improver: normalizeSingleRole( input.roles.improver, agents ),
	};

	const out: SkillsmithConfig = {
		mode: input.mode,
		agents,
		roles,
		paths: { ...DEFAULT_PATHS, ...input.paths },
	};
	if ( input.hooks !== undefined ) out.hooks = input.hooks;
	if ( input.selfImprovement !== undefined ) {
		out.selfImprovement = input.selfImprovement;
	}
	return out;
}

function normalizeSingleRole(
	role: SingleRoleInput,
	agents: Record< string, AgentDefinition >
): { agent: AgentDefinition; prompt?: string } {
	if ( typeof role === 'string' ) {
		return { agent: agents[ role ] as AgentDefinition };
	}
	const out: { agent: AgentDefinition; prompt?: string } = {
		agent: agents[ role.agent ] as AgentDefinition,
	};
	if ( role.prompt !== undefined ) out.prompt = role.prompt;
	return out;
}

/**
 * Normalize the judge role, lifting the string shorthand to object form,
 * resolving its `concurrency` to a concrete value, and carrying `library`
 * through when set. `concurrency` is optional user-facing and defaults to
 * `'parallel'`, so downstream code can read
 * `config.roles.judge.concurrency` unconditionally; `library` stays
 * optional — it is present on the normalized role only when configured.
 *
 * @param role   - The judge role exactly as authored (string or object).
 * @param agents - The resolved agent map to look the judge agent up in.
 * @returns The normalized judge role with `concurrency` always set.
 */
function normalizeJudgeRole(
	role: JudgeRoleInput,
	agents: Record< string, AgentDefinition >
): NormalizedRoles[ 'judge' ] {
	if ( typeof role === 'string' ) {
		return {
			agent: agents[ role ] as AgentDefinition,
			concurrency: 'parallel',
		};
	}
	const out: NormalizedRoles[ 'judge' ] = {
		agent: agents[ role.agent ] as AgentDefinition,
		concurrency: role.concurrency ?? 'parallel',
	};
	if ( role.library !== undefined ) out.library = role.library;
	return out;
}
