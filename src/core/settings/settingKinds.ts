import { IDLE_AFTER_MINUTES, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, type AppSettings } from './settings'
import { NIGHT_BRIGHTNESS_MAX, NIGHT_BRIGHTNESS_MIN } from '../idle/nightDim'
import { IDLE_CARD_IDS } from '../idle/columns'

// What kind of value each Setting is (#420, ADR 0091): the card offers a
// setting's ops by its kind — a boolean on and off, a choice one op per
// value, an amount up, down or to a number, words a Slot — so the lines
// are generated from this table and the `AppSettings` shape, never listed
// on the card. A boolean needs no entry: its kind is its value's. Every
// other field must say its kind here, the type insists, and leaving one
// off the card is a policy entry (`kept`), never a missing line.

/** Why a setting is kept off the card. */
export type KeptWhy =
  /** Hard policy: a wrong value leaves voice unable to hear the line that would put it back. */
  | 'voice'
  /** An edit of records (people, feeds, a dashboard, a device), not a value with a kind. */
  | 'record'
  /** Worked out from another setting, never set on its own. */
  | 'derived'

/** How the card and the Answer name a setting: a short noun the Answer says, and what the card adds to tell it apart. */
export interface Named {
  readonly name: string
  readonly hint?: string
}

export type SettingKind =
  /** On and off. */
  | ({ readonly kind: 'switch' } & Named)
  /** One op per value, each with how the card names it. */
  | ({ readonly kind: 'choice'; readonly values: readonly { readonly value: string | number; readonly named: string }[] } & Named)
  /** One of the voices installed, or `''` the default. */
  | ({ readonly kind: 'voices' } & Named)
  /** A number between bounds, moved by the Amount Choice. */
  | ({ readonly kind: 'amount'; readonly min: number; readonly max: number; readonly step: number; readonly unit: string } & Named)
  /** A place the words name, looked up by the geocoder. */
  | ({ readonly kind: 'place' } & Named)
  /** A time of day the words name, `HH:MM`. */
  | ({ readonly kind: 'time' } & Named)
  /** A set of members, each shown or not. */
  | ({ readonly kind: 'members'; readonly members: readonly { readonly value: string; readonly named: string }[] } & Named)
  /** Off the card, and why. */
  | { readonly kind: 'kept'; readonly why: KeptWhy }

/** A group of settings kept as one object (`nightDim`, `weather`). */
export interface SettingGroup<T> {
  readonly kind: 'group'
  readonly fields: SettingKinds<T>
}

type KindOf<V> = V extends boolean ? SettingKind : V extends readonly unknown[] ? SettingKind : V extends object ? SettingGroup<V> | SettingKind : SettingKind

/** Each field's kind: required for every field that is no boolean, optional for a boolean (its name, at most). */
export type SettingKinds<T> = { readonly [K in keyof T as NonNullable<T[K]> extends boolean ? never : K]-?: KindOf<NonNullable<T[K]>> } & {
  readonly [K in keyof T as NonNullable<T[K]> extends boolean ? K : never]?: SettingKind
}

const choice = (named: Named, values: readonly (readonly [string | number, string])[]): SettingKind => ({ kind: 'choice', ...named, values: values.map(([value, named]) => ({ value, named })) })

/** The card's names of the Idle Screen's cards. */
const CARD_NAMES: Readonly<Record<(typeof IDLE_CARD_IDS)[number], string>> = {
  weather: 'weather',
  calendar: 'calendar',
  lastPage: 'last page',
  weight: 'weight',
  usage: 'AI usage',
  news: 'news',
  music: 'music',
}

export const SETTING_KINDS: SettingKinds<AppSettings> = {
  micId: { kind: 'kept', why: 'voice' },
  wakeWordThreshold: { kind: 'kept', why: 'voice' },
  pauseCapMs: { kind: 'kept', why: 'voice' },
  resumptionMergeMs: { kind: 'kept', why: 'voice' },
  hotListenSilenceMs: { kind: 'kept', why: 'voice' },
  sttEngine: { kind: 'kept', why: 'voice' },
  webZoomPercent: { kind: 'amount', name: 'web page zoom', min: WEB_ZOOM_PERCENT_MIN, max: WEB_ZOOM_PERCENT_MAX, step: 10, unit: '%' },
  ttsVoice: { kind: 'voices', name: 'voice', hint: 'the voice the app speaks in' },
  adblockEnabled: { kind: 'switch', name: 'ad blocking' },
  appearance: choice({ name: 'appearance', hint: 'light or dark mode' }, [
    ['system', 'as this computer'],
    ['light', 'light mode'],
    ['dark', 'dark mode'],
  ]),
  timeFormat: choice({ name: 'clock', hint: '12-hour or 24-hour' }, [
    ['system', 'as this computer'],
    ['12', '12-hour'],
    ['24', '24-hour'],
  ]),
  clockSeconds: { kind: 'switch', name: 'seconds on the clock' },
  dateFormat: choice({ name: 'date format', hint: 'how the date under the clock is written' }, [
    ['long', 'Saturday 24 October'],
    ['long-year', 'Saturday, 24 October 2026'],
    ['short', 'Sat 24 Oct'],
    ['numeric', '24/10/2026'],
  ]),
  weekStart: choice({ name: 'first day of the week' }, [
    ['system', 'as this computer'],
    ['monday', 'Monday'],
    ['sunday', 'Sunday'],
    ['saturday', 'Saturday'],
  ]),
  idleAfterMinutes: choice(
    { name: 'idle timeout', hint: 'how long before the Idle Screen comes on' },
    IDLE_AFTER_MINUTES.map((minutes) => [minutes, minutes === 0 ? 'the launch default' : `${minutes} minute${minutes === 1 ? '' : 's'}`] as const),
  ),
  nightDim: {
    kind: 'group',
    fields: {
      enabled: { kind: 'switch', name: 'night dimming', hint: 'the Idle Screen darkened at night' },
      from: { kind: 'time', name: 'night dimming start' },
      to: { kind: 'time', name: 'night dimming end' },
      monitor: { kind: 'kept', why: 'record' },
      brightnessPercent: { kind: 'amount', name: 'night dimming brightness', hint: 'how bright the Idle Screen stays while dimmed', min: NIGHT_BRIGHTNESS_MIN, max: NIGHT_BRIGHTNESS_MAX, step: 10, unit: '%' },
    },
  },
  weather: {
    kind: 'group',
    fields: {
      city: { kind: 'place', name: 'weather city' },
      units: choice({ name: 'weather units' }, [
        ['metric', 'Celsius'],
        ['imperial', 'Fahrenheit'],
      ]),
      latitude: { kind: 'kept', why: 'derived' },
      longitude: { kind: 'kept', why: 'derived' },
    },
  },
  usageDashboard: { kind: 'kept', why: 'record' },
  idleCards: { kind: 'members', name: 'Idle Screen card', members: IDLE_CARD_IDS.map((id) => ({ value: id, named: CARD_NAMES[id] })) },
  news: { kind: 'kept', why: 'record' },
  weight: { kind: 'kept', why: 'record' },
  scale: { kind: 'kept', why: 'record' },
}
