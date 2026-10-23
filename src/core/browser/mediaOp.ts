// A Media Op's shape (#372, ADR 0080): what the browser port fires on a
// media ref's own element and the Action Outcome heads name. The card that
// offers the ops and reads them lives in core/command/mediaOp.ts; this is
// the part the browser side depends on, so no port points inward.

/** The ops a media ref can carry, in the order the card offers them. */
export const MEDIA_OPS = ['play', 'pause', 'forward', 'back', 'restart', 'volume', 'mute', 'unmute', 'loop', 'unloop', 'rate', 'captions', 'uncaptions'] as const
export type MediaOp = (typeof MEDIA_OPS)[number]

/** The Amount's rungs (ADR 0080): how far a seek moves, Jev's to choose; `end` is the start when going back. */
export const AMOUNT_RUNGS = ['words', 'moment', 'little', 'chunk', 'lot', 'half', 'end'] as const
export type AmountRung = (typeof AMOUNT_RUNGS)[number]

/**
 * The Amount's rungs for a volume or a speed (ADR 0080 as amended by
 * #408): `to` the level the words carry, else up or down and how far —
 * the direction Jev's, never a word list's.
 */
export const LEVEL_RUNGS = ['to', 'up-little', 'up-step', 'up-lot', 'up-all', 'down-little', 'down-step', 'down-lot', 'down-all'] as const
export type LevelRung = (typeof LEVEL_RUNGS)[number]

/** What a Media Op Command carries: the op; for a seek the rung read and the seconds it came to; for a volume or a rate, the level it sets. */
export interface MediaOpAction {
  readonly op: MediaOp
  readonly rung?: AmountRung
  readonly seconds?: number
  readonly to?: number
}

/** Whether a card label is a Media Op's. */
export function isMediaOp(label: string): label is MediaOp {
  return (MEDIA_OPS as readonly string[]).includes(label)
}

/** Whether an op moves the position by an Amount: the Amount Choice is read for these alone. */
export function isSeek(op: MediaOp): op is 'forward' | 'back' {
  return op === 'forward' || op === 'back'
}
