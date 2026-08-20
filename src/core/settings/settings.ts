// Dashboard-editable settings. Everything here mirrors config that otherwise
// comes from the environment (model routing, provider keys) or from later
// pipeline pieces (mic, wake word, TTS voice, weather). The settings file
// overrides env only where a value is set, so env stays the base layer.

import { AGENT_ROLES, routingEnvPrefix, type AgentRole } from '../agent/modelRouting'

export const WAKE_WORD_THRESHOLD_MIN = 0
export const WAKE_WORD_THRESHOLD_MAX = 1
/** Endpoint-delay slider bounds (#37): silence that ends an utterance. */
export const ENDPOINT_DELAY_MS_MIN = 200
export const ENDPOINT_DELAY_MS_MAX = 1500
export const ENDPOINT_DELAY_MS_DEFAULT = 500
/** Orchestrator tool-round ceiling — a runaway rail, not a budget. */
export const MAX_TOOL_ROUNDS_MIN = 10
export const MAX_TOOL_ROUNDS_MAX = 200
export const MAX_TOOL_ROUNDS_DEFAULT = 80

export type WeatherUnits = 'metric' | 'imperial'

export interface RoleRoutingSettings {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AppSettings {
  /** Provider keys used as the fallback key for roles without their own. */
  apiKeys: { zai?: string; deepseek?: string }
  /** Microphone device id from enumerateDevices; 'default' follows the OS. */
  micId: string
  wakeWordThreshold: number
  /** Silence (ms) that ends an utterance — the endpoint-delay slider (#37). */
  endpointDelayMs: number
  /** Orchestrator tool-round ceiling; applies to the next command, no restart. */
  maxToolRounds: number
  /** Piper voice id; '' follows BINGBONG_PIPER_VOICE / the default voice. */
  ttsVoice: string
  /** Kill switch for the embedder-level adblocker (issue #21). */
  adblockEnabled: boolean
  weather: { city: string; units: WeatherUnits }
  modelRouting: Record<AgentRole, RoleRoutingSettings>
}

export function defaultSettings(): AppSettings {
  return {
    apiKeys: {},
    micId: 'default',
    wakeWordThreshold: 0.5,
    endpointDelayMs: ENDPOINT_DELAY_MS_DEFAULT,
    maxToolRounds: MAX_TOOL_ROUNDS_DEFAULT,
    ttsVoice: '',
    adblockEnabled: true,
    weather: { city: '', units: 'metric' },
    modelRouting: {
      orchestrator: { baseUrl: '', model: '', apiKey: '' },
      subagent: { baseUrl: '', model: '', apiKey: '' },
      vision: { baseUrl: '', model: '', apiKey: '' },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asThreshold(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(WAKE_WORD_THRESHOLD_MAX, Math.max(WAKE_WORD_THRESHOLD_MIN, value))
}

function asEndpointDelay(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(ENDPOINT_DELAY_MS_MAX, Math.max(ENDPOINT_DELAY_MS_MIN, value))
}

function asMaxToolRounds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(MAX_TOOL_ROUNDS_MAX, Math.max(MAX_TOOL_ROUNDS_MIN, Math.round(value)))
}

function sanitizeRouting(value: unknown): RoleRoutingSettings {
  const record = asRecord(value)
  return {
    baseUrl: asString(record?.baseUrl, ''),
    model: asString(record?.model, ''),
    apiKey: asString(record?.apiKey, ''),
  }
}

/** Parse anything (disk, IPC) into valid settings; unknown bits fall back to defaults. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const defaults = defaultSettings()
  const record = asRecord(raw)
  if (!record) return defaults

  const keys = asRecord(record.apiKeys)
  const weather = asRecord(record.weather)
  const routing = asRecord(record.modelRouting)

  return {
    apiKeys: {
      ...(typeof keys?.zai === 'string' ? { zai: keys.zai } : {}),
      ...(typeof keys?.deepseek === 'string' ? { deepseek: keys.deepseek } : {}),
    },
    micId: asString(record.micId, defaults.micId),
    wakeWordThreshold: asThreshold(record.wakeWordThreshold, defaults.wakeWordThreshold),
    endpointDelayMs: asEndpointDelay(record.endpointDelayMs, defaults.endpointDelayMs),
    maxToolRounds: asMaxToolRounds(record.maxToolRounds, defaults.maxToolRounds),
    ttsVoice: asString(record.ttsVoice, defaults.ttsVoice),
    // Only an explicit false disables the engine — missing/garbage means on.
    adblockEnabled: record.adblockEnabled === false ? false : defaults.adblockEnabled,
    weather: {
      city: asString(weather?.city, defaults.weather.city),
      units: weather?.units === 'imperial' ? 'imperial' : defaults.weather.units,
    },
    modelRouting: {
      orchestrator: sanitizeRouting(routing?.orchestrator),
      subagent: sanitizeRouting(routing?.subagent),
      vision: sanitizeRouting(routing?.vision),
    },
  }
}

const ROLE_ENV_PREFIX: Record<AgentRole, string> = {
  orchestrator: routingEnvPrefix('orchestrator'),
  subagent: routingEnvPrefix('subagent'),
  vision: routingEnvPrefix('vision'),
}

function setIfPresent(env: Record<string, string>, name: string, value: string | undefined): void {
  if (typeof value === 'string' && value.trim() !== '') env[name] = value.trim()
}

/**
 * The env-var view of settings, layered over process.env by the caller. Only
 * set values appear, so an untouched field keeps its env config.
 */
export function settingsToEnv(settings: AppSettings): Record<string, string> {
  const env: Record<string, string> = {}
  setIfPresent(env, 'ZAI_API_KEY', settings.apiKeys.zai)
  setIfPresent(env, 'DEEPSEEK_API_KEY', settings.apiKeys.deepseek)
  for (const role of AGENT_ROLES) {
    const prefix = ROLE_ENV_PREFIX[role]
    const routing = settings.modelRouting[role]
    setIfPresent(env, `${prefix}_BASE_URL`, routing.baseUrl)
    setIfPresent(env, `${prefix}_MODEL`, routing.model)
    setIfPresent(env, `${prefix}_API_KEY`, routing.apiKey)
  }
  return env
}
