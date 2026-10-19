import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettledWeighIn } from './people'
import { createWeighInPopup, type WeighInPopupState } from './weighInPopup'

const JAISH = { id: 'jaish', name: 'Jaish' }
const BARUN = { id: 'barun', name: 'Barun' }

function settled(kg: number, changeKg: number | null, person = JAISH, at = 2): SettledWeighIn {
  return { at, kg, person, changeKg, others: [person === JAISH ? BARUN : JAISH] }
}

describe('the Weigh-in pop-up', () => {
  let shown: WeighInPopupState[]
  let popup: ReturnType<typeof createWeighInPopup>
  let options: { on: boolean; lingerMs: number }

  beforeEach(() => {
    vi.useFakeTimers()
    shown = []
    options = { on: true, lingerMs: 8_000 }
    popup = createWeighInPopup(
      (state) => shown.push(state),
      () => options,
    )
  })
  afterEach(() => vi.useRealTimers())

  it('shows the live weight while it moves, then the settled weight with whose it is, the change and the other People', () => {
    popup.reading({ kg: 80.4, stable: false })
    popup.reading({ kg: 81.1, stable: false })
    expect(popup.state()).toEqual({ phase: 'live', kg: 81.1 })
    popup.weighIn(settled(81.25, -0.5))
    expect(popup.state()).toEqual({ phase: 'settled', at: 2, kg: 81.25, person: JAISH, changeKg: -0.5, others: [BARUN] })
  })

  it('keeps the settled weight while the owner is still on', () => {
    popup.reading({ kg: 81.25, stable: true })
    popup.weighIn(settled(81.25, null))
    popup.reading({ kg: 83.2, stable: false })
    expect(popup.state()).toMatchObject({ phase: 'settled', kg: 81.25, changeKg: null })
  })

  it('leaves about 8 s after the owner steps off', () => {
    popup.reading({ kg: 81.1, stable: false })
    popup.weighIn(settled(81.25, null))
    popup.reading({ kg: 0, stable: false })
    vi.advanceTimersByTime(7_900)
    expect(popup.state().phase).toBe('settled')
    vi.advanceTimersByTime(200)
    expect(popup.state()).toEqual({ phase: 'hidden' })
    expect(shown.at(-1)).toEqual({ phase: 'hidden' })
  })

  it('lingers as long as the Weight section says', () => {
    options.lingerMs = 3_000
    popup.weighIn(settled(81.25, null))
    popup.ended()
    vi.advanceTimersByTime(3_100)
    expect(popup.state()).toEqual({ phase: 'hidden' })
  })

  it('shows nothing while it is off in the Weight section', () => {
    options.on = false
    popup.reading({ kg: 81.1, stable: false })
    popup.weighIn(settled(81.25, null))
    expect(shown).toEqual([])
  })

  it('follows a move at once — the new name, their change and the chips — and lingers its full time from the tap', () => {
    popup.weighIn(settled(81.25, -0.5))
    popup.ended()
    vi.advanceTimersByTime(6_000)
    popup.moved(settled(81.25, null, BARUN))
    expect(popup.state()).toEqual({ phase: 'settled', at: 2, kg: 81.25, person: BARUN, changeKg: null, others: [JAISH] })
    vi.advanceTimersByTime(7_900)
    expect(popup.state().phase).toBe('settled')
    vi.advanceTimersByTime(200)
    expect(popup.state()).toEqual({ phase: 'hidden' })
  })

  it('ignores a move of a Weigh-in it is not showing', () => {
    popup.weighIn(settled(81.25, -0.5))
    popup.moved(settled(70, null, BARUN, 1))
    expect(popup.state()).toMatchObject({ person: JAISH, kg: 81.25 })
    popup.ended()
    vi.advanceTimersByTime(8_100)
    popup.moved(settled(81.25, null, BARUN))
    expect(popup.state()).toEqual({ phase: 'hidden' })
  })

  it('leaves 8 s after the scale drops the link, and stepping back on in time brings the live weight back', () => {
    popup.reading({ kg: 81.1, stable: false })
    popup.reading({ kg: 0, stable: false })
    vi.advanceTimersByTime(4_000)
    popup.reading({ kg: 79.9, stable: false })
    vi.advanceTimersByTime(8_000)
    expect(popup.state()).toEqual({ phase: 'live', kg: 79.9 })
    popup.ended()
    vi.advanceTimersByTime(8_000)
    expect(popup.state()).toEqual({ phase: 'hidden' })
  })

  it('stays hidden for a scale waking at 0 kg', () => {
    popup.reading({ kg: 0, stable: false })
    expect(shown).toEqual([])
  })

  it('tells each change once, not every repeated frame', () => {
    popup.reading({ kg: 81.1, stable: false })
    popup.reading({ kg: 81.1, stable: false })
    expect(shown).toEqual([{ phase: 'live', kg: 81.1 }])
  })
})
