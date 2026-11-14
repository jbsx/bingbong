// The Weigh-in Log (CONTEXT.md): weighin-events.jsonl beside weighins.json,
// one line per change to the Weigh-ins, never rewritten. It is the record;
// weighins.json is the Weigh-ins it replays to, kept for a quick read. A
// recorded Weigh-in carries the scale's own frame as hex, so a decoding fix
// can be checked against what the scale sent. A line that does not parse
// (a write cut short) is skipped and the rest still replay.

import { sanitizeWeighIns, type WeighIn } from './weighIns'

/** The log's line format; a reader skips lines of a version it does not know. */
export const WEIGH_IN_LOG_VERSION = 1

export type WeighInEvent =
  /** A Weigh-in recorded. `frame` is the scale's stable reading frame (hex); `seeded` marks one copied from weighins.json when the log began. */
  | { v: 1; t: number; op: 'add'; weighIn: WeighIn; frame?: string; seeded?: true }
  | { v: 1; t: number; op: 'remove'; at: number }
  /** A Weigh-in given to another Person; `from` is whose it was. */
  | { v: 1; t: number; op: 'move'; at: number; from: string; to: string }
  | { v: 1; t: number; op: 'removePerson'; person: string }

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** One line read; null when it is not a well-formed event of a known version. */
export function parseEvent(line: string): WeighInEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const event = raw as Record<string, unknown> | null
  if (event === null || typeof event !== 'object' || event.v !== WEIGH_IN_LOG_VERSION || !finite(event.t)) return null
  const t = event.t
  switch (event.op) {
    case 'add': {
      const [weighIn] = sanitizeWeighIns({ weighIns: [event.weighIn] })
      if (weighIn === undefined) return null
      return {
        v: 1,
        t,
        op: 'add',
        weighIn,
        ...(typeof event.frame === 'string' && /^([0-9a-f]{2})+$/.test(event.frame) ? { frame: event.frame } : {}),
        ...(event.seeded === true ? { seeded: true as const } : {}),
      }
    }
    case 'remove':
      return finite(event.at) ? { v: 1, t, op: 'remove', at: event.at } : null
    case 'move':
      return finite(event.at) && text(event.from) && text(event.to) ? { v: 1, t, op: 'move', at: event.at, from: event.from, to: event.to } : null
    case 'removePerson':
      return text(event.person) ? { v: 1, t, op: 'removePerson', person: event.person } : null
    default:
      return null
  }
}

/** The log's text read: its well-formed events in order and how many lines were skipped. */
export function parseLog(log: string): { events: WeighInEvent[]; skipped: number } {
  const events: WeighInEvent[] = []
  let skipped = 0
  for (const line of log.split('\n')) {
    if (line.trim() === '') continue
    const event = parseEvent(line)
    if (event === null) skipped += 1
    else events.push(event)
  }
  return { events, skipped }
}

/** One event as its line, newline included. */
export function eventLine(event: WeighInEvent): string {
  return `${JSON.stringify(event)}\n`
}

/** One event applied to the Weigh-ins (oldest first); an add at a time already held is ignored, as weighins.json keeps the first. */
export function applyEvent(weighIns: readonly WeighIn[], event: WeighInEvent): WeighIn[] {
  switch (event.op) {
    case 'add':
      return weighIns.some((weighIn) => weighIn.at === event.weighIn.at) ? [...weighIns] : sanitizeWeighIns({ weighIns: [...weighIns, event.weighIn] })
    case 'remove':
      return weighIns.filter((weighIn) => weighIn.at !== event.at)
    case 'move':
      return weighIns.map((weighIn) => (weighIn.at === event.at ? { ...weighIn, person: event.to } : weighIn))
    case 'removePerson':
      return weighIns.filter((weighIn) => weighIn.person !== event.person)
  }
}

/** The Weigh-ins the events leave, oldest first. */
export function replay(events: readonly WeighInEvent[]): WeighIn[] {
  return events.reduce<WeighIn[]>(applyEvent, [])
}
