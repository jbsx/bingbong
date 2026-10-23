/**
 * Night Dim: the Idle Screen darkened between two times of day, so the
 * appliance's always-on display does not light the room at night. Off by
 * default; the window may run past midnight (23:00 to 07:00).
 */
export interface NightDim {
  enabled: boolean
  /** When the dimming starts, `HH:MM` on the device's clock. */
  from: string
  /** When it ends, `HH:MM`. */
  to: string
  /** How bright the screen stays while dimmed, in percent. */
  brightnessPercent: number
}

export const NIGHT_BRIGHTNESS_MIN = 10
export const NIGHT_BRIGHTNESS_MAX = 90

export function defaultNightDim(): NightDim {
  return { enabled: false, from: '23:00', to: '07:00', brightnessPercent: 40 }
}

/** A time of day as `HH:MM` on the 24-hour clock, as `<input type="time">` writes it; anything else none. */
function asClockTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60 ? value : null
}

/** Parse anything (disk, IPC) into a Night Dim; unknown bits fall back to the defaults. */
export function sanitizeNightDim(raw: unknown): NightDim {
  const defaults = defaultNightDim()
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const brightness = typeof record.brightnessPercent === 'number' && Number.isFinite(record.brightnessPercent) ? Math.round(record.brightnessPercent) : defaults.brightnessPercent
  return {
    enabled: record.enabled === true,
    from: asClockTime(record.from) ?? defaults.from,
    to: asClockTime(record.to) ?? defaults.to,
    brightnessPercent: Math.min(NIGHT_BRIGHTNESS_MAX, Math.max(NIGHT_BRIGHTNESS_MIN, brightness)),
  }
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** Whether `now` falls inside the dimming window: from its start, up to but not at its end; a window that starts and ends at once is never. */
export function isNightDimmed(now: Date, dim: NightDim): boolean {
  if (!dim.enabled) return false
  const at = now.getHours() * 60 + now.getMinutes()
  const from = minutesOf(dim.from)
  const to = minutesOf(dim.to)
  if (from === to) return false
  return from < to ? at >= from && at < to : at >= from || at < to
}
