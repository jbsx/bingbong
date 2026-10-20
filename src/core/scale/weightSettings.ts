// The Weight section (CONTEXT.md): the People, the Weight card's choices
// and the Weigh-in pop-up's. #350's lone Body Profile (settings' `body`)
// becomes Jaish's on upgrade, with Barun beside him.

import type { BodyProfile } from './bodyComposition'
import { JAISH, type Person } from './people'

export const WEIGHT_CARD_RANGES = [7, 30, 90] as const
export type WeightCardRange = (typeof WEIGHT_CARD_RANGES)[number]

/** How long the pop-up may linger after stepping off, in ms. */
export const POPUP_LINGER_MS_MIN = 2_000
export const POPUP_LINGER_MS_MAX = 30_000
export const POPUP_LINGER_MS_DEFAULT = 8_000

export interface WeightSettings {
  /** Jaish first, always; then the others in the order they were added. */
  people: Person[]
  /** The Weight card: the People it leaves out (by id, so a new Person is shown), the figures each row carries and the line's range in days. */
  card: { hidden: string[]; change: boolean; fat: boolean; line: boolean; rangeDays: WeightCardRange }
  /** The Weigh-in pop-up: shown at all, and how long it stays after stepping off. */
  popup: { on: boolean; lingerMs: number }
}

/** A Body Profile with nothing set: a new Person's. */
export const EMPTY_BODY: BodyProfile = { heightCm: null, birthDate: null, sex: null }

export function defaultWeightSettings(): WeightSettings {
  return {
    people: [
      { id: JAISH, name: 'Jaish', body: EMPTY_BODY, guess: true },
      { id: 'barun', name: 'Barun', body: EMPTY_BODY, guess: true },
    ],
    card: { hidden: [], change: true, fat: true, line: true, rangeDays: 30 },
    popup: { on: true, lingerMs: POPUP_LINGER_MS_DEFAULT },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A height in cm a person could have; anything else unset. */
function asHeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 250 ? value : null
}

/** A real calendar date, YYYY-MM-DD; anything else unset. */
function asBirthDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? value : null
}

export function sanitizeBodyProfile(raw: unknown): BodyProfile {
  const body = asRecord(raw)
  return { heightCm: asHeight(body?.heightCm), birthDate: asBirthDate(body?.birthDate), sex: body?.sex === 'male' || body?.sex === 'female' ? body.sex : null }
}

/**
 * The People as saved: each with an id, one per id, and Jaish first however
 * the list came. A name cleared in the field never drops a Person (that is
 * Remove's, with its confirm): they keep their default name, or "Unnamed".
 */
function sanitizePeople(raw: unknown[]): Person[] {
  const defaults = defaultWeightSettings().people
  const people: Person[] = []
  for (const item of raw) {
    const record = asRecord(item)
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    if (id === '' || people.some((person) => person.id === id)) continue
    const typed = typeof record?.name === 'string' ? record.name.trim() : ''
    const name = typed !== '' ? typed : (defaults.find((person) => person.id === id)?.name ?? 'Unnamed')
    people.push({ id, name, body: sanitizeBodyProfile(record?.body), guess: record?.guess !== false })
  }
  const jaish = people.find((person) => person.id === JAISH) ?? defaultWeightSettings().people[0]
  return [jaish, ...people.filter((person) => person.id !== JAISH)]
}

/** The Weight section without a Person being removed: gone from the People and from the card's hidden list. Jaish is never removed. */
export function withoutPerson(weight: WeightSettings, id: string): WeightSettings {
  if (id === JAISH) return weight
  return { ...weight, people: weight.people.filter((person) => person.id !== id), card: { ...weight.card, hidden: weight.card.hidden.filter((hidden) => hidden !== id) } }
}

/** Settings' `weight` as read from disk or IPC; with none (settings from #350 or before), today's default with `legacyBody` as Jaish's. */
export function sanitizeWeightSettings(raw: unknown, legacyBody: unknown): WeightSettings {
  const defaults = defaultWeightSettings()
  const record = asRecord(raw)
  if (record === null) {
    const [jaish, ...rest] = defaults.people
    return { ...defaults, people: [{ ...jaish, body: sanitizeBodyProfile(legacyBody) }, ...rest] }
  }
  const card = asRecord(record.card)
  const popup = asRecord(record.popup)
  const lingerMs = typeof popup?.lingerMs === 'number' && Number.isFinite(popup.lingerMs) ? Math.round(popup.lingerMs) : POPUP_LINGER_MS_DEFAULT
  return {
    people: Array.isArray(record.people) ? sanitizePeople(record.people) : defaults.people,
    card: {
      hidden: Array.isArray(card?.hidden) ? card.hidden.filter((id): id is string => typeof id === 'string') : [],
      change: card?.change !== false,
      fat: card?.fat !== false,
      line: card?.line !== false,
      rangeDays: WEIGHT_CARD_RANGES.find((days) => days === card?.rangeDays) ?? defaults.card.rangeDays,
    },
    popup: { on: popup?.on !== false, lingerMs: Math.min(POPUP_LINGER_MS_MAX, Math.max(POPUP_LINGER_MS_MIN, lingerMs)) },
  }
}
