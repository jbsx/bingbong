// Model router: which OpenAI-compatible endpoint + model id serves each agent
// role. Everything is config (environment); no model id or provider is baked
// into code, so swapping providers is a config change. The one exception
// is the decision role below (#275, ADR 0068): its issue pins a default
// base URL and model id, because its thresholds are tuned per model version
// and a key alone is meant to arm it; both are still overridable by env.

import { REASONING_EFFORTS, type ReasoningEffort } from '../ports/llm.ts'
import { reportFault } from '../trace/fault.ts'

export type AgentRole = 'orchestrator' | 'subagent' | 'vision'

export interface ModelEndpointConfig {
  /** OpenAI-compatible API root, e.g. https://ai.z.ai/api/coding/paas/v4 */
  baseUrl: string
  apiKey: string
  /** Model id resolved from config — never hardcoded in code. */
  model: string
}

interface RoleConfig {
  envPrefix: string
  /** Key env var used when no explicit key config exists for the role. */
  defaultKeyEnv: string
}

const ROLES: Record<AgentRole, RoleConfig> = {
  orchestrator: { envPrefix: 'BINGBONG_ORCHESTRATOR', defaultKeyEnv: 'ZAI_API_KEY' },
  subagent: { envPrefix: 'BINGBONG_SUBAGENT', defaultKeyEnv: 'DEEPSEEK_API_KEY' },
  vision: { envPrefix: 'BINGBONG_VISION', defaultKeyEnv: 'ZAI_API_KEY' },
}

/** Every role, in declaration order — the single list all role-iterating code shares. */
export const AGENT_ROLES = ['orchestrator', 'subagent', 'vision'] as const satisfies readonly AgentRole[]

/** The env var prefix (`BINGBONG_ORCHESTRATOR`, …) that configures one role. */
export function routingEnvPrefix(role: AgentRole): string {
  return ROLES[role].envPrefix
}

/** Every env var that configures a role — used by tests that unset config. */
export function routingEnvKeys(role: AgentRole): string[] {
  const { envPrefix, defaultKeyEnv } = ROLES[role]
  return [
    `${envPrefix}_BASE_URL`,
    `${envPrefix}_MODEL`,
    `${envPrefix}_API_KEY`,
    `${envPrefix}_API_KEY_ENV`,
    defaultKeyEnv,
  ]
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/**
 * Resolve the endpoint for one role:
 * `BINGBONG_<ROLE>_BASE_URL` + `BINGBONG_<ROLE>_MODEL` (required) and an API
 * key from `BINGBONG_<ROLE>_API_KEY`, or the env var named by
 * `BINGBONG_<ROLE>_API_KEY_ENV`, or the role's default key env.
 *
 * Throws a single error naming every missing piece. The first sentence stays
 * short so the spoken error line doesn't recite the whole variable list.
 */
export function resolveModelEndpoint(env: Record<string, string | undefined>, role: AgentRole): ModelEndpointConfig {
  const { envPrefix, defaultKeyEnv } = ROLES[role]
  const baseUrl = readEnv(env, `${envPrefix}_BASE_URL`)
  const model = readEnv(env, `${envPrefix}_MODEL`)
  const explicitKey = readEnv(env, `${envPrefix}_API_KEY`)
  const keyEnvName = readEnv(env, `${envPrefix}_API_KEY_ENV`)
  const namedKey = keyEnvName ? readEnv(env, keyEnvName) : undefined
  // A named key env that is unset is a config error, not a silent fallback.
  const apiKey = explicitKey ?? namedKey ?? (keyEnvName ? undefined : readEnv(env, defaultKeyEnv))

  const keyHint =
    keyEnvName && !namedKey
      ? `${keyEnvName} is not set`
      : `${envPrefix}_API_KEY, ${envPrefix}_API_KEY_ENV or ${defaultKeyEnv}`

  if (!baseUrl || !model || !apiKey) {
    const missing = [
      !baseUrl ? `${envPrefix}_BASE_URL` : null,
      !model ? `${envPrefix}_MODEL` : null,
      !apiKey ? keyHint : null,
    ].filter((part): part is string => part !== null)
    throw new Error(`model routing for '${role}' is not configured. Set ${missing.join(', ')}.`)
  }

  return { baseUrl, model, apiKey }
}

/** Which roles resolve right now — the settings page's configured/unconfigured lines (#76). */
export type RoutingStatus = Record<AgentRole, boolean>

/** One role's resolvability, throw-free — the same resolution the pipeline runs. */
export function roleConfigured(env: Record<string, string | undefined>, role: AgentRole): boolean {
  try {
    resolveModelEndpoint(env, role)
    return true
  } catch (error) {
    reportFault('agent.modelRouting.roleConfigured', error)
    return false
  }
}

export function resolveRoutingStatus(env: Record<string, string | undefined>): RoutingStatus {
  return {
    orchestrator: roleConfigured(env, 'orchestrator'),
    subagent: roleConfigured(env, 'subagent'),
    vision: roleConfigured(env, 'vision'),
  }
}

// The decision role (#275, ADR 0068): a Decision Model answering a Run's
// typed questions inside a round. It is not an AgentRole — it serves no
// loop, holds no settings row and never reaches `set_setting` — so it
// resolves beside the three rather than among them. Unlike them it has
// defaults for everything but its key: the key alone is the arm marker,
// and a missing one is not a fault but today's behaviour.

const DECISION_ENV_PREFIX = 'BINGBONG_DECISION'
const DECISION_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
/** Pinned, never `jev-latest`: thresholds are tuned per model version. */
const DECISION_DEFAULT_MODEL = 'jev-1.13.0'
const DECISION_DEFAULT_KEY_ENV = 'TYPESAFE_API_KEY'
/** The comma list of seams that act (#279 threads it through the harnesses). */
export const DECISION_SEAMS_ENV_KEY = `${DECISION_ENV_PREFIX}_SEAMS`

/** The scripted stand-in's hook: set, it serves the role and no request leaves the machine. */
export const DECISION_SCRIPT_ENV_KEY = `${DECISION_ENV_PREFIX}_SCRIPT`

/** The seams a Decision Model can serve: a Selected Passage (#276), a Result Pick (#277), the Effort Tier (#278). */
export type DecisionSeam = 'passage' | 'result' | 'tier'
export const DECISION_SEAMS = ['passage', 'result', 'tier'] as const satisfies readonly DecisionSeam[]

/** Whether the decision role resolved, and to what; never thrown, since unconfigured is a valid arm. */
export type DecisionRouting =
  | { readonly configured: true; readonly endpoint: ModelEndpointConfig }
  | { readonly configured: false; readonly reason: string }

/** Every env var that configures the decision role — what a hermetic harness unsets. */
export function decisionEnvKeys(): string[] {
  return [
    `${DECISION_ENV_PREFIX}_BASE_URL`,
    `${DECISION_ENV_PREFIX}_MODEL`,
    `${DECISION_ENV_PREFIX}_API_KEY`,
    `${DECISION_ENV_PREFIX}_API_KEY_ENV`,
    DECISION_DEFAULT_KEY_ENV,
    DECISION_SEAMS_ENV_KEY,
  ]
}

/**
 * Resolve the decision role: the key by the other roles' precedence
 * (explicit, then the named key env, then `TYPESAFE_API_KEY`), the base URL
 * and model by override or default.
 */
export function resolveDecisionRouting(env: Record<string, string | undefined>): DecisionRouting {
  const explicitKey = readEnv(env, `${DECISION_ENV_PREFIX}_API_KEY`)
  const keyEnvName = readEnv(env, `${DECISION_ENV_PREFIX}_API_KEY_ENV`)
  const namedKey = keyEnvName ? readEnv(env, keyEnvName) : undefined
  // A named key env that is unset never falls back to the default key.
  const apiKey = explicitKey ?? namedKey ?? (keyEnvName ? undefined : readEnv(env, DECISION_DEFAULT_KEY_ENV))
  if (!apiKey) {
    const hint =
      keyEnvName && !namedKey
        ? `${keyEnvName} is not set`
        : `set ${DECISION_ENV_PREFIX}_API_KEY, ${DECISION_ENV_PREFIX}_API_KEY_ENV or ${DECISION_DEFAULT_KEY_ENV}`
    return { configured: false, reason: `no key: ${hint}` }
  }
  return {
    configured: true,
    endpoint: {
      baseUrl: readEnv(env, `${DECISION_ENV_PREFIX}_BASE_URL`) ?? DECISION_DEFAULT_BASE_URL,
      model: readEnv(env, `${DECISION_ENV_PREFIX}_MODEL`) ?? DECISION_DEFAULT_MODEL,
      apiKey,
    },
  }
}

/**
 * The seams that act: none when the role is neither configured nor
 * scripted, otherwise every seam unless `BINGBONG_DECISION_SEAMS` is set —
 * then the ones it lists, and none when it is set empty. An unknown name
 * is dropped rather than failing a Run over a typo in an experiment variable.
 */
export function resolveDecisionSeams(env: Record<string, string | undefined>): ReadonlySet<DecisionSeam> {
  const served = readEnv(env, DECISION_SCRIPT_ENV_KEY) !== undefined || resolveDecisionRouting(env).configured
  if (!served) return new Set()
  // Unset means every seam; set but empty means none — the off switch that
  // keeps the key in place.
  const listed = env[DECISION_SEAMS_ENV_KEY]
  if (typeof listed !== 'string') return new Set(DECISION_SEAMS)
  const names = listed.split(',').map((name) => name.trim().toLowerCase())
  return new Set(DECISION_SEAMS.filter((seam) => names.includes(seam)))
}

/**
 * The experiment lever that forces every round's reasoning-effort rung
 * (#166), orchestrator and Browse Subagent alike — and the Finalization
 * rounds too (#215): a corpus pass at a forced rung is uniform, so the
 * bookkeeping round and the reserved Answer round give up their own
 * `low` for the forced value like every other round. Unset, each
 * round's own rung — the Run Plan's before the first declaration (#252),
 * the Effort Tier's, or Finalization's — decides. This is how a probe
 * runs the same command at `low` and at `max` on one commit.
 */
export const REASONING_EFFORT_ENV_KEY = 'BINGBONG_REASONING_EFFORT'

/**
 * The override in force, or undefined when none is: an unset, blank, or
 * unrecognized value leaves the tier map in charge rather than failing a
 * Run over a typo in an experiment variable.
 */
export function resolveReasoningEffortOverride(
  env: Record<string, string | undefined>,
): ReasoningEffort | undefined {
  const raw = readEnv(env, REASONING_EFFORT_ENV_KEY)?.toLowerCase()
  return REASONING_EFFORTS.find((effort) => effort === raw)
}
