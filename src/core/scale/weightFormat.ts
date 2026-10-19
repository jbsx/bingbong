import type { BodyFigures, Figure } from './bodyComposition'

/** A weight as the scale shows it: to the 0.05 kg it reads, never fewer than one decimal. */
export function formatKg(kg: number): string {
  const text = String(Math.round(kg * 100) / 100)
  return text.includes('.') ? text : `${text}.0`
}

/** A change, signed: a true minus, a plus, and ±0 for one that rounds to nothing. */
export function formatChange(change: number, digits: number): string {
  const rounded = Math.round(change * 10 ** digits) / 10 ** digits
  if (rounded === 0) return '±0'
  return `${rounded > 0 ? '+' : '−'}${String(Math.abs(rounded))}`
}

/** A figure to its digits; one the profile cannot support as a dash. */
export function formatFigure(figure: Figure, digits: number): string {
  return figure === 'unavailable' ? '–' : figure.toFixed(digits)
}

/** Every figure a Weigh-in has, in the order the Weight page shows them: its name, unit and digits. */
export const WEIGHT_FIGURES: readonly { key: keyof BodyFigures; label: string; unit: string; digits: number }[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', digits: 2 },
  { key: 'bmi', label: 'BMI', unit: '', digits: 1 },
  { key: 'fatPercent', label: 'Body fat', unit: '%', digits: 1 },
  { key: 'waterPercent', label: 'Water', unit: '%', digits: 1 },
  { key: 'musclePercent', label: 'Muscle', unit: '%', digits: 1 },
  { key: 'boneKg', label: 'Bone', unit: 'kg', digits: 1 },
  { key: 'leanKg', label: 'Lean mass', unit: 'kg', digits: 1 },
  { key: 'bmrKcal', label: 'BMR', unit: 'kcal', digits: 0 },
]
