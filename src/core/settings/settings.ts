// Dashboard-editable settings. Everything here mirrors config that otherwise
// comes from the environment or from the voice pipeline (mic, wake word, TTS
// voice, weather). The settings file overrides env only where a value is
// set, so env stays the base layer.

import { defaultUsagePrefs, sanitizeUsagePrefs, type UsagePrefs } from '../usage/usage'
import { IDLE_CARD_IDS, sanitizeIdleCards, savedIdleCards, type IdleCardId } from '../idle/columns'
import { defaultNewsFeeds, sanitizeNewsFeeds, type NewsFeed } from '../news/feeds'
import { defaultInterestProfile, sanitizeInterestProfile, type InterestProfile } from '../news/interestProfile'
import { defaultWeightSettings, sanitizeWeightSettings, type WeightSettings } from '../scale/weightSettings'
import { PAUSE_CAP_MS_DEFAULT, PAUSE_CAP_MS_MAX, PAUSE_CAP_MS_MIN, RESUMPTION_MERGE_MS_DEFAULT, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN } from './endpointTimings'

export const WAKE_WORD_THRESHOLD_MIN = 0
export const WAKE_WORD_THRESHOLD_MAX = 1
export { PAUSE_CAP_MS_DEFAULT, PAUSE_CAP_MS_MAX, PAUSE_CAP_MS_MIN, RESUMPTION_MERGE_MS_DEFAULT, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN }
/** The plain timer's last default (847d039): a saved value of it is read as the new default once (#357). */
const PAUSE_CAP_MS_BEFORE_TURN_CHECK = 700
/**
 * Hot Listen silence bounds (#326): the silence after the last Endpoint
 * that closes the Listen one wake opened.
 */
export const HOT_LISTEN_SILENCE_MS_MIN = 2_000
export const HOT_LISTEN_SILENCE_MS_MAX = 60_000
/** 8 s (#326): long enough to read the page between Commands, short enough that a forgotten Listen closes. */
export const HOT_LISTEN_SILENCE_MS_DEFAULT = 8_000
/** Web-zoom slider bounds (#53): readable-from-the-couch page zoom. */
export const WEB_ZOOM_PERCENT_MIN = 75
export const WEB_ZOOM_PERCENT_MAX = 200
export const WEB_ZOOM_PERCENT_DEFAULT = 130

export type WeatherUnits = 'metric' | 'imperial'

/**
 * Appearance (ADR 0020): the tri-state theme Setting — `system` follows the
 * OS signal, `light`/`dark` are manual overrides. Main resolves it against
 * nativeTheme and both the app chrome tokens and the pages'
 * prefers-color-scheme follow the resolved value.
 */
export type Appearance = 'system' | 'light' | 'dark'

/**
 * STT engine tier (#63): Small is the default everywhere (the Hardware
 * Floor — dual-core, 4 GB RAM — fits its ~230 MB fetch comfortably);
 * Medium is the opt-in for capable hardware, Base the legacy tier. The
 * tier applies when the transcriber is constructed — a restart.
 */
export type SttModel = 'base' | 'small' | 'medium'

export interface AppSettings {
  /** Microphone device id from enumerateDevices; 'default' follows the OS. */
  micId: string
  wakeWordThreshold: number
  /** Silence (ms) that ends an Utterance whatever the turn check says — the pause cap (#357, the endpoint delay of #37). */
  pauseCapMs: number
  /**
   * Silence (ms) held after the endpoint before submission (#60): speech
   * resuming inside the window rejoins the utterance. 0 disables the hold.
   */
  resumptionMergeMs: number
  /** Silence (ms) after the last Endpoint that closes a Hot Listen (#326). */
  hotListenSilenceMs: number
  /** Page zoom for the browser pane, in percent (#53). */
  webZoomPercent: number
  /** Piper voice id; '' follows BINGBONG_PIPER_VOICE / the default voice. */
  ttsVoice: string
  /** STT engine tier — loads at the next transcriber construction (#63). */
  sttModel: SttModel
  /** Kill switch for the embedder-level adblocker (issue #21). */
  adblockEnabled: boolean
  /** Theme resolution (ADR 0020) — system follows the OS, manual wins. */
  appearance: Appearance
  weather: { city: string; units: WeatherUnits }
  /**
   * The AI usage dashboard the Idle Screen reads gauges and history from
   * ('' hides the card), and which providers and windows it shows.
   */
  usageDashboard: { url: string } & UsagePrefs
  /** The Idle Screen's Pinned Cards (core/idle/columns): a set — each card has its home, so order decides nothing; one left out is not shown. */
  idleCards: IdleCardId[]
  /**
   * The News card's Interest Profile (core/news/interestProfile) — the
   * topics a story is ranked against, each with the subreddits polled for
   * it — and the feeds it reads (core/news/feeds).
   */
  news: { topics: InterestProfile; feeds: NewsFeed[] }
  /** The Weight section (core/scale/weightSettings): the People, each with the Body Profile their Weigh-ins' figures are worked out from, the Weight card's choices and the pop-up's. */
  weight: WeightSettings
  /** The scale the Scale Listener remembered by its Bluetooth address ('' until one is seen, or once forgotten). */
  scale: { address: string }
}

/** The owner's dashboard on the LAN, so the Idle Screen shows it out of the box. */
export const USAGE_DASHBOARD_URL_DEFAULT = 'http://192.168.1.73:4321'

export function defaultSettings(): AppSettings {
  return {
    micId: 'default',
    wakeWordThreshold: 0.5,
    pauseCapMs: PAUSE_CAP_MS_DEFAULT,
    resumptionMergeMs: RESUMPTION_MERGE_MS_DEFAULT,
    hotListenSilenceMs: HOT_LISTEN_SILENCE_MS_DEFAULT,
    webZoomPercent: WEB_ZOOM_PERCENT_DEFAULT,
    ttsVoice: '',
    sttModel: 'small',
    adblockEnabled: true,
    appearance: 'system',
    weather: { city: '', units: 'metric' },
    usageDashboard: { url: USAGE_DASHBOARD_URL_DEFAULT, ...defaultUsagePrefs() },
    idleCards: [...IDLE_CARD_IDS],
    news: { topics: defaultInterestProfile(), feeds: defaultNewsFeeds() },
    weight: defaultWeightSettings(),
    scale: { address: '' },
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

function asPauseCap(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(PAUSE_CAP_MS_MAX, Math.max(PAUSE_CAP_MS_MIN, value))
}

/**
 * The pause cap as saved (#357). Settings saved before it hold the
 * endpoint delay under its old key: that value carries over, except the
 * plain timer's 700 ms default, which becomes today's default. Saved once
 * under the new key, any value — 700 too — is the owner's and stays.
 */
function pauseCap(record: Record<string, unknown>, fallback: number): number {
  if (record.pauseCapMs !== undefined) return asPauseCap(record.pauseCapMs, fallback)
  if (record.endpointDelayMs === PAUSE_CAP_MS_BEFORE_TURN_CHECK) return fallback
  return asPauseCap(record.endpointDelayMs, fallback)
}

function asResumptionMerge(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(RESUMPTION_MERGE_MS_MAX, Math.max(RESUMPTION_MERGE_MS_MIN, Math.round(value)))
}

function asHotListenSilence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(HOT_LISTEN_SILENCE_MS_MAX, Math.max(HOT_LISTEN_SILENCE_MS_MIN, Math.round(value)))
}

function asWebZoomPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(WEB_ZOOM_PERCENT_MAX, Math.max(WEB_ZOOM_PERCENT_MIN, Math.round(value)))
}

/** Any explicit tier passes through; anything else falls back to Small. */
export function asSttModel(value: unknown): SttModel {
  return value === 'base' || value === 'medium' ? value : 'small'
}

/** Only the three literals pass; anything else falls back to following the OS. */
export function asAppearance(value: unknown): Appearance {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** The default Pinned Cards before the grid became three by four (#352). */
const OLD_DEFAULT_IDLE_CARDS: readonly IdleCardId[] = ['weather', 'usage', 'calendar', 'music', 'news']

/** The default Pinned Cards on the three-by-four grid before the Weight card (#350). */
const GRID_DEFAULT_IDLE_CARDS: readonly IdleCardId[] = ['weather', 'calendar', 'lastPage', 'news', 'usage', 'music']

function sameCards(a: readonly IdleCardId[], b: readonly IdleCardId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * The Pinned Cards as saved, read as a set (core/idle/columns), and a card
 * added when the settings were saved before it existed — the News card when
 * they have no `news` section, the Weight card when they have neither
 * `body` (#350) nor `weight` (#351) — so it is on by default for an owner
 * who already chose the others. Once saved with its section, a list without
 * the card means it was unpinned. A list that is an earlier default, as it
 * was written — from before the three-by-four grid (#352), or from before
 * the Weight card — is read as today's default.
 */
function pinnedCards(record: Record<string, unknown>): IdleCardId[] {
  const saved = savedIdleCards(record.idleCards)
  if (saved === null) return [...IDLE_CARD_IDS]
  const cards = record.news === undefined && !saved.includes('news') ? [...saved, 'news' as const] : saved
  const beforeWeight = record.body === undefined && record.weight === undefined
  if (sameCards(cards, OLD_DEFAULT_IDLE_CARDS) || (beforeWeight && sameCards(cards, GRID_DEFAULT_IDLE_CARDS))) return [...IDLE_CARD_IDS]
  return sanitizeIdleCards(beforeWeight && !cards.includes('weight') ? [...cards, 'weight'] : cards)
}

/** A Bluetooth address as BlueZ writes it (upper case); anything else none. */
function asScaleAddress(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(value.trim()) ? value.trim().toUpperCase() : ''
}

/** Parse anything (disk, IPC) into valid settings; unknown bits fall back to defaults. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const defaults = defaultSettings()
  const record = asRecord(raw)
  if (!record) return defaults

  const weather = asRecord(record.weather)
  const usageDashboard = asRecord(record.usageDashboard)
  const news = asRecord(record.news)

  return {
    micId: asString(record.micId, defaults.micId),
    wakeWordThreshold: asThreshold(record.wakeWordThreshold, defaults.wakeWordThreshold),
    pauseCapMs: pauseCap(record, defaults.pauseCapMs),
    resumptionMergeMs: asResumptionMerge(record.resumptionMergeMs, defaults.resumptionMergeMs),
    hotListenSilenceMs: asHotListenSilence(record.hotListenSilenceMs, defaults.hotListenSilenceMs),
    webZoomPercent: asWebZoomPercent(record.webZoomPercent, defaults.webZoomPercent),
    ttsVoice: asString(record.ttsVoice, defaults.ttsVoice),
    sttModel: asSttModel(record.sttModel),
    // Only an explicit false disables the engine — missing/garbage means on.
    adblockEnabled: record.adblockEnabled === false ? false : defaults.adblockEnabled,
    appearance: asAppearance(record.appearance),
    weather: {
      city: asString(weather?.city, defaults.weather.city),
      units: weather?.units === 'imperial' ? 'imperial' : defaults.weather.units,
    },
    usageDashboard: { url: asString(usageDashboard?.url, defaults.usageDashboard.url), ...sanitizeUsagePrefs(usageDashboard) },
    idleCards: pinnedCards(record),
    news: { topics: news === null ? defaultInterestProfile() : sanitizeInterestProfile(news.topics), feeds: sanitizeNewsFeeds(news?.feeds) },
    weight: sanitizeWeightSettings(record.weight, record.body),
    scale: { address: asScaleAddress(asRecord(record.scale)?.address) },
  }
}

/**
 * The env-var view of settings, layered over process.env by the caller. Only
 * set values appear, so an untouched field keeps its env config. Nothing in
 * the settings file routes a model today; the decision role is env-only.
 */
export function settingsToEnv(_settings: AppSettings): Record<string, string> {
  return {}
}
