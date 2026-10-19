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
  weighIn: WeighIn | null
}

export interface ScaleSession {
  /** A frame the scale notified at `at` (ms). */
  receive(bytes: Uint8Array, at: number): ScaleStep
}

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
  return {
    receive(bytes, at) {
      const frame = decodeFrame(bytes, divisor)
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
