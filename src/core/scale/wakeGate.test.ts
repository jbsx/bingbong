import { describe, expect, it } from 'vitest'
import { ASLEEP_MS, createWakeGate } from './wakeGate'

const SCALE = 'A4:C1:38:F7:C6:58'

describe('createWakeGate', () => {
  it('lets a scale never connected to connect on its first advert', () => {
    expect(createWakeGate().heard(SCALE, 0)).toBe(true)
  })

  it('holds a scale let go while it keeps advertising — the loop of 2026-10-20', () => {
    const gate = createWakeGate()
    gate.heard(SCALE, 0)
    gate.hold(SCALE)
    for (let at = 1_000; at <= 120_000; at += 1_000) expect(gate.heard(SCALE, at)).toBe(false)
  })

  it('connects again on the first advert after the scale has slept', () => {
    const gate = createWakeGate()
    gate.heard(SCALE, 0)
    gate.hold(SCALE)
    expect(gate.heard(SCALE, 2_000)).toBe(false)
    expect(gate.heard(SCALE, 2_000 + ASLEEP_MS)).toBe(true)
    expect(gate.heard(SCALE, 2_500 + ASLEEP_MS)).toBe(true)
  })

  it('holds a scale let go before any advert was heard until one has a gap behind it', () => {
    const gate = createWakeGate()
    gate.hold(SCALE)
    expect(gate.heard(SCALE, 50_000)).toBe(false)
    expect(gate.heard(SCALE, 50_000 + ASLEEP_MS)).toBe(true)
  })

  it('holds only the scale let go', () => {
    const gate = createWakeGate()
    gate.hold(SCALE)
    expect(gate.heard('11:22:33:44:55:66', 0)).toBe(true)
  })
})
