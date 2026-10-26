// The ear's usage tally (#463, grill ruling 11): seconds of audio each
// engine heard per day, split into the lines that fired a Command and the
// lines that fired nothing — the false-wake proxy, what the wake word costs.
// The cloud ear's is what it was sent, Parakeet hearing for it or not; a
// local engine's is the line's audio. Read off the `stt` span, settled by
// the turn's decision record; kept locally, a month of days. The Usage
// card draws the cloud ear's day as one line beside the dashboard's
// providers; the LAN dashboard is not told.

export interface EarDay {
  /** Seconds of lines that fired a Command. */
  fired: number
  /** Seconds of lines that fired nothing: a blip, a false wake, a line read as none. */
  nothing: number
}

/** By local day (YYYY-MM-DD), then by engine. */
export type EarTally = Record<string, Record<string, EarDay>>

/** The cloud ear the tally names by what it was sent (ADR 0019 as amended: the one there is). */
export const CLOUD_EAR = 'elevenlabs'

/**
 * Who an `stt` span's line was for (#463): a span carrying `sentMs` is the
 * cloud ear's, whoever heard it; `heard` is the engine whose words it was.
 * Null when the span names no engine.
 */
export function sttLine(detail: Readonly<Record<string, unknown>>): { asked: string; heard: string; sentMs: number | null } | null {
  if (typeof detail.engine !== 'string') return null
  const sentMs = typeof detail.sentMs === 'number' && Number.isFinite(detail.sentMs) && detail.sentMs >= 0 ? detail.sentMs : null
  return { asked: sentMs !== null ? CLOUD_EAR : detail.engine, heard: detail.engine, sentMs }
}

const KEEP_DAYS = 31
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Parse anything (disk) into a tally; malformed days and engines are dropped. */
export function sanitizeEarTally(raw: unknown): EarTally {
  const tally: EarTally = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return tally
  for (const [day, engines] of Object.entries(raw as Record<string, unknown>)) {
    if (!DAY_KEY.test(day) || typeof engines !== 'object' || engines === null) continue
    for (const [engine, value] of Object.entries(engines as Record<string, unknown>)) {
      const record = value as Record<string, unknown> | null
      const fired = seconds(record?.fired)
      const nothing = seconds(record?.nothing)
      if (fired === null || nothing === null) continue
      tally[day] = { ...tally[day], [engine]: { fired, nothing } }
    }
  }
  return tally
}

/** A span as the perf sink writes it: the fields the tally reads. */
export interface EarSpan {
  turnId: string
  stage: string
  at: number
  detail?: Record<string, unknown>
}

export interface EarTallyBook {
  /** An `stt` span: its seconds go under nothing until the turn fires. True when the tally changed. */
  heard(span: EarSpan): boolean
  /** A decision log record: a turn whose Command did something moves its seconds to fired. True when the tally changed. */
  decided(record: { type: string; turnId: string; verb?: string }): boolean
  /** One day's tally, by engine. */
  day(at: number): Readonly<Record<string, EarDay>>
  tally(): EarTally
}

export function createEarTallyBook(initial: EarTally): EarTallyBook {
  let tally: EarTally = { ...initial }
  // The turns heard and not yet fired, oldest first; a turn that never fires stays under nothing.
  const open = new Map<string, { day: string; engine: string; seconds: number }>()

  function prune(today: string): void {
    const cutoff = dayKey(new Date(`${today}T12:00:00`).getTime() - KEEP_DAYS * 86_400_000)
    tally = Object.fromEntries(Object.entries(tally).filter(([day]) => day > cutoff))
  }

  return {
    heard(span) {
      if (span.stage !== 'stt' || span.detail === undefined || span.detail.error !== undefined) return false
      const line = sttLine(span.detail)
      const ms = line?.sentMs ?? seconds(span.detail.totalMs)
      if (line === null || ms === null) return false
      const engine = line.asked
      const day = dayKey(span.at)
      const was = tally[day]?.[engine] ?? { fired: 0, nothing: 0 }
      tally = { ...tally, [day]: { ...tally[day], [engine]: { ...was, nothing: was.nothing + ms / 1000 } } }
      open.set(span.turnId, { day, engine, seconds: ms / 1000 })
      if (open.size > 200) open.delete(open.keys().next().value!)
      prune(day)
      return true
    },
    decided(record) {
      if (record.type !== 'decision' || record.verb === undefined || record.verb === 'none') return false
      const line = open.get(record.turnId)
      if (line === undefined) return false
      open.delete(record.turnId)
      const was = tally[line.day]?.[line.engine]
      if (was === undefined) return false
      tally = { ...tally, [line.day]: { ...tally[line.day], [line.engine]: { fired: was.fired + line.seconds, nothing: Math.max(0, was.nothing - line.seconds) } } }
      return true
    },
    day: (at) => tally[dayKey(at)] ?? {},
    tally: () => tally,
  }
}

/** The Usage card's line for the cloud ear's day; null when it heard nothing. */
export function earLine(day: Readonly<Record<string, EarDay>>): string | null {
  const cloud = day[CLOUD_EAR]
  if (cloud === undefined || cloud.fired + cloud.nothing <= 0) return null
  const minutes = (value: number): string => (value / 60).toFixed(1)
  return `ElevenLabs ear today ${minutes(cloud.fired + cloud.nothing)} min · ${minutes(cloud.nothing)} min fired nothing`
}
