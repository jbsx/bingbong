import { describe, expect, it } from 'vitest'
import { defaultSettings, type AppSettings } from '../settings/settings'
import { SETTING_KINDS, type SettingKinds } from '../settings/settingKinds'
import { appAnswer, appCardOptions, appChangeOf, appOpOf, appOptions, settingOptions, timeOfDayIn, type AppOpAction, type AppState } from './appOp'

function stateWith(settings: Partial<AppSettings> = {}, rest: Partial<AppState> = {}): AppState {
  return {
    panel: { mode: 'overlay', open: false, width: 536 },
    view: 'dashboard',
    settings: { ...defaultSettings(), ...settings },
    voices: ['en_GB-alba-medium', 'en_US-amy-low'],
    ...rest,
  }
}

const lines = (state: AppState, kinds?: SettingKinds<AppSettings>): Record<string, string> =>
  Object.fromEntries(appOptions(state, kinds).map((option) => [option.label, option.line]))

describe('appOptions: the app on the card (#420, ADR 0091)', () => {
  it('offers a boolean setting on and off whatever its state, each line carrying the state', () => {
    const offered = lines(stateWith({ adblockEnabled: true }))
    expect(offered.set_adblock_enabled_on).toContain('ad blocking, now on')
    expect(offered.set_adblock_enabled_off).toContain('ad blocking, now on')
    expect(offered.set_adblock_enabled_off).toContain('turn it off')
  })

  it('offers no op for a setting voice may not change, nor for a record (hard policy, ADR 0091)', () => {
    const labels = appOptions(stateWith()).map((option) => option.label)
    for (const kept of ['mic', 'wake_word', 'pause_cap', 'resumption_merge', 'hot_listen', 'stt_engine', 'usage_dashboard', 'news', 'weight_', 'scale', 'latitude', 'longitude']) {
      expect(labels.filter((label) => label.startsWith('set_') && !label.startsWith('set_idle_cards_') && label.includes(kept))).toEqual([])
    }
    // Nor does any line carry an Environment (.env) value: it is no setting at all.
    expect(appOptions(stateWith()).some((option) => /\b[A-Z][A-Z0-9_]{3,}=/.test(option.line))).toBe(false)
  })

  it('puts a new boolean field on the card with no card code', () => {
    const settings = { ...defaultSettings(), showSparkles: false } as AppSettings
    const offered = lines(stateWith({}, { settings }))
    expect(offered.set_show_sparkles_on).toContain('show sparkles, now off')
    expect(offered.set_show_sparkles_off).toContain('turn it off')
  })

  it('puts a new enum field on the card from its kinds entry alone', () => {
    const settings = { ...defaultSettings(), fontSize: 'small' } as AppSettings
    const kinds = { ...SETTING_KINDS, fontSize: { kind: 'choice', name: 'font size', values: [{ value: 'small', named: 'small' }, { value: 'large', named: 'large' }] } } as SettingKinds<AppSettings>
    const offered = lines(stateWith({}, { settings }), kinds)
    expect(Object.keys(offered).filter((label) => label.startsWith('set_font_size_'))).toEqual(['set_font_size_small', 'set_font_size_large'])
    expect(offered.set_font_size_large).toContain('font size, now small — set it to large')
  })

  it('offers an enum one op per value, a voice per installed voice, and each Idle Screen card shown or hidden', () => {
    const offered = lines(stateWith({ appearance: 'light', idleCards: ['weather'] }))
    expect(Object.keys(offered).filter((label) => label.startsWith('set_appearance_'))).toEqual(['set_appearance_system', 'set_appearance_light', 'set_appearance_dark'])
    expect(offered.set_appearance_dark).toContain('now light mode — set it to dark mode')
    expect(Object.keys(offered).filter((label) => label.startsWith('set_tts_voice_'))).toEqual(['set_tts_voice_default', 'set_tts_voice_en_gb_alba_medium', 'set_tts_voice_en_us_amy_low'])
    expect(offered.set_idle_cards_weather_off).toContain('"weather", now shown — hide it')
    expect(offered.set_idle_cards_news_on).toContain('"news", now hidden — show it')
  })

  it('puts the settings on the card as one line, their ops — a new field\'s too — on the settings ask', () => {
    const settings = { ...defaultSettings(), showSparkles: false } as AppSettings
    const card = appCardOptions(stateWith({}, { settings }))
    expect(card.some((option) => option.label.startsWith('set_'))).toBe(false)
    const line = card.find((option) => option.label === 'settings')!.line
    for (const name of ['ad blocking', 'appearance (light or dark mode)', 'idle timeout', 'weather city']) expect(line).toContain(name)
    expect(line).not.toMatch(/microphone|wake word|pause/)
    expect(settingOptions(stateWith({}, { settings })).map((option) => option.label)).toContain('set_show_sparkles_on')
  })

  it('offers the panel and every view, each line saying what is open and showing now', () => {
    const offered = lines(stateWith({}, { panel: { mode: 'docked', open: true, width: 600 }, view: 'settings', section: 'clock' }))
    expect(offered.panel_close).toContain('now open, docked, 600 px wide')
    expect(offered.panel_width).toContain('amount Choice')
    expect(offered.show_settings_weather).toContain('Settings page at its Weather section — now showing the Settings page at its Clock section')
    expect(offered.show_weight).toBeDefined()
    expect(offered.show_dashboard).toBeDefined()
  })
})

describe('an app op fired (#420)', () => {
  const fire = (label: string, state: AppState, extra: Partial<AppOpAction> = {}) => {
    const op = appOpOf(label, state)
    if (op === null) throw new Error(`no op ${label}`)
    const action = { ...op, ...extra } as AppOpAction
    return { action, change: appChangeOf(action, state) }
  }
  const after = (state: AppState, change: ReturnType<typeof appChangeOf>): AppState => {
    if (change?.kind === 'settings') return { ...state, settings: change.settings }
    if (change?.kind === 'panel') return { ...state, panel: { ...state.panel, ...(change.open !== undefined ? { open: change.open } : {}), ...(change.mode !== undefined ? { mode: change.mode } : {}), ...(change.width !== undefined ? { width: change.width } : {}) } }
    return state
  }

  it('turns the adblocker off and says so', () => {
    const state = stateWith({ adblockEnabled: true })
    const { action, change } = fire('set_adblock_enabled_off', state)
    expect(change).toEqual({ kind: 'settings', settings: { ...state.settings, adblockEnabled: false } })
    expect(appAnswer(action, state, after(state, change))).toBe('Ad blocking turned off.')
  })

  it('uses the 24-hour clock, and sets the idle timeout to 10 minutes, naming the new value', () => {
    const state = stateWith()
    const clock = fire('set_time_format_24', state)
    expect(appAnswer(clock.action, state, after(state, clock.change))).toBe('Clock set to 24-hour.')
    const idle = fire('set_idle_after_minutes_10', state)
    expect(appAnswer(idle.action, state, after(state, idle.change))).toBe('Idle timeout set to 10 minutes.')
  })

  it('says when the setting already was', () => {
    const state = stateWith({ appearance: 'dark' })
    const dark = fire('set_appearance_dark', state)
    expect(appAnswer(dark.action, state, after(state, dark.change))).toBe('Appearance set to dark mode. It already was.')
  })

  it('moves an amount by its rung, or to the number the words carry, within its bounds', () => {
    const state = stateWith({ webZoomPercent: 130 })
    expect(fire('set_web_zoom_percent', state, { rung: 'up-step' }).change).toMatchObject({ settings: { webZoomPercent: 140 } })
    expect(fire('set_web_zoom_percent', state, { rung: 'to', words: 'set the zoom to 150 percent' }).change).toMatchObject({ settings: { webZoomPercent: 150 } })
    expect(fire('set_web_zoom_percent', state, { rung: 'up-all' }).change).toMatchObject({ settings: { webZoomPercent: 200 } })
    expect(fire('set_web_zoom_percent', state, { rung: 'to', words: 'zoom in' }).change).toBeNull()
  })

  it('makes the panel wider by a step, docks it, and says a close of a closed panel already was', () => {
    const state = stateWith()
    const wider = fire('panel_width', state, { rung: 'up-step' })
    expect(wider.change).toEqual({ kind: 'panel', width: 696 })
    expect(appAnswer(wider.action, state, after(state, wider.change))).toBe('The activity panel is 696 pixels wide.')
    const dock = fire('panel_docked', state)
    expect(appAnswer(dock.action, state, after(state, dock.change))).toBe('The activity panel is docked beside the page.')
    const hide = fire('panel_close', state)
    expect(appAnswer(hide.action, state, after(state, hide.change))).toBe('Closed the activity panel. It already was.')
  })

  it('shows a view at its section', () => {
    const state = stateWith()
    const { action, change } = fire('show_settings_weather', state)
    expect(change).toEqual({ kind: 'view', view: 'settings', section: 'weather' })
    expect(appAnswer(action, state, state)).toBe('Showing the Settings page, at Weather.')
  })

  it('hands a spoken city to the geocoder, and reads a spoken time of day', () => {
    const state = stateWith()
    expect(fire('set_weather_city', state, { words: 'Paris' }).change).toEqual({ kind: 'place', path: ['weather', 'city'], words: 'Paris' })
    expect(fire('set_night_dim_from', state, { words: '11 pm' }).change).toMatchObject({ settings: { nightDim: { from: '23:00' } } })
  })

  it('shows and hides one Idle Screen card, keeping the others', () => {
    const state = stateWith({ idleCards: ['weather', 'news'] })
    const { action, change } = fire('set_idle_cards_news_off', state)
    expect(change).toMatchObject({ settings: { idleCards: ['weather'] } })
    expect(appAnswer(action, state, after(state, change))).toBe('The news card is hidden on the Idle Screen.')
  })
})

describe('timeOfDayIn', () => {
  it.each([
    ['23:00', '23:00'],
    ['11 pm', '23:00'],
    ['7.30 am', '07:30'],
    ['12 am', '00:00'],
    ['midnight', '00:00'],
    ['seven in the morning', '07:00'],
    ['soon', null],
  ])('%s → %s', (words, time) => {
    expect(timeOfDayIn(words)).toBe(time)
  })
})
