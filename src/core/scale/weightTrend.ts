/** A reading in time: a figure at a Weigh-in, or the trend's value there. */
export interface TrendPoint {
  at: number
  value: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How fast the Weight Trend follows the scale: a time constant, so a
 * reading a day after the last moves the trend about 35 % of the way to
 * it (the share the owner picked on the 2026-11-15 prototype, which was
 * a per-reading 0.35) and a reading after a week away moves it nearly all
 * the way. A guess: what would settle it is the owner's day-to-day spread
 * from the Weigh-in Log set against how late the trend shows a real turn.
 */
export const TREND_TIME_CONSTANT_MS = -DAY_MS / Math.log(1 - 0.35)

/**
 * The Weight Trend (owner, 2026-11-15): the readings as an exponential
 * moving average weighted by the time between them, so a day's water
 * swing drops out and the direction shows. One value per reading, at the
 * reading's time; the first reading starts it. Readings are taken in the
 * order given, which is time order.
 */
export function weightTrend(points: readonly TrendPoint[], timeConstantMs: number = TREND_TIME_CONSTANT_MS): TrendPoint[] {
  const trend: TrendPoint[] = []
  for (const point of points) {
    const last = trend.at(-1)
    if (last === undefined) {
      trend.push({ at: point.at, value: point.value })
      continue
    }
    const share = 1 - Math.exp(-Math.max(0, point.at - last.at) / timeConstantMs)
    trend.push({ at: point.at, value: last.value + share * (point.value - last.value) })
  }
  return trend
}

/**
 * An SVG path through the points as a monotone cubic (Fritsch–Carlson): a
 * smooth line that passes through every point and never overshoots between
 * two of them, so it draws no value the series does not hold. The points
 * go left to right.
 */
export function monotonePath(points: readonly (readonly [number, number])[]): string {
  const n = points.length
  if (n === 0) return ''
  const at = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(2)}`
  if (n === 1) return `M${at(points[0][0], points[0][1])}`
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1][0] - points[i][0]
    slopes.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx)
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === n - 1) return slopes[n - 2]
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2
  })
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i] / slopes[i]
    const b = tangents[i + 1] / slopes[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      tangents[i] = t * a * slopes[i]
      tangents[i + 1] = t * b * slopes[i]
    }
  }
  let path = `M${at(points[0][0], points[0][1])}`
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const third = (x1 - x0) / 3
    path += `C${at(x0 + third, y0 + tangents[i] * third)} ${at(x1 - third, y1 - tangents[i + 1] * third)} ${at(x1, y1)}`
  }
  return path
}
