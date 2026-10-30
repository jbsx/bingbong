import { describe, expect, it } from 'vitest'
import { createHighBandDetector, DETECTOR_TUNING, highBandDb, simulateDuck } from './detector'
import { FRAME_S, RATE } from './score'

const tone = (hz: number, seconds: number, amplitude: number): Float32Array => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE))

describe('highBandDb (#515)', () => {
  it('reads what is above 2 kHz and not what is below', () => {
    expect(highBandDb(tone(4000, FRAME_S, 0.1))).toBeGreaterThan(-30)
    expect(highBandDb(tone(300, FRAME_S, 0.1))).toBeLessThan(-70)
  })
})

describe('the detector (#515)', () => {
  it('fires when the high band rises over the echo it has been hearing, and not on the echo', () => {
    const detector = createHighBandDetector()
    const fires: boolean[] = []
    for (let i = 0; i < 200; i++) fires.push(detector.push(-70 + (i % 3)))
    expect(fires.some(Boolean)).toBe(false)
    for (let i = 0; i < 8; i++) fires.push(detector.push(-45))
    expect(fires.slice(200).some(Boolean)).toBe(true)
  })

  it('needs an echo heard before it fires at all', () => {
    const detector = createHighBandDetector()
    const fires = Array.from({ length: DETECTOR_TUNING.warmFrames - 1 }, () => detector.push(-30))
    expect(fires.some(Boolean)).toBe(false)
  })

  it('holds its floor while ducked, so the voice coming back does not fire it', () => {
    const detector = createHighBandDetector()
    for (let i = 0; i < 200; i++) detector.push(-60)
    detector.freeze(true)
    for (let i = 0; i < 300; i++) detector.push(-76)
    detector.freeze(false)
    const fires = Array.from({ length: 30 }, () => detector.push(-60))
    expect(fires.some(Boolean)).toBe(false)
  })
})

describe('simulateDuck (#515)', () => {
  it('ducks from the fire plus the landing to the hold, with the echo falling under it', () => {
    const echo = Float32Array.from({ length: 12 * RATE }, (_, i) => 0.01 * Math.sin((2 * Math.PI * 500 * i) / RATE) + 0.0005 * Math.sin((2 * Math.PI * 3000 * i) / RATE))
    const person = new Float32Array(echo.length)
    person.set(tone(3000, 0.5, 0.1), 8 * RATE)
    const { spans, fires } = simulateDuck(echo, person, { landing: 0.2, hold: 1, share: 0.15 })
    expect(fires).toHaveLength(1)
    expect(fires[0]).toBeGreaterThanOrEqual(8)
    expect(fires[0]).toBeLessThan(8.4)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.from).toBeCloseTo(fires[0]! + 0.2, 5)
    expect(spans[0]!.to).toBeGreaterThanOrEqual(9.5)
  })
})
