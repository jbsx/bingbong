// A Weigh-in's figures (CONTEXT.md), worked out on every read from the
// weight, the scale's first resistance and the Body Profile — never stored.
// The impedance figures are openScale's TrisaBodyAnalyzeLib, fed the way
// its QNHandler feeds it for this protocol type (a resistance under 410 as
// 3.0, else 0.3 × (r1 − 400)); BMR is Mifflin–St Jeor. They are estimates,
// and the page says so. A figure the profile cannot support is
// 'unavailable', never a made-up number.

import type { WeighIn } from './weighIns'

export type Sex = 'male' | 'female'

/** The owner's height, date of birth (YYYY-MM-DD) and sex, from settings; any of them may be unset. */
export interface BodyProfile {
  heightCm: number | null
  birthDate: string | null
  sex: Sex | null
}

export type Figure = number | 'unavailable'

export interface BodyFigures {
  weightKg: number
  bmi: Figure
  fatPercent: Figure
  waterPercent: Figure
  musclePercent: Figure
  boneKg: Figure
  leanKg: Figure
  bmrKcal: Figure
}

/** Whole years from a YYYY-MM-DD birth date to the local day of `at`. */
export function ageOn(birthDate: string, at: number): number {
  const [year, month, day] = birthDate.split('-').map(Number)
  const on = new Date(at)
  const birthdayPassed = on.getMonth() + 1 > month || (on.getMonth() + 1 === month && on.getDate() >= day)
  return on.getFullYear() - year - (birthdayPassed ? 0 : 1)
}

/** The resistance as QNHandler feeds the Trisa formulas for every protocol type but 0xFF. */
function trisaImpedance(r1: number): number {
  return r1 < 410 ? 3.0 : 0.3 * (r1 - 400)
}

export function bodyFigures(weighIn: WeighIn, profile: BodyProfile): BodyFigures {
  const kg = weighIn.kg
  const unavailable: BodyFigures = { weightKg: kg, bmi: 'unavailable', fatPercent: 'unavailable', waterPercent: 'unavailable', musclePercent: 'unavailable', boneKg: 'unavailable', leanKg: 'unavailable', bmrKcal: 'unavailable' }
  const { heightCm, birthDate, sex } = profile
  if (heightCm === null || heightCm <= 0) return unavailable
  const bmi = (kg * 1e4) / (heightCm * heightCm)
  if (birthDate === null || sex === null) return { ...unavailable, bmi }
  const age = ageOn(birthDate, weighIn.at)
  const male = sex === 'male'
  const bmrKcal = 10 * kg + 6.25 * heightCm - 5 * age + (male ? 5 : -161)
  // No resistance measured (bare feet off the electrodes): the impedance figures have nothing to stand on.
  if (weighIn.r1 <= 0) return { ...unavailable, bmi, bmrKcal }
  const z = trisaImpedance(weighIn.r1)
  const fatPercent = male ? bmi * (1.479 + 4.4e-4 * z) + 0.1 * age - 21.764 : bmi * (1.506 + 3.908e-4 * z) + 0.1 * age - 12.834
  return {
    weightKg: kg,
    bmi,
    fatPercent,
    waterPercent: male ? 87.51 + (-1.162 * bmi - 0.00813 * z + 0.07594 * age) : 77.721 + (-1.148 * bmi - 0.00573 * z + 0.06448 * age),
    musclePercent: male ? 74.627 + (-0.811 * bmi - 0.00565 * z - 0.367 * age) : 57.0 + (-0.694 * bmi - 0.00344 * z - 0.255 * age),
    boneKg: male ? 7.829 + (-0.0855 * bmi - 5.92e-4 * z - 0.0389 * age) : 7.98 + (-0.0973 * bmi - 4.84e-4 * z - 0.036 * age),
    leanKg: kg * (1 - fatPercent / 100),
    bmrKcal,
  }
}
