import { useState } from 'react'
import { bodyFigures, type BodyFigures, type BodyProfile, type Figure } from '../../core/scale/bodyComposition'
import { formatChange, formatFigure, formatKg, WEIGHT_FIGURES } from '../../core/scale/weightFormat'
import { since, type WeighIn } from '../../core/scale/weighIns'
import { reportRendererFault } from './diagnostics'
import { WeightChart } from './WeightChart'

const DAY_MS = 24 * 60 * 60 * 1000

/** The chart spans the page offers; All reaches back to the first Weigh-in. */
const RANGES = [
  { name: '30 d', ms: 30 * DAY_MS },
  { name: '90 d', ms: 90 * DAY_MS },
  { name: '1 y', ms: 365 * DAY_MS },
  { name: 'All', ms: null },
] as const

type RangeName = (typeof RANGES)[number]['name']

/** The figures that need the scale's impedance, which a Weigh-in with no resistance cannot have. */
const IMPEDANCE_FIGURES = new Set<keyof BodyFigures>(['fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg'])

/** Why a figure has no number: the profile it needs, or a Weigh-in the scale measured no impedance for. */
function missingWhy(key: keyof BodyFigures, weighIn: WeighIn, profile: BodyProfile): string {
  const profileWhole = profile.heightCm !== null && profile.birthDate !== null && profile.sex !== null
  if (profileWhole && IMPEDANCE_FIGURES.has(key) && weighIn.r1 <= 0) return 'no impedance measured'
  return 'set your body profile in Settings'
}

function withUnit(text: string, unit: string): string {
  return unit === '' ? text : unit === '%' ? `${text}%` : `${text} ${unit}`
}

function changeText(now: Figure, before: Figure | undefined, digits: number, unit: string): string | null {
  if (now === 'unavailable' || before === undefined || before === 'unavailable') return null
  // A percentage's change is in points, not percent of itself.
  const suffix = unit === '%' ? ' pts' : unit === '' ? '' : ` ${unit}`
  return `${formatChange(now - before, digits)}${suffix}`
}

function stamp(at: number): string {
  return new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * The Weight page (CONTEXT.md): a full-window view beside Settings, opened
 * from the Weight card. The latest Weigh-in with every figure and its
 * change since the one before; a chart per figure over 30 days, 90 days, a
 * year or all of it; and every Weigh-in, newest first, each with a Delete
 * for a mis-weigh or a guest. Every figure is worked out on the spot from
 * the stored reading and the Body Profile — the page says the impedance
 * ones are estimates.
 */
export function WeightPage({ weighIns, profile, onClose }: { weighIns: readonly WeighIn[] | null; profile: BodyProfile; onClose: () => void }) {
  const [range, setRange] = useState<RangeName>('30 d')
  const [now] = useState(() => Date.now())
  const list = weighIns ?? []
  const latest = list[list.length - 1]
  const previous = list[list.length - 2]
  const figures = latest === undefined ? null : bodyFigures(latest, profile)
  const before = previous === undefined ? null : bodyFigures(previous, profile)
  const span = RANGES.find((option) => option.name === range)?.ms ?? null
  const shown = since(list, span, now)
  const start = span === null ? (list[0]?.at ?? now) : now - span
  const history = list.map((weighIn) => ({ weighIn, figures: bodyFigures(weighIn, profile) }))

  const remove = (at: number): void => {
    window.bingbong.weight.remove(at).catch((error: unknown) => reportRendererFault('weight.remove', error))
  }

  return (
    <section className="settings-page weight-page" aria-label="weight">
      <div className="settings-scroll weight-scroll">
        {latest === undefined || figures === null ? (
          <section className="settings-section">
            <h2>Weight</h2>
            <p className="settings-note">No Weigh-ins yet. Step on the scale: Bing Bong records the weight once it settles.</p>
          </section>
        ) : (
          <>
            <section className="settings-section weight-latest" aria-label="latest weigh-in">
              <h2>Latest · {stamp(latest.at)}</h2>
              <ul className="weight-figures">
                {WEIGHT_FIGURES.map(({ key, label, unit, digits }) => {
                  const value = figures[key]
                  const change = changeText(value, before?.[key], digits, unit)
                  return (
                    <li key={key} className="weight-figure" data-figure={key}>
                      <span className="weight-figure-label">{label}</span>
                      <span className="weight-figure-value">{value === 'unavailable' ? '–' : withUnit(key === 'weightKg' ? formatKg(value) : formatFigure(value, digits), unit)}</span>
                      <span className="weight-figure-change">{value === 'unavailable' ? missingWhy(key, latest, profile) : change === null ? 'first Weigh-in' : `${change} since the last`}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="settings-note">
                Body fat, water, muscle, bone and lean mass are estimates from the scale’s impedance (openScale’s Trisa formulas); BMR is Mifflin–St Jeor. They move with hydration and the time of day — compare like with like.
              </p>
            </section>

            <section className="settings-section weight-history" aria-label="weight history">
              <div className="weight-history-head">
                <h2>History</h2>
                <span className="weight-ranges" role="group" aria-label="chart span">
                  {RANGES.map((option) => (
                    <button key={option.name} type="button" className={option.name === range ? 'weight-range weight-range--on' : 'weight-range'} aria-pressed={option.name === range} onClick={() => setRange(option.name)}>
                      {option.name}
                    </button>
                  ))}
                </span>
              </div>
              <div className="weight-charts">
                {WEIGHT_FIGURES.map(({ key, label, unit, digits }) => {
                  const points = shown.flatMap((weighIn) => {
                    const value = bodyFigures(weighIn, profile)[key]
                    return value === 'unavailable' ? [] : [{ at: weighIn.at, value }]
                  })
                  return (
                    <figure key={key} className="weight-chart-figure" data-figure={key}>
                      <figcaption>
                        {label}
                        {unit === '' ? '' : ` (${unit})`}
                      </figcaption>
                      <WeightChart points={points} start={start} end={now} digits={digits} label={`${label} over ${range === 'All' ? 'every Weigh-in' : `the last ${range}`}`} />
                    </figure>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {list.length > 0 ? (
          <section className="settings-section" aria-label="weigh-ins">
            <h2>Weigh-ins</h2>
            <table className="weight-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Weight</th>
                  <th>Body fat</th>
                  <th>Muscle</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(({ weighIn, figures: row }) => (
                  <tr key={weighIn.at} data-at={weighIn.at}>
                    <td>{stamp(weighIn.at)}</td>
                    <td>{formatKg(weighIn.kg)} kg</td>
                    <td>{row.fatPercent === 'unavailable' ? '–' : `${formatFigure(row.fatPercent, 1)}%`}</td>
                    <td>{row.musclePercent === 'unavailable' ? '–' : `${formatFigure(row.musclePercent, 1)}%`}</td>
                    <td>
                      <button type="button" className="settings-term-remove" aria-label={`Delete the Weigh-in of ${stamp(weighIn.at)}`} onClick={() => remove(weighIn.at)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>

      <div className="settings-actions">
        <button type="button" className="settings-button weight-back" onClick={onClose}>
          Back
        </button>
      </div>
    </section>
  )
}
