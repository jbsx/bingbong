import { describe, expect, it } from 'vitest'
import { createAppControlTool, createSetSettingTool } from './settingsTools'
import { FakeAppControls, FakeClock, FakeSettings } from '../testing/doubles'
import type { ToolCall } from '../ports/llm'

// set_setting + app_control (#67, ADR 0006): every non-credential Setting is
// voice-reachable and applies immediately — one typed write into the same
// settings-store seam the settings page drives, so live consumers (wake
// threshold, endpoint delay, TTS voice, adblock kill switch, web zoom,
// weather, model routing) pick the change up without a restart. Credentials,
// API keys and mic selection are absent from the surface entirely — they are
// keyboard-only by design. app_control (quit/reload) rides the existing
// yes/no confirmation gate and speaks its ack before acting (destructive ops
// speak; set_setting, like panel ops, stays silent: the result string is the
// only acknowledgment).

function callOf(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, args }
}

const ctx = () => ({ clock: new FakeClock() })

async function executeSetting(
  args: Record<string, unknown>,
): Promise<{ settings: FakeSettings; result: unknown }> {
  const settings = new FakeSettings()
  const result = await createSetSettingTool(settings).execute(callOf('set_setting', args), ctx())
  return { settings, result }
}

describe('createSetSettingTool', () => {
  it('is exactly set_setting, firing immediately: no risk gate, no ask, no history gating', () => {
    const tool = createSetSettingTool(new FakeSettings())
    expect(tool.name).toBe('set_setting')
    expect(tool.assessRisk).toBeUndefined()
    expect(tool.askUser).toBeUndefined()
    expect(tool.requiresHistory).not.toBe(true)
  })

  it('sets numeric settings through the store seam, reporting the effective (clamped) value', async () => {
    const { settings, result } = await executeSetting({ setting: 'wake_word_threshold', number_value: 0.65 })
    expect(settings.get().wakeWordThreshold).toBe(0.65)
    expect(result).toBe('Wake word threshold set to 0.65.')

    const zoom = await executeSetting({ setting: 'web_zoom_percent', number_value: 500 })
    expect(zoom.settings.get().webZoomPercent).toBe(200)
    expect(zoom.result).toBe('Web zoom set to 200%.')
  })

  it('sets the endpoint delay', async () => {
    const { settings, result } = await executeSetting({ setting: 'endpoint_delay_ms', number_value: 1200 })
    expect(settings.get().endpointDelayMs).toBe(1200)
    expect(result).toBe('Endpoint delay set to 1200 ms.')
  })

  it('sets the resumption-merge window — 0 disables the hold', async () => {
    const { settings, result } = await executeSetting({ setting: 'resumption_merge_ms', number_value: 2_200 })
    expect(settings.get().resumptionMergeMs).toBe(2_200)
    expect(result).toBe('Merge window set to 2200 ms.')

    const off = await executeSetting({ setting: 'resumption_merge_ms', number_value: 0 })
    expect(off.settings.get().resumptionMergeMs).toBe(0)
    expect(off.result).toBe('Merge window disabled.')
  })

  it('sets string settings: tts voice and weather city', async () => {
    const voice = await executeSetting({ setting: 'tts_voice', string_value: 'en_US-lessac-medium' })
    expect(voice.settings.get().ttsVoice).toBe('en_US-lessac-medium')
    expect(voice.result).toBe('TTS voice set to en_US-lessac-medium.')

    const city = await executeSetting({ setting: 'weather_city', string_value: 'Berlin' })
    expect(city.settings.get().weather.city).toBe('Berlin')
    expect(city.result).toBe('Weather city set to Berlin.')
  })

  it('sets boolean settings: adblock on and off', async () => {
    const off = await executeSetting({ setting: 'adblock_enabled', boolean_value: false })
    expect(off.settings.get().adblockEnabled).toBe(false)
    expect(off.result).toBe('Adblock disabled.')

    const on = await executeSetting({ setting: 'adblock_enabled', boolean_value: true })
    expect(on.settings.get().adblockEnabled).toBe(true)
    expect(on.result).toBe('Adblock enabled.')
  })

  it('sets weather units between metric and imperial', async () => {
    const { settings, result } = await executeSetting({ setting: 'weather_units', string_value: 'imperial' })
    expect(settings.get().weather.units).toBe('imperial')
    expect(result).toBe('Weather units set to imperial.')
  })

  it('sets model routing per role — model and base URL, never keys', async () => {
    const model = await executeSetting({
      setting: 'model_routing_model',
      role: 'subagent',
      string_value: 'deepseek-chat',
    })
    expect(model.settings.get().modelRouting.subagent.model).toBe('deepseek-chat')
    expect(model.result).toBe('subagent model set to deepseek-chat.')

    const baseUrl = await executeSetting({
      setting: 'model_routing_base_url',
      role: 'orchestrator',
      string_value: 'https://api.deepseek.com/v1',
    })
    expect(baseUrl.settings.get().modelRouting.orchestrator.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(baseUrl.result).toBe('orchestrator base URL set to https://api.deepseek.com/v1.')
  })

  it('sets the STT tier, rejecting a value the fold would silently coerce', async () => {
    const { settings, result } = await executeSetting({ setting: 'stt_model', string_value: 'medium' })
    expect(settings.get().sttModel).toBe('medium')
    expect(result).toBe('STT model set to medium; it loads at the next restart.')

    const invalid = new FakeSettings()
    const tool = createSetSettingTool(invalid)
    await expect(
      tool.execute(callOf('set_setting', { setting: 'stt_model', string_value: 'giant' }), ctx()),
    ).rejects.toThrow(/stt_model must be one of: base, medium/)
    expect(invalid.updates).toEqual([])
  })

  it('sets the tool-round ceiling, clamped by the fold', async () => {
    const { settings, result } = await executeSetting({ setting: 'max_tool_rounds', number_value: 5 })
    expect(settings.get().maxToolRounds).toBe(10)
    expect(result).toBe('Max tool rounds set to 10.')
  })

  it('merges the patch onto the current settings — unrelated values survive a set', async () => {
    const settings = new FakeSettings()
    settings.update({ ...settings.get(), ttsVoice: 'en_US-amy-medium', weather: { city: 'Oslo', units: 'metric' } })
    expect(settings.updates).toHaveLength(1)

    await createSetSettingTool(settings).execute(
      callOf('set_setting', { setting: 'web_zoom_percent', number_value: 90 }),
      ctx(),
    )

    const raw = settings.updates[1] as Record<string, unknown>
    expect(raw.ttsVoice).toBe('en_US-amy-medium')
    expect(raw.weather).toEqual({ city: 'Oslo', units: 'metric' })
    expect(settings.get().webZoomPercent).toBe(90)
    expect(settings.get().ttsVoice).toBe('en_US-amy-medium')
  })

  it('rejects a setting outside the enum without touching the store', async () => {
    const settings = new FakeSettings()
    const tool = createSetSettingTool(settings)

    await expect(
      tool.execute(callOf('set_setting', { setting: 'api_key', string_value: 'nope' }), ctx()),
    ).rejects.toThrow(/'setting' must be one of/)
    await expect(
      tool.execute(callOf('set_setting', { setting: 'mic_id', string_value: 'nope' }), ctx()),
    ).rejects.toThrow(/'setting' must be one of/)
    expect(settings.updates).toEqual([])
  })

  it('rejects a missing or wrongly typed value without touching the store', async () => {
    const settings = new FakeSettings()
    const tool = createSetSettingTool(settings)

    await expect(tool.execute(callOf('set_setting', { setting: 'wake_word_threshold' }), ctx())).rejects.toThrow(
      /wake_word_threshold needs number_value/,
    )
    await expect(
      tool.execute(callOf('set_setting', { setting: 'adblock_enabled', number_value: 1 }), ctx()),
    ).rejects.toThrow(/adblock_enabled needs boolean_value/)
    await expect(
      tool.execute(callOf('set_setting', { setting: 'weather_city', number_value: 7 }), ctx()),
    ).rejects.toThrow(/weather_city needs string_value/)
    expect(settings.updates).toEqual([])
  })

  it('rejects model routing without a role', async () => {
    const settings = new FakeSettings()
    const tool = createSetSettingTool(settings)

    await expect(
      tool.execute(callOf('set_setting', { setting: 'model_routing_model', string_value: 'glm-4.6' }), ctx()),
    ).rejects.toThrow(/model_routing_model also needs 'role'/)
    expect(settings.updates).toEqual([])
  })

  it('exposes every non-credential setting in its parameter enum — credentials, keys, mic absent', () => {
    const tool = createSetSettingTool(new FakeSettings())
    expect(Object.keys(tool.parameters ?? {}).sort()).toEqual(
      ['boolean_value', 'number_value', 'role', 'setting', 'string_value'].sort(),
    )
    expect(tool.parameters?.['setting']?.enum).toEqual([
      'wake_word_threshold',
      'endpoint_delay_ms',
      'resumption_merge_ms',
      'tts_voice',
      'adblock_enabled',
      'web_zoom_percent',
      'weather_city',
      'weather_units',
      'stt_model',
      'max_tool_rounds',
      'model_routing_model',
      'model_routing_base_url',
    ])
    expect(tool.parameters?.['role']?.enum).toEqual(['orchestrator', 'subagent', 'vision'])
  })
})

describe('createAppControlTool', () => {
  it('is exactly app_control with quit/reload as the only actions', () => {
    const tool = createAppControlTool(new FakeAppControls())
    expect(tool.name).toBe('app_control')
    expect(Object.keys(tool.parameters ?? {})).toEqual(['action'])
    expect(tool.parameters?.['action']?.enum).toEqual(['quit', 'reload'])
    expect(tool.requiresHistory).not.toBe(true)
    expect(tool.askUser).toBeUndefined()
  })

  it('gates quit behind the yes/no confirmation', () => {
    const tool = createAppControlTool(new FakeAppControls())
    expect(tool.assessRisk?.(callOf('app_control', { action: 'quit' }))).toEqual({
      kind: 'confirm',
      prompt: 'Quit Bing Bong?',
    })
  })

  it('gates reload behind the yes/no confirmation', () => {
    const tool = createAppControlTool(new FakeAppControls())
    expect(tool.assessRisk?.(callOf('app_control', { action: 'reload' }))).toEqual({
      kind: 'confirm',
      prompt: 'Reload the app window?',
    })
  })

  it('denies an unknown action outright — no dialog, no execution', () => {
    const app = new FakeAppControls()
    const tool = createAppControlTool(app)
    expect(tool.assessRisk?.(callOf('app_control', { action: 'shutdown' }))).toMatchObject({ kind: 'deny' })
    expect(app.calls).toEqual([])
  })

  it('speaks the ack before quitting on an approved execute', async () => {
    const app = new FakeAppControls()
    const tool = createAppControlTool(app)

    const result = await tool.execute(callOf('app_control', { action: 'quit' }), ctx())

    expect(app.calls).toEqual(['ack:Quitting.', 'quit'])
    expect(result).toBe('Quitting.')
  })

  it('speaks the ack before reloading on an approved execute', async () => {
    const app = new FakeAppControls()
    const tool = createAppControlTool(app)

    const result = await tool.execute(callOf('app_control', { action: 'reload' }), ctx())

    expect(app.calls).toEqual(['ack:Reloading.', 'reload'])
    expect(result).toBe('App window reloaded.')
  })
})
