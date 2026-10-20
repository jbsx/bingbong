import { describe, expect, it } from 'vitest'
import { ageOn, bodyFigures, type BodyProfile } from './bodyComposition'

// Expected figures worked by hand from Sun et al. 2003, Janssen et al. 2000, openScale's Trisa bone formula and Mifflin–St Jeor.

const at = new Date(2026, 9, 19, 7, 30).getTime()
const owner: BodyProfile = { heightCm: 180, birthDate: '1991-03-01', sex: 'male', background: null }

describe('bodyFigures', () => {
  it('works out every figure for a man from his weight, first resistance and Body Profile', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500, person: 'jaish' }, owner)
    expect(figures.weightKg).toBe(81.25)
    expect(figures.bmi).toBeCloseTo(25.077, 2)
    expect(figures.fatPercent).toBeCloseTo(23.917, 2)
    expect(figures.waterPercent).toBeCloseTo(54.525, 2)
    expect(figures.musclePercent).toBeCloseTo(39.16, 2)
    expect(figures.boneKg).toBeCloseTo(4.304, 2)
    expect(figures.leanKg).toBeCloseTo(61.818, 2)
    expect(figures.bmrKcal).toBeCloseTo(1767.5, 1)
  })

  it('uses the woman’s formulas', () => {
    const figures = bodyFigures({ at, kg: 62, r1: 620, r2: 610, person: 'jaish' }, { heightCm: 165, birthDate: '1986-01-01', sex: 'female', background: null })
    expect(figures.bmi).toBeCloseTo(22.773, 2)
    expect(figures.fatPercent).toBeCloseTo(29.502, 2)
    expect(figures.waterPercent).toBeCloseTo(48.919, 2)
    expect(figures.musclePercent).toBeCloseTo(32.049, 2)
    expect(figures.boneKg).toBeCloseTo(4.292, 2)
    expect(figures.leanKg).toBeCloseTo(43.709, 2)
    expect(figures.bmrKcal).toBeCloseTo(1290.25, 1)
  })

  it('adds the four-compartment gap to the body fat for a South Asian Background, and only to the fat and lean mass', () => {
    const man = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500, person: 'jaish' }, { ...owner, background: 'southAsian' })
    expect(man.fatPercent).toBeCloseTo(29.017, 2)
    expect(man.leanKg).toBeCloseTo(57.674, 2)
    expect(man.waterPercent).toBeCloseTo(54.525, 2)
    expect(man.musclePercent).toBeCloseTo(39.16, 2)
    const woman = bodyFigures({ at, kg: 62, r1: 620, r2: 610, person: 'jaish' }, { heightCm: 165, birthDate: '1986-01-01', sex: 'female', background: 'southAsian' })
    expect(woman.fatPercent).toBeCloseTo(34.902, 2)
    expect(woman.leanKg).toBeCloseTo(40.361, 2)
  })

  it('gives BMI from the height alone, and every other figure as unavailable without the whole profile', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500, person: 'jaish' }, { heightCm: 180, birthDate: null, sex: 'male', background: null })
    expect(figures.bmi).toBeCloseTo(25.077, 2)
    for (const key of ['fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg', 'bmrKcal'] as const) expect(figures[key]).toBe('unavailable')
  })

  it('gives only the weight with no profile at all', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 512, r2: 500, person: 'jaish' }, { heightCm: null, birthDate: null, sex: null, background: null })
    expect(figures.weightKg).toBe(81.25)
    expect(figures.bmi).toBe('unavailable')
    expect(figures.fatPercent).toBe('unavailable')
    expect(figures.bmrKcal).toBe('unavailable')
  })

  it('leaves the impedance figures unavailable when the scale measured no resistance, keeping BMI and BMR', () => {
    const figures = bodyFigures({ at, kg: 81.25, r1: 0, r2: 0, person: 'jaish' }, owner)
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
