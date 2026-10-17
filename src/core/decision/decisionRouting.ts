// The decision role (ADR 0068): Jev, a Decision Model that answers typed
// questions — a Choice among named options, a Noul for whether a statement
// holds — and generates nothing. Unlike a generating model's routing it has
// defaults for everything but its key: the key alone is the arm marker.
// Everything is config (environment); both the base URL and the pinned
// model id are overridable.

export interface ModelEndpointConfig {
  /** API root, e.g. https://api.typesafe.ai */
  baseUrl: string
  apiKey: string
  /** Model id resolved from config — pinned, never a floating alias. */
  model: string
}

const DECISION_ENV_PREFIX = 'BINGBONG_DECISION'
const DECISION_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
/** Pinned, never `jev-latest`: thresholds are tuned per model version. */
const DECISION_DEFAULT_MODEL = 'jev-1.13.0'
const DECISION_DEFAULT_KEY_ENV = 'TYPESAFE_API_KEY'

/** The scripted stand-in's hook: set, it serves the role and no request leaves the machine. */
export const DECISION_SCRIPT_ENV_KEY = `${DECISION_ENV_PREFIX}_SCRIPT`

/** Whether the decision role resolved, and to what; never thrown, since unconfigured is a valid state. */
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
    DECISION_SCRIPT_ENV_KEY,
  ]
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/**
 * Resolve the decision role: the key from `BINGBONG_DECISION_API_KEY`, the
 * env var named by `BINGBONG_DECISION_API_KEY_ENV`, or `TYPESAFE_API_KEY`;
 * the base URL and model by override or default.
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
