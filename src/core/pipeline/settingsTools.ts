import { AGENT_ROLES, type AgentRole } from '../agent/modelRouting'
import type { AppSettings } from '../settings/settings'
import { coercedNumber, type Tool, type ToolParameterSpec } from './tool'

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
  quit(): 'quitting'
  reload(): 'reloading' | 'unavailable'
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
  'resumption_merge_ms',
  'tts_voice',
  'adblock_enabled',
  'appearance',
  'web_zoom_percent',
  'weather_city',
  'weather_units',
  'stt_model',
  'max_tool_rounds',
  'model_routing_model',
  'model_routing_base_url',
] as const

type SettingKey = (typeof SETTING_KEYS)[number]

type ValueKind = 'number' | 'string' | 'boolean'

/**
 * One row per voice-reachable Setting: the value type it takes, the patch it
 * contributes on top of the current settings, and the line reporting the
 * effective value after the sanitize fold (clamped values read back clamped).
 * Adding a Setting means adding one row — nothing else in this file changes.
 */
interface SettingSpec {
  kind: ValueKind
  /** Restricts string values to exactly these (the fold would silently coerce garbage). */
  values?: readonly string[]
  /** The model-routing settings also need the `role` parameter. */
  routing?: boolean
  patch(value: unknown, role: AgentRole | undefined): Record<string, unknown>
  describe(settings: AppSettings, role: AgentRole | undefined): string
}

const SETTING_SPECS: Record<SettingKey, SettingSpec> = {
  wake_word_threshold: {
    kind: 'number',
    patch: (value) => ({ wakeWordThreshold: value }),
    describe: (s) => `Wake word threshold set to ${s.wakeWordThreshold}.`,
  },
  endpoint_delay_ms: {
    kind: 'number',
    patch: (value) => ({ endpointDelayMs: value }),
    describe: (s) => `Endpoint delay set to ${s.endpointDelayMs} ms.`,
  },
  resumption_merge_ms: {
    kind: 'number',
    patch: (value) => ({ resumptionMergeMs: value }),
    describe: (s) => (s.resumptionMergeMs === 0 ? 'Merge window disabled.' : `Merge window set to ${s.resumptionMergeMs} ms.`),
  },
  tts_voice: {
    kind: 'string',
    patch: (value) => ({ ttsVoice: value }),
    describe: (s) => (s.ttsVoice.trim() === '' ? 'TTS voice set to the default.' : `TTS voice set to ${s.ttsVoice}.`),
  },
  adblock_enabled: {
    kind: 'boolean',
    patch: (value) => ({ adblockEnabled: value }),
    describe: (s) => (s.adblockEnabled ? 'Adblock enabled.' : 'Adblock disabled.'),
  },
  appearance: {
    kind: 'string',
    values: ['system', 'light', 'dark'],
    patch: (value) => ({ appearance: value }),
    describe: (s) =>
      s.appearance === 'system'
        ? 'Appearance set to follow this computer\'s setting.'
        : `Appearance set to ${s.appearance}.`,
  },
  web_zoom_percent: {
    kind: 'number',
    patch: (value) => ({ webZoomPercent: value }),
    describe: (s) => `Web zoom set to ${s.webZoomPercent}%.`,
  },
  weather_city: {
    kind: 'string',
    patch: (value) => ({ weather: { city: value } }),
    describe: (s) => (s.weather.city.trim() === '' ? 'Weather city cleared.' : `Weather city set to ${s.weather.city}.`),
  },
  weather_units: {
    kind: 'string',
    values: ['metric', 'imperial'],
    patch: (value) => ({ weather: { units: value } }),
    describe: (s) => `Weather units set to ${s.weather.units}.`,
  },
  stt_model: {
    kind: 'string',
    values: ['base', 'small', 'medium'],
    // The tier loads at the next transcriber construction — a restart (#63).
    patch: (value) => ({ sttModel: value }),
    describe: (s) => `STT model set to ${s.sttModel}; it loads at the next restart.`,
  },
  max_tool_rounds: {
    kind: 'number',
    // Applies to the next command, no restart.
    patch: (value) => ({ maxToolRounds: value }),
    describe: (s) => `Max tool rounds set to ${s.maxToolRounds}.`,
  },
  model_routing_model: {
    kind: 'string',
    routing: true,
    patch: (value, role) => ({ modelRouting: { [role!]: { model: value } } }),
    describe: (s, role) => `${role} model set to ${s.modelRouting[role!].model}.`,
  },
  model_routing_base_url: {
    kind: 'string',
    routing: true,
    patch: (value, role) => ({ modelRouting: { [role!]: { baseUrl: value } } }),
    describe: (s, role) => `${role} base URL set to ${s.modelRouting[role!].baseUrl}.`,
  },
}

function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value)
}

function typedValue(key: SettingKey, args: Record<string, unknown>): unknown {
  const spec = SETTING_SPECS[key]
  if (spec.kind === 'number') {
    const value = coercedNumber(args.number_value)
    if (value === undefined) throw new Error(`set_setting: ${key} needs number_value`)
    return value
  }
  if (spec.kind === 'boolean') {
    if (typeof args.boolean_value !== 'boolean') throw new Error(`set_setting: ${key} needs boolean_value`)
    return args.boolean_value
  }
  if (typeof args.string_value !== 'string') throw new Error(`set_setting: ${key} needs string_value`)
  if (spec.values && !spec.values.includes(args.string_value)) {
    throw new Error(`set_setting: ${key} must be one of: ${spec.values.join(', ')}`)
  }
  return args.string_value
}

function routingRole(key: SettingKey, args: Record<string, unknown>): AgentRole {
  if (!isAgentRole(args.role)) {
    throw new Error(`set_setting: ${key} also needs 'role' (${AGENT_ROLES.join(', ')})`)
  }
  return args.role
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
        'resumption_merge_ms (0–3000 silence held for resumed speech before submitting, 0 off), tts_voice (Piper voice id), ' +
        'adblock_enabled, appearance (system|light|dark), web_zoom_percent (75–200), weather_city, weather_units ' +
        '(metric|imperial), stt_model (base|small|medium), max_tool_rounds, model_routing_model or model_routing_base_url ' +
        '(with role). Credentials, API keys and microphone are keyboard-only.',
    },
    number_value: {
      type: 'number',
      description:
        'The new value for numeric settings (wake_word_threshold, endpoint_delay_ms, resumption_merge_ms, web_zoom_percent, max_tool_rounds)',
      required: false,
    },
    string_value: {
      type: 'string',
      description:
        'The new value for string settings (tts_voice, weather_city, weather_units, appearance, stt_model, model_routing_model, model_routing_base_url)',
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
      'Change one of the app Settings by voice: wake word threshold, endpoint delay, merge window, TTS voice, adblock, ' +
      'appearance (system, light, or dark), web zoom, weather city/units, STT model, tool-round ceiling, or model routing ' +
      '(model or base URL per role). Applies immediately with no confirmation. Credentials, API keys and microphone ' +
      'selection are not voice-reachable — the user must type those in the settings page. Returns the resulting ' +
      'persisted value, which is sufficient verification; do not inspect the browser to confirm it.',
    parameters,
    execute: async (call) => {
      const key = call.args.setting
      if (!isSettingKey(key)) {
        throw new Error(`set_setting: 'setting' must be one of: ${SETTING_KEYS.join(', ')}`)
      }
      const spec = SETTING_SPECS[key]
      const value = typedValue(key, call.args)
      const role = spec.routing ? routingRole(key, call.args) : undefined
      const updated = settings.update(mergedUpdate(settings.get(), spec.patch(value, role)))
      return spec.describe(updated, role)
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
      'across the room. Returns the resulting application lifecycle state when execution remains observable.',
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
      const lifecycle = action === 'quit' ? app.quit() : app.reload()
      return `application: lifecycle=${lifecycle}`
    },
  }
}
