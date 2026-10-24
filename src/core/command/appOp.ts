import type { AppSettings } from '../settings/settings'
import { SETTING_KINDS, type SettingGroup, type SettingKind, type SettingKinds } from '../settings/settingKinds'
import { SETTINGS_SECTIONS } from '../settings/sections'
import { FEED_PANEL_WIDTH_MIN, FEED_PANEL_WIDTH_STEP, type FeedPanelMode, type FeedPanelState } from '../panel/feedPanelState'
import type { LevelRung } from '../browser/mediaOp'
import { firstNumber } from '../timer/duration'

// The app itself on the card (#420, ADR 0091): its panel, its views and its
// settings as Appliance Verbs by kind, as a media ref carries its Media Ops
// (ADR 0080). Each line carries the current state, and every op the kind
// allows is offered whatever that state is; Jev picks the op. The settings'
// ops are generated from the `AppSettings` shape and the kinds table
// (`SETTING_KINDS`), never listed here: a boolean added to the settings is
// on the card with no line of this file. Code keeps the facts and the
// mechanisms — what each op changes, the Answer it says — and Jev every
// choice.

/** The app's full-window views (App.tsx): the browsing dashboard, the Weight page, Settings. */
export type AppView = 'dashboard' | 'weight' | 'settings'

/** What the app holds when a line is read: its panel, the view showing (and the Settings section shown), its settings and the voices installed. */
export interface AppState {
  readonly panel: FeedPanelState
  readonly view: AppView
  readonly section?: string
  readonly settings: AppSettings
  readonly voices: readonly string[]
}

/** A setting's place in `AppSettings`: `['adblockEnabled']`, `['nightDim', 'from']`. */
export type SettingPath = readonly string[]

/** What one app op does, as its card label names it. */
export type AppOp =
  | { readonly kind: 'panel'; readonly op: 'open' | 'close' | FeedPanelMode }
  /** The panel's width, by the Amount Choice. */
  | { readonly kind: 'panelWidth' }
  | { readonly kind: 'view'; readonly view: AppView; readonly section?: string }
  /** A setting set to one value: a switch's, a choice's, a voice. */
  | { readonly kind: 'set'; readonly path: SettingPath; readonly value: string | number | boolean }
  /** One member of a set setting shown or not: an Idle Screen card. */
  | { readonly kind: 'member'; readonly path: SettingPath; readonly member: string; readonly on: boolean }
  /** A number moved by the Amount Choice. */
  | { readonly kind: 'amount'; readonly path: SettingPath }
  /** A setting the words carry: a place, a time of day. */
  | { readonly kind: 'words'; readonly path: SettingPath }
  /** One of the settings, which the settings ask then reads (the card's one `settings` line). */
  | { readonly kind: 'settings' }

/** An op as a Command carries it (#420): the op, with the Amount Choice's rung for an amount and the words for one the words carry. */
export type AppOpAction = AppOp & { readonly rung?: LevelRung; readonly words?: string }

/** One option on the action card. */
export interface AppOption {
  readonly label: string
  readonly line: string
  readonly op: AppOp
}

/** A setting on the card: where it is, its kind, and its value now. */
interface Leaf {
  readonly path: SettingPath
  readonly kind: Exclude<SettingKind, { kind: 'kept' }>
  readonly value: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `adblockEnabled` → `adblock enabled`: a boolean's name when the table gives it none. */
const keyWords = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()

/** A label part: lower case, `_` between words. */
const slug = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/**
 * Every setting the card offers, walked off the settings themselves in
 * their own order: a group's fields inside it; a boolean the table names
 * or not; every other field by its table entry — none, or `kept`, is off
 * the card.
 */
function leavesOf(settings: Record<string, unknown>, kinds: Record<string, SettingKind | SettingGroup<unknown> | undefined>, at: SettingPath = []): Leaf[] {
  return Object.entries(settings).flatMap(([key, value]): Leaf[] => {
    const entry = kinds[key]
    const path = [...at, key]
    if (entry?.kind === 'group') return isRecord(value) ? leavesOf(value, entry.fields as Record<string, SettingKind | undefined>, path) : []
    if (entry === undefined) return typeof value === 'boolean' ? [{ path, kind: { kind: 'switch', name: keyWords(key) }, value }] : []
    return entry.kind === 'kept' ? [] : [{ path, kind: entry, value }]
  })
}

/** The settings on the card, walked off the settings themselves. */
const leavesIn = (settings: AppSettings, kinds: SettingKinds<AppSettings>): Leaf[] => leavesOf(settings as unknown as Record<string, unknown>, kinds as never)

/** A setting's value at its path. */
export function settingAt(settings: AppSettings, path: SettingPath): unknown {
  return path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), settings)
}

/** The settings with one value changed at its path; the store's sanitizer keeps its bounds. */
export function withSetting(settings: AppSettings, path: SettingPath, value: unknown): AppSettings {
  const put = (record: Record<string, unknown>, [key, ...rest]: SettingPath): Record<string, unknown> => ({ ...record, [key!]: rest.length === 0 ? value : put(isRecord(record[key!]) ? (record[key!] as Record<string, unknown>) : {}, rest) })
  return put(settings as unknown as Record<string, unknown>, path) as unknown as AppSettings
}

/** The kind of the setting at a path; null for one off the card. */
function kindAt(path: SettingPath, settings: AppSettings, kinds: SettingKinds<AppSettings>): Leaf['kind'] | null {
  const key = path.join('.')
  return leavesIn(settings, kinds).find((leaf) => leaf.path.join('.') === key)?.kind ?? null
}

const VIEW_NAMES: Readonly<Record<AppView, string>> = { dashboard: 'the browser', weight: 'the Weight page', settings: 'the Settings page' }

const sectionTitle = (id: string | undefined): string | undefined => SETTINGS_SECTIONS.find((section) => section.id === id)?.title

/** What the screen shows now, as a view line says it. */
function shownNow(state: AppState): string {
  const title = state.view === 'settings' ? sectionTitle(state.section) : undefined
  return `now showing ${VIEW_NAMES[state.view]}${title !== undefined ? ` at its ${title} section` : ''}`
}

/** The panel now, as its lines say it. */
function panelNow(panel: FeedPanelState): string {
  return `now ${panel.open ? 'open' : 'closed'}, ${panel.mode}, ${panel.width} px wide`
}

/** A choice's or a voice's value as the card names it. */
function namedValue(kind: Leaf['kind'], value: unknown): string {
  if (kind.kind === 'choice') return kind.values.find((candidate) => candidate.value === value)?.named ?? String(value)
  if (kind.kind === 'voices') return value === '' ? 'the default voice' : String(value)
  return String(value)
}

/** A setting's value now, as its line says it. */
function valueNow(leaf: Leaf): string {
  const { kind, value } = leaf
  switch (kind.kind) {
    case 'switch':
      return value === true ? 'on' : 'off'
    case 'amount':
      return `${String(value)}${kind.unit} (${kind.min}–${kind.max}${kind.unit})`
    case 'place':
      return value === '' ? 'found from the network' : String(value)
    case 'members':
      return ''
    default:
      return namedValue(kind, value)
  }
}

/** The setting as its line names it: the noun, then what tells it apart. */
const settingName = (kind: Leaf['kind']): string => `${kind.name}${kind.hint !== undefined ? ` (${kind.hint})` : ''}`

/** One setting's options: each op its kind allows. */
function opsOfSetting(leaf: Leaf, voices: readonly string[]): AppOption[] {
  const { kind, path } = leaf
  const base = `set_${slug(path.join('_'))}`
  const head = `app setting: ${settingName(kind)}, now ${valueNow(leaf)}`
  switch (kind.kind) {
    case 'switch':
      return [true, false].map((on) => ({ label: `${base}_${on ? 'on' : 'off'}`, line: `${head} — turn it ${on ? 'on' : 'off'}`, op: { kind: 'set', path, value: on } }))
    case 'choice':
      return kind.values.map(({ value, named }) => ({ label: `${base}_${slug(String(value))}`, line: `${head} — set it to ${named}`, op: { kind: 'set', path, value } }))
    case 'voices':
      return ['', ...voices].map((voice) => ({ label: `${base}_${voice === '' ? 'default' : slug(voice)}`, line: `${head} — set it to ${namedValue(kind, voice)}`, op: { kind: 'set', path, value: voice } }))
    case 'amount':
      return [{ label: base, line: `${head} — change it: up, down or to the number the words carry, the amount Choice saying which and how far`, op: { kind: 'amount', path } }]
    case 'place':
      return [{ label: base, line: `${head} — set it to the place the words name, the Slot carrying it`, op: { kind: 'words', path } }]
    case 'time':
      return [{ label: base, line: `${head} — set it to the time of day the words carry, the Slot carrying it`, op: { kind: 'words', path } }]
    case 'members': {
      const shown = Array.isArray(leaf.value) ? leaf.value : []
      return kind.members.flatMap(({ value, named }) => {
        const now = `app setting: ${kind.name} "${named}", now ${shown.includes(value) ? 'shown' : 'hidden'}`
        return [true, false].map((on) => ({ label: `${base}_${slug(value)}_${on ? 'on' : 'off'}`, line: `${now} — ${on ? 'show it' : 'hide it'}`, op: { kind: 'member', path, member: value, on } as const }))
      })
    }
  }
}

/** The panel's options (#420, ADR 0021 as amended): open, close, overlay, docked, and its width by the Amount Choice. */
function panelOptions(panel: FeedPanelState): AppOption[] {
  const now = panelNow(panel)
  return [
    { label: 'panel_open', line: `app: open the activity panel, the feed of what was said and done — ${now}`, op: { kind: 'panel', op: 'open' } },
    { label: 'panel_close', line: `app: close the activity panel, hiding it — ${now}`, op: { kind: 'panel', op: 'close' } },
    { label: 'panel_overlay', line: `app: float the activity panel over the page — ${now}`, op: { kind: 'panel', op: 'overlay' } },
    { label: 'panel_docked', line: `app: dock the activity panel beside the page, in its own room — ${now}`, op: { kind: 'panel', op: 'docked' } },
    { label: 'panel_width', line: `app: change the activity panel's width: wider, narrower or to the pixels the words carry, the amount Choice saying which and how far — ${now}`, op: { kind: 'panelWidth' } },
  ]
}

/** The views' options: the browser, the Weight page, and Settings — at the top and at each of its sections. */
function viewOptions(state: AppState): AppOption[] {
  const now = shownNow(state)
  return [
    { label: 'show_dashboard', line: `app: show the browser, leaving Settings or the Weight page — ${now}`, op: { kind: 'view', view: 'dashboard' } },
    { label: 'show_weight', line: `app: show the Weight page, the weigh-ins — ${now}`, op: { kind: 'view', view: 'weight' } },
    { label: 'show_settings', line: `app: show the Settings page — ${now}`, op: { kind: 'view', view: 'settings' } },
    ...SETTINGS_SECTIONS.map(({ id, title }): AppOption => ({ label: `show_settings_${slug(id)}`, line: `app: show the Settings page at its ${title} section — ${now}`, op: { kind: 'view', view: 'settings', section: id } })),
  ]
}

/** The card label of the settings' one line. */
export const SETTINGS_LABEL = 'settings'

/**
 * The settings' one line on the action card, worded as it was measured
 * (gate 2026-10-24, Mammoth ∩ Elephant): the same line generated from every
 * setting's name — with its hint, or the name alone — lost two cases that
 * passed before on Elephant and read a setting line as none. A setting
 * added to `AppSettings` needs no word here: its ops are on the settings
 * ask's card, generated, and it is "one of the app's settings".
 */
const SETTINGS_LINE =
  "app setting: change one of the app's settings — ad blocking, appearance (light or dark mode), the clock (12- or 24-hour), seconds on the clock, the date format, the first day of the week, the idle timeout, night dimming, web page zoom, the weather city and units, the voice, the Idle Screen's cards"

/**
 * The app's options on the action card (#420, ADR 0091): the panel's, the
 * views', and the settings as one line, each setting's ops asked on the
 * settings ask once that line is chosen. Measured on the gate against every
 * setting's ops on every card (2026-10-24, Mammoth ∩ Elephant): both read
 * the app's lines alike, and every op on every card lost cases that passed
 * before — on a long page its lines pushed what is further down off the
 * Card Budget — where the one line lost none.
 */
export function appCardOptions(state: AppState): AppOption[] {
  return [...panelOptions(state.panel), ...viewOptions(state), { label: SETTINGS_LABEL, line: SETTINGS_LINE, op: { kind: 'settings' } }]
}

/** Every setting's ops by its kind, each line carrying the state now: the settings ask's card. A setting the kinds table keeps off (`kept`: the voice timings, the records) has none. */
export function settingOptions(state: AppState, kinds: SettingKinds<AppSettings> = SETTING_KINDS): AppOption[] {
  return leavesIn(state.settings, kinds).flatMap((leaf) => opsOfSetting(leaf, state.voices))
}

/**
 * Every app op, the panel's, the views' and every setting's: what a label
 * either ask offers resolves against.
 */
export function appOptions(state: AppState, kinds: SettingKinds<AppSettings> = SETTING_KINDS): AppOption[] {
  return [...panelOptions(state.panel), ...viewOptions(state), ...settingOptions(state, kinds)]
}

/** The op a card label names, read against the app as it is; null for a label no app option has. */
export function appOpOf(label: string, state: AppState, kinds: SettingKinds<AppSettings> = SETTING_KINDS): AppOp | null {
  if (label === SETTINGS_LABEL) return { kind: 'settings' }
  return appOptions(state, kinds).find((option) => option.label === label)?.op ?? null
}

/** Whether an op moves by the Amount Choice. */
export const takesAmount = (op: AppOp): boolean => op.kind === 'amount' || op.kind === 'panelWidth'

/** What an op changes, worked out against the app as it is: the panel, the view, or the settings to save; a place to look up; null when the words carry no value for it. */
export type AppChange =
  | { readonly kind: 'panel'; readonly open?: boolean; readonly mode?: FeedPanelMode; readonly width?: number }
  | { readonly kind: 'view'; readonly view: AppView; readonly section?: string }
  | { readonly kind: 'settings'; readonly settings: AppSettings }
  | { readonly kind: 'place'; readonly path: SettingPath; readonly words: string }

/** The panel's width with no bound of its own here: main clamps it to its share of the window, as every width writer does. */
const PANEL_WIDTH_UNBOUNDED = Number.MAX_SAFE_INTEGER

/**
 * How far each up or down rung moves an amount, in its steps: a guess, cheap
 * to reverse (ADR 0080's levels) — a line like "a bit wider" landing too far
 * or too short would settle it.
 */
const RUNG_STEPS: Readonly<Record<'little' | 'step' | 'lot', number>> = { little: 0.5, step: 1, lot: 2.5 }

/** The level a rung sets: `to` the number the words carry, else up or down its steps or all the way; null when `to` finds none. */
function levelOf(rung: LevelRung | undefined, words: string, now: number, bounds: { readonly min: number; readonly max: number; readonly step: number }): number | null {
  if (rung === undefined || rung === 'to') {
    const number = firstNumber(words)
    return number === null ? null : Math.max(bounds.min, Math.min(bounds.max, number))
  }
  const [way, size] = rung.split('-') as ['up' | 'down', 'little' | 'step' | 'lot' | 'all']
  if (size === 'all') return way === 'up' ? bounds.max : bounds.min
  const next = now + (way === 'up' ? 1 : -1) * Math.round(bounds.step * RUNG_STEPS[size])
  return Math.max(bounds.min, Math.min(bounds.max, next))
}

/** The time of day the words carry, `HH:MM` on the 24-hour clock: `23:00`, `11 pm`, `7.30 am`, `midnight`; null for none. */
export function timeOfDayIn(words: string): string | null {
  const said = words.toLowerCase()
  if (/\bmidnight\b/.test(said)) return '00:00'
  if (/\b(noon|midday)\b/.test(said)) return '12:00'
  const pm = /\b(pm|p\.m\.?|evening|night)\b/.test(said)
  const am = /\b(am|a\.m\.?|morning)\b/.test(said)
  const digits = /\b(\d{1,2})(?:[:.](\d{2}))?\b/.exec(said)
  const hour = digits !== null ? Number(digits[1]) : firstNumber(said)
  const minute = digits?.[2] !== undefined ? Number(digits[2]) : 0
  if (hour === null || hour > 23 || minute > 59) return null
  const h = pm && hour < 12 ? hour + 12 : am && hour === 12 ? 0 : hour
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(minute)}`
}

/** A place the geocoder picked for spoken words: its name, where it is, and its coordinates. */
export interface PickedPlace {
  readonly name: string
  readonly where: string
  readonly latitude: number
  readonly longitude: number
}

/** The settings a picked place makes (the weather city): its name, and its coordinates kept, as the Settings page's picker keeps them. */
export function placeSettings(state: AppState, path: SettingPath, place: PickedPlace): AppSettings {
  const group = path.slice(0, -1)
  const owner = group.length === 0 ? state.settings : settingAt(state.settings, group)
  const next = { ...(isRecord(owner) ? owner : {}), [path[path.length - 1]!]: place.name, latitude: place.latitude, longitude: place.longitude }
  return group.length === 0 ? (next as unknown as AppSettings) : withSetting(state.settings, group, next)
}

/** A picked place as its Answer names it: `Paris, Île-de-France, France`. */
export const placeName = (place: PickedPlace): string => (place.where === '' ? place.name : `${place.name}, ${place.where}`)

/** What an op changes on the app as it is; null when it needs a value the words do not carry. */
export function appChangeOf(action: AppOpAction, state: AppState, kinds: SettingKinds<AppSettings> = SETTING_KINDS): AppChange | null {
  const words = action.words ?? ''
  switch (action.kind) {
    case 'panel':
      return action.op === 'open' || action.op === 'close' ? { kind: 'panel', open: action.op === 'open' } : { kind: 'panel', mode: action.op }
    case 'panelWidth': {
      // The window's bound is main's: it clamps to its share of the window, as every width writer does.
      const width = levelOf(action.rung, words, state.panel.width, { min: FEED_PANEL_WIDTH_MIN, max: PANEL_WIDTH_UNBOUNDED, step: FEED_PANEL_WIDTH_STEP })
      return width === null ? null : { kind: 'panel', width }
    }
    case 'view':
      return { kind: 'view', view: action.view, ...(action.section !== undefined ? { section: action.section } : {}) }
    case 'set':
      return { kind: 'settings', settings: withSetting(state.settings, action.path, action.value) }
    case 'member': {
      const shown = settingAt(state.settings, action.path)
      const members = Array.isArray(shown) ? (shown as unknown[]).filter((member) => member !== action.member) : []
      return { kind: 'settings', settings: withSetting(state.settings, action.path, action.on ? [...members, action.member] : members) }
    }
    case 'amount': {
      const kind = kindAt(action.path, state.settings, kinds)
      const now = settingAt(state.settings, action.path)
      if (kind?.kind !== 'amount' || typeof now !== 'number') return null
      const level = levelOf(action.rung, words, now, kind)
      return level === null ? null : { kind: 'settings', settings: withSetting(state.settings, action.path, level) }
    }
    case 'settings':
      return null
    case 'words': {
      const kind = kindAt(action.path, state.settings, kinds)
      if (kind?.kind === 'place') return words.trim() === '' ? null : { kind: 'place', path: action.path, words: words.trim() }
      const time = kind?.kind === 'time' ? timeOfDayIn(words) : null
      return time === null ? null : { kind: 'settings', settings: withSetting(state.settings, action.path, time) }
    }
  }
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The Answer an op says (ADR 0091): a fixed sentence filled from the app as
 * it is after the op, naming the new value — the sanitized one, when its
 * bounds moved it — and saying so when it already was. No model writes it.
 */
export function appAnswer(action: AppOpAction, before: AppState, after: AppState, kinds: SettingKinds<AppSettings> = SETTING_KINDS, placed?: string): string {
  const already = (same: boolean): string => (same ? ' It already was.' : '')
  switch (action.kind) {
    case 'panel': {
      if (action.op === 'open' || action.op === 'close') return `${action.op === 'open' ? 'Opened' : 'Closed'} the activity panel.${already(before.panel.open === after.panel.open)}`
      return `The activity panel ${after.panel.mode === 'docked' ? 'is docked beside the page' : 'floats over the page'}.${already(before.panel.mode === after.panel.mode)}`
    }
    case 'panelWidth':
      return `The activity panel is ${after.panel.width} pixels wide.${already(before.panel.width === after.panel.width)}`
    case 'view': {
      const title = sectionTitle(action.section)
      return `Showing ${VIEW_NAMES[action.view]}${title !== undefined ? `, at ${title}` : ''}.`
    }
    case 'member': {
      const kind = kindAt(action.path, after.settings, kinds)
      const named = kind?.kind === 'members' ? (kind.members.find((member) => member.value === action.member)?.named ?? action.member) : action.member
      const shown = (state: AppState): boolean => (settingAt(state.settings, action.path) as unknown[] | undefined)?.includes(action.member) === true
      return `The ${named} card is ${shown(after) ? 'shown' : 'hidden'} on the Idle Screen.${already(shown(before) === shown(after))}`
    }
    case 'settings':
      return 'Done.'
    default: {
      const kind = kindAt(action.path, after.settings, kinds)
      const was = settingAt(before.settings, action.path)
      const now = settingAt(after.settings, action.path)
      if (kind === null) return 'Done.'
      const same = JSON.stringify(was) === JSON.stringify(now)
      // A spoken place names the one the geocoder picked, region and country too (ADR 0091's guess: its first match).
      if (kind.kind === 'place' && placed !== undefined) return `${capital(kind.name)} set to ${placed}.`
      if (kind.kind === 'switch') return `${capital(kind.name)} turned ${now === true ? 'on' : 'off'}.${already(same)}`
      const value = kind.kind === 'amount' ? `${String(now)}${kind.unit === '%' ? ' percent' : ` ${kind.unit}`}` : kind.kind === 'place' && now === '' ? 'the network\'s own place' : namedValue(kind, now)
      return `${capital(kind.name)} set to ${value}.${already(same)}`
    }
  }
}

/** The app op as the Feed and "Done so far" name it: `app: panel open`, `app: set ad blocking off`. */
export function describeAppOp(action: AppOpAction): string {
  switch (action.kind) {
    case 'panel':
      return `app: panel ${action.op}`
    case 'panelWidth':
      return `app: panel width ${action.rung ?? 'to'}`
    case 'view':
      return `app: show ${action.view}${action.section !== undefined ? ` ${action.section}` : ''}`
    case 'set':
      return `app: set ${action.path.join('.')} ${JSON.stringify(action.value)}`
    case 'member':
      return `app: ${action.on ? 'show' : 'hide'} ${action.path.join('.')} ${action.member}`
    case 'amount':
      return `app: set ${action.path.join('.')} ${action.rung ?? 'to'}${action.words !== undefined && (action.rung ?? 'to') === 'to' ? ` ${JSON.stringify(action.words)}` : ''}`
    case 'words':
      return `app: set ${action.path.join('.')} ${JSON.stringify(action.words ?? '')}`
    case 'settings':
      return 'app: a setting'
  }
}

/**
 * The names the app's own surfaces go by (#420, ADR 0089): its views and its
 * panel, each by the one word its line names it with. A bare word one of
 * them is no Known Address — "open settings" has two readings, and is
 * Jev's. A section's word ("weather", "voice") is not one: it names a site
 * as readily, and its view is reached by its words in full.
 */
export function appWords(): ReadonlySet<string> {
  return new Set(['settings', 'weight', 'dashboard', 'panel', 'feed'])
}
