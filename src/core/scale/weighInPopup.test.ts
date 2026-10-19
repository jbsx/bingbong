import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWeighInPopup, type WeighInPopupState } from './weighInPopup'

describe('the Weigh-in pop-up', () => {
  let shown: WeighInPopupState[]
  let popup: ReturnType<typeof createWeighInPopup>

  beforeEach(() => {
    vi.useFakeTimers()
    shown = []
    popup = createWeighInPopup((state) => shown.push(state))
  })
  afterEach(() => vi.useRealTimers())

  it('shows the live weight while it moves, then the settled weight with the change since the previous Weigh-in', () => {
    popup.reading({ kg: 80.4, stable: false })
    popup.reading({ kg: 81.1, stable: false })
    expect(popup.state()).toEqual({ phase: 'live', kg: 81.1 })
    popup.weighIn({ at: 2, kg: 81.25, r1: 512, r2: 500 }, { at: 1, kg: 81.75, r1: 510, r2: 500 })
    expect(popup.state()).toEqual({ phase: 'settled', kg: 81.25, changeKg: -0.5 })
  })

  it('keeps the settled weight while the owner is still on, and has no change with no earlier Weigh-in', () => {
    popup.reading({ kg: 81.25, stable: true })
    popup.weighIn({ at: 2, kg: 81.25, r1: 512, r2: 500 }, null)
    popup.reading({ kg: 83.2, stable: false })
    expect(popup.state()).toEqual({ phase: 'settled', kg: 81.25, changeKg: null })
  })

  it('leaves about 8 s after the owner steps off', () => {
    popup.reading({ kg: 81.1, stable: false })
    popup.weighIn({ at: 2, kg: 81.25, r1: 512, r2: 500 }, null)
    popup.reading({ kg: 0, stable: false })
    vi.advanceTimersByTime(7_900)
    expect(popup.state().phase).toBe('settled')
    vi.advanceTimersByTime(200)
    expect(popup.state()).toEqual({ phase: 'hidden' })
    expect(shown.at(-1)).toEqual({ phase: 'hidden' })
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
