import { describe, expect, it } from 'vitest'
import { loudnessFactor, matchedLevel } from './loudness'

describe('YouTube\'s loudness factor (#460)', () => {
  it('is 10^(−loudnessDb/20) for a loud track: JTRDwh0BHG4 at 5.22 dB plays at 0.548 of the player\'s level', () => {
    expect(loudnessFactor(5.22)).toBeCloseTo(0.5483, 4)
  })

  it('never turns a quiet track up, and is 1 with no loudness in the response', () => {
    expect(loudnessFactor(-11.56)).toBe(1)
    expect(loudnessFactor(null)).toBe(1)
    expect(loudnessFactor(Number.NaN)).toBe(1)
  })

  it('matches a level across tracks: 20 on 5.22 dB is about 19.9 on 5.25 dB', () => {
    expect(matchedLevel(20, 5.22, 5.25)).toBeCloseTo(19.93, 2)
  })

  it('a loud track\'s level carried to a quiet one is the level on YouTube\'s scale, held to 100', () => {
    expect(matchedLevel(20, 5.22, -11.56)).toBeCloseTo(36.48, 2)
    expect(matchedLevel(80, 5.22, null)).toBe(100)
  })
})
