import type { DecisionChoiceQuestion } from '../ports/decisionModel'
import type { MediaFacts } from '../browser/snapshot'
import { firstNumber } from '../timer/duration'

// A Media Op (#372, ADR 0080, CONTEXT.md): an action a media ref carries on
// the action card because of its kind, the way an input carries `type-N`
// and a link `open-N`. Every op the element can take is offered whatever
// its state — mute on a muted element changes nothing, and the next Hop's
// Verdict ends it — and only what it cannot do is withheld: no seek on an
// element with no seekable range, no captions on one with no text track.
// Each op is one evaluate on that element through the browser controller,
// on any site; the Player is untouched. No grammar line: "skip ahead" is
// Jev's to read, and how far is the Amount Choice's.

/** The ops a media ref can carry, in the order the card offers them. */
export const MEDIA_OPS = ['play', 'pause', 'forward', 'back', 'restart', 'volume', 'mute', 'unmute', 'loop', 'unloop', 'rate', 'captions', 'uncaptions'] as const
export type MediaOp = (typeof MEDIA_OPS)[number]

/** The ops that move the position: the Amount Choice is read for these alone. */
const SEEKS: ReadonlySet<MediaOp> = new Set<MediaOp>(['forward', 'back', 'restart'])
const CAPTION_OPS: ReadonlySet<MediaOp> = new Set<MediaOp>(['captions', 'uncaptions'])

/** The Amount's rungs (ADR 0080): how far a seek moves, Jev's to choose; `end` is the start when going back. */
export const AMOUNT_RUNGS = ['words', 'moment', 'little', 'chunk', 'lot', 'half', 'end'] as const
export type AmountRung = (typeof AMOUNT_RUNGS)[number]

/** The share of the length each fraction rung moves. */
const FRACTIONS: Readonly<Record<Exclude<AmountRung, 'words' | 'end'>, number>> = { moment: 1 / 100, little: 1 / 20, chunk: 1 / 10, lot: 1 / 4, half: 1 / 2 }

/** How much `volume-N` moves the volume when the words carry no number, as the Player's louder and quieter do. */
export const VOLUME_STEP = 10
/** How much `rate-N` moves the speed when the words carry no number. */
export const RATE_STEP = 0.25

/** What a Media Op Command carries: the op, and for a seek the rung read and the seconds it came to; for a volume or a rate, the level it sets. */
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

/** Whether an op is a seek: the Amount Choice is read for it. */
export function isSeek(op: MediaOp): boolean {
  return op === 'forward' || op === 'back'
}

/**
 * The ops an element can take, by ability alone (ADR 0080): the seeks
 * only with a seekable range, the captions pair only with text tracks,
 * the rest always — never gated by state.
 */
export function mediaOpsOf(facts: MediaFacts): MediaOp[] {
  return MEDIA_OPS.filter((op) => (SEEKS.has(op) ? facts.seekable !== null : CAPTION_OPS.has(op) ? facts.tracks > 0 : true))
}

/** Each op's line on the action card: a whole action naming the ref by number and what plays in it. */
export function mediaOpDescription(op: MediaOp, ref: number, title: string): string {
  const named = `[${ref}] ${JSON.stringify(title)}`
  switch (op) {
    case 'play':
      return `play ${named}: start it, or carry on playing it`
    case 'pause':
      return `pause ${named}`
    case 'forward':
      return `skip forward in ${named}, the amount Choice saying how far`
    case 'back':
      return `skip back in ${named}, the amount Choice saying how far`
    case 'restart':
      return `play ${named} again from the start`
    case 'volume':
      return `set the volume of ${named}: to the number the words carry (0 to 100), or up or down as they say`
    case 'mute':
      return `mute ${named}`
    case 'unmute':
      return `unmute ${named}`
    case 'loop':
      return `put ${named} on loop, so it repeats`
    case 'unloop':
      return `stop looping ${named}`
    case 'rate':
      return `set the playback speed of ${named}: to the number the words carry (1 is normal), or faster or slower as they say`
    case 'captions':
      return `turn captions (subtitles) on for ${named}`
    case 'uncaptions':
      return `turn captions off for ${named}`
  }
}

/** The Amount Choice (ADR 0080): asked on every ask that offers a media ref, read only when the action is a seek. */
export function amountQuestion(): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'Only when the action skips forward or back in a video or audio: how far? Choose words when the words say how far — a number of seconds, or of minutes; otherwise the share of its length the words mean. Ignored for every other action.',
    options: {
      words: 'as far as the words say: the number they carry, in seconds, or in minutes when they say minutes',
      moment: 'a moment: a hundredth of its length',
      little: 'a little: a twentieth of its length',
      chunk: 'a chunk: a tenth of its length',
      lot: 'a lot: a quarter of its length',
      half: 'half of its length',
      end: 'all the way: to the end, or back to the start',
    },
  }
}

/** A media position as a player shows it: `1:02`, `1:02:03`. */
export function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * A media ref's state as its line carries it (ADR 0080): playing, paused
 * or ended; elapsed/duration, or live; the volume as a percentage, or
 * muted; loop; the speed when not normal; captions off or the language
 * showing, on an element with text tracks; buffering; failed.
 */
export function mediaStateOf(facts: MediaFacts): string {
  const live = !Number.isFinite(facts.duration)
  return [
    facts.ended ? 'ended' : facts.paused ? 'paused' : 'playing',
    live ? `live ${clockOf(facts.currentTime)}` : `${clockOf(facts.currentTime)}/${clockOf(facts.duration)}`,
    facts.muted ? 'muted' : `volume ${Math.round(facts.volume * 100)}%`,
    `loop ${facts.loop ? 'on' : 'off'}`,
    ...(facts.rate !== 1 ? [`speed ${facts.rate}×`] : []),
    ...(facts.tracks > 0 ? [`captions ${facts.captions ?? 'off'}`] : []),
    ...(facts.buffering ? ['buffering'] : []),
    ...(facts.failed ? ['failed'] : []),
  ].join(' ')
}

/** The length a fraction rung is a share of: the duration, or a live stream's seekable window. */
function lengthOf(facts: MediaFacts): number {
  if (Number.isFinite(facts.duration)) return facts.duration
  return facts.seekable === null ? 0 : facts.seekable.end - facts.seekable.start
}

/** The seconds the words name: their number in seconds, or minutes or hours when they say so; "a minute" is one. Null when they name none. */
export function secondsInWords(words: string): number | null {
  const unit = /\bhours?\b/i.test(words) ? 3600 : /\bmin(?:ute)?s?\b/i.test(words) ? 60 : /\bsec(?:ond)?s?\b/i.test(words) ? 1 : null
  const number = firstNumber(words)
  if (number === null) return unit === null ? null : unit
  return number * (unit ?? 1)
}

/**
 * How far a seek moves (ADR 0080): the rung's share of the length — a live
 * stream's seekable window — or the number the words carry; `end` is the
 * way to the end, or back to the start. The rung that was used rides the
 * action, so a `words` rung with no number in the words is told as the
 * `little` it fell back to.
 */
export function seekAmount(rung: AmountRung, op: 'forward' | 'back', facts: MediaFacts, words: string): { rung: AmountRung; seconds: number } {
  if (rung === 'words') {
    const seconds = secondsInWords(words)
    if (seconds !== null) return { rung, seconds }
    return seekAmount('little', op, facts, words)
  }
  if (rung === 'end') {
    const end = facts.seekable?.end ?? (Number.isFinite(facts.duration) ? facts.duration : facts.currentTime)
    const start = facts.seekable?.start ?? 0
    return { rung, seconds: hundredths(Math.max(0, op === 'forward' ? end - facts.currentTime : facts.currentTime - start)) }
  }
  return { rung, seconds: hundredths(lengthOf(facts) * FRACTIONS[rung]) }
}

/** Seconds to the hundredth: a share of a length is no finer than a player shows. */
const hundredths = (seconds: number): number => Math.round(seconds * 100) / 100

const UP = /\b(up|louder|loud|raise|increase|higher|more)\b/i
const DOWN = /\b(down|quieter|quiet|lower|decrease|softer|less|reduce)\b/i
const FASTER = /\b(faster|quicker|speed up|double)\b/i
const SLOWER = /\b(slower|slow|half)\b/i

/** The level `volume-N` sets, 0–100: the number the words carry, else a step up or down as they say; null when they say neither. */
export function volumeTarget(words: string, facts: MediaFacts): number | null {
  const number = firstNumber(words)
  if (number !== null && number >= 0 && number <= 100) return number
  const now = Math.round(facts.volume * 100)
  if (UP.test(words)) return Math.min(100, now + VOLUME_STEP)
  if (DOWN.test(words)) return Math.max(0, now - VOLUME_STEP)
  return null
}

/** The speed `rate-N` sets: the number the words carry (1 is normal, "2x" is double), else a step faster or slower as they say; null when they say neither. */
export function rateTarget(words: string, facts: MediaFacts): number | null {
  const match = /(\d+(?:\.\d+)?)\s*x?\b/i.exec(words)
  if (match !== null) {
    const rate = Number(match[1])
    if (rate > 0 && rate <= 16) return rate
  }
  if (/\bnormal\b/i.test(words)) return 1
  if (/\bdouble\b/i.test(words)) return 2
  if (/\bhalf\b/i.test(words)) return 0.5
  if (FASTER.test(words)) return Math.min(16, facts.rate + RATE_STEP)
  if (SLOWER.test(words)) return Math.max(RATE_STEP, facts.rate - RATE_STEP)
  return null
}

/** Whether two positions differ by more than a player's own tick. */
const moved = (before: number, after: number): boolean => Math.abs(after - before) >= 0.5

/**
 * What changed on a media element between two reads of its facts (#372,
 * ADR 0080), in the words the op's outcome and "Done so far" share:
 * `0:16 → 0:26`, `paused`, `muted`, `loop on`, `volume 100% → 30%`,
 * `speed 1× → 1.5×`, `captions en`. Empty when nothing did.
 */
export function mediaChangesOf(before: MediaFacts, after: MediaFacts): string[] {
  const playing = (facts: MediaFacts): string => (facts.ended ? 'ended' : facts.paused ? 'paused' : 'playing')
  return [
    ...(playing(before) !== playing(after) ? [playing(after)] : []),
    ...(moved(before.currentTime, after.currentTime) ? [`${clockOf(before.currentTime)} → ${clockOf(after.currentTime)}`] : []),
    ...(before.muted !== after.muted ? [after.muted ? 'muted' : 'unmuted'] : []),
    ...(Math.round(before.volume * 100) !== Math.round(after.volume * 100) ? [`volume ${Math.round(before.volume * 100)}% → ${Math.round(after.volume * 100)}%`] : []),
    ...(before.loop !== after.loop ? [`loop ${after.loop ? 'on' : 'off'}`] : []),
    ...(before.rate !== after.rate ? [`speed ${before.rate}× → ${after.rate}×`] : []),
    ...(before.captions !== after.captions ? [`captions ${after.captions ?? 'off'}`] : []),
    ...(before.failed !== after.failed && after.failed ? ['failed'] : []),
  ]
}

/** A Media Op as "Done so far" and the Feed name it: `pause`, `skip forward 10 s`, `set the volume to 30`. */
export function describeMediaOp(action: MediaOpAction): string {
  switch (action.op) {
    case 'forward':
    case 'back':
      return `skip ${action.op} ${action.seconds !== undefined ? `${Math.round(action.seconds)} s` : ''}`.trim()
    case 'volume':
      return `set the volume to ${action.to ?? '?'}`
    case 'rate':
      return `set the speed to ${action.to ?? '?'}×`
    case 'unloop':
      return 'stop looping'
    case 'captions':
      return 'turn captions on'
    case 'uncaptions':
      return 'turn captions off'
    default:
      return action.op
  }
}
