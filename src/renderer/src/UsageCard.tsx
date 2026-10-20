import { chartCeiling, elapsedPct, pace, resetLabel, USAGE_HISTORY_MS, USAGE_STALE_MS, type UsageView, type UsageWindow } from '../../core/usage/usage'

/** A pause in the dashboard's sampling longer than this breaks the line rather than bridging it. */
const GAP_MS = 5 * 60 * 1000

/** A ring's width in px by how many providers share the row: two at F2's size, three to five shrinking to stay in one row. */
const RING_PX = [228, 228, 228, 184, 148, 120]

/** Each provider's tone, as a class the stylesheet maps to its light and dark color. */
function toneClass(provider: string): string {
  return `usage-tone--${provider.toLowerCase()}`
}

/** The reset glyph: a circling arrow. */
function Cycle() {
  return (
    <svg className="usage-cycle" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" />
    </svg>
  )
}

/** An arc of a circle centred in the 228 box from share `from` to `to` (0–1, clockwise from the top). */
function arc(radius: number, from: number, to: number): string {
  const end = Math.min(to, 0.9999)
  const at = (share: number): string => {
    const angle = -Math.PI / 2 + 2 * Math.PI * share
    return `${(114 + radius * Math.cos(angle)).toFixed(2)},${(114 + radius * Math.sin(angle)).toFixed(2)}`
  }
  return `M${at(from)} A${radius},${radius} 0 ${end - from > 0.5 ? 1 : 0} 1 ${at(end)}`
}

/** A tick across the ring at a share of it: where the window has run to. */
function Tick({ radius, share, length, className }: { radius: number; share: number; length: number; className: string }) {
  const angle = -Math.PI / 2 + 2 * Math.PI * share
  const x = (r: number): number => 114 + r * Math.cos(angle)
  const y = (r: number): number => 114 + r * Math.sin(angle)
  return <line className={className} x1={x(radius - length)} y1={y(radius - length)} x2={x(radius + length)} y2={y(radius + length)} />
}

/**
 * A provider's ring, F2's (round 5): the outer arc the share of its gauge's
 * limit used, in its tone, the part past the share of the window run
 * brighter; a tick where the window has run to; and a thin inner ring for
 * its next window, with its own tick. The number in the middle, and under
 * it the Pace when the use runs ahead of the window.
 */
function Ring({ gauge, inner, now }: { gauge: UsageWindow | null; inner: UsageWindow | null; now: number }) {
  const used = gauge === null ? null : Math.max(0, gauge.usedPct) / 100
  const run = gauge === null || gauge.resetAt === null ? null : elapsedPct(gauge, now) / 100
  const ahead = gauge === null ? null : pace(gauge, now)
  const innerUsed = inner === null ? 0 : Math.min(1, Math.max(0, inner.usedPct) / 100)
  const innerRun = inner === null || inner.resetAt === null ? null : elapsedPct(inner, now) / 100
  const split = used !== null && run !== null && used > run ? run : null
  return (
    <span className={used !== null && used > 1 ? 'usage-ring usage-ring--over' : 'usage-ring'}>
      <svg viewBox="0 0 228 228" aria-hidden="true">
        <circle className="usage-ring-track" cx={114} cy={114} r={100} />
        {used !== null && used > 0 ? (
          split === null ? (
            <path className="usage-ring-arc" d={arc(100, 0, Math.min(1, used))} />
          ) : (
            <>
              {split > 0.004 ? <path className="usage-ring-arc" d={arc(100, 0, split)} /> : null}
              <path className="usage-ring-ahead" d={arc(100, split, Math.min(1, used))} />
            </>
          )
        ) : null}
        {inner !== null ? (
          <>
            <circle className="usage-ring-inner-track" cx={114} cy={114} r={76} />
            {innerUsed > 0 ? <path className="usage-ring-inner" d={arc(76, 0, innerUsed)} /> : null}
            {innerRun !== null ? <Tick radius={76} share={innerRun} length={9} className="usage-ring-tick usage-ring-tick--inner" /> : null}
          </>
        ) : null}
        {run !== null ? <Tick radius={100} share={run} length={14} className="usage-ring-tick" /> : null}
      </svg>
      <span className="usage-ring-middle">
        <span className={ahead !== null ? 'usage-ring-pct usage-ring-pct--ahead' : 'usage-ring-pct'}>
          {used === null ? '–' : Math.round(gauge!.usedPct)}
          {used !== null ? <small>%</small> : null}
        </span>
        {ahead !== null ? <span className="usage-ring-pace">+{ahead} ahead</span> : null}
      </span>
    </span>
  )
}

/** One of a provider's other windows as a figure under its ring: "7d 8% ⟳ 6d 15h" — the first larger, the rest a step down. */
function WindowFigure({ window, now, lead }: { window: UsageWindow; now: number; lead: boolean }) {
  return (
    <span className={lead ? 'usage-figure usage-figure--lead' : 'usage-figure'} aria-label={`${window.caption} ${Math.round(window.usedPct)}%, resets ${resetLabel(window.resetAt, now)}`}>
      <span className="usage-figure-caption">{window.caption}</span>
      <b className="usage-figure-pct">{Math.round(window.usedPct)}%</b>
      <span className="usage-figure-reset">
        <Cycle />
        {resetLabel(window.resetAt, now)}
      </span>
    </span>
  )
}

/** A provider's column: its ring, its name in its tone and its plan, the gauge's window and reset, and its other windows as figures. */
function ProviderRing({ provider, now }: { provider: UsageView; now: number }) {
  const gauge = provider.gauge
  return (
    <span
      className={`usage-ring-item ${toneClass(provider.name)}`}
      aria-label={gauge ? `${provider.name} ${gauge.caption}: ${Math.round(gauge.usedPct)}% used, resets ${resetLabel(gauge.resetAt, now)}` : provider.name}
    >
      <Ring gauge={gauge} inner={provider.bars[0] ?? null} now={now} />
      <span className="usage-ring-name">
        <b>{provider.name}</b>
        {provider.plan ? <span className="usage-ring-plan"> {provider.plan}</span> : null}
      </span>
      {gauge ? (
        <span className="usage-ring-reset">
          {gauge.caption} <Cycle />
          {resetLabel(gauge.resetAt, now)}
        </span>
      ) : null}
      {provider.bars.length > 0 ? (
        <span className="usage-figures">
          {provider.bars.map((window, index) => (
            <WindowFigure key={window.key} window={window} now={now} lead={index === 0} />
          ))}
        </span>
      ) : null}
    </span>
  )
}

/** The providers' rings in one row; three to five shrink their rings to stay in it. */
function Rings({ providers, now }: { providers: readonly UsageView[]; now: number }) {
  const ring = RING_PX[Math.min(providers.length, RING_PX.length - 1)]
  return (
    <section className="usage-rings" data-providers={providers.length} style={{ '--ring-columns': String(providers.length), '--ring': `${ring}px` } as React.CSSProperties} aria-label="AI usage">
      {providers.map((provider) => (
        <ProviderRing key={provider.name} provider={provider} now={now} />
      ))}
    </section>
  )
}

/** One window's line as an SVG path in the chart's 0–1000 × 0–100 box, broken where sampling paused; each run also as an area down to the axis. */
function linePaths(points: ReadonlyArray<[number, number]>, start: number, ceiling: number): { line: string; area: string; end: { x: number; y: number; pct: number } | null } {
  const runs: [number, number][][] = []
  let previous: number | null = null
  let lastPct = 0
  for (const [time, pct] of points) {
    if (time < start - GAP_MS) continue
    const x = Math.max(0, ((time - start) / USAGE_HISTORY_MS) * 1000)
    const y = 100 - (Math.min(pct, ceiling) / ceiling) * 100
    if (previous === null || time - previous > GAP_MS) runs.push([])
    runs[runs.length - 1].push([x, y])
    previous = time
    lastPct = pct
  }
  const at = ([x, y]: [number, number]): string => `${x.toFixed(1)},${y.toFixed(2)}`
  const line = runs.map((run) => run.map((point, index) => `${index === 0 ? 'M' : 'L'}${at(point)}`).join('')).join('')
  const area = runs.map((run) => `M${run[0][0].toFixed(1)},100${run.map((point) => `L${at(point)}`).join('')}L${run[run.length - 1][0].toFixed(1)},100Z`).join('')
  const last = runs.at(-1)?.at(-1)
  return { line, area, end: last ? { x: last[0], y: last[1], pct: Math.round(lastPct) } : null }
}

/** The least room, as a share of the plot's height, between two last values' middles: a 40 px figure on a plot about 130 px tall; smaller figures for more lines (styles.css, .usage-chart[data-lines]). */
function lastGap(lines: number): number {
  return lines <= 2 ? 32 : lines === 3 ? 26 : 19
}

/**
 * Where each line's last value sits beside the plot: level with where the
 * line ends, pushed apart where two end close so neither covers the other,
 * the lower one moving down and the column shifted back up if that runs
 * past the foot.
 */
function lastValueTops(ends: readonly (number | null)[], gap: number): number[] {
  const order = ends.map((y, index) => ({ y, index })).filter((entry): entry is { y: number; index: number } => entry.y !== null).sort((a, b) => a.y - b.y)
  const tops = new Array<number>(ends.length).fill(0)
  let previous = -Infinity
  for (const entry of order) {
    previous = Math.max(entry.y, previous + gap)
    tops[entry.index] = previous
  }
  const over = Math.max(0, previous - 100)
  for (const entry of order) tops[entry.index] -= over
  return tops
}

/** A 5-hour window draws solid; a provider's longer ones take the dashboard's two dashes in turn. */
function dashOf(window: UsageWindow, index: number): string | undefined {
  if (window.key.toLowerCase().startsWith('5h')) return undefined
  return index % 2 ? '3 5' : '9 5'
}

/** When the dashboard last refreshed, amber once that is past USAGE_STALE_MS (a failed poll keeps the last numbers on screen). */
function Updated({ updatedAt, now }: { updatedAt: number; now: number }) {
  const stale = now - updatedAt > USAGE_STALE_MS
  const updated = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <span className={stale ? 'usage-updated usage-updated--stale' : 'usage-updated'}>updated {updated}</span>
}

/**
 * The dashboard's last twelve hours for the charted windows: the legend and
 * "last 12 h" over it, each line in its provider's tone over a faint fill,
 * a 5-hour window solid and a longer one dashed, and at the right edge where
 * each ends, its last value large in its tone; under it −12h, −6h and now
 * with when the dashboard last refreshed. The plot stretches to its box; its
 * strokes keep their width (non-scaling), the dots and figures sit in HTML.
 */
function UsageChart({ providers, updatedAt, now }: { providers: readonly UsageView[]; updatedAt: number; now: number }) {
  const start = now - USAGE_HISTORY_MS
  const lines = providers.flatMap((p) => p.lines.map((window, index) => ({ provider: p.name, window, dash: dashOf(window, index) })))
  const peak = Math.max(0, ...lines.flatMap(({ window }) => window.history.filter(([time]) => time >= start).map(([, pct]) => pct)))
  const ceiling = chartCeiling(peak)
  const rows = [1, 0.5, 0].map((share) => Math.round(ceiling * share))
  const drawn = lines.map((entry) => ({ ...entry, ...linePaths(entry.window.history, start, ceiling) }))
  const lastAt = lastValueTops(
    drawn.map(({ end }) => end?.y ?? null),
    lastGap(drawn.length),
  )
  // Past three lines the legend names the provider alone, so every entry keeps its place.
  const named = lines.length > 3
  return (
    <section className="usage-chart" data-lines={Math.min(drawn.length, 4)} aria-label="usage over the last twelve hours">
      <div className="usage-chart-head">
        <span className="usage-chart-legend">
          {lines.map(({ provider, window, dash }) => (
            <span key={`${provider}:${window.key}`} className={`usage-legend ${toneClass(provider)}`}>
              <svg width={22} height={6} aria-hidden="true">
                <line x1={2} y1={3} x2={20} y2={3} strokeDasharray={dash === undefined ? undefined : dash === '9 5' ? '5 3' : '2 3'} />
              </svg>
              {named ? provider : `${provider} · ${window.caption}`}
            </span>
          ))}
        </span>
        <span className="usage-chart-span">last 12 h</span>
      </div>
      <div className="usage-chart-plot">
        <span className="usage-chart-y" aria-hidden="true">
          {rows.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </span>
        <span className="usage-chart-area">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            {rows.map((value) => (
              <line key={value} className={value === 0 ? 'usage-chart-axis' : 'usage-chart-grid'} x1={0} x2={1000} y1={100 - (value / ceiling) * 100} y2={100 - (value / ceiling) * 100} />
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
        <span className="usage-chart-last" aria-label="the last values">
          {drawn.map(({ provider, window, end }, index) =>
            end === null ? null : (
              <span key={`${provider}:${window.key}:last`} className={`usage-last ${toneClass(provider)}`} style={{ top: `${lastAt[index]}%` }}>
                {end.pct}
              </span>
            ),
          )}
        </span>
        <span className="usage-chart-x" aria-hidden="true">
          <span>−12h</span>
          <span>−6h</span>
          <span>
            now · <Updated updatedAt={updatedAt} now={now} />
          </span>
        </span>
      </div>
    </section>
  )
}

/**
 * The AI Usage card (CONTEXT.md), F2's card in the middle Column under the
 * Clock Lines: the chosen providers' rings in one row over the dashboard's
 * last twelve hours. In its smaller form the rings alone, with when the
 * dashboard last refreshed. Read-only — a tap wakes the dashboard like
 * anywhere else on the Idle Screen; the choices live in settings.
 */
export function UsageCard({ providers, updatedAt, now, form }: { providers: readonly UsageView[]; updatedAt: number; now: number; form: 'full' | 'small' }) {
  return (
    <section className={`idle-card usage-card usage-card--${form}`} aria-label="AI usage">
      <Rings providers={providers} now={now} />
      {form === 'full' ? (
        <UsageChart providers={providers} updatedAt={updatedAt} now={now} />
      ) : (
        <span className="usage-card-foot">
          <Updated updatedAt={updatedAt} now={now} />
        </span>
      )}
    </section>
  )
}
