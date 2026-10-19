import { describe, expect, it } from 'vitest'
import { ageOn, bodyFigures, type BodyProfile } from './bodyComposition'

// Expected figures worked by hand from openScale's TrisaBodyAnalyzeLib and Mifflin–St Jeor (#350).

const at = new Date(2026, 9, 19, 7, 30).getTime()
const owner: BodyProfile = { heightCm: 180, birthDate: '1991-03-01', sex: 'male' }

describe('bodyFigures', () => {
  it('works out every figure for a man from his weight, first resistance and Body Profile', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500 }, owner)
    expect(figures.weightKg).toBe(81.25)
    expect(figures.bmi).toBeCloseTo(25.077, 2)
    expect(figures.fatPercent).toBeCloseTo(19.196, 2)
    expect(figures.waterPercent).toBeCloseTo(60.755, 2)
    expect(figures.musclePercent).toBeCloseTo(41.255, 2)
    expect(figures.boneKg).toBeCloseTo(4.304, 2)
    expect(figures.leanKg).toBeCloseTo(65.653, 2)
    expect(figures.bmrKcal).toBeCloseTo(1767.5, 1)
  })

  it('feeds a resistance under 410 as 3.0, and uses the woman’s formulas', () => {
    const figures = bodyFigures({ at, kg: 62, r1: 380, r2: 380 }, { heightCm: 165, birthDate: '1986-01-01', sex: 'female' })
    expect(figures.bmi).toBeCloseTo(22.773, 2)
    expect(figures.fatPercent).toBeCloseTo(25.489, 2)
    expect(figures.waterPercent).toBeCloseTo(54.139, 2)
    expect(figures.musclePercent).toBeCloseTo(30.985, 2)
    expect(figures.boneKg).toBeCloseTo(4.323, 2)
    expect(figures.leanKg).toBeCloseTo(46.197, 2)
    expect(figures.bmrKcal).toBeCloseTo(1290.25, 1)
  })

  it('gives BMI from the height alone, and every other figure as unavailable without the whole profile', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500 }, { heightCm: 180, birthDate: null, sex: 'male' })
    expect(figures.bmi).toBeCloseTo(25.077, 2)
    for (const key of ['fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg', 'bmrKcal'] as const) expect(figures[key]).toBe('unavailable')
  })

  it('gives only the weight with no profile at all', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500 }, { heightCm: null, birthDate: null, sex: null })
    expect(figures.weightKg).toBe(81.25)
    expect(figures.bmi).toBe('unavailable')
    expect(figures.fatPercent).toBe('unavailable')
    expect(figures.bmrKcal).toBe('unavailable')
  })

  it('leaves the impedance figures unavailable when the scale measured no resistance, keeping BMI and BMR', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 0, r2: 0 }, owner)
    expect(figures.bmi).toBeCloseTo(25.077, 2)
    expect(figures.bmrKcal).toBeCloseTo(1767.5, 1)
    for (const key of ['fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg'] as const) expect(figures[key]).toBe('unavailable')
  })
})

describe('ageOn', () => {
  it('counts whole years on the day of the Weigh-in', () => {
    expect(ageOn('1991-10-19', new Date(2026, 9, 19, 7).getTime())).toBe(35)
    expect(ageOn('1991-10-20', new Date(2026, 9, 19, 7).getTime())).toBe(34)
  })
})
