// The decision role (ADR 0068): Jev, a Decision Model that answers typed
// questions — a Choice among named options, a Noul for whether a statement
// holds — and generates nothing. Unlike a generating model's routing it has
// defaults for everything but its key: the key alone is the arm marker.
// Everything is config (environment); both the base URL and the pinned
// model id are overridable.

import { CARD_BUDGET_ENV_KEY, cardBudgetTokens } from './cardBudget.ts'

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

/**
 * The Fallback Hosts (#477, ADR 0076 as amended): a comma list, in
 * `BINGBONG_GATE_MODELS`'s style, of the hosts an ask goes to after the
 * live one failed — a 429 or another status, a timeout, a transport fault,
 * a malformed answer — in order, the same bytes at once, no wait on the
 * one that failed. Each entry is `<model>` (on the live host and key, as
 * the gate reads a model) or `<model>|<base-url>|<key-env-name>`: the name
 * of the env var that holds the key, never the key. Empty by default,
 * which is one host and the behaviour before #477. A fallback should be a
 * gate model: a card the gate never measured on that model is a reading
 * nobody checked. `pnpm jev:gate`, `jev:replay` and the Planner never read
 * it — each asks exactly the model it names.
 */
export const DECISION_FALLBACKS_ENV_KEY = `${DECISION_ENV_PREFIX}_FALLBACKS`
/**
 * How long every attempt that has a host after it may take (#477): 2,250
 * ms, measured on the 162 answered asks in the kiosk's decision records to
 * 2026-10-26 — p50 1,227 ms, p95 2,142 ms, p99 2,739 ms, max 2,943 ms;
 * the p95 rounded up to the next 250 ms (7 of the 162 answers came later).
 * The last attempt keeps `BINGBONG_DECISION_TIMEOUT_MS`, so an empty list
 * costs exactly one timeout, as before.
 */
export const DECISION_DEFAULT_FALLBACK_TIMEOUT_MS = 2_250
const DECISION_FALLBACK_TIMEOUT_ENV_KEY = `${DECISION_ENV_PREFIX}_FALLBACK_TIMEOUT_MS`

/**
 * The most pixels an ask's image may have on either side (#477, ADR 0084
 * as amended): TypeSafe's image docs (docs.typesafe.ai/images, read
 * 2026-10-26) give "Width and height: 280 to 1568 pixels each", "an image
 * outside them is rejected, never resized to fit". The ledger's replay
 * agrees (turn-mvjdvzlf-3: 1568×882 answers, 1569×883 does not). One
 * number for every host, the smallest documented, as the Card Budget is
 * the smallest host's (ADR 0088); where the docs and the replay disagree,
 * the smaller wins. The Mark Ask's capture is scaled so its long edge is
 * at most this before it is sent; the marks keep their size relative to
 * the image.
 */
export const DECISION_IMAGE_LONG_EDGE_PX = 1568

/** The short side the same docs refuse under: a capture scaled to the long edge with a side under this is still refused (280 px), noted, not padded. */
export const DECISION_IMAGE_SHORT_EDGE_MIN_PX = 280

/**
 * The size an image is sent at (#477): as it is when its long edge is
 * within `DECISION_IMAGE_LONG_EDGE_PX`, else scaled down to it on both
 * sides, the aspect kept; `scale` is what every mark's box is multiplied
 * by. A 2560×1440 capture becomes 1568×882.
 */
export function fitImageToLongEdge(size: { readonly width: number; readonly height: number }, limit: number = DECISION_IMAGE_LONG_EDGE_PX): { width: number; height: number; scale: number } {
  const long = Math.max(size.width, size.height)
  if (!(long > limit)) return { width: size.width, height: size.height, scale: 1 }
  const scale = limit / long
  return { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), scale }
}

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
      /** The Card Budget (#406, ADR 0088), in the host's tokens: one number for every model. */
      readonly cardBudget: number
      /** The Fallback Hosts (#477), in order; empty for one host. */
      readonly fallbacks: readonly ModelEndpointConfig[]
      /** How long an attempt with a host after it may take (#477); the last keeps `timeoutMs`. */
      readonly fallbackTimeoutMs: number
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
    CARD_BUDGET_ENV_KEY,
    DECISION_FALLBACKS_ENV_KEY,
    DECISION_FALLBACK_TIMEOUT_ENV_KEY,
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
  const rawFallbackTimeout = readEnv(env, DECISION_FALLBACK_TIMEOUT_ENV_KEY)
  const fallbackTimeoutMs = rawFallbackTimeout === undefined ? DECISION_DEFAULT_FALLBACK_TIMEOUT_MS : Number(rawFallbackTimeout)
  if (!Number.isInteger(fallbackTimeoutMs) || fallbackTimeoutMs <= 0) {
    return { configured: false, reason: `${DECISION_FALLBACK_TIMEOUT_ENV_KEY} must be a whole number of ms above 0, got "${rawFallbackTimeout}"` }
  }
  const endpoint: ModelEndpointConfig = {
    baseUrl: readEnv(env, `${DECISION_ENV_PREFIX}_BASE_URL`) ?? DECISION_DEFAULT_BASE_URL,
    model: readEnv(env, `${DECISION_ENV_PREFIX}_MODEL`) ?? DECISION_DEFAULT_MODEL,
    apiKey,
  }
  const fallbacks = resolveFallbacks(env, endpoint)
  if ('reason' in fallbacks) return { configured: false, reason: fallbacks.reason }
  return {
    configured: true,
    endpoint,
    protocol,
    timeoutMs,
    images: images !== 'false',
    cardBudget: cardBudgetTokens(env),
    fallbacks: fallbacks.hosts,
    fallbackTimeoutMs,
  }
}

/**
 * The Fallback Hosts `BINGBONG_DECISION_FALLBACKS` names (#477), each
 * `<model>` on the live host and key or `<model>|<base-url>|<key-env-name>`;
 * an entry that does not parse, or names a key env that is unset, leaves
 * the role unconfigured with the reason — a fallback that would fail every
 * time is no fallback.
 */
function resolveFallbacks(env: Record<string, string | undefined>, live: ModelEndpointConfig): { hosts: ModelEndpointConfig[] } | { reason: string } {
  const raw = readEnv(env, DECISION_FALLBACKS_ENV_KEY)
  if (raw === undefined) return { hosts: [] }
  const hosts: ModelEndpointConfig[] = []
  for (const entry of raw.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
    const [model, baseUrl, keyEnvName, ...more] = entry.split('|').map((part) => part.trim())
    if (model === undefined || model === '' || more.length > 0 || (baseUrl !== undefined && (baseUrl === '' || keyEnvName === undefined || keyEnvName === ''))) {
      return { reason: `${DECISION_FALLBACKS_ENV_KEY} entry "${entry}" must be <model> or <model>|<base-url>|<key-env-name>` }
    }
    if (baseUrl === undefined) {
      hosts.push({ ...live, model })
      continue
    }
    const apiKey = readEnv(env, keyEnvName!)
    if (apiKey === undefined) return { reason: `${DECISION_FALLBACKS_ENV_KEY} entry "${entry}": ${keyEnvName} is not set` }
    hosts.push({ baseUrl, model, apiKey })
  }
  return { hosts }
}
