/**
 * A forecast's local wall-clock time (`YYYY-MM-DDTHH:MM`, the city's own) as
 * the locale writes a time of day. Built from its parts, never parsed as an
 * instant: the city's clock is what the screen shows, whatever zone the
 * device is in. A bare hour is a time only where the locale says am/pm; a
 * 24-hour locale's "18" beside "Sunday 18 October" reads as a date, so it
 * takes its minutes — "18:00" (#334).
 */
export function hourLabel(local: string, { locale, withMinutes = false }: { locale?: string; withMinutes?: boolean } = {}): string {
  const match = /T(\d{2}):(\d{2})/.exec(local)
  if (match === null) return local
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  const hourCycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
  const twelveHour = hourCycle === 'h11' || hourCycle === 'h12'
  if (twelveHour && !withMinutes) return date.toLocaleTimeString(locale, { hour: 'numeric' })
  return date.toLocaleTimeString(locale, { hour: twelveHour ? 'numeric' : '2-digit', minute: '2-digit' })
}
