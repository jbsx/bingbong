import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  sanitizeSettings,
  settingsToEnv,
  ENDPOINT_DELAY_MS_MAX,
  ENDPOINT_DELAY_MS_MIN,
  RESUMPTION_MERGE_MS_MAX,
  RESUMPTION_MERGE_MS_MIN,
  WEB_ZOOM_PERCENT_MAX,
  WEB_ZOOM_PERCENT_MIN,
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
    expect(settings.endpointDelayMs).toBe(900)
    expect(settings.resumptionMergeMs).toBe(1500)
    expect(settings.webZoomPercent).toBe(130)
    expect(settings.ttsVoice).toBe('')
    expect(settings.sttModel).toBe('small')
    expect(settings.weather).toEqual({ city: '', units: 'metric' })
    expect(settings.adblockEnabled).toBe(true)
    expect(settings.appearance).toBe('system')
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
      endpointDelayMs: 650,
      resumptionMergeMs: 1_200,
      webZoomPercent: 100,
      ttsVoice: 'en_US-lessac-high',
      appearance: 'dark',
      weather: { city: 'Berlin', units: 'imperial' },
      modelRouting: {
        orchestrator: { baseUrl: 'https://x.test/v1', model: 'glm-4.6', apiKey: 'sk-1' },
      },
    })
    expect(settings.apiKeys).toEqual({ zai: 'k1', deepseek: 'k2' })
    expect(settings.wakeWordThreshold).toBe(0.8)
    expect(settings.endpointDelayMs).toBe(650)
    expect(settings.webZoomPercent).toBe(100)
    expect(settings.appearance).toBe('dark')
    expect(settings.weather).toEqual({ city: 'Berlin', units: 'imperial' })
    expect(settings.modelRouting.orchestrator).toEqual({ baseUrl: 'https://x.test/v1', model: 'glm-4.6', apiKey: 'sk-1' })
    expect(settings.modelRouting.subagent).toEqual(defaultSettings().modelRouting.subagent)
  })

  it('clamps the wake-word threshold into range', () => {
    expect(sanitizeSettings({ wakeWordThreshold: -1 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MIN)
    expect(sanitizeSettings({ wakeWordThreshold: 7 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MAX)
    expect(sanitizeSettings({ wakeWordThreshold: 'loud' }).wakeWordThreshold).toBe(defaultSettings().wakeWordThreshold)
  })

  it('clamps the endpoint delay into its slider range', () => {
    expect(sanitizeSettings({ endpointDelayMs: 10 }).endpointDelayMs).toBe(ENDPOINT_DELAY_MS_MIN)
    expect(sanitizeSettings({ endpointDelayMs: 90_000 }).endpointDelayMs).toBe(ENDPOINT_DELAY_MS_MAX)
    expect(sanitizeSettings({ resumptionMergeMs: 2_500 }).resumptionMergeMs).toBe(2_500)
    expect(sanitizeSettings({ resumptionMergeMs: -1 }).resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_MIN)
    expect(sanitizeSettings({ resumptionMergeMs: 60_000 }).resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_MAX)
    expect(sanitizeSettings({}).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    expect(sanitizeSettings({ resumptionMergeMs: 'soon' }).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    expect(sanitizeSettings({ resumptionMergeMs: null }).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    // Missing and garbage values fall back to the ~900 ms default (#37/#60).
    expect(sanitizeSettings({}).endpointDelayMs).toBe(defaultSettings().endpointDelayMs)
    expect(sanitizeSettings({ endpointDelayMs: 'soon' }).endpointDelayMs).toBe(defaultSettings().endpointDelayMs)
    expect(sanitizeSettings({ endpointDelayMs: null }).endpointDelayMs).toBe(defaultSettings().endpointDelayMs)
  })

  it('drops the retired maximum-round key from a migrated profile — no round limit lives in settings (#129)', () => {
    // A settings.json persisted before #129 carries maxToolRounds; the
    // sanitize fold ignores the unknown key and keeps everything else.
    // Round limits are product-owned Effort Tier budgets and the 32-round
    // hard ceiling (effortEpoch.ts) — never a user setting.
    const settings = sanitizeSettings({
      maxToolRounds: 120,
      endpointDelayMs: 650,
      webZoomPercent: 100,
      weather: { city: 'Berlin', units: 'metric' },
    })
    expect('maxToolRounds' in settings).toBe(false)
    expect(settings.endpointDelayMs).toBe(650)
    expect(settings.webZoomPercent).toBe(100)
    expect(settings.weather).toEqual({ city: 'Berlin', units: 'metric' })
    // A clean profile never sees the key at all.
    expect('maxToolRounds' in defaultSettings()).toBe(false)
  })

  it('clamps the web zoom into its slider range', () => {
    expect(sanitizeSettings({ webZoomPercent: 10 }).webZoomPercent).toBe(WEB_ZOOM_PERCENT_MIN)
    expect(sanitizeSettings({ webZoomPercent: 500 }).webZoomPercent).toBe(WEB_ZOOM_PERCENT_MAX)
    // Missing and garbage values fall back to the couch-readable default (#53).
    expect(sanitizeSettings({}).webZoomPercent).toBe(defaultSettings().webZoomPercent)
    expect(sanitizeSettings({ webZoomPercent: 'big' }).webZoomPercent).toBe(defaultSettings().webZoomPercent)
    expect(sanitizeSettings({ webZoomPercent: null }).webZoomPercent).toBe(defaultSettings().webZoomPercent)
  })

  it('keeps an explicit adblock kill switch but defaults to on', () => {
    expect(sanitizeSettings({ adblockEnabled: false }).adblockEnabled).toBe(false)
    expect(sanitizeSettings({}).adblockEnabled).toBe(true)
    expect(sanitizeSettings({ adblockEnabled: 'nope' }).adblockEnabled).toBe(true)
  })

  it('accepts only the three appearance literals and defaults to system', () => {
    expect(sanitizeSettings({ appearance: 'light' }).appearance).toBe('light')
    expect(sanitizeSettings({ appearance: 'dark' }).appearance).toBe('dark')
    expect(sanitizeSettings({ appearance: 'system' }).appearance).toBe('system')
    expect(sanitizeSettings({}).appearance).toBe('system')
    expect(sanitizeSettings({ appearance: 'auto' }).appearance).toBe('system')
    expect(sanitizeSettings({ appearance: 1 }).appearance).toBe('system')
  })

  it('keeps explicit STT tiers and defaults everything else to small (#63)', () => {
    expect(sanitizeSettings({ sttModel: 'medium' }).sttModel).toBe('medium')
    expect(sanitizeSettings({ sttModel: 'small' }).sttModel).toBe('small')
    expect(sanitizeSettings({ sttModel: 'base' }).sttModel).toBe('base')
    // Missing, unknown or garbage tiers keep the 4 GB hardware floor.
    expect(sanitizeSettings({}).sttModel).toBe('small')
    expect(sanitizeSettings({ sttModel: 'tiny' }).sttModel).toBe('small')
    expect(sanitizeSettings({ sttModel: true }).sttModel).toBe('small')
    expect(sanitizeSettings({ sttModel: null }).sttModel).toBe('small')
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
