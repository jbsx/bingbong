import { describe, expect, it } from 'vitest'
import { guessPerson, JAISH, settledWeighIn, weighInsOf, type Person } from './people'
import type { WeighIn } from './weighIns'

const EMPTY = { heightCm: null, birthDate: null, sex: null, background: null }
const jaish: Person = { id: JAISH, name: 'Jaish', body: EMPTY, guess: true }
const barun: Person = { id: 'barun', name: 'Barun', body: EMPTY, guess: true }
const guest: Person = { id: 'p-guest', name: 'Guest', body: EMPTY, guess: true }

const at = (day: number, kg: number, person: string): WeighIn => ({ at: day * 86_400_000, kg, r1: 500, r2: 500, person })

describe('guessPerson', () => {
  const history = [at(1, 84, JAISH), at(2, 71, 'barun'), at(3, 83.5, JAISH), at(4, 72, 'barun')]

  it('gives the Weigh-in to the Person whose latest Weigh-in weight is nearest', () => {
    expect(guessPerson(83, history, [jaish, barun])).toBe(JAISH)
    expect(guessPerson(73.4, history, [jaish, barun])).toBe('barun')
    // Barun's latest is 72, not his older 71; Jaish's is 83.5, not 84.
    expect(guessPerson(77.6, history, [jaish, barun])).toBe('barun')
  })

  it('never guesses a Person whose "guess me" is off', () => {
    expect(guessPerson(72, history, [jaish, { ...barun, guess: false }])).toBe(JAISH)
  })

  it('never guesses a Person with no Weigh-in yet', () => {
    expect(guessPerson(60, history, [jaish, barun, guest])).toBe('barun')
  })

  it('goes to Jaish when nobody is guessable', () => {
    expect(guessPerson(72, [], [jaish, barun])).toBe(JAISH)
    expect(guessPerson(72, history, [{ ...jaish, guess: false }, { ...barun, guess: false }])).toBe(JAISH)
  })

  it('counts a Weigh-in of a Person no longer in settings as Jaish’s', () => {
    expect(guessPerson(60, [at(1, 61, 'p-gone')], [jaish, barun])).toBe(JAISH)
    expect(weighInsOf([at(1, 61, 'p-gone'), at(2, 72, 'barun')], [jaish, barun], JAISH).map((weighIn) => weighIn.kg)).toEqual([61])
  })
})

describe('settledWeighIn', () => {
  it('names the Person, the change since their own previous Weigh-in and a chip per other Person', () => {
    const history = [at(1, 84, JAISH), at(2, 71, 'barun'), at(3, 72.5, 'barun')]
    expect(settledWeighIn(history[2], history, [jaish, barun, guest])).toEqual({
      at: history[2].at,
      kg: 72.5,
      person: { id: 'barun', name: 'Barun' },
      changeKg: 1.5,
      others: [
        { id: JAISH, name: 'Jaish' },
        { id: 'p-guest', name: 'Guest' },
      ],
    })
  })

  it('has no change for a Person’s first Weigh-in', () => {
    const history = [at(1, 84, JAISH), at(2, 71, 'barun')]
    expect(settledWeighIn(history[1], history, [jaish, barun]).changeKg).toBeNull()
  })
})
