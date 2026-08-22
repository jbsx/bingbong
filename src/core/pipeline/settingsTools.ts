import { AGENT_ROLES, type AgentRole } from '../agent/modelRouting'
import type { AppSettings } from '../settings/settings'
import type { Tool, ToolParameterSpec } from './tool'

// set_setting + app_control (#67, ADR 0006): every non-credential Setting is
// voice-reachable. set_setting writes through the same settings-store seam
// the settings page drives (get + update with a merged full object, so the
// sanitize fold validates and clamps exactly as a dashboard save would), so
// live consumers — wake threshold, endpoint delay, TTS voice, the adblock
// kill switch, web zoom, weather, model routing — apply the change without a
// restart. It fires immediately (tuning is reversible) and stays silent (the
// result string is the only ack — the same policy as the panel ops).
//
// Credentials, API keys, and mic selection are absent from the surface
// entirely: not in the enum, not in a parameter, not describable. They stay
// deliberate keyboard acts.
//
// app_control (quit/reload) is destructive: it rides the pipeline's existing
// yes/no confirmation via assessRisk, and on an approved execute it speaks a
// short ack through the app seam BEFORE acting — the user across the room
// hears that it happened even with eyes off the screen (and for quit, before
// the process can take the audio with it).

/** The settings-store seam the tool drives — satisfied by the main settings store. */
export interface SettingsControls {
  get(): AppSettings
  /** Sanitize, persist, broadcast. Returns the settings now in effect. */
  update(raw: unknown): AppSettings
}

/** The app-lifecycle seam — wired per window by main. */
export interface AppControls {
  quit(): void
  reload(): void
  /**
   * Speak the ack for a destructive op; resolves when playback finishes (or
   * fails — a dead speaker never blocks the confirmed action).
   */
  speakAck(text: string, turnId?: string): Promise<void>
}

/** The voice-reachable settings — credentials, keys, and mic stay keyboard-only. */
const SETTING_KEYS = [
  'wake_word_threshold',
  'endpoint_delay_ms',
  'tts_voice',
  'adblock_enabled',
  'web_zoom_percent',
  'weather_city',
  'weather_units',
  'model_routing_model',
  'model_routing_base_url',
] as const

type SettingKey = (typeof SETTING_KEYS)[number]

type ValueKind = 'number' | 'string' | 'boolean'

const SETTING_KINDS: Record<SettingKey, ValueKind> = {
  wake_word_threshold: 'number',
  endpoint_delay_ms: 'number',
  tts_voice: 'string',
  adblock_enabled: 'boolean',
  web_zoom_percent: 'number',
  weather_city: 'string',
  weather_units: 'string',
  model_routing_model: 'string',
  model_routing_base_url: 'string',
}

const ROUTING_SETTINGS: readonly SettingKey[] = ['model_routing_model', 'model_routing_base_url']

function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value)
}

/** A numeric arg may arrive as a string ("900"); media seek established the coercion. */
function numericArg(value: unknown): number | undefined {
  const coerced = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof coerced === 'number' && Number.isFinite(coerced) ? coerced : undefined
}

function typedValue(key: SettingKey, args: Record<string, unknown>): unknown {
  const kind = SETTING_KINDS[key]
  if (kind === 'number') {
    const value = numericArg(args.number_value)
    if (value === undefined) throw new Error(`set_setting: ${key} needs number_value`)
    return value
  }
  if (kind === 'boolean') {
    if (typeof args.boolean_value !== 'boolean') throw new Error(`set_setting: ${key} needs boolean_value`)
    return args.boolean_value
  }
  if (typeof args.string_value !== 'string') throw new Error(`set_setting: ${key} needs string_value`)
  return args.string_value
}

function routingRole(key: SettingKey, args: Record<string, unknown>): AgentRole {
  if (!isAgentRole(args.role)) {
    throw new Error(`set_setting: ${key} also needs 'role' (${AGENT_ROLES.join(', ')})`)
  }
  return args.role
}

/** The patch one call contributes, on top of the current settings. */
function patchFor(key: SettingKey, value: unknown, role: AgentRole | undefined): Record<string, unknown> {
  switch (key) {
    case 'wake_word_threshold':
      return { wakeWordThreshold: value }
    case 'endpoint_delay_ms':
      return { endpointDelayMs: value }
    case 'tts_voice':
      return { ttsVoice: value }
    case 'adblock_enabled':
      return { adblockEnabled: value }
    case 'web_zoom_percent':
      return { webZoomPercent: value }
    case 'weather_city':
      return { weather: { city: value } }
    case 'weather_units':
      return { weather: { units: value } }
    case 'model_routing_model':
      return { modelRouting: { [role!]: { model: value } } }
    case 'model_routing_base_url':
      return { modelRouting: { [role!]: { baseUrl: value } } }
  }
}

function describeEffect(key: SettingKey, settings: AppSettings, role: AgentRole | undefined): string {
  switch (key) {
    case 'wake_word_threshold':
      return `Wake word threshold set to ${settings.wakeWordThreshold}.`
    case 'endpoint_delay_ms':
      return `Endpoint delay set to ${settings.endpointDelayMs} ms.`
    case 'tts_voice':
      return settings.ttsVoice.trim() === ''
        ? 'TTS voice set to the default.'
        : `TTS voice set to ${settings.ttsVoice}.`
    case 'adblock_enabled':
      return settings.adblockEnabled ? 'Adblock enabled.' : 'Adblock disabled.'
    case 'web_zoom_percent':
      return `Web zoom set to ${settings.webZoomPercent}%.`
    case 'weather_city':
      return settings.weather.city.trim() === ''
        ? 'Weather city cleared.'
        : `Weather city set to ${settings.weather.city}.`
    case 'weather_units':
      return `Weather units set to ${settings.weather.units}.`
    case 'model_routing_model':
      return `${role} model set to ${settings.modelRouting[role!].model}.`
    case 'model_routing_base_url':
      return `${role} base URL set to ${settings.modelRouting[role!].baseUrl}.`
  }
}

/** Deep-merge a patch onto the current settings — nested objects merge, scalars replace. */
function mergedUpdate(current: AppSettings, patch: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const existing = raw[key]
    raw[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value) && typeof existing === 'object' && existing !== null
        ? { ...existing, ...value }
        : value
  }
  return raw
}

export function createSetSettingTool(settings: SettingsControls): Tool {
  const parameters: Record<string, ToolParameterSpec> = {
    setting: {
      type: 'string',
      enum: [...SETTING_KEYS],
      description:
        'The Setting to change: wake_word_threshold (0–1), endpoint_delay_ms (200–1500 silence that submits an utterance), ' +
        'tts_voice (Piper voice id), adblock_enabled, web_zoom_percent (75–200), weather_city, weather_units (metric|imperial), ' +
        'model_routing_model or model_routing_base_url (with role). Credentials, API keys and microphone are keyboard-only.',
    },
    number_value: {
      type: 'number',
      description: 'The new value for numeric settings (wake_word_threshold, endpoint_delay_ms, web_zoom_percent)',
      required: false,
    },
    string_value: {
      type: 'string',
      description:
        'The new value for string settings (tts_voice, weather_city, weather_units, model_routing_model, model_routing_base_url)',
      required: false,
    },
    boolean_value: {
      type: 'boolean',
      description: 'The new value for adblock_enabled',
      required: false,
    },
    role: {
      type: 'string',
      enum: [...AGENT_ROLES],
      description: 'Which model role a model_routing_* setting changes (required for those settings)',
      required: false,
    },
  }

  return {
    name: 'set_setting',
    description:
      'Change one of the app Settings by voice: wake word threshold, endpoint delay, TTS voice, adblock, ' +
      'web zoom, weather city/units, or model routing (model or base URL per role). Applies immediately with ' +
      'no confirmation. Credentials, API keys and microphone selection are not voice-reachable — the user ' +
      'must type those in the settings page.',
    parameters,
    execute: async (call) => {
      const key = call.args.setting
      if (!isSettingKey(key)) {
        throw new Error(`set_setting: 'setting' must be one of: ${SETTING_KEYS.join(', ')}`)
      }
      const value = typedValue(key, call.args)
      const role = ROUTING_SETTINGS.includes(key) ? routingRole(key, call.args) : undefined
      const updated = settings.update(mergedUpdate(settings.get(), patchFor(key, value, role)))
      return describeEffect(key, updated, role)
    },
  }
}

export function createAppControlTool(app: AppControls): Tool {
  const parameters: Record<string, ToolParameterSpec> = {
    action: {
      type: 'string',
      enum: ['quit', 'reload'],
      description: 'quit exits the whole app; reload restarts the dashboard window (the browsing session survives)',
    },
  }

  return {
    name: 'app_control',
    description:
      'Quit the app or reload its dashboard window. Always gated on a spoken yes/no confirmation; once ' +
      'confirmed, a short acknowledgment is spoken before the action runs. Use it to restart the app from ' +
      'across the room.',
    parameters,
    assessRisk: (call) => {
      if (call.args.action !== 'quit' && call.args.action !== 'reload') {
        return { kind: 'deny', reason: "app_control: 'action' must be 'quit' or 'reload'" }
      }
      return {
        kind: 'confirm',
        prompt: call.args.action === 'quit' ? 'Quit Bing Bong?' : 'Reload the app window?',
      }
    },
    execute: async (call, ctx) => {
      const action = call.args.action === 'quit' ? 'quit' : 'reload'
      // The ack precedes the action: for quit, nothing speaks after; for
      // reload, the dashboard is about to be replaced mid-run.
      await app.speakAck(action === 'quit' ? 'Quitting.' : 'Reloading.', ctx.turnId)
      if (action === 'quit') {
        app.quit()
        return 'Quitting.'
      }
      app.reload()
      return 'App window reloaded.'
    },
  }
}
