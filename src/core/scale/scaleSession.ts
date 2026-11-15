import { decodeFrame, replyTo, type QnWrite } from './qn'
import type { WeighIn } from './weighIns'

/** A stable reading under this is not a person: a bag, a foot brushing the glass. */
export const MIN_WEIGH_IN_KG = 5

/** One weight the scale showed, for the Weigh-in pop-up. */
export interface ScaleReading {
  kg: number
  stable: boolean
}

/** What one notified frame comes to: the replies to write, the reading it carried, and the Weigh-in it settled, if any. */
export interface ScaleStep {
  writes: QnWrite[]
  reading: ScaleReading | null
  /** Whose it is is the Scale Listener's guess (core/scale/people), not the scale's. */
  weighIn: Omit<WeighIn, 'person'> | null
}

export interface ScaleSession {
  /** A frame the scale notified at `at` (ms). */
  receive(bytes: Uint8Array, at: number): ScaleStep
  /** How long the link may stay silent before the listener lets the scale go. */
  quietMs(): number
}

/**
 * A scale that has sent a reading and then nothing for this long has been
 * left: the owner stepped off, and the link is let go so the next stepping-on
 * connects afresh.
 */
export const QUIET_AFTER_READING_MS = 15_000
/**
 * Before the first reading the scale is waiting for the owner to step on. A
 * 15 s wait here let it go just as the readings came (2026-11-15, #560). The
 * scale drops the link itself when it sleeps; this cap is a guess, and the
 * scale log's records say how long it really holds.
 */
export const WAITING_FOR_READING_MS = 120_000

/**
 * One connection to the scale (CONTEXT.md, Scale Listener): answers its
 * handshake, reads its weight frames with the divisor its info frame named,
 * and records one Weigh-in per stepping-on — the first stable frame of at
 * least 5 kg; its repeats and any later stable frame are ignored until the
 * weight drops under 5 kg (the owner stepped off), when a new stepping-on
 * may begin.
 */
export function createScaleSession(): ScaleSession {
  let divisor: 10 | 100 = 100
  let recorded = false
  let weighing = false
  return {
    quietMs: () => (weighing ? QUIET_AFTER_READING_MS : WAITING_FOR_READING_MS),
    receive(bytes, at) {
      const frame = decodeFrame(bytes, divisor)
      if (frame.kind === 'reading') weighing = true
      if (frame.kind === 'info') divisor = frame.divisor
      const writes = replyTo(frame, at)
      if (frame.kind !== 'reading') return { writes, reading: null, weighIn: null }
      const reading = { kg: frame.kg, stable: frame.stable }
      if (frame.kg < MIN_WEIGH_IN_KG) {
        recorded = false
        return { writes, reading, weighIn: null }
      }
      if (!frame.stable || recorded) return { writes, reading, weighIn: null }
      recorded = true
      return { writes, reading, weighIn: { at, kg: frame.kg, r1: frame.r1, r2: frame.r2 } }
    },
  }
}
