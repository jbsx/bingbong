// A Weigh-in's figures (CONTEXT.md), worked out on every read from the
// weight, the scale's first resistance and the Body Profile — never stored.
// The first resistance is taken as ohms and goes in as height²/R, the
// impedance index the published BIA equations stand on: fat-free mass and
// total body water from Sun et al. 2003 (NHANES III, a four-compartment
// reference), skeletal muscle from Janssen et al. 2000 (MRI reference).
// Both were drawn mostly from people of European, African and Hispanic
// descent; a Background corrects the body fat for a group they read low
// (see BACKGROUND_FAT_POINTS). Bone is still openScale's Trisa formula,
// fed the way its QNHandler feeds it, and BMR is Mifflin–St Jeor. They are
// estimates, and the page says so. A figure the profile cannot support is
// 'unavailable', never a made-up number.

import type { WeighIn } from './weighIns'

export type Sex = 'male' | 'female'

/** A descent the impedance equations are known to misread, so the body fat is corrected for it (CONTEXT.md, Background). */
export type Background = 'southAsian'

export const BACKGROUNDS: readonly Background[] = ['southAsian']

/**
 * Points of body fat added for a Background, by sex: what a four-compartment
 * model measured above a European-derived prediction at the same build.
 * South Asian is Deurenberg-Yap's 107 Singaporean Indians (thesis,
 * Wageningen 2000, ch. 5 table 1: men 28.0 vs 22.9, women 38.3 vs 32.9).
 */
export const BACKGROUND_FAT_POINTS: Record<Background, Record<Sex, number>> = {
  southAsian: { male: 5.1, female: 5.4 },
}

/** The owner's height, date of birth (YYYY-MM-DD), sex and Background, from settings; any of them may be unset (no Background means no correction). */
export interface BodyProfile {
  heightCm: number | null
  birthDate: string | null
  sex: Sex | null
  background: Background | null
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
  const r = weighIn.r1
  const index = (heightCm * heightCm) / r
  const fatFreeKg = male ? -10.68 + 0.65 * index + 0.26 * kg + 0.02 * r : -9.53 + 0.69 * index + 0.17 * kg + 0.02 * r
  const correction = profile.background === null ? 0 : BACKGROUND_FAT_POINTS[profile.background][sex]
  const fatPercent = (1 - fatFreeKg / kg) * 100 + correction
  const waterKg = male ? 1.2 + 0.45 * index + 0.18 * kg : 3.75 + 0.45 * index + 0.11 * kg
  const muscleKg = 0.401 * index + (male ? 3.825 : 0) - 0.071 * age + 5.102
  const z = trisaImpedance(r)
  return {
    weightKg: kg,
    bmi,
    fatPercent,
    waterPercent: (waterKg / kg) * 100,
    musclePercent: (muscleKg / kg) * 100,
    boneKg: male ? 7.829 + (-0.0855 * bmi - 5.92e-4 * z - 0.0389 * age) : 7.98 + (-0.0973 * bmi - 4.84e-4 * z - 0.036 * age),
    leanKg: kg * (1 - fatPercent / 100),
    bmrKcal,
  }
}
