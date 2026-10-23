import { timeOfDay, type TimeFormat } from '../../core/idle/timeFormat'
import { bodyFigures } from '../../core/scale/bodyComposition'
import { weighInsOf, type Person } from '../../core/scale/people'
import { formatFigure, formatKg, SINCE_LAST } from '../../core/scale/weightFormat'
import { changeSinceLast, since, type WeighIn } from '../../core/scale/weighIns'
import type { WeightSettings } from '../../core/scale/weightSettings'
import { WeightChart } from './WeightChart'
import { NoBreakHyphens } from './NoBreakHyphens'
import { dateLabel } from './dateLabel'

const DAY_MS = 24 * 60 * 60 * 1000

/** One row of the card: a Person the Weight section shows, with their Weigh-ins (at least one), oldest first. */
export interface WeightCardRow {
  person: Person
  weighIns: WeighIn[]
}

/** The card's rows: every Person not left out in the Weight section who has a Weigh-in, in settings' order. */
export function weightCardRows(weighIns: readonly WeighIn[], weight: WeightSettings): WeightCardRow[] {
  return weight.people
    .filter((person) => !weight.card.hidden.includes(person.id))
    .map((person) => ({ person, weighIns: weighInsOf(weighIns, weight.people, person.id) }))
    .filter((row) => row.weighIns.length > 0)
}

/**
 * When the latest Weigh-in was: today's by its time alone ("07:12", "7:12
 * am" — "today 7:12 am" outgrew the line on the 12-hour clock),
 * "yesterday", else "Mon 13 Oct".
 */
function whenLabel(at: number, now: number, format: TimeFormat): string {
  const day = new Date(at)
  const today = new Date(now)
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / DAY_MS)
  if (days === 0) return timeOfDay(day, format)
  if (days === 1) return 'yesterday'
  return dateLabel(day, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * The change since the last Weigh-in, as round 6 draws it: an arrow and
 * the size — ▼ 0.30 in green down, ▲ 0.20 in amber up, ±0 flat — what it
 * is against named once, under the lines; the first Weigh-in a quiet note.
 */
function LastChange({ weighIns }: { weighIns: readonly WeighIn[] }) {
  const change = changeSinceLast(weighIns)
  if (change === null)
    return (
      <span className="weight-card-change weight-card-change--none">
        <NoBreakHyphens text="first Weigh-in" />
      </span>
    )
  const size = Math.abs(Math.round(change * 100) / 100)
  const direction = size < 0.05 ? 'flat' : change < 0 ? 'down' : 'up'
  return (
    <span className={`weight-card-change weight-card-change--${direction}`} aria-label={`${direction === 'down' ? 'down' : direction === 'up' ? 'up' : 'flat'} ${size.toFixed(2)} kg ${SINCE_LAST}`}>
      {direction === 'flat' ? '±0' : `${direction === 'down' ? '▼' : '▲'} ${size.toFixed(2)}`}
    </span>
  )
}

/** A row is its own tap, on the pointer going down like the other idle controls. */
function tapProps(person: Person, latest: WeighIn, onOpen: (person: string) => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'data-person': person.id,
    'aria-label': `${person.name} ${formatKg(latest.kg)} kg. Open the Weight page on ${person.name}`,
    onPointerDown: () => onOpen(person.id),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') onOpen(person.id)
    },
  } as const
}

/**
 * The Weight card (CONTEXT.md), in the right Column under the Calendar:
 * per Person with a Weigh-in, the weight, the change since their last
 * Weigh-in, the name in their colour, when, the body fat and their own
 * line over the Weight section's range, each line on its own axis, with
 * "Δ since the last Weigh-in" under the lines. In its smaller form, each
 * name with the weight and the change. The figures shown are the Weight
 * section's choice. A tap on a row opens the Weight page on that Person on
 * the pointer going down, as the other idle controls do — the same
 * pointer-down wakes the dashboard, which unmounts this screen before any
 * click could land.
 */
export function WeightCard({
  rows,
  weight,
  form,
  now,
  format = 'system',
  onOpen,
}: {
  rows: readonly WeightCardRow[]
  weight: WeightSettings
  form: 'full' | 'small'
  now: number
  format?: TimeFormat
  onOpen: (person: string) => void
}) {
  const { card } = weight
  if (form === 'small') {
    return (
      <section className="idle-card weight-card weight-card--small" aria-label="weight">
        {rows.map(({ person, weighIns }) => {
          const latest = weighIns[weighIns.length - 1]
          return (
            <div key={person.id} className="weight-card-row weight-card-line" {...tapProps(person, latest, onOpen)}>
              <span className="weight-card-name">{person.name}</span>
              <span className="weight-card-kg">
                {formatKg(latest.kg)}
                <small> kg</small>
              </span>
              {card.change ? <LastChange weighIns={weighIns} /> : null}
            </div>
          )
        })}
      </section>
    )
  }
  const rangeMs = card.rangeDays * DAY_MS
  return (
    <section className="idle-card weight-card weight-card--full" aria-label="weight" data-rows={rows.length}>
      {rows.map(({ person, weighIns }) => {
        const latest = weighIns[weighIns.length - 1]
        const fat = bodyFigures(latest, person.body).fatPercent
        const line = since(weighIns, rangeMs, now).map((weighIn) => ({ at: weighIn.at, value: weighIn.kg }))
        return (
          <div key={person.id} className="weight-card-row" {...tapProps(person, latest, onOpen)}>
            <div className="weight-card-figures">
              <span className="weight-card-kg">
                {formatKg(latest.kg)}
                <small> kg</small>
              </span>
              {card.change ? <LastChange weighIns={weighIns} /> : null}
              <span className="weight-card-who">
                <span className="weight-card-name">{person.name}</span>
                <span className="weight-card-when">{whenLabel(latest.at, now, format)}</span>
                {card.fat ? <span className="weight-card-fat">{fat === 'unavailable' ? '– fat' : `${formatFigure(fat, 1)}% fat`}</span> : null}
              </span>
            </div>
            {card.line ? <WeightChart points={line} start={now - rangeMs} end={now} digits={1} label={`${person.name}’s weight over the last ${card.rangeDays} days`} compact /> : null}
          </div>
        )
      })}
      {card.line || card.change ? (
        <span className="weight-card-foot" aria-hidden="true">
          {card.line ? <span>−{card.rangeDays}d</span> : null}
          {card.change ? (
            <span>
              Δ <NoBreakHyphens text={SINCE_LAST} />
            </span>
          ) : null}
          {card.line ? <span>now</span> : null}
        </span>
      ) : null}
    </section>
  )
}
