import type { BodyFigures, Figure } from './bodyComposition'

/** A weight to the 0.05 kg the scale reads, always two decimals, so 81.70 sits beside 81.25. */
export function formatKg(kg: number): string {
  return kg.toFixed(2)
}

/** A change, signed and at the figure's digits: a true minus, a plus, and ±0 for one that rounds to nothing. */
export function formatChange(change: number, digits: number): string {
  const rounded = Math.round(change * 10 ** digits) / 10 ** digits
  if (rounded === 0) return '±0'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}`
}

/**
 * A chart's value scale: the labels on its top and bottom, and the range
 * the line is drawn in. The labels are the series' own highest and lowest
 * at the figure's digits, the range padded around them so a half-kilo week
 * still reads as a slope. A series flat at those digits would label both
 * ends alike (4.3 / 4.3), so it is labelled one step either side of its
 * value (4.4 / 4.2) and drawn across exactly that, the line midway.
 */
export function chartScale(values: readonly number[], digits: number): { top: string; bottom: string; floor: number; span: number } {
  const step = 10 ** -digits
  const high = Math.max(...values)
  const low = Math.min(...values)
  if (high.toFixed(digits) === low.toFixed(digits)) {
    const mid = Number(high.toFixed(digits))
    return { top: (mid + step).toFixed(digits), bottom: (mid - step).toFixed(digits), floor: mid - step, span: 2 * step }
  }
  const pad = Math.max((high - low) * 0.15, step * 5)
  return { top: high.toFixed(digits), bottom: low.toFixed(digits), floor: low - pad, span: high - low + 2 * pad }
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
