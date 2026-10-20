import { describe, expect, it } from 'vitest'
import { withoutPerson } from '../scale/weightSettings'
import { profileSubreddits } from '../news/interestProfile'
import {
  defaultSettings,
  HOT_LISTEN_SILENCE_MS_MAX,
  HOT_LISTEN_SILENCE_MS_MIN,
  sanitizeSettings,
  settingsToEnv,
  PAUSE_CAP_MS_MAX,
  PAUSE_CAP_MS_MIN,
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
    // ADR 0076 amendment 2026-10-20 (#357): the turn check decides, a 2 s pause caps it, with no merge hold.
    expect(settings.pauseCapMs).toBe(2_000)
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
      pauseCapMs: 650,
      resumptionMergeMs: 1_200,
      webZoomPercent: 100,
      ttsVoice: 'en_US-lessac-high',
      appearance: 'dark',
      weather: { city: 'Berlin', units: 'imperial' },
    })
    expect(settings.wakeWordThreshold).toBe(0.8)
    expect(settings.pauseCapMs).toBe(650)
    expect(settings.webZoomPercent).toBe(100)
    expect(settings.appearance).toBe('dark')
    expect(settings.weather).toEqual({ city: 'Berlin', units: 'imperial' })
  })

  it('clamps the wake-word threshold into range', () => {
    expect(sanitizeSettings({ wakeWordThreshold: -1 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MIN)
    expect(sanitizeSettings({ wakeWordThreshold: 7 }).wakeWordThreshold).toBe(WAKE_WORD_THRESHOLD_MAX)
    expect(sanitizeSettings({ wakeWordThreshold: 'loud' }).wakeWordThreshold).toBe(defaultSettings().wakeWordThreshold)
  })

  it('clamps the pause cap into its slider range', () => {
    expect(sanitizeSettings({ pauseCapMs: 10 }).pauseCapMs).toBe(PAUSE_CAP_MS_MIN)
    expect(sanitizeSettings({ pauseCapMs: 90_000 }).pauseCapMs).toBe(PAUSE_CAP_MS_MAX)
    expect(sanitizeSettings({ resumptionMergeMs: 2_500 }).resumptionMergeMs).toBe(2_500)
    expect(sanitizeSettings({ resumptionMergeMs: -1 }).resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_MIN)
    expect(sanitizeSettings({ resumptionMergeMs: 60_000 }).resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_MAX)
    expect(sanitizeSettings({}).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    expect(sanitizeSettings({ resumptionMergeMs: 'soon' }).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    expect(sanitizeSettings({ resumptionMergeMs: null }).resumptionMergeMs).toBe(defaultSettings().resumptionMergeMs)
    // Missing and garbage values fall back to the 2 s default (#37/#357, ADR 0076).
    expect(sanitizeSettings({}).pauseCapMs).toBe(defaultSettings().pauseCapMs)
    expect(sanitizeSettings({ pauseCapMs: 'soon' }).pauseCapMs).toBe(defaultSettings().pauseCapMs)
    expect(sanitizeSettings({ pauseCapMs: null }).pauseCapMs).toBe(defaultSettings().pauseCapMs)
  })

  it("reads the endpoint delay saved before the pause cap as the cap, and the plain timer's 700 ms default as the new 2 s default (#357)", () => {
    // The owner's settings.json holds 700 from 847d039.
    expect(sanitizeSettings({ endpointDelayMs: 700 }).pauseCapMs).toBe(2_000)
    expect(sanitizeSettings({ endpointDelayMs: 1_200 }).pauseCapMs).toBe(1_200)
    expect(sanitizeSettings({ endpointDelayMs: 'soon' }).pauseCapMs).toBe(2_000)
    expect('endpointDelayMs' in sanitizeSettings({ endpointDelayMs: 1_200 })).toBe(false)
  })

  it('migrates 700 only once: a 700 saved as the pause cap stays (#357)', () => {
    const migrated = sanitizeSettings({ endpointDelayMs: 700 })
    expect(sanitizeSettings({ ...migrated, pauseCapMs: 700 }).pauseCapMs).toBe(700)
    // The new key wins over a stale old one beside it.
    expect(sanitizeSettings({ endpointDelayMs: 1_200, pauseCapMs: 700 }).pauseCapMs).toBe(700)
  })

  it('drops the retired maximum-round key from a migrated profile — no round limit lives in settings (#129)', () => {
    // A settings.json persisted before #129 carries maxToolRounds; the
    // sanitize fold ignores the unknown key and keeps everything else.
    // Round limits are product-owned Effort Tier budgets and the 32-round
    // hard ceiling (effortEpoch.ts) — never a user setting.
    const settings = sanitizeSettings({
      maxToolRounds: 120,
      pauseCapMs: 650,
      webZoomPercent: 100,
      weather: { city: 'Berlin', units: 'metric' },
    })
    expect('maxToolRounds' in settings).toBe(false)
    expect(settings.pauseCapMs).toBe(650)
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
    expect(sanitizeSettings({ idleCards: ['calendar', 'weather'], body: {} }).idleCards).toEqual(['weather', 'calendar', 'news'])
    expect(sanitizeSettings({ idleCards: ['calendar', 'weather'], news: { topics: [] }, body: {} }).idleCards).toEqual(['weather', 'calendar'])
  })

  it('reads the default list from before the three-by-four grid as today’s default, the Last Page with it, and any other list as the set it pins', () => {
    const today = ['weather', 'calendar', 'lastPage', 'weight', 'usage', 'news', 'music']
    expect(sanitizeSettings({ idleCards: ['weather', 'usage', 'calendar', 'music', 'news'], news: { topics: [] } }).idleCards).toEqual(today)
    expect(sanitizeSettings({ idleCards: ['weather', 'usage', 'calendar', 'music'] }).idleCards).toEqual(today)
    expect(sanitizeSettings({ idleCards: ['usage', 'weather', 'calendar', 'music', 'news'], news: { topics: [] }, body: {} }).idleCards).toEqual(['weather', 'calendar', 'usage', 'news', 'music'])
  })
})

describe('the Weight card and the Weight section (#350, #351)', () => {
  const EMPTY = { heightCm: null, birthDate: null, sex: null }

  it('pins the Weight card and starts with Jaish and Barun, no Body Profile, every figure on the card, a 30-day line, the pop-up on for 8 s and no remembered scale', () => {
    const settings = defaultSettings()
    expect(settings.idleCards).toContain('weight')
    expect(settings.weight).toEqual({
      people: [
        { id: 'jaish', name: 'Jaish', body: EMPTY, guess: true },
        { id: 'barun', name: 'Barun', body: EMPTY, guess: true },
      ],
      card: { hidden: [], change: true, fat: true, line: true, rangeDays: 30 },
      popup: { on: true, lingerMs: 8000 },
    })
    expect(settings.scale).toEqual({ address: '' })
  })

  it('reads the default list from before the Weight card as today’s default, and adds the card to any other list saved before it', () => {
    expect(sanitizeSettings({ idleCards: ['weather', 'calendar', 'lastPage', 'news', 'usage', 'music'], news: { topics: [] } }).idleCards).toEqual(['weather', 'calendar', 'lastPage', 'weight', 'usage', 'news', 'music'])
    expect(sanitizeSettings({ idleCards: ['news', 'weather'], news: { topics: [] } }).idleCards).toEqual(['weather', 'weight', 'news'])
    expect(sanitizeSettings({ idleCards: ['news', 'weather'], news: { topics: [] }, body: {} }).idleCards).toEqual(['weather', 'news'])
    expect(sanitizeSettings({ idleCards: ['news', 'weather'], news: { topics: [] }, weight: {} }).idleCards).toEqual(['weather', 'news'])
  })

  it('gives #350’s Body Profile to Jaish on upgrade, with Barun added beside him', () => {
    const { people } = sanitizeSettings({ body: { heightCm: 180, birthDate: '1991-03-01', sex: 'male' } }).weight
    expect(people).toEqual([
      { id: 'jaish', name: 'Jaish', body: { heightCm: 180, birthDate: '1991-03-01', sex: 'male' }, guess: true },
      { id: 'barun', name: 'Barun', body: EMPTY, guess: true },
    ])
  })

  it('keeps a sensible profile and drops what is not one', () => {
    const body = (raw: unknown) => sanitizeSettings({ weight: { people: [{ id: 'jaish', name: 'Jaish', body: raw }] } }).weight.people[0].body
    expect(body({ heightCm: 180, birthDate: '1991-03-01', sex: 'male' })).toEqual({ heightCm: 180, birthDate: '1991-03-01', sex: 'male' })
    expect(body({ heightCm: 18, birthDate: '1991-02-31', sex: 'm' })).toEqual(EMPTY)
    expect(body({ heightCm: '180', birthDate: 19910301, sex: 'female' })).toEqual({ ...EMPTY, sex: 'female' })
  })

  it('keeps the People as saved — renamed, added, removed, "guess me" off — but always Jaish, first, and one Person per id', () => {
    const people = sanitizeSettings({
      weight: {
        people: [
          { id: 'p-1', name: '  Guest ', guess: false },
          { id: 'jaish', name: 'Jai' },
          { id: 'p-1', name: 'Twin' },
          { name: 'No id' },
        ],
      },
    }).weight.people
    expect(people).toEqual([
      { id: 'jaish', name: 'Jai', body: EMPTY, guess: true },
      { id: 'p-1', name: 'Guest', body: EMPTY, guess: false },
    ])
    expect(sanitizeSettings({ weight: { people: [] } }).weight.people).toEqual([{ id: 'jaish', name: 'Jaish', body: EMPTY, guess: true }])
  })

  it('never drops a Person, nor their profile, for a name cleared in the field: they keep a name to be fixed', () => {
    const people = sanitizeSettings({
      weight: {
        people: [
          { id: 'jaish', name: ' ', body: { heightCm: 180, birthDate: null, sex: null } },
          { id: 'barun', name: '' },
          { id: 'p-2', name: '   ' },
        ],
      },
    }).weight.people
    expect(people.map((person) => [person.id, person.name])).toEqual([
      ['jaish', 'Jaish'],
      ['barun', 'Barun'],
      ['p-2', 'Unnamed'],
    ])
    expect(people[0].body.heightCm).toBe(180)
  })

  it('takes a removed Person out of the People and out of the card’s hidden list', () => {
    const weight = sanitizeSettings({ weight: { card: { hidden: ['barun'] } } }).weight
    const without = withoutPerson(weight, 'barun')
    expect(without.people.map((person) => person.id)).toEqual(['jaish'])
    expect(without.card.hidden).toEqual([])
    expect(withoutPerson(weight, 'jaish')).toEqual(weight)
  })

  it('keeps the card’s choices and the pop-up’s, within bounds', () => {
    const weight = sanitizeSettings({ weight: { card: { hidden: ['barun', 3], change: false, fat: 'no', line: false, rangeDays: 90 }, popup: { on: false, lingerMs: 999_999 } } }).weight
    expect(weight.card).toEqual({ hidden: ['barun'], change: false, fat: true, line: false, rangeDays: 90 })
    expect(weight.popup).toEqual({ on: false, lingerMs: 30_000 })
    expect(sanitizeSettings({ weight: { card: { rangeDays: 14 } } }).weight.card.rangeDays).toBe(30)
  })

  it('keeps a scale address as Bluetooth writes it, and nothing else', () => {
    expect(sanitizeSettings({ scale: { address: 'a4:c1:38:f7:c6:58' } }).scale).toEqual({ address: 'A4:C1:38:F7:C6:58' })
    expect(sanitizeSettings({ scale: { address: 'the bathroom' } }).scale).toEqual({ address: '' })
  })
})
