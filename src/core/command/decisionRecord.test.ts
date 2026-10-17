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
  it('keeps every verb probability and the five most probable targets and spans', () => {
    const verb: DecisionChoiceAnswer = { type: 'choice', choice: 'click', confidence: 0.8, probabilities: { click: 0.8, open: 0.1, none: 0.1 } }
    const target: DecisionChoiceAnswer = {
      type: 'choice',
      choice: 'ref-2',
      confidence: 0.5,
      probabilities: { none: 0.05, 'ref-1': 0.1, 'ref-2': 0.5, 'ref-3': 0.15, 'ref-4': 0.02, 'ref-5': 0.08, 'ref-6': 0.1 },
    }
    const slot: DecisionChoiceAnswer = { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, 's0-0': 0.1 } }
    expect(jevDetailOf({ verb, target, slot }, 212, 'jev-1.14.0')).toEqual({
      model: 'jev-1.14.0',
      latencyMs: 212,
      confidence: { verb: 0.8, target: 0.5, slot: 0.9 },
      probabilities: {
        verb: { click: 0.8, open: 0.1, none: 0.1 },
        target: { 'ref-2': 0.5, 'ref-3': 0.15, 'ref-1': 0.1, 'ref-6': 0.1, 'ref-5': 0.08 },
        slot: { none: 0.9, 's0-0': 0.1 },
      },
    })
  })
})
