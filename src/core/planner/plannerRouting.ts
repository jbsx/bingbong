// The Planner's routing (#465, ADR 0095): a chat model behind an
// OpenAI-compatible endpoint, by env in the #395 shape — the key alone
// arms it, everything else defaults and is overridable, so another model
// is one `.env` line and the choice of model is measured, never argued.
// GLM-5.3 on Z.ai's Coding Plan by the owner's ruling (2026-10-26: the
// Coding Plan while the project is personal, pay per token at
// distribution); GLM-5.3-flash is the gate's model (the weaker model is
// the bar). Zero runtime imports beyond types: the gate scripts run this
// under node's type stripping (#36).

import type { ModelEndpointConfig } from '../decision/decisionRouting'

const PLANNER_ENV_PREFIX = 'BINGBONG_PLANNER'
const PLANNER_DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
/** The served id (the coding endpoint's /models, 2026-10-26), lower case as it reports it. */
export const PLANNER_DEFAULT_MODEL = 'glm-5.3'
/** The weaker model the gate runs and the goal gate's judge is (the weaker model is the bar). */
export const PLANNER_GATE_MODEL = 'glm-5.3-flash'
const PLANNER_DEFAULT_KEY_ENV = 'ZAI_API_KEY'
/**
 * The most one Planner call may take: 30 s, a guess (the #464 grill), the
 * Command tier keeps its 800 ms. Settled once the `planner-step` spans
 * have a day of numbers.
 */
const PLANNER_DEFAULT_TIMEOUT_MS = 30_000
/** The owner's limiter (2026-10-26): at most 2 calls a second and 4 in flight. */
const PLANNER_DEFAULT_PER_SECOND = 2
const PLANNER_DEFAULT_IN_FLIGHT = 4

const TIMEOUT_KEY = `${PLANNER_ENV_PREFIX}_TIMEOUT_MS`
const THINKING_KEY = `${PLANNER_ENV_PREFIX}_THINKING`
const RATE_KEY = `${PLANNER_ENV_PREFIX}_RATE`
const IN_FLIGHT_KEY = `${PLANNER_ENV_PREFIX}_IN_FLIGHT`

export type PlannerRouting =
  | {
      readonly configured: true
      readonly endpoint: ModelEndpointConfig
      readonly timeoutMs: number
      /** Z.ai's `thinking` switch; off sends `disabled`, which GLM-5.3 reads as think little, never none. */
      readonly thinking: boolean
      readonly perSecond: number
      readonly inFlight: number
    }
  | { readonly configured: false; readonly reason: string }

export type ConfiguredPlannerRouting = Extract<PlannerRouting, { readonly configured: true }>

/** Every env var that configures the Planner — what a hermetic harness unsets. */
export function plannerEnvKeys(): string[] {
  return [
    `${PLANNER_ENV_PREFIX}_BASE_URL`,
    `${PLANNER_ENV_PREFIX}_MODEL`,
    `${PLANNER_ENV_PREFIX}_API_KEY`,
    `${PLANNER_ENV_PREFIX}_API_KEY_ENV`,
    PLANNER_DEFAULT_KEY_ENV,
    TIMEOUT_KEY,
    THINKING_KEY,
    RATE_KEY,
    IN_FLIGHT_KEY,
  ]
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/**
 * Resolve the Planner: the key from `BINGBONG_PLANNER_API_KEY`, the env var
 * named by `BINGBONG_PLANNER_API_KEY_ENV`, or `ZAI_API_KEY`; the rest by
 * override or default. A setting that does not parse leaves the role
 * unconfigured with the reason, never a guess at what was meant.
 */
export function resolvePlannerRouting(env: Record<string, string | undefined>): PlannerRouting {
  const keyEnvName = readEnv(env, `${PLANNER_ENV_PREFIX}_API_KEY_ENV`)
  const namedKey = keyEnvName ? readEnv(env, keyEnvName) : undefined
  // A named key env that is unset never falls back to the default key.
  const apiKey = readEnv(env, `${PLANNER_ENV_PREFIX}_API_KEY`) ?? namedKey ?? (keyEnvName ? undefined : readEnv(env, PLANNER_DEFAULT_KEY_ENV))
  if (!apiKey) {
    const hint = keyEnvName && !namedKey ? `${keyEnvName} is not set` : `set ${PLANNER_ENV_PREFIX}_API_KEY, ${PLANNER_ENV_PREFIX}_API_KEY_ENV or ${PLANNER_DEFAULT_KEY_ENV}`
    return { configured: false, reason: `no key: ${hint}` }
  }
  const rawTimeout = readEnv(env, TIMEOUT_KEY)
  const timeoutMs = rawTimeout === undefined ? PLANNER_DEFAULT_TIMEOUT_MS : Number(rawTimeout)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return { configured: false, reason: `${TIMEOUT_KEY} must be a whole number of ms above 0, got "${rawTimeout}"` }
  const rawThinking = readEnv(env, THINKING_KEY)
  const thinking = rawThinking?.toLowerCase() ?? 'off'
  if (thinking !== 'on' && thinking !== 'off') return { configured: false, reason: `${THINKING_KEY} must be on or off, got "${rawThinking}"` }
  const rawRate = readEnv(env, RATE_KEY)
  const perSecond = rawRate === undefined ? PLANNER_DEFAULT_PER_SECOND : Number(rawRate)
  if (!Number.isFinite(perSecond) || perSecond <= 0) return { configured: false, reason: `${RATE_KEY} must be a number of calls a second above 0, got "${rawRate}"` }
  const rawInFlight = readEnv(env, IN_FLIGHT_KEY)
  const inFlight = rawInFlight === undefined ? PLANNER_DEFAULT_IN_FLIGHT : Number(rawInFlight)
  if (!Number.isInteger(inFlight) || inFlight <= 0) return { configured: false, reason: `${IN_FLIGHT_KEY} must be a whole number of calls above 0, got "${rawInFlight}"` }
  return {
    configured: true,
    endpoint: {
      baseUrl: (readEnv(env, `${PLANNER_ENV_PREFIX}_BASE_URL`) ?? PLANNER_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: readEnv(env, `${PLANNER_ENV_PREFIX}_MODEL`) ?? PLANNER_DEFAULT_MODEL,
      apiKey,
    },
    timeoutMs,
    thinking: thinking === 'on',
    perSecond,
    inFlight,
  }
}
