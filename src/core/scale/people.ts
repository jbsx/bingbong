// People (CONTEXT.md): who the scale serves, each with a name, a Body
// Profile and "guess me". A Weigh-in is given to the Person whose latest
// Weigh-in is nearest, with no asking; a wrong guess is moved with a tap.

import type { BodyProfile } from './bodyComposition'
import type { WeighIn } from './weighIns'

/** Jaish's id: the owner, always there and never removed, and whose every Weigh-in from before #351 is. */
export const JAISH = 'jaish'

export interface Person {
  /** Stable across renames; a Weigh-in names its Person by it. */
  id: string
  name: string
  body: BodyProfile
  /** Left out of the guess when off. */
  guess: boolean
}

/** A Person as the pop-up's chips name them. */
export interface PersonName {
  id: string
  name: string
}

/** Whose a Weigh-in is: its Person, or Jaish's when that Person is no longer in settings. */
export function ownerOf(weighIn: WeighIn, people: readonly Person[]): string {
  return people.some((person) => person.id === weighIn.person) ? weighIn.person : JAISH
}

/** One Person's Weigh-ins, oldest first. */
export function weighInsOf(weighIns: readonly WeighIn[], people: readonly Person[], id: string): WeighIn[] {
  return weighIns.filter((weighIn) => ownerOf(weighIn, people) === id)
}

/**
 * Whose a new Weigh-in of `kg` is: the Person whose latest Weigh-in weight
 * is nearest, among those with "guess me" on and a Weigh-in already (the
 * earlier in settings on a tie); Jaish with nobody guessable.
 */
export function guessPerson(kg: number, weighIns: readonly WeighIn[], people: readonly Person[]): string {
  let best: { id: string; distance: number } | null = null
  for (const person of people) {
    if (!person.guess) continue
    const latest = weighInsOf(weighIns, people, person.id).at(-1)
    if (latest === undefined) continue
    const distance = Math.abs(latest.kg - kg)
    if (best === null || distance < best.distance) best = { id: person.id, distance }
  }
  return best?.id ?? JAISH
}

/** The settled pop-up's words for a Weigh-in: whose it is, the change since their previous one (null for their first), and a chip per other Person. */
export interface SettledWeighIn {
  at: number
  kg: number
  person: PersonName
  changeKg: number | null
  others: PersonName[]
}

export function settledWeighIn(weighIn: WeighIn, weighIns: readonly WeighIn[], people: readonly Person[]): SettledWeighIn {
  const id = ownerOf(weighIn, people)
  const previous = weighInsOf(weighIns, people, id)
    .filter((other) => other.at < weighIn.at)
    .at(-1)
  const name = (person: Person): PersonName => ({ id: person.id, name: person.name })
  const owner = people.find((person) => person.id === id)
  return {
    at: weighIn.at,
    kg: weighIn.kg,
    person: owner === undefined ? { id, name: 'Jaish' } : name(owner),
    changeKg: previous === undefined ? null : Math.round((weighIn.kg - previous.kg) * 100) / 100,
    others: people.filter((person) => person.id !== id).map(name),
  }
}
