// What the Idle Screen's weather reads off a report beyond its figures
// (CONTEXT.md, Idle Screen): the rain chance at its peak in the coming
// hours and the hour it peaks, and the day bar of sunrise to sunset with
// now marked — every time in the city's own clock.

import type { WeatherHour } from './weather'

/** The rain at its peak in the coming hours: its chance and the hour it comes (`YYYY-MM-DDTHH:MM`). */
export interface RainPeak {
  chance: number
  time: string
}

/** The highest chance of rain in the coming hours, the earliest of a tie; nothing when no hour has a chance. */
export function rainPeak(hours: readonly WeatherHour[]): RainPeak | null {
  let peak: RainPeak | null = null
  for (const hour of hours) {
    if (hour.precipitationChance === null) continue
    if (peak === null || hour.precipitationChance > peak.chance) peak = { chance: hour.precipitationChance, time: hour.time }
  }
  return peak
}

/** A wall-clock time's place in its day, 0 at midnight to 1 at the next. */
function shareOfDay(local: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(local)
  return match === null ? null : (Number(match[1]) * 60 + Number(match[2])) / (24 * 60)
}

/** The day bar: sunrise, sunset and now as shares of the day's 24 hours; nothing without both sun times. */
export function dayBar(sunrise: string | null, sunset: string | null, now: string): { sunrise: number; sunset: number; now: number } | null {
  const rise = sunrise === null ? null : shareOfDay(sunrise)
  const set = sunset === null ? null : shareOfDay(sunset)
  const at = shareOfDay(now)
  if (rise === null || set === null || at === null) return null
  return { sunrise: rise, sunset: set, now: at }
}

/**
 * Where the sunrise and sunset times sit under the day bar, as shares of its width: each under its own edge, then
 * moved the least it takes for both to stay inside the bar and clear of each other. `width` is one time's share of
 * the bar (owner, 2026-11-16: the times at 40 px, read from the chair, so a short day's two no longer fit under their edges).
 */
export function sunLabelPlaces(bar: { sunrise: number; sunset: number }, width: number): { sunrise: number; sunset: number } {
  const half = width / 2
  const clamp = (share: number, low: number, high: number): number => Math.min(Math.max(share, low), Math.max(low, high))
  let rise = clamp(bar.sunrise, half, 1 - half - width)
  let set = clamp(bar.sunset, half + width, 1 - half)
  const short = width - (set - rise)
  if (short > 0) {
    rise = clamp(rise - short / 2, half, 1 - half - width)
    set = clamp(rise + width, half + width, 1 - half)
  }
  return { sunrise: rise, sunset: set }
}

/** An instant on the city's clock (its offset from UTC, as the forecast gives it), written as the forecast writes its times. */
export function cityWallClock(at: number, utcOffsetSeconds: number): string {
  const city = new Date(at + utcOffsetSeconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${city.getUTCFullYear()}-${pad(city.getUTCMonth() + 1)}-${pad(city.getUTCDate())}T${pad(city.getUTCHours())}:${pad(city.getUTCMinutes())}`
}
