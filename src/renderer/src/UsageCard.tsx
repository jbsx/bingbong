import { chartCeiling, elapsedPct, resetLabel, USAGE_HISTORY_MS, USAGE_STALE_MS, type UsageView, type UsageWindow } from '../../core/usage/usage'

/** The dashboard's grid: 64 dots, eight to a row, lit by how much of the window has run. */
const DOTS = 64
const DOT_COLUMNS = 8
const DOT_PITCH = 27.5

/** A pause in the dashboard's sampling longer than this breaks the line rather than bridging it. */
const GAP_MS = 5 * 60 * 1000

/** Each provider's tone, as a class the stylesheet maps to its light and dark color. */
function toneClass(provider: string): string {
  return `usage-tone--${provider.toLowerCase()}`
}

/**
 * The dashboard's dot gauge: the dots fill as the window runs to its reset,
 * the number over them is how much of the limit is used — two clocks in one
 * glance, so a high number with few dots lit reads as burning fast.
 */
function DotGauge({ window, now }: { window: UsageWindow; now: number }) {
  const lit = Math.ceil((elapsedPct(window, now) * DOTS) / 100)
  const used = Math.round(window.usedPct)
  return (
    <span className="usage-dots">
      <svg viewBox="0 0 220 220" aria-hidden="true">
        {Array.from({ length: DOTS }, (_, i) => (
          <circle
            key={i}
            className={i < lit ? 'usage-dot usage-dot--on' : 'usage-dot'}
            cx={13.75 + (i % DOT_COLUMNS) * DOT_PITCH}
            cy={13.75 + Math.floor(i / DOT_COLUMNS) * DOT_PITCH}
            r={9.2}
          />
        ))}
      </svg>
      <span className={used > 100 ? 'usage-dots-pct usage-dots-pct--over' : 'usage-dots-pct'}>{used}</span>
    </span>
  )
}

function Bar({ window, now }: { window: UsageWindow; now: number }) {
  return (
    <span className="usage-bar">
      <span className="usage-bar-caption">{window.caption}</span>
      <span className="usage-bar-track">
        <span className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, window.usedPct))}%` }} />
      </span>
      <span className="usage-bar-pct">{Math.round(window.usedPct)}%</span>
      <span className="usage-bar-reset">{resetLabel(window.resetAt, now)}</span>
    </span>
  )
}

function Gauge({ provider, now }: { provider: UsageView; now: number }) {
  const gauge = provider.gauge
  return (
    <div
      className={`usage-gauge ${toneClass(provider.name)}`}
      aria-label={gauge ? `${provider.name} ${gauge.caption}: ${Math.round(gauge.usedPct)}% used` : provider.name}
    >
      <span className="usage-gauge-head">
        <span className="usage-gauge-name">{provider.name}</span>
        {provider.plan ? <span className="usage-gauge-plan">{provider.plan}</span> : null}
      </span>
      {gauge ? (
        <>
          <DotGauge window={gauge} now={now} />
          <span className="usage-gauge-reset">
            {gauge.caption} · <b>{resetLabel(gauge.resetAt, now)}</b>
          </span>
        </>
      ) : null}
      {provider.bars.length > 0 ? (
        <span className="usage-bars">
          {provider.bars.map((bar) => (
            <Bar key={bar.key} window={bar} now={now} />
          ))}
        </span>
      ) : null}
    </div>
  )
}

/** One window's line as an SVG path in the chart's 0–1000 × 0–100 box, broken where sampling paused. */
function linePath(points: ReadonlyArray<[number, number]>, start: number, ceiling: number): string {
  let d = ''
  let previous: number | null = null
  for (const [time, pct] of points) {
    if (time < start - GAP_MS) continue
    const x = Math.max(0, ((time - start) / USAGE_HISTORY_MS) * 1000).toFixed(1)
    const y = (100 - (Math.min(pct, ceiling) / ceiling) * 100).toFixed(2)
    d += `${previous === null || time - previous > GAP_MS ? 'M' : 'L'}${x},${y}`
    previous = time
  }
  return d
}

const HOUR_TICKS = [-12, -9, -6, -3, 0]

/** A 5-hour window draws solid; a provider's longer ones take the dashboard's two dashes in turn. */
function dashOf(window: UsageWindow, index: number): string | undefined {
  if (window.key.toLowerCase().startsWith('5h')) return undefined
  return index % 2 ? '3 5' : '9 5'
}

/**
 * The dashboard's usage history for the chosen windows over the last
 * twelve hours, each line in its provider's tone, a 5-hour window solid
 * and a longer one dashed, as the dashboard draws them; beside the legend,
 * when the dashboard last refreshed, amber once that is past USAGE_STALE_MS
 * (a failed poll keeps the last numbers on screen). The plot stretches to
 * the card; its strokes keep their width (non-scaling) and the labels sit
 * in HTML so nothing in the text stretches with it.
 */
function UsageChart({ providers, updatedAt, now }: { providers: readonly UsageView[]; updatedAt: number; now: number }) {
  const start = now - USAGE_HISTORY_MS
  const lines = providers.flatMap((p) => p.lines.map((window, index) => ({ provider: p.name, window, dash: dashOf(window, index) })))
  const peak = Math.max(0, ...lines.flatMap(({ window }) => window.history.filter(([time]) => time >= start).map(([, pct]) => pct)))
  const ceiling = chartCeiling(peak)
  const rows = [1, 0.75, 0.5, 0.25, 0].map((share) => Math.round(ceiling * share))
  const stale = now - updatedAt > USAGE_STALE_MS
  const updated = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="usage-chart" aria-label="usage over the last twelve hours">
      <div className="usage-chart-head">
        <span className="usage-chart-legend">
          {lines.map(({ provider, window, dash }) => (
            <span key={`${provider}:${window.key}`} className={`usage-legend ${toneClass(provider)}`}>
              <svg width={18} height={4} aria-hidden="true">
                <line x1={1} y1={2} x2={17} y2={2} strokeDasharray={dash === undefined ? undefined : dash === '9 5' ? '5 3' : '2 3'} />
              </svg>
              {provider} · {window.caption}
            </span>
          ))}
        </span>
        <span className={stale ? 'usage-updated usage-updated--stale' : 'usage-updated'}>Updated {updated}</span>
      </div>
      <div className="usage-chart-plot">
        <span className="usage-chart-y" aria-hidden="true">
          {rows.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </span>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {rows.map((value) => (
            <line key={value} className="usage-chart-grid" x1={0} x2={1000} y1={100 - (value / ceiling) * 100} y2={100 - (value / ceiling) * 100} />
          ))}
          {lines.map(({ provider, window, dash }) => (
            <path
              key={`${provider}:${window.key}`}
              className={`usage-line ${toneClass(provider)}`}
              d={linePath(window.history, start, ceiling)}
              strokeDasharray={dash}
            />
          ))}
        </svg>
      </div>
      <span className="usage-chart-x" aria-hidden="true">
        {HOUR_TICKS.map((hour) => (
          <span key={hour}>{hour === 0 ? 'now' : `${hour}h`}</span>
        ))}
      </span>
    </div>
  )
}

/**
 * The AI Usage card (CONTEXT.md): the chosen providers' gauges as the
 * owner's usage dashboard draws them, beside that dashboard's history as
 * lines and when it last refreshed. Read-only — a tap wakes the dashboard
 * like anywhere else on the Idle Screen; the choices live in settings.
 * Past two providers the gauges shrink and the chart drops under them.
 */
export function UsageCard({ providers, updatedAt, now }: { providers: readonly UsageView[]; updatedAt: number; now: number }) {
  return (
    <section className={providers.length > 2 ? 'idle-card usage-card usage-card--many' : 'idle-card usage-card'} aria-label="AI usage">
      <div className="usage-gauges">
        {providers.map((provider) => (
          <Gauge key={provider.name} provider={provider} now={now} />
        ))}
      </div>
      <UsageChart providers={providers} updatedAt={updatedAt} now={now} />
    </section>
  )
}
