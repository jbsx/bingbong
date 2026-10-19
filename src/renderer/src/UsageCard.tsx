import type { SlotSize } from '../../core/idle/slots'
import { chartCeiling, elapsedPct, resetLabel, USAGE_HISTORY_MS, USAGE_STALE_MS, type UsageView, type UsageWindow } from '../../core/usage/usage'

/** A pause in the dashboard's sampling longer than this breaks the line rather than bridging it. */
const GAP_MS = 5 * 60 * 1000

/** How many rings draw at full size in one row; past that a provider's other windows are bars under it. */
const FULL_RINGS = 3

/** Each provider's tone, as a class the stylesheet maps to its light and dark color. */
function toneClass(provider: string): string {
  return `usage-tone--${provider.toLowerCase()}`
}

/**
 * A window as a ring: the outer arc the share of the limit used, in the
 * provider's tone, the number in the middle; a thin inner arc how much of
 * the window has run to its reset — two clocks in one glance, so a high
 * number with a short inner arc reads as burning fast. The ring is as large
 * as its box allows, the number about a third of it. A window past its
 * limit draws its arc whole and its number red.
 */
function Ring({ window, now }: { window: UsageWindow | null; now: number }) {
  const used = window === null ? null : Math.round(window.usedPct)
  const elapsed = window === null ? 0 : elapsedPct(window, now)
  return (
    <span className={used !== null && used > 100 ? 'usage-ring usage-ring--over' : 'usage-ring'}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="usage-ring-track" cx={50} cy={50} r={44} />
        {used !== null && used > 0 ? (
          <circle className="usage-ring-arc" cx={50} cy={50} r={44} pathLength={100} strokeDasharray={`${Math.min(100, used)} 100`} transform="rotate(-90 50 50)" />
        ) : null}
        <circle className="usage-ring-time-track" cx={50} cy={50} r={34} />
        {elapsed > 0 ? (
          <circle className="usage-ring-time" cx={50} cy={50} r={34} pathLength={100} strokeDasharray={`${Math.min(100, elapsed)} 100`} transform="rotate(-90 50 50)" />
        ) : null}
      </svg>
      <span className="usage-ring-pct">
        {used ?? '–'}
        {used !== null ? <small>%</small> : null}
      </span>
    </span>
  )
}

/** A window's reset, under its ring: "7d · resets 1d 1h" ("resets" left to the wider boxes); the caption left off where the name above carries it. */
function ResetLine({ window, now, caption = true }: { window: UsageWindow; now: number; caption?: boolean }) {
  return (
    <span className="usage-ring-reset">
      {caption ? `${window.caption} · ` : null}
      <span className="usage-ring-resets">resets </span>
      <b>{resetLabel(window.resetAt, now)}</b>
    </span>
  )
}

/** One of a provider's other windows as a compact bar, when the row has no room for its ring. */
function Bar({ window, now }: { window: UsageWindow; now: number }) {
  return (
    <span className="usage-bar" aria-label={`${window.caption} ${Math.round(window.usedPct)}%, resets ${resetLabel(window.resetAt, now)}`}>
      <span className="usage-bar-words">
        {window.caption} <b>{Math.round(window.usedPct)}%</b> · {resetLabel(window.resetAt, now)}
      </span>
      <span className="usage-bar-track">
        <span className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, window.usedPct))}%` }} />
      </span>
    </span>
  )
}

/** A provider's gauge as a ring with its name, plan and reset under it, and its other windows as bars when they get no ring of their own. */
function ProviderRing({ provider, bars, now }: { provider: UsageView; bars: boolean; now: number }) {
  const gauge = provider.gauge
  return (
    <span
      className={`usage-ring-item ${toneClass(provider.name)}`}
      aria-label={gauge ? `${provider.name} ${gauge.caption}: ${Math.round(gauge.usedPct)}% used, resets ${resetLabel(gauge.resetAt, now)}` : provider.name}
    >
      <Ring window={gauge} now={now} />
      <span className="usage-ring-words">
        <span className="usage-ring-name">
          {provider.name}
          {provider.plan ? <span className="usage-ring-plan"> {provider.plan}</span> : null}
        </span>
        {gauge ? <ResetLine window={gauge} now={now} /> : null}
        {bars && provider.bars.length > 0 ? (
          <span className="usage-bars">
            {provider.bars.map((bar) => (
              <Bar key={bar.key} window={bar} now={now} />
            ))}
          </span>
        ) : null}
      </span>
    </span>
  )
}

/** One of a provider's other windows as its own, smaller ring beside the provider's. */
function WindowRing({ provider, window, now }: { provider: UsageView; window: UsageWindow; now: number }) {
  return (
    <span
      className={`usage-ring-item usage-ring-item--extra ${toneClass(provider.name)}`}
      aria-label={`${provider.name} ${window.caption}: ${Math.round(window.usedPct)}% used, resets ${resetLabel(window.resetAt, now)}`}
    >
      <Ring window={window} now={now} />
      <span className="usage-ring-words">
        <span className="usage-ring-name">
          {provider.name} <span className="usage-ring-plan">{window.caption}</span>
        </span>
        <ResetLine window={window} now={now} caption={false} />
      </span>
    </span>
  )
}

/**
 * The providers' rings in one row: each provider's gauge, and its other
 * windows as smaller rings while the row holds three or fewer, else as
 * bars under their provider. Past three providers the rings shrink to stay
 * in the row.
 */
function Rings({ providers, now }: { providers: readonly UsageView[]; now: number }) {
  const windows = providers.reduce((sum, provider) => sum + 1 + provider.bars.length, 0)
  const ringed = windows <= FULL_RINGS
  const count = ringed ? windows : providers.length
  return (
    <section className="idle-card usage-rings" style={{ '--rings': String(count) } as React.CSSProperties} aria-label="AI usage">
      {providers.map((provider) => [
        <ProviderRing key={provider.name} provider={provider} bars={!ringed} now={now} />,
        ...(ringed ? provider.bars.map((bar) => <WindowRing key={`${provider.name}:${bar.key}`} provider={provider} window={bar} now={now} />) : []),
      ])}
    </section>
  )
}

/** One window's line as an SVG path in the chart's 0–1000 × 0–100 box, broken where sampling paused; each run also as an area down to the axis. */
function linePaths(points: ReadonlyArray<[number, number]>, start: number, ceiling: number): { line: string; area: string; end: { x: number; y: number } | null } {
  const runs: [number, number][][] = []
  let previous: number | null = null
  for (const [time, pct] of points) {
    if (time < start - GAP_MS) continue
    const x = Math.max(0, ((time - start) / USAGE_HISTORY_MS) * 1000)
    const y = 100 - (Math.min(pct, ceiling) / ceiling) * 100
    if (previous === null || time - previous > GAP_MS) runs.push([])
    runs[runs.length - 1].push([x, y])
    previous = time
  }
  const at = ([x, y]: [number, number]): string => `${x.toFixed(1)},${y.toFixed(2)}`
  const line = runs.map((run) => run.map((point, index) => `${index === 0 ? 'M' : 'L'}${at(point)}`).join('')).join('')
  const area = runs.map((run) => `M${run[0][0].toFixed(1)},100${run.map((point) => `L${at(point)}`).join('')}L${run[run.length - 1][0].toFixed(1)},100Z`).join('')
  const last = runs.at(-1)?.at(-1)
  return { line, area, end: last ? { x: last[0], y: last[1] } : null }
}

const HOUR_TICKS = [-12, -6, 0]

/** A 5-hour window draws solid; a provider's longer ones take the dashboard's two dashes in turn. */
function dashOf(window: UsageWindow, index: number): string | undefined {
  if (window.key.toLowerCase().startsWith('5h')) return undefined
  return index % 2 ? '3 5' : '9 5'
}

/** The windows the chart draws, by caption, as its kicker names them: "7d window", "5h · 7d windows". */
function windowsLabel(lines: readonly { window: UsageWindow }[]): string {
  const captions = [...new Set(lines.map(({ window }) => window.caption))]
  return `${captions.join(' · ')} window${captions.length === 1 ? '' : 's'}`
}

/**
 * The dashboard's usage history for the chosen windows over the last
 * twelve hours, a tile of its own: each line in its provider's tone over a
 * faint fill, a dot where it ends, a 5-hour window solid and a longer one
 * dashed, as the dashboard draws them; the legend under the kicker and,
 * beside it, when the dashboard last refreshed, amber once that is past
 * USAGE_STALE_MS (a failed poll keeps the last numbers on screen). The plot
 * stretches to the tile; its strokes keep their width (non-scaling), and
 * the dots and labels sit in HTML so nothing stretches with it.
 */
function UsageChart({ providers, updatedAt, now }: { providers: readonly UsageView[]; updatedAt: number; now: number }) {
  const start = now - USAGE_HISTORY_MS
  const lines = providers.flatMap((p) => p.lines.map((window, index) => ({ provider: p.name, window, dash: dashOf(window, index) })))
  const peak = Math.max(0, ...lines.flatMap(({ window }) => window.history.filter(([time]) => time >= start).map(([, pct]) => pct)))
  const ceiling = chartCeiling(peak)
  const rows = [1, 0.5, 0].map((share) => Math.round(ceiling * share))
  const drawn = lines.map((entry) => ({ ...entry, ...linePaths(entry.window.history, start, ceiling) }))
  return (
    <section className="idle-card usage-chart" aria-label="usage over the last twelve hours">
      <div className="usage-chart-head">
        <h3 className="idle-kicker">Last 12 hours · {windowsLabel(lines)}</h3>
        <Updated updatedAt={updatedAt} now={now} />
      </div>
      <span className="usage-chart-legend">
        {lines.map(({ provider, window, dash }) => (
          <span key={`${provider}:${window.key}`} className={`usage-legend ${toneClass(provider)}`}>
            <svg width={26} height={6} aria-hidden="true">
              <line x1={2} y1={3} x2={24} y2={3} strokeDasharray={dash === undefined ? undefined : dash === '9 5' ? '5 3' : '2 3'} />
            </svg>
            {provider} · {window.caption}
          </span>
        ))}
      </span>
      <div className="usage-chart-plot">
        <span className="usage-chart-y" aria-hidden="true">
          {rows.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </span>
        <span className="usage-chart-area">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            {rows.map((value) => (
              <line key={value} className="usage-chart-grid" x1={0} x2={1000} y1={100 - (value / ceiling) * 100} y2={100 - (value / ceiling) * 100} />
            ))}
            {drawn.map(({ provider, window, area }) => (
              <path key={`${provider}:${window.key}:area`} className={`usage-fill ${toneClass(provider)}`} d={area} />
            ))}
            {drawn.map(({ provider, window, dash, line }) => (
              <path key={`${provider}:${window.key}`} className={`usage-line ${toneClass(provider)}`} d={line} strokeDasharray={dash} />
            ))}
          </svg>
          {drawn.map(({ provider, window, end }) =>
            end === null ? null : (
              <span key={`${provider}:${window.key}:end`} className={`usage-end ${toneClass(provider)}`} style={{ left: `${end.x / 10}%`, top: `${end.y}%` }} aria-hidden="true" />
            ),
          )}
        </span>
        <span className="usage-chart-x" aria-hidden="true">
          {HOUR_TICKS.map((hour) => (
            <span key={hour}>{hour === 0 ? 'now' : `${hour}h`}</span>
          ))}
        </span>
      </div>
    </section>
  )
}

/** When the dashboard last refreshed, amber once that is past USAGE_STALE_MS (a failed poll keeps the last numbers on screen). */
function Updated({ updatedAt, now }: { updatedAt: number; now: number }) {
  const stale = now - updatedAt > USAGE_STALE_MS
  const updated = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <span className={stale ? 'usage-updated usage-updated--stale' : 'usage-updated'}>Updated {updated}</span>
}

/**
 * The AI Usage card (CONTEXT.md), tiles down the right of the Idle Screen:
 * the chosen providers' windows as rings, and in a tall Card Slot the
 * dashboard's last twelve hours under them; in a one-cell slot the rings
 * alone, with when the dashboard last refreshed. Read-only — a tap wakes
 * the dashboard like anywhere else on the Idle Screen; the choices live in
 * settings.
 */
export function UsageCard({ providers, updatedAt, now, size }: { providers: readonly UsageView[]; updatedAt: number; now: number; size: SlotSize }) {
  return (
    <section className="idle-tiles usage-card" aria-label="AI usage" style={{ '--w': String(size.w), '--h': String(size.h) } as React.CSSProperties}>
      <Rings providers={providers} now={now} />
      {size.h >= 2 ? <UsageChart providers={providers} updatedAt={updatedAt} now={now} /> : null}
    </section>
  )
}
