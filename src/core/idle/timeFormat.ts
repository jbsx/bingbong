/**
 * The Time Format setting: which clock a time of day is written on — the
 * locale's own (`system`, as every time was before the setting), or the
 * 12-hour or 24-hour clock whatever the locale says.
 */
export type TimeFormat = 'system' | '12' | '24'

/** Only the three literals pass; anything else follows the locale. */
export function asTimeFormat(value: unknown): TimeFormat {
  return value === '12' || value === '24' ? value : 'system'
}

/** Whether a time is written on the 12-hour clock: the setting's word, or for `system` the locale's. */
export function isTwelveHour(format: TimeFormat, locale?: string): boolean {
  if (format !== 'system') return format === '12'
  const hourCycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
  return hourCycle === 'h11' || hourCycle === 'h12'
}

/**
 * A time of day with its minutes, as the Intl options that write it: the
 * 12-hour clock's bare hour and day period ("9:05 pm"), or the 24-hour
 * clock's two-digit hour ("21:05"). `h23`, not `hour12: false`, which some
 * engines read as `h24` and write midnight "24:05".
 */
export function timeOptions(format: TimeFormat, locale?: string): Intl.DateTimeFormatOptions {
  return isTwelveHour(format, locale)
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
}

/** A time of day in that format: "21:05", "9:05 pm". */
export function timeOfDay(at: Date | number, format: TimeFormat, locale?: string): string {
  return new Intl.DateTimeFormat(locale, timeOptions(format, locale)).format(at)
}

/**
 * The Idle Screen's clock in its parts, so the separator can take the
 * accent and the day period sit small beside the minutes: "9", ":", "05",
 * "pm" — the period '' on the 24-hour clock.
 */
export function clockParts(at: Date | number, format: TimeFormat, locale?: string): { hours: string; separator: string; minutes: string; period: string } {
  const parts = new Intl.DateTimeFormat(locale, timeOptions(format, locale)).formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  const hourAt = parts.findIndex((part) => part.type === 'hour')
  const separator = parts[hourAt + 1]?.type === 'literal' ? parts[hourAt + 1].value : ':'
  return { hours: value('hour'), separator, minutes: value('minute'), period: value('dayPeriod') }
}
