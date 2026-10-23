import { isTwelveHour, timeOptions, type TimeFormat } from '../idle/timeFormat'

/**
 * A forecast's local wall-clock time (`YYYY-MM-DDTHH:MM`, the city's own) as
 * the locale writes a time of day. Built from its parts, never parsed as an
 * instant: the city's clock is what the screen shows, whatever zone the
 * device is in. A bare hour is a time only where the locale says am/pm; a
 * 24-hour locale's "18" beside "Sunday 18 October" reads as a date, so it
 * takes its minutes — "18:00" (#334). The Time Format setting picks the
 * clock; `system` leaves it to the locale.
 */
export function hourLabel(
  local: string,
  { locale, withMinutes = false, format = 'system' }: { locale?: string; withMinutes?: boolean; format?: TimeFormat } = {},
): string {
  const match = /T(\d{2}):(\d{2})/.exec(local)
  if (match === null) return local
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  if (isTwelveHour(format, locale) && !withMinutes) return date.toLocaleTimeString(locale, { hour: 'numeric', hour12: true })
  return date.toLocaleTimeString(locale, timeOptions(format, locale))
}
