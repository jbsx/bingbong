import { describe, expect, it } from 'vitest'
import { profileSubreddits } from '../news/interestProfile'
import {
  defaultSettings,
  HOT_LISTEN_SILENCE_MS_MAX,
  HOT_LISTEN_SILENCE_MS_MIN,
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
    expect(settings.micId).toBe('default')
    expect(settings.wakeWordThreshold).toBeGreaterThan(0)
    expect(settings.wakeWordThreshold).toBeLessThanOrEqual(1)
    // ADR 0076 (#324): released 300 ms into silence, with no merge hold.
    expect(settings.endpointDelayMs).toBe(300)
    expect(settings.hotListenSilenceMs).toBe(8_000)
    expect(settings.resumptionMergeMs).toBe(0)
    expect(settings.webZoomPercent).toBe(130)
    expect(settings.ttsVoice).toBe('')
    expect(settings.sttModel).toBe('small')
    expect(settings.weather).toEqual({ city: '', units: 'metric' })
    expect(settings.adblockEnabled).toBe(true)
    expect(settings.appearance).toBe('system')
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
      micId: 'abc',
      wakeWordThreshold: 0.8,
      endpointDelayMs: 650,
      resumptionMergeMs: 1_200,
      webZoomPercent: 100,
      ttsVoice: 'en_US-lessac-high',
      appearance: 'dark',
      weather: { city: 'Berlin', units: 'imperial' },
    })
    expect(settings.wakeWordThreshold).toBe(0.8)
    expect(settings.endpointDelayMs).toBe(650)
    expect(settings.webZoomPercent).toBe(100)
    expect(settings.appearance).toBe('dark')
    expect(settings.weather).toEqual({ city: 'Berlin', units: 'imperial' })
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
    // Missing and garbage values fall back to the 300 ms default (#37/#60, ADR 0076).
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
    })
    expect(settings.weather).toEqual(defaultSettings().weather)
    expect(settings.micId).toBe('default')
    expect(settings.ttsVoice).toBe('')
  })
})

describe('settingsToEnv', () => {
  it('maps empty settings to no overrides', () => {
    expect(settingsToEnv(defaultSettings())).toEqual({})
  })
})

describe('hotListenSilenceMs (#326)', () => {
  it('keeps a value inside its bounds, clamps one outside, and falls back on garbage', () => {
    expect(sanitizeSettings({ hotListenSilenceMs: 12_000 }).hotListenSilenceMs).toBe(12_000)
    expect(sanitizeSettings({ hotListenSilenceMs: 10 }).hotListenSilenceMs).toBe(HOT_LISTEN_SILENCE_MS_MIN)
    expect(sanitizeSettings({ hotListenSilenceMs: 999_999 }).hotListenSilenceMs).toBe(HOT_LISTEN_SILENCE_MS_MAX)
    expect(sanitizeSettings({ hotListenSilenceMs: 'soon' }).hotListenSilenceMs).toBe(8_000)
  })
})

describe('news (#346)', () => {
  it('defaults to the seven Interest Profile topics and pins the News card', () => {
    const settings = defaultSettings()
    expect(settings.news.topics.map((topic) => topic.name)).toEqual([
      'AI coding agents and harnesses',
      'Frontier AI research',
      'Developer tooling and terminal culture',
      'Startups, product and business',
      'Markets and finance',
      'The Musk orbit',
      'One-offs',
    ])
    expect(settings.idleCards).toContain('news')
  })

  it('keeps an edited profile, an empty one included', () => {
    expect(sanitizeSettings({ news: { topics: [{ name: ' Chess ', words: [' chess ', '', 7], subreddits: [' chess ', 3] }] } }).news.topics).toEqual([
      { name: 'Chess', words: ['chess'], subreddits: ['chess'] },
    ])
    expect(sanitizeSettings({ news: { topics: [] } }).news.topics).toEqual([])
  })
})

describe('news sources (#348)', () => {
  it('defaults to a subreddit or two per topic and the labs’ and press feeds', () => {
    const { news } = defaultSettings()
    expect(news.topics.find((topic) => topic.name === 'The Musk orbit')?.subreddits).toEqual(['teslamotors', 'SpaceX'])
    expect(news.feeds.map((feed) => feed.name)).toEqual(['OpenAI', 'Anthropic', 'Google DeepMind', 'Ars Technica', 'The Verge', 'Electrek'])
  })

  it('gives a topic saved before subreddits existed its default topic’s, and keeps one emptied as none', () => {
    const topics = sanitizeSettings({ news: { topics: [{ name: 'One-offs', words: ['chess'] }, { name: 'Mine', words: ['x'] }, { name: 'The Musk orbit', words: [], subreddits: [] }] } }).news.topics
    expect(topics.map((topic) => topic.subreddits)).toEqual([['chess'], [], []])
  })

  it('polls each subreddit once however it was typed, and none that names no subreddit', () => {
    const topics = sanitizeSettings({ news: { topics: [{ name: 'A', words: [], subreddits: ['r/NeoVim', 'r/', '/'] }, { name: 'B', words: [], subreddits: ['neovim', 'rust'] }] } }).news.topics
    expect(profileSubreddits(topics)).toEqual(['r/NeoVim', 'rust'])
  })

  it('keeps an edited feed list, an empty one included, and defaults one saved before feeds existed', () => {
    expect(sanitizeSettings({ news: { topics: [], feeds: [{ name: ' Electrek ', url: ' https://electrek.co/feed/ ' }, { name: 3 }] } }).news.feeds).toEqual([
      { name: 'Electrek', url: 'https://electrek.co/feed/' },
    ])
    expect(sanitizeSettings({ news: { topics: [], feeds: [] } }).news.feeds).toEqual([])
    expect(sanitizeSettings({ news: { topics: [] } }).news.feeds).toHaveLength(6)
  })

  it('adds the News card to Pinned Cards saved before it existed, but keeps it off once unpinned', () => {
    expect(sanitizeSettings({ idleCards: ['calendar', 'weather'] }).idleCards).toEqual(['calendar', 'weather', 'news'])
    expect(sanitizeSettings({ idleCards: ['calendar', 'weather'], news: { topics: [] } }).idleCards).toEqual(['calendar', 'weather'])
  })
})
