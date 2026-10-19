// Dashboard-editable settings. Everything here mirrors config that otherwise
// comes from the environment or from the voice pipeline (mic, wake word, TTS
// voice, weather). The settings file overrides env only where a value is
// set, so env stays the base layer.

import { defaultUsagePrefs, sanitizeUsagePrefs, type UsagePrefs } from '../usage/usage'
import { IDLE_CARD_IDS, sanitizeIdleCards, type IdleCardId } from '../idle/slots'
import { defaultInterestProfile, sanitizeInterestProfile, type InterestProfile } from '../news/interestProfile'

export const WAKE_WORD_THRESHOLD_MIN = 0
export const WAKE_WORD_THRESHOLD_MAX = 1
/** Endpoint-delay slider bounds (#37): silence that ends an utterance. */
export const ENDPOINT_DELAY_MS_MIN = 200
export const ENDPOINT_DELAY_MS_MAX = 1500
/**
 * 300 ms on this branch (ADR 0076, #324): the Reaction is the one clock the
 * user feels, so an Utterance is released 300 ms into silence. A pause
 * mid-sentence makes two Commands; a Misfire is recovered, never prevented.
 * (`main` holds 900 ms, raised from 500 in #60.)
 */
export const ENDPOINT_DELAY_MS_DEFAULT = 300
/**
 * Resumption-merge window bounds (#60/#59): silence held after the endpoint
 * before the utterance submits. 0 disables the hold — the endpoint submits
 * directly.
 */
export const RESUMPTION_MERGE_MS_MIN = 0
export const RESUMPTION_MERGE_MS_MAX = 3_000
/** 0 on this branch (ADR 0076): no hold after the Endpoint. (`main` holds 1,500 ms.) */
export const RESUMPTION_MERGE_MS_DEFAULT = 0
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
  /** Silence (ms) that ends an utterance — the endpoint-delay slider (#37). */
  endpointDelayMs: number
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
  /** The Idle Screen's pinned cards (core/idle/slots), in the order they read; one left out is not shown. */
  idleCards: IdleCardId[]
  /** The News card's Interest Profile (core/news/interestProfile): the topics a story is ranked against. */
  news: { topics: InterestProfile }
}

/** The owner's dashboard on the LAN, so the Idle Screen shows it out of the box. */
export const USAGE_DASHBOARD_URL_DEFAULT = 'http://192.168.1.73:4321'

export function defaultSettings(): AppSettings {
  return {
    micId: 'default',
    wakeWordThreshold: 0.5,
    endpointDelayMs: ENDPOINT_DELAY_MS_DEFAULT,
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
    news: { topics: defaultInterestProfile() },
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

/**
 * The Pinned Cards as saved, and the News card added at the end when the
 * settings were saved before it existed — they have no `news` section — so
 * it is on by default for an owner who already ordered the others. Once
 * saved with the News section, a list without it means it was unpinned.
 */
function pinnedCards(record: Record<string, unknown>): IdleCardId[] {
  const cards = sanitizeIdleCards(record.idleCards)
  return record.news === undefined && !cards.includes('news') ? [...cards, 'news'] : cards
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
    endpointDelayMs: asEndpointDelay(record.endpointDelayMs, defaults.endpointDelayMs),
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
    news: { topics: news === null ? defaultInterestProfile() : sanitizeInterestProfile(news.topics) },
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
