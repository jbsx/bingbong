import type { SlotSize } from '../../core/idle/slots'
import { bodyFigures, type BodyProfile } from '../../core/scale/bodyComposition'
import { formatChange, formatFigure, formatKg } from '../../core/scale/weightFormat'
import { changeSince, since, type WeighIn } from '../../core/scale/weighIns'
import { WeightChart } from './WeightChart'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const TREND_MS = 30 * DAY_MS

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

/**
 * The Weight card (CONTEXT.md), a Pinned Card: given a 1×2 Card Slot, the
 * latest weight large with its change against a week ago and the body fat
 * in one tile, the last 30 days' trend in the tile under it; given one
 * cell, the weight and the change. A tap opens the Weight page on the
 * pointer going down, as the other idle controls do — the same
 * pointer-down wakes the dashboard, which unmounts this screen before any
 * click could land.
 */
export function WeightCard({ weighIns, profile, size, now, onOpen }: { weighIns: readonly WeighIn[]; profile: BodyProfile; size: SlotSize; now: number; onOpen: () => void }) {
  const latest = weighIns[weighIns.length - 1]
  const fat = bodyFigures(latest, profile).fatPercent
  const trend = since(weighIns, TREND_MS, now).map((weighIn) => ({ at: weighIn.at, value: weighIn.kg }))
  return (
    <div
      role="button"
      tabIndex={0}
      className="idle-tiles weight-card"
      aria-label={`Weight ${formatKg(latest.kg)} kg. Open the Weight page`}
      style={{ '--w': String(size.w), '--h': String(size.h) } as React.CSSProperties}
      onPointerDown={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen()
      }}
    >
      <section className="idle-card weight-card-now" aria-label="latest weigh-in">
        <h3 className="idle-kicker">Weight · {whenLabel(latest.at, now)}</h3>
        <span className="weight-card-kg">
          {formatKg(latest.kg)}
          <small> kg</small>
        </span>
        <WeekChange weighIns={weighIns} />
        {size.h >= 2 ? (
          <span className="weight-card-fat">
            Body fat <b>{fat === 'unavailable' ? '–' : `${formatFigure(fat, 1)}%`}</b>
            {fat === 'unavailable' ? <span className="weight-card-note"> · set your body profile in Settings</span> : null}
          </span>
        ) : null}
      </section>
      {size.h >= 2 ? (
        <section className="idle-card weight-card-trend" aria-label="weight over the last 30 days">
          <h3 className="idle-kicker">Last 30 days</h3>
          <WeightChart points={trend} start={now - TREND_MS} end={now} digits={1} label="weight over the last 30 days" compact />
        </section>
      ) : null}
    </div>
  )
}
