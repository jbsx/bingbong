// Model router: which OpenAI-compatible endpoint + model id serves each agent
// role. Everything is config (environment); no model id or provider is baked
// into code, so swapping providers is a config change.

import type { ReasoningEffort } from '../ports/llm'

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
  } catch {
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

/**
 * The experiment lever that forces every round's reasoning-effort rung
 * (#166), orchestrator and Browse Subagent alike. Unset, each round's own
 * rung — the Effort Tier's — decides. This is how a probe runs the same
 * command at `low` and at `max` on one commit.
 */
export const REASONING_EFFORT_ENV_KEY = 'BINGBONG_REASONING_EFFORT'

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'high', 'max']

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
