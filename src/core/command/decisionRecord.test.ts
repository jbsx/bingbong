import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import { jevDetailOf, MISFIRE_WINDOW_MS, misfireSignal } from './decisionRecord'

// The per-Command decision record (#324) beside the perf log: what was
// heard, what was read and by whom, Jev's confidence — and the Misfire
// signal, the next Command within 3 s being back, clear, escape or the
// opposite scroll (ADR 0076: counted, never prevented).

describe('misfireSignal', () => {
  it('reads back, clear, escape and the opposite scroll within the window as a Misfire of the Command before', () => {
    expect(misfireSignal({ verb: 'click', at: 1_000 }, { verb: 'back', at: 2_500 })).toBe('back')
    expect(misfireSignal({ verb: 'type', at: 1_000 }, { verb: 'clear', at: 1_200 })).toBe('clear')
    expect(misfireSignal({ verb: 'click', at: 1_000 }, { verb: 'press', key: { key: 'Escape' }, at: 3_999 })).toBe('escape')
    expect(misfireSignal({ verb: 'scroll_down', at: 1_000 }, { verb: 'scroll_up', at: 1_500 })).toBe('opposite_scroll')
    expect(misfireSignal({ verb: 'scroll_up', at: 1_000 }, { verb: 'scroll_down', at: 1_500 })).toBe('opposite_scroll')
  })

  it('reads nothing past the window, from a same-way scroll, another key, or a Command that fired nothing', () => {
    expect(misfireSignal({ verb: 'click', at: 1_000 }, { verb: 'back', at: 1_000 + MISFIRE_WINDOW_MS + 1 })).toBeNull()
    expect(misfireSignal({ verb: 'scroll_down', at: 1_000 }, { verb: 'scroll_down', at: 1_500 })).toBeNull()
    expect(misfireSignal({ verb: 'click', at: 1_000 }, { verb: 'press', key: { key: 'Enter' }, at: 1_500 })).toBeNull()
    expect(misfireSignal({ verb: 'none', at: 1_000 }, { verb: 'back', at: 1_500 })).toBeNull()
    expect(misfireSignal({ verb: 'click', at: 1_000 }, { verb: 'click', at: 1_500 })).toBeNull()
  })
})

describe('jevDetailOf', () => {
  it('keeps the eight most probable actions on the card (#370) and the five most probable spans', () => {
    const action: DecisionChoiceAnswer = {
      type: 'choice',
      choice: 'click-2',
      confidence: 0.5,
      probabilities: { none: 0.01, search: 0.03, 'click-1': 0.1, 'click-2': 0.5, 'click-3': 0.12, 'type-3': 0.02, 'menu-2': 0.04, 'open-1': 0.05, scroll_down: 0.06, loop: 0.07 },
    }
    const slot: DecisionChoiceAnswer = { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, 's0-0': 0.1 } }
    expect(jevDetailOf({ action, slot }, 212, 'jev-1.14.0')).toEqual({
      model: 'jev-1.14.0',
      latencyMs: 212,
      confidence: { action: 0.5, slot: 0.9 },
      probabilities: {
        action: { 'click-2': 0.5, 'click-3': 0.12, 'click-1': 0.1, loop: 0.07, scroll_down: 0.06, 'open-1': 0.05, 'menu-2': 0.04, search: 0.03 },
        slot: { none: 0.9, 's0-0': 0.1 },
      },
    })
  })

  it('carries where beside the action card and the Slot when it was asked (#340), and omits it when it was not', () => {
    const one = (label: string, confidence: number): DecisionChoiceAnswer => ({ type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } })
    const reading = { action: one('search', 0.9), slot: one('s2-4', 0.7) }
    const where: DecisionChoiceAnswer = { type: 'choice', choice: 'site', confidence: 0.6, probabilities: { page: 0.1, site: 0.6, web: 0.3 } }
    const scoped = jevDetailOf({ ...reading, where }, 212, 'jev-1.14.0')
    expect(scoped.confidence).toEqual({ action: 0.9, slot: 0.7, where: 0.6 })
    expect(scoped.probabilities.where).toEqual({ page: 0.1, site: 0.6, web: 0.3 })
    const unscoped = jevDetailOf(reading, 212, 'jev-1.14.0')
    expect('where' in unscoped.confidence).toBe(false)
    expect('where' in unscoped.probabilities).toBe(false)
  })
})
