import type { SlotSize } from '../../core/idle/slots'
import { bodyFigures } from '../../core/scale/bodyComposition'
import { weighInsOf, type Person } from '../../core/scale/people'
import { formatChange, formatFigure, formatKg } from '../../core/scale/weightFormat'
import { changeSince, since, type WeighIn } from '../../core/scale/weighIns'
import type { WeightSettings } from '../../core/scale/weightSettings'
import { WeightChart } from './WeightChart'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

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

/** When the latest Weigh-in was: "today 07:12", "yesterday", else "Mon 13 Oct". */
function whenLabel(at: number, now: number): string {
  const day = new Date(at)
  const today = new Date(now)
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / DAY_MS)
  if (days === 0) return `today ${day.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  if (days === 1) return 'yesterday'
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The change against a week ago as a line: "−0.5 kg · 7 days", or a quiet note with nothing that far back. */
function WeekChange({ weighIns }: { weighIns: readonly WeighIn[] }) {
  const change = changeSince(weighIns, WEEK_MS)
  if (change === null) return <span className="weight-card-change weight-card-change--none">no Weigh-in a week back</span>
  const direction = Math.abs(change) < 0.05 ? 'flat' : change < 0 ? 'down' : 'up'
  return (
    <span className={`weight-card-change weight-card-change--${direction}`}>
      {formatChange(change, 2)} kg <span className="weight-card-change-span">· 7 days</span>
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
 * The Weight card (CONTEXT.md), a Pinned Card of each Person's latest
 * Weigh-in. Given a 1×2 Card Slot, one tile per Person with a Weigh-in:
 * the name, the weight, its change against their last Weigh-in a week or
 * more before, the body fat and their own line over the Weight section's
 * range, each line on its own axis; given one cell, each name with the
 * weight and the change. The figures shown are the Weight section's
 * choice. A tap on a row opens the Weight page on that Person on the
 * pointer going down, as the other idle controls do — the same
 * pointer-down wakes the dashboard, which unmounts this screen before any
 * click could land.
 */
export function WeightCard({ rows, weight, size, now, onOpen }: { rows: readonly WeightCardRow[]; weight: WeightSettings; size: SlotSize; now: number; onOpen: (person: string) => void }) {
  const { card } = weight
  if (size.h < 2) {
    return (
      <div className="idle-tiles weight-card" aria-label="weight" style={{ '--w': String(size.w), '--h': String(size.h) } as React.CSSProperties}>
        <section className="idle-card weight-card--list" style={{ '--rows': String(rows.length) } as React.CSSProperties}>
          <h3 className="idle-kicker">Weight</h3>
          {rows.map(({ person, weighIns }) => {
            const latest = weighIns[weighIns.length - 1]
            return (
              <div key={person.id} className="weight-card-line" {...tapProps(person, latest, onOpen)}>
                <span className="weight-card-name">{person.name}</span>
                <span className="weight-card-kg">
                  {formatKg(latest.kg)}
                  <small> kg</small>
                </span>
                {card.change ? <WeekChange weighIns={weighIns} /> : null}
              </div>
            )
          })}
        </section>
      </div>
    )
  }
  const rangeMs = card.rangeDays * DAY_MS
  return (
    <div className="idle-tiles weight-card" aria-label="weight" data-rows={rows.length} style={{ '--w': String(size.w), '--h': String(rows.length) } as React.CSSProperties}>
      {rows.map(({ person, weighIns }) => {
        const latest = weighIns[weighIns.length - 1]
        const fat = bodyFigures(latest, person.body).fatPercent
        const line = since(weighIns, rangeMs, now).map((weighIn) => ({ at: weighIn.at, value: weighIn.kg }))
        return (
          <section key={person.id} className="idle-card weight-card-row" {...tapProps(person, latest, onOpen)}>
            <h3 className="idle-kicker">
              <span className="weight-card-name">{person.name}</span> · {whenLabel(latest.at, now)}
            </h3>
            <div className="weight-card-figures">
              <span className="weight-card-kg">
                {formatKg(latest.kg)}
                <small> kg</small>
              </span>
              <span className="weight-card-side">
                {card.change ? <WeekChange weighIns={weighIns} /> : null}
                {card.fat ? (
                  <span className="weight-card-fat">
                    Body fat <b>{fat === 'unavailable' ? '–' : `${formatFigure(fat, 1)}%`}</b>
                  </span>
                ) : null}
              </span>
            </div>
            {card.line ? <WeightChart points={line} start={now - rangeMs} end={now} digits={1} label={`${person.name}’s weight over the last ${card.rangeDays} days`} compact /> : null}
          </section>
        )
      })}
    </div>
  )
}
