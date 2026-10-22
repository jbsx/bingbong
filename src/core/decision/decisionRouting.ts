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
/**
 * Pinned, never `jev-latest`. `jev-1.14.0` by the owner's ruling (ADR 0076):
 * no confidence bar is tuned on this branch, so nothing holds the `jev-1.13.0`
 * pin the adapter inherited, and 1.14 is the release whose Box question can
 * locate a target in a screenshot.
 */
const DECISION_DEFAULT_MODEL = 'jev-1.14.0'
const DECISION_DEFAULT_KEY_ENV = 'TYPESAFE_API_KEY'
/** The most a Decision Model may cost a round (ADR 0068: "under a second"). */
export const DECISION_DEFAULT_TIMEOUT_MS = 800
const DECISION_TIMEOUT_ENV_KEY = `${DECISION_ENV_PREFIX}_TIMEOUT_MS`
/**
 * The wire protocol a Decision Model speaks. One today: `/v1/systemone`
 * (state + typed questions), which TypeSafe, Baseten, OpenRouter and
 * TrueFoundry all serve (#395); a second (OpenAI Decisions) is its own
 * adapter when it comes.
 */
export const DECISION_PROTOCOLS = ['systemone'] as const
export type DecisionProtocol = (typeof DECISION_PROTOCOLS)[number]
const DECISION_DEFAULT_PROTOCOL: DecisionProtocol = 'systemone'
const DECISION_PROTOCOL_ENV_KEY = `${DECISION_ENV_PREFIX}_PROTOCOL`
/** Off for a text-only model: an ask that carries an image (the Mark Ask) is then never sent. */
const DECISION_IMAGES_ENV_KEY = `${DECISION_ENV_PREFIX}_IMAGES`

/** The scripted stand-in's hook: set, it serves the role and no request leaves the machine. */
export const DECISION_SCRIPT_ENV_KEY = `${DECISION_ENV_PREFIX}_SCRIPT`

/** Whether the decision role resolved, and to what; never thrown, since unconfigured is a valid state. */
export type DecisionRouting =
  | {
      readonly configured: true
      readonly endpoint: ModelEndpointConfig
      readonly protocol: DecisionProtocol
      /** How long one call may take before it is unavailable as a timeout. */
      readonly timeoutMs: number
      /** Whether the model reads images; when not, an ask that carries one is unavailable at once. */
      readonly images: boolean
    }
  | { readonly configured: false; readonly reason: string }

export type ConfiguredDecisionRouting = Extract<DecisionRouting, { readonly configured: true }>

/** Every env var that configures the decision role — what a hermetic harness unsets. */
export function decisionEnvKeys(): string[] {
  return [
    `${DECISION_ENV_PREFIX}_BASE_URL`,
    `${DECISION_ENV_PREFIX}_MODEL`,
    `${DECISION_ENV_PREFIX}_API_KEY`,
    `${DECISION_ENV_PREFIX}_API_KEY_ENV`,
    DECISION_DEFAULT_KEY_ENV,
    DECISION_SCRIPT_ENV_KEY,
    DECISION_TIMEOUT_ENV_KEY,
    DECISION_IMAGES_ENV_KEY,
    DECISION_PROTOCOL_ENV_KEY,
  ]
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/**
 * Resolve the decision role: the key from `BINGBONG_DECISION_API_KEY`, the
 * env var named by `BINGBONG_DECISION_API_KEY_ENV`, or `TYPESAFE_API_KEY`;
 * the protocol, base URL, model, per-call timeout and whether images are sent by
 * override or default. A setting that does not parse leaves the role
 * unconfigured with the reason, never a guess at what was meant.
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
  const rawProtocol = readEnv(env, DECISION_PROTOCOL_ENV_KEY) ?? DECISION_DEFAULT_PROTOCOL
  const protocol = DECISION_PROTOCOLS.find((known) => known === rawProtocol)
  if (protocol === undefined) {
    return { configured: false, reason: `${DECISION_PROTOCOL_ENV_KEY} "${rawProtocol}" is not one this build speaks (${DECISION_PROTOCOLS.join(', ')})` }
  }
  const rawTimeout = readEnv(env, DECISION_TIMEOUT_ENV_KEY)
  const timeoutMs = rawTimeout === undefined ? DECISION_DEFAULT_TIMEOUT_MS : Number(rawTimeout)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return { configured: false, reason: `${DECISION_TIMEOUT_ENV_KEY} must be a whole number of ms above 0, got "${rawTimeout}"` }
  }
  const rawImages = readEnv(env, DECISION_IMAGES_ENV_KEY)
  const images = rawImages?.toLowerCase()
  if (images !== undefined && images !== 'true' && images !== 'false') {
    return { configured: false, reason: `${DECISION_IMAGES_ENV_KEY} must be true or false, got "${rawImages}"` }
  }
  return {
    configured: true,
    endpoint: {
      baseUrl: readEnv(env, `${DECISION_ENV_PREFIX}_BASE_URL`) ?? DECISION_DEFAULT_BASE_URL,
      model: readEnv(env, `${DECISION_ENV_PREFIX}_MODEL`) ?? DECISION_DEFAULT_MODEL,
      apiKey,
    },
    protocol,
    timeoutMs,
    images: images !== 'false',
  }
}
