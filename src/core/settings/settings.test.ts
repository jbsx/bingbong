import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  sanitizeSettings,
  settingsToEnv,
  WAKE_WORD_THRESHOLD_MAX,
  WAKE_WORD_THRESHOLD_MIN,
} from './settings'

describe('defaultSettings', () => {
  it('has sensible defaults and no secrets', () => {
    const settings = defaultSettings()
    expect(settings.apiKeys).toEqual({})
    expect(settings.micId).toBe('default')
    expect(settings.wakeWordThreshold).toBeGreaterThan(0)
    expect(settings.wakeWordThreshold).toBeLessThanOrEqual(1)
    expect(settings.ttsVoice).toBe('')
    expect(settings.weather).toEqual({ city: '', units: 'metric' })
    for (const role of ['orchestrator', 'subagent', 'vision'] as const) {
      expect(settings.modelRouting[role]).toEqual({ baseUrl: '', model: '', apiKey: '' })
    }
  })
})

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings())
    expect(sanitizeSettings(undefined)).toEqual(defaultSettings())
    expect(sanitizeSettings('nope')).toEqual(defaultSettings())
    expect(sanitizeSettings(42)).toEqual(defaultSettings())
  })

  it('fills missing fields from defaults', () => {
    const settings = sanitizeSettings({ micId: 'mic-123' })
    expect(settings.micId).toBe('mic-123')
    expect(settings.weather).toEqual(defaultSettings().weather)
  })

  it('keeps valid values', () => {
    const settings = sanitizeSettings({
      apiKeys: { zai: 'k1', deepseek: 'k2' },
      micId: 'abc',
      wakeWordThreshold: 0.8,
      ttsVoice: 'en_US-lessac-high',
      weather: { city: 'Berlin', units: 'imperial' },
      modelRouting: {
        orchestrator: { baseUrl: 'https://x.test/v1', model: 'glm-4.6', apiKey: 'sk-1' },
      },
    })
    expect(settings.apiKeys).toEqual({ zai: 'k1', deepseek: 'k2' })
    expect(settings.wakeWordThreshold).toBe(0.8)
    expect(settings.weather).toEqual({ city: 'Berlin', units: 'imperial' })
    expect(settings.modelRouting.orchestrator).toEqual({ baseUrl: 'https://x.test/v1', model: 'glm-4.6', apiKey: 'sk-1' })
    expect(settings.modelRouting.subagent).toEqual(defaultSettings().modelRouting.subagent)
  })

  it('clamps the wake-word threshold into range', () => {
    expect(sanitizeSettings({ wakeWordThreshold: -1 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MIN)
    expect(sanitizeSettings({ wakeWordThreshold: 7 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MAX)
    expect(sanitizeSettings({ wakeWordThreshold: 'loud' }).wakeWordThreshold).toBe(defaultSettings().wakeWordThreshold)
  })

  it('drops unknown weather units and non-string fields', () => {
    const settings = sanitizeSettings({
      weather: { city: 5, units: 'kelvin' },
      micId: {},
      ttsVoice: null,
      apiKeys: { zai: 123 },
    })
    expect(settings.weather).toEqual(defaultSettings().weather)
    expect(settings.micId).toBe('default')
    expect(settings.ttsVoice).toBe('')
    expect(settings.apiKeys).toEqual({})
  })
})

describe('settingsToEnv', () => {
  it('maps empty settings to no overrides', () => {
    expect(settingsToEnv(defaultSettings())).toEqual({})
  })

  it('maps provider keys to their env names', () => {
    const env = settingsToEnv({ ...defaultSettings(), apiKeys: { zai: 'z', deepseek: 'd' } })
    expect(env).toEqual({ ZAI_API_KEY: 'z', DEEPSEEK_API_KEY: 'd' })
  })

  it('maps model routing to the per-role env vars, skipping blanks', () => {
    const settings = defaultSettings()
    settings.modelRouting.orchestrator = { baseUrl: 'https://x.test/v1', model: 'glm-4.6', apiKey: 'sk-1' }
    settings.modelRouting.subagent = { baseUrl: '', model: 'deepseek-chat', apiKey: '' }
    const env = settingsToEnv(settings)
    expect(env).toEqual({
      BINGBONG_ORCHESTRATOR_BASE_URL: 'https://x.test/v1',
      BINGBONG_ORCHESTRATOR_MODEL: 'glm-4.6',
      BINGBONG_ORCHESTRATOR_API_KEY: 'sk-1',
      BINGBONG_SUBAGENT_MODEL: 'deepseek-chat',
    })
  })
})
