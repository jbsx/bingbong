import { hourLabel } from '../../core/weather/hourLabel'
import { cityWallClock, dayBar, rainPeak } from '../../core/weather/today'
import { temperatureHue, type WeatherHour, type WeatherOutlookDay, type WeatherReport } from '../../core/weather/weather'
import type { WeatherUnits } from '../../core/settings/settings'
import { WeatherIcon } from './WeatherIcon'

function degrees(temperature: number): string {
  return `${Math.round(temperature)}°`
}

/** A temperature's tone, as CSS: its hue at the mode's saturation and lightness, so it sits on either ground. */
function tone(temperature: number, units: WeatherUnits): string {
  return `hsl(${temperatureHue(temperature, units)} var(--wx-sat) var(--wx-light))`
}

function hueStyle(temperature: number, units: WeatherUnits): React.CSSProperties {
  return { '--hue': String(temperatureHue(temperature, units)) } as React.CSSProperties
}

function sentence(words: string): string {
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** A drop of rain, in the rain's blue. */
function Drop({ size }: { size: number }) {
  return (
    <svg className="wx-drop" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z" />
    </svg>
  )
}

/** The day from sunrise to sunset on its 24 hours, now marked on it — past sunset at night. */
function DayBar({ report, now }: { report: WeatherReport; now: number }) {
  const at = report.utcOffsetSeconds === undefined ? null : cityWallClock(now, report.utcOffsetSeconds)
  const bar = at === null ? null : dayBar(report.today?.sunrise ?? null, report.today?.sunset ?? null, at)
  if (bar === null || report.today?.sunrise == null || report.today.sunset == null) return null
  const percent = (share: number): string => `${(share * 100).toFixed(2)}%`
  return (
    <div className="wx-day" aria-label={`sunrise ${hourLabel(report.today.sunrise, { withMinutes: true })}, sunset ${hourLabel(report.today.sunset, { withMinutes: true })}`}>
      <span className="wx-day-track">
        <span className="wx-day-sun" style={{ left: percent(bar.sunrise), width: percent(bar.sunset - bar.sunrise) }} />
        <span className="wx-day-edge" style={{ left: percent(bar.sunrise) }} />
        <span className="wx-day-edge" style={{ left: percent(bar.sunset) }} />
        <span className="wx-day-now" style={{ left: percent(bar.now) }} />
      </span>
      <span className="wx-day-time" style={{ left: percent(bar.sunrise) }}>
        {hourLabel(report.today.sunrise, { withMinutes: true })}
      </span>
      <span className="wx-day-time" style={{ left: percent(bar.sunset) }}>
        {hourLabel(report.today.sunset, { withMinutes: true })}
      </span>
    </div>
  )
}

/**
 * The weather now: the temperature huge in its hue, the condition, the city
 * by its sky's glyph and today's rain chance; today's low to high with now
 * on it; the day bar under them.
 */
function WeatherNow({ report, now }: { report: WeatherReport; now: number }) {
  const { today, units } = report
  const span = today ? Math.max(1, today.high - today.low) : 1
  const at = today ? Math.min(100, Math.max(0, ((report.temperature - today.low) / span) * 100)) : 0
  return (
    <div className="wx-band wx-now" aria-label="weather now">
      <div className="wx-now-head">
        <span className="wx-temp wx-hero" style={hueStyle(report.temperature, units)}>
          {degrees(report.temperature)}
        </span>
        <span className="wx-cond">
          <span className="wx-cond-words">{sentence(report.description)}</span>
          <span className="wx-cond-city">
            <WeatherIcon sky={report.sky ?? 'unknown'} isDay={report.isDay ?? null} size={26} />
            {report.city}
          </span>
          {today?.precipitationChance != null ? (
            <span className="wx-cond-rain" aria-label={`rain ${Math.round(today.precipitationChance)}% at its peak today`}>
              <Drop size={20} />
              {Math.round(today.precipitationChance)}%<span className="wx-cond-rain-words">peak today</span>
            </span>
          ) : null}
        </span>
      </div>
      {today ? (
        <div className="wx-lohi" aria-label={`low ${degrees(today.low)}, high ${degrees(today.high)}`}>
          <span className="wx-temp" style={hueStyle(today.low, units)}>
            {degrees(today.low)}
          </span>
          <span className="wx-lohi-bar" style={{ '--from': tone(today.low, units), '--to': tone(today.high, units) } as React.CSSProperties}>
            <span className="wx-lohi-now" style={{ left: `${at}%` }} />
          </span>
          <span className="wx-temp" style={hueStyle(today.high, units)}>
            {degrees(today.high)}
          </span>
        </div>
      ) : null}
      <DayBar report={report} now={now} />
    </div>
  )
}

/** A smooth line through points (Catmull-Rom as cubic Béziers), as round 6 draws the hours. */
function smooth(points: readonly [number, number][]): string {
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]},${p2[1]}`
  }
  return d
}

/** The chart's box: 456 wide, the hours' columns 30 in from each side. */
const W = 456
const X0 = 30
const X1 = W - 30
const BASE = 246

/**
 * The six coming hours, round 6's chart: each hour's sky over its column,
 * the temperature as a line in its hues — labelled where it turns, and at
 * each end — over the rain chance as a blue area, each hour's chance over
 * it, the peak's brighter, and the hours under the axis.
 */
function HourChart({ hours, units, peak }: { hours: readonly WeatherHour[]; units: WeatherUnits; peak: number }) {
  const last = hours.length - 1
  const x = (index: number): number => (last === 0 ? (X0 + X1) / 2 : X0 + ((X1 - X0) * index) / last)
  const rainY = (chance: number): number => BASE - chance * 1.42
  const mean = hours.reduce((sum, hour) => sum + hour.temperature, 0) / hours.length
  const reach = Math.max(1, ...hours.map((hour) => Math.abs(hour.temperature - mean)))
  const per = Math.min(22, 34 / reach)
  const tempY = (temperature: number): number => 76 - (temperature - mean) * per
  const rain = hours.map((hour, index): [number, number] => [x(index), rainY(hour.precipitationChance ?? 0)])
  const temps = hours.map((hour, index): [number, number] => [x(index), tempY(Math.round(hour.temperature))])
  // Labelled where the temperature turns and at each end — always over the line, since under it lie the rain figures.
  const shown = hours.map((hour, index) => {
    const t = Math.round(hour.temperature)
    const before = index > 0 ? Math.round(hours[index - 1].temperature) : null
    const after = index < last ? Math.round(hours[index + 1].temperature) : null
    return index === 0 || index === last || t !== before || t !== after
  })
  return (
    <div className="wx-hours-chart">
      <span className="wx-hours-skies" aria-hidden="true">
        {hours.map((hour, index) => (
          <span key={hour.time} style={{ left: `${(x(index) / W) * 100}%` }}>
            <WeatherIcon sky={hour.sky} isDay={hour.isDay} size={30} />
          </span>
        ))}
      </span>
      <svg viewBox={`0 0 ${W} 300`} width={W} height={300} aria-hidden="true">
        <defs>
          <linearGradient id="wx-rain-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="wx-rain-stop" stopOpacity={0.42} />
            <stop offset="1" className="wx-rain-stop" stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="wx-temp-line" gradientUnits="userSpaceOnUse" x1={X0} x2={X1} y1={0} y2={0}>
            {hours.map((hour, index) => (
              <stop key={hour.time} offset={last === 0 ? 0 : index / last} style={{ stopColor: tone(hour.temperature, units) }} />
            ))}
          </linearGradient>
        </defs>
        {hours.map((hour, index) => (
          <line key={hour.time} className="wx-hours-rule" x1={x(index)} x2={x(index)} y1={48} y2={BASE} />
        ))}
        {hours.length > 1 ? (
          <>
            <path className="wx-rain-area" d={`${smooth(rain)} L${x(last)},${BASE} L${x(0)},${BASE}Z`} />
            <path className="wx-rain-line" d={smooth(rain)} />
          </>
        ) : null}
        <line className="wx-hours-axis" x1={X0 - 16} x2={X1 + 16} y1={BASE} y2={BASE} />
        {hours.map((hour, index) => (
          <g key={hour.time}>
            <text className="wx-hours-time" x={x(index)} y={BASE + 28} textAnchor="middle">
              {hourLabel(hour.time)}
            </text>
            {hour.precipitationChance !== null && hour.precipitationChance > 0 ? (
              <text className={hour.precipitationChance === peak ? 'wx-hours-rain wx-hours-rain--peak' : 'wx-hours-rain'} x={x(index)} y={rainY(hour.precipitationChance) - 10} textAnchor="middle">
                {Math.round(hour.precipitationChance)}%
              </text>
            ) : null}
          </g>
        ))}
        {hours.length > 1 ? <path className="wx-temp-line" d={smooth(temps)} /> : null}
        {hours.map((hour, index) =>
          shown[index] ? (
            <g key={`${hour.time}:t`}>
              <circle className="wx-temp-dot" cx={temps[index][0]} cy={temps[index][1]} r={5} style={{ fill: tone(hour.temperature, units) }} />
              <text
                className="wx-temp-label"
                x={index === 0 ? x(index) + 12 : index === last ? x(index) - 12 : x(index)}
                y={(index === 0 || index === last ? Math.min(temps[index][1], temps[index === 0 ? Math.min(1, last) : index - 1][1]) : temps[index][1]) - 12}
                textAnchor={index === 0 ? 'start' : index === last ? 'end' : 'middle'}
                style={{ fill: tone(hour.temperature, units) }}
              >
                {degrees(hour.temperature)}
              </text>
            </g>
          ) : null,
        )}
      </svg>
    </div>
  )
}

/** The coming hours: the rain at its peak and the hour it comes, large, over the chart. */
function WeatherHours({ report }: { report: WeatherReport }) {
  const hours = report.hours ?? []
  const peak = rainPeak(hours)
  return (
    <div className="wx-band wx-hours" aria-label="coming hours">
      {peak !== null ? (
        <div className="wx-peak" aria-label={`rain ${Math.round(peak.chance)}% by ${hourLabel(peak.time)}`}>
          <span className="wx-peak-figure">
            {Math.round(peak.chance)}
            <small>%</small>
          </span>
          <span className="wx-peak-words">
            <span>rain</span>
            <span className="wx-peak-by">by {hourLabel(peak.time, { withMinutes: true })}</span>
          </span>
        </div>
      ) : null}
      {hours.length > 0 ? <HourChart hours={hours} units={report.units} peak={peak?.chance ?? -1} /> : null}
    </div>
  )
}

function outlookWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: 'short' })
}

/**
 * The three days after today, a row each: the weekday, the sky, the rain
 * chance (brighter from 80 %), and the range as a bar in its hues on one
 * scale for the three, its low and high at its ends.
 */
function WeatherDays({ days, units }: { days: readonly WeatherOutlookDay[]; units: WeatherUnits }) {
  const floor = Math.min(...days.map((day) => day.low)) - 6
  const span = Math.max(1, Math.max(...days.map((day) => day.high)) + 6 - floor)
  const at = (temperature: number): number => ((temperature - floor) / span) * 100
  return (
    <ul className="wx-band wx-days" aria-label="coming days">
      {days.map((day) => (
        <li key={day.date} className="wx-days-day" aria-label={`${outlookWeekday(day.date)}: ${day.description}, ${degrees(day.low)} to ${degrees(day.high)}`}>
          <span className="wx-days-name">{outlookWeekday(day.date)}</span>
          <WeatherIcon sky={day.sky} isDay={true} size={32} />
          <span className={day.precipitationChance !== null && day.precipitationChance >= 80 ? 'wx-days-rain wx-days-rain--high' : 'wx-days-rain'}>
            {day.precipitationChance !== null ? `${Math.round(day.precipitationChance)}%` : ''}
          </span>
          <span className="wx-days-track">
            <span className="wx-days-range" style={{ left: `${at(day.low)}%`, right: `${100 - at(day.high)}%`, '--from': tone(day.low, units), '--to': tone(day.high, units) } as React.CSSProperties} />
            <span className="wx-temp wx-days-low" style={{ ...hueStyle(day.low, units), right: `calc(${100 - at(day.low)}% + 10px)` }}>
              {degrees(day.low)}
            </span>
            <span className="wx-temp wx-days-high" style={{ ...hueStyle(day.high, units), left: `calc(${at(day.high)}% + 10px)` }}>
              {degrees(day.high)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The weather (CONTEXT.md, Idle Screen), down the left Column as round 6
 * draws it: the weather now, the coming hours, the coming days — every
 * temperature in its hue, rain in blue, every time in the city's own clock.
 */
export function WeatherColumn({ report, now }: { report: WeatherReport; now: number }) {
  return (
    <section className="idle-card wx-card" aria-label="weather">
      <WeatherNow report={report} now={now} />
      <WeatherHours report={report} />
      {(report.days ?? []).length > 0 ? <WeatherDays days={report.days ?? []} units={report.units} /> : <div className="wx-band wx-days" />}
    </section>
  )
}
