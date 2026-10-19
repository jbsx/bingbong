import { chartScale } from '../../core/scale/weightFormat'

/** One figure's value at a Weigh-in. */
export interface ChartPoint {
  at: number
  value: number
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/**
 * A figure over a span as a line, drawn like the AI usage chart: an SVG in
 * a 0–1000 × 0–100 box stretched to its room, the stroke keeping its width
 * (non-scaling), a faint fill under it and a dot on the latest value in
 * HTML so nothing stretches with the plot. The value axis spans the
 * figure's own range in the span (chartScale), so a half-kilo week still
 * reads as a slope. `compact` leaves the date axis off (the Weight card's
 * trend).
 */
export function WeightChart({ points, start, end, digits, label, compact = false }: { points: readonly ChartPoint[]; start: number; end: number; digits: number; label: string; compact?: boolean }) {
  const { top, bottom, floor, span } = chartScale(
    points.map((point) => point.value),
    digits,
  )
  const width = Math.max(1, end - start)
  const at = (point: ChartPoint): [number, number] => [Math.min(1000, Math.max(0, ((point.at - start) / width) * 1000)), 100 - ((point.value - floor) / span) * 100]
  const drawn = points.map(at)
  const line = drawn.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(2)}`).join('')
  const area = drawn.length > 0 ? `M${drawn[0][0].toFixed(1)},100${drawn.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(2)}`).join('')}L${drawn[drawn.length - 1][0].toFixed(1)},100Z` : ''
  return (
    <div className={compact ? 'weight-chart weight-chart--compact' : 'weight-chart'} role="img" aria-label={label}>
      <span className="weight-chart-y" aria-hidden="true">
        <span>{points.length > 0 ? top : ''}</span>
        <span>{points.length > 0 ? bottom : ''}</span>
      </span>
      <span className="weight-chart-area">
        {points.length === 0 ? (
          <span className="weight-chart-none">No Weigh-ins in this span</span>
        ) : (
          <>
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <path className="weight-chart-fill" d={area} />
              <path className="weight-chart-line" d={line} />
            </svg>
            {drawn.map(([x, y], index) =>
              points.length <= 40 || index === drawn.length - 1 ? (
                <span key={points[index].at} className={index === drawn.length - 1 ? 'weight-chart-dot weight-chart-dot--last' : 'weight-chart-dot'} style={{ left: `${x / 10}%`, top: `${y}%` }} aria-hidden="true" />
              ) : null,
            )}
          </>
        )}
      </span>
      {compact ? null : (
        <span className="weight-chart-x" aria-hidden="true">
          <span>{dayLabel(start)}</span>
          <span>{dayLabel(end)}</span>
        </span>
      )}
    </div>
  )
}
