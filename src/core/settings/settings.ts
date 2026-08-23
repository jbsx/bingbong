// Dashboard-editable settings. Everything here mirrors config that otherwise
// comes from the environment (model routing, provider keys) or from later
// pipeline pieces (mic, wake word, TTS voice, weather). The settings file
// overrides env only where a value is set, so env stays the base layer.

import { AGENT_ROLES, routingEnvPrefix, type AgentRole } from '../agent/modelRouting.ts'

export const WAKE_WORD_THRESHOLD_MIN = 0
export const WAKE_WORD_THRESHOLD_MAX = 1
/** Endpoint-delay slider bounds (#37): silence that ends an utterance. */
export const ENDPOINT_DELAY_MS_MIN = 200
export const ENDPOINT_DELAY_MS_MAX = 1500
/** Raised 500 → 900 ms (#60): half-commands from mid-sentence pauses die here. */
export const ENDPOINT_DELAY_MS_DEFAULT = 900
/**
 * Resumption-merge window bounds (#60/#59): silence held after the endpoint
 * before the utterance submits. 0 disables the hold — the endpoint submits
 * directly.
 */
export const RESUMPTION_MERGE_MS_MIN = 0
export const RESUMPTION_MERGE_MS_MAX = 3_000
export const RESUMPTION_MERGE_MS_DEFAULT = 1_500
/** Orchestrator tool-round ceiling — a runaway rail, not a budget. */
export const MAX_TOOL_ROUNDS_MIN = 10
export const MAX_TOOL_ROUNDS_MAX = 200
export const MAX_TOOL_ROUNDS_DEFAULT = 80
/** Web-zoom slider bounds (#53): readable-from-the-couch page zoom. */
export const WEB_ZOOM_PERCENT_MIN = 75
export const WEB_ZOOM_PERCENT_MAX = 200
export const WEB_ZOOM_PERCENT_DEFAULT = 130

export type WeatherUnits = 'metric' | 'imperial'

/**
 * STT engine tier (#63): Base is the default everywhere (the hardware
 * floor target is 4 GB RAM); Medium is the opt-in for capable hardware,
 * applied when the transcriber is constructed — a restart.
 */
export type SttModel = 'base' | 'medium'

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
  /**
   * Silence (ms) held after the endpoint before submission (#60): speech
   * resuming inside the window rejoins the utterance. 0 disables the hold.
   */
  resumptionMergeMs: number
  /** Orchestrator tool-round ceiling; applies to the next command, no restart. */
  maxToolRounds: number
  /** Page zoom for the main pane and subagent panes, in percent (#53). */
  webZoomPercent: number
  /** Piper voice id; '' follows BINGBONG_PIPER_VOICE / the default voice. */
  ttsVoice: string
  /** STT engine tier — loads at the next transcriber construction (#63). */
  sttModel: SttModel
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
    resumptionMergeMs: RESUMPTION_MERGE_MS_DEFAULT,
    maxToolRounds: MAX_TOOL_ROUNDS_DEFAULT,
    webZoomPercent: WEB_ZOOM_PERCENT_DEFAULT,
    ttsVoice: '',
    sttModel: 'base',
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

function asResumptionMerge(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(RESUMPTION_MERGE_MS_MAX, Math.max(RESUMPTION_MERGE_MS_MIN, Math.round(value)))
}

function asMaxToolRounds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(MAX_TOOL_ROUNDS_MAX, Math.max(MAX_TOOL_ROUNDS_MIN, Math.round(value)))
}

function asWebZoomPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(WEB_ZOOM_PERCENT_MAX, Math.max(WEB_ZOOM_PERCENT_MIN, Math.round(value)))
}

/** Anything that is not an explicit 'medium' stays on the Base tier (#63). */
export function asSttModel(value: unknown): SttModel {
  return value === 'medium' ? 'medium' : 'base'
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
    resumptionMergeMs: asResumptionMerge(record.resumptionMergeMs, defaults.resumptionMergeMs),
    maxToolRounds: asMaxToolRounds(record.maxToolRounds, defaults.maxToolRounds),
    webZoomPercent: asWebZoomPercent(record.webZoomPercent, defaults.webZoomPercent),
    ttsVoice: asString(record.ttsVoice, defaults.ttsVoice),
    // Only an explicit opt-in raises the tier — anything else stays Base.
    sttModel: asSttModel(record.sttModel),
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
