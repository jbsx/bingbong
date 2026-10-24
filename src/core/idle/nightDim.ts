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
  /** The monitor whose own brightness is lowered over DDC/CI (#413); none, the veil only. */
  monitor: NightDimMonitor | null
}

/** A monitor as Night Dim keeps it: by its EDID model and its connector, never by the I²C bus, which renumbers. */
export interface NightDimMonitor {
  /** The EDID model, `325E1`. */
  model: string
  /** The connector without its card, `HDMI-A-1`. */
  connector: string
}

export const NIGHT_BRIGHTNESS_MIN = 0
export const NIGHT_BRIGHTNESS_MAX = 100

export function defaultNightDim(): NightDim {
  return { enabled: false, from: '23:00', to: '07:00', brightnessPercent: 40, monitor: null }
}

/** A time of day as `HH:MM` on the 24-hour clock, as `<input type="time">` writes it; anything else none. */
function asClockTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60 ? value : null
}

function asMonitor(value: unknown): NightDimMonitor | null {
  if (typeof value !== 'object' || value === null) return null
  const { model, connector } = value as Record<string, unknown>
  return typeof model === 'string' && model !== '' && typeof connector === 'string' && connector !== '' ? { model, connector } : null
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
    monitor: asMonitor(record.monitor),
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

/**
 * The monitor's own brightness at night: the setting's share of the level
 * it had by day (`40 %` of 40 is 16), so the slider means the same with the
 * veil or without it. None when the monitor cannot go darker that way — a
 * day level already at 0, or a share that rounds back to it — and the veil
 * dims instead.
 */
export function nightLevel(dayLevel: number, brightnessPercent: number): number | null {
  const night = Math.round((dayLevel * brightnessPercent) / 100)
  return dayLevel <= 0 || night === dayLevel ? null : night
}
