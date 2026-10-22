import type { DecisionChoiceQuestion } from '../ports/decisionModel'
import type { MediaFacts } from '../browser/snapshot'
import { MEDIA_OPS, isSeek, type AmountRung, type MediaOp, type MediaOpAction } from '../browser/mediaOp'
import { firstNumber } from '../timer/duration'

export { AMOUNT_RUNGS, MEDIA_OPS, isMediaOp, isSeek, type AmountRung, type MediaOp, type MediaOpAction } from '../browser/mediaOp'

// A Media Op (#372, ADR 0080, CONTEXT.md): an action a media ref carries on
// the action card because of its kind, the way an input carries `type-N`
// and a link `open-N`. Every op the element can take is offered whatever
// its state — mute on a muted element changes nothing — and only what it
// cannot do is withheld: no seek on an element with no seekable range, no
// captions on one with no text track. Each op is one evaluate on that
// element through the browser controller, on any site; the Player is
// untouched. No grammar line: "skip ahead" is Jev's to read, and how far
// is the Amount Choice's.

/** The ops that need a seekable range: withheld, by ability alone, on an element with none. */
const NEEDS_SEEKABLE: ReadonlySet<MediaOp> = new Set<MediaOp>(['forward', 'back', 'restart'])
/** The ops that need text tracks. */
const NEEDS_TRACKS: ReadonlySet<MediaOp> = new Set<MediaOp>(['captions', 'uncaptions'])

/** The share of the length each fraction rung moves. */
const FRACTIONS: Readonly<Record<Exclude<AmountRung, 'words' | 'end'>, number>> = { moment: 1 / 100, little: 1 / 20, chunk: 1 / 10, lot: 1 / 4, half: 1 / 2 }

/** How much `volume-N` moves the volume when the words carry no number, as the Player's louder and quieter do. */
export const VOLUME_STEP = 10
/** How much `rate-N` moves the speed when the words carry no number. */
export const RATE_STEP = 0.25

/**
 * The ops an element can take, by ability alone (ADR 0080): the seeks
 * only with a seekable range, the captions pair only with text tracks,
 * the rest always — never gated by state.
 */
export function mediaOpsOf(facts: MediaFacts): MediaOp[] {
  return MEDIA_OPS.filter((op) => (NEEDS_SEEKABLE.has(op) ? facts.seekable !== null : NEEDS_TRACKS.has(op) ? facts.tracks > 0 : true))
}

/**
 * Each op in words, one row: its line on the action card (the ref it acts
 * on filled in), how "Done so far" and the Feed name it done, and the
 * Answer it leaves. A seek, a volume and a rate carry their number too.
 */
interface OpWords {
  readonly card: (named: string) => string
  readonly done: string
  readonly answer: string
}

const OP_WORDS: Readonly<Record<MediaOp, OpWords>> = {
  play: { card: (named) => `play ${named}: start it, or carry on playing it`, done: 'play', answer: 'Playing.' },
  pause: { card: (named) => `pause ${named}`, done: 'pause', answer: 'Paused.' },
  // "by a length of time" is what tells "go back a minute" from the browser's `back` (measured 2026-10-21: 0.62–0.65 → 0.85–0.89 on the fixture page, 0.63–0.65 → 0.83–0.89 on the YouTube ask).
  forward: { card: (named) => `go forward in ${named} by a length of time, the amount Choice saying how far`, done: 'skip forward', answer: 'Skipped forward' },
  back: { card: (named) => `go back in ${named} by a length of time, the amount Choice saying how far`, done: 'skip back', answer: 'Skipped back' },
  restart: { card: (named) => `play ${named} again from the start`, done: 'restart', answer: 'Restarted.' },
  volume: { card: (named) => `set the volume of ${named}: to the number the words carry (0 to 100), or up or down as they say`, done: 'set the volume to', answer: 'Volume' },
  mute: { card: (named) => `mute ${named}`, done: 'mute', answer: 'Muted.' },
  unmute: { card: (named) => `unmute ${named}`, done: 'unmute', answer: 'Unmuted.' },
  loop: { card: (named) => `put ${named} on loop, so it repeats`, done: 'loop', answer: 'Looping.' },
  unloop: { card: (named) => `stop looping ${named}`, done: 'stop looping', answer: 'Loop off.' },
  rate: { card: (named) => `set the playback speed of ${named}: to the number the words carry (1 is normal), or faster or slower as they say`, done: 'set the speed to', answer: 'Speed' },
  captions: { card: (named) => `turn captions (subtitles) on for ${named}`, done: 'turn captions on', answer: 'Captions on.' },
  uncaptions: { card: (named) => `turn captions off for ${named}`, done: 'turn captions off', answer: 'Captions off.' },
}

/** Each op's line on the action card: a whole action naming the ref by number and what plays in it. */
export function mediaOpDescription(op: MediaOp, ref: number, title: string): string {
  return OP_WORDS[op].card(`[${ref}] ${JSON.stringify(title)}`)
}

/** The number an action carries, in its words: ` 10 s` for a seek, ` 30` for a volume, ` 1.5×` for a speed; nothing for the rest. */
function numberOf(action: MediaOpAction): string {
  if (isSeek(action.op)) return action.seconds !== undefined ? ` ${Math.round(action.seconds)} s` : ''
  if (action.op === 'volume') return ` ${action.to ?? '?'}`
  if (action.op === 'rate') return ` ${action.to ?? '?'}×`
  return ''
}

/** A Media Op as "Done so far" and the Feed name it: `pause`, `skip forward 10 s`, `set the volume to 30`. */
export function describeMediaOp(action: MediaOpAction): string {
  return `${OP_WORDS[action.op].done}${numberOf(action)}`
}

/** A Media Op's Answer (#333, #372): what it did; a seek says where it came to; one that changed nothing (an empty list of changes) says so. */
export function mediaOpAnswer(action: MediaOpAction, changes: readonly string[] | undefined): string {
  const words = OP_WORDS[action.op].answer
  const sentence = ((): string => {
    if (isSeek(action.op)) {
      const to = changes?.map((change) => /→ (\S+)$/.exec(change)?.[1]).find((at) => at !== undefined)
      return `${words}${numberOf(action)}${to !== undefined ? `, to ${to}` : ''}.`
    }
    return action.op === 'volume' || action.op === 'rate' ? `${words}${numberOf(action)}.` : words
  })()
  return changes !== undefined && changes.length === 0 ? `${sentence} Nothing changed: it was already.` : sentence
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

/** playing, paused or ended: the one word the state line and a change both use. */
const playingOf = (facts: MediaFacts): string => (facts.ended ? 'ended' : facts.paused ? 'paused' : 'playing')
/** The volume as a percentage. */
const percentOf = (facts: MediaFacts): number => Math.round(facts.volume * 100)
const loopOf = (facts: MediaFacts): string => `loop ${facts.loop ? 'on' : 'off'}`
/** The captions as the line tells them: the language showing, off when every track is disabled; nothing for a hidden track, on at one player and off at another (#389). */
const captionsOf = (facts: MediaFacts): string[] => (facts.captions !== null ? [`captions ${facts.captions}`] : facts.hiddenTrack ? [] : ['captions off'])

/**
 * A media ref's state as its line carries it (ADR 0080): playing, paused
 * or ended; elapsed/duration, or live; the volume as a percentage, or
 * muted; loop; the speed when not normal; captions off or the language
 * showing, on an element with text tracks, none for a hidden track;
 * buffering; failed.
 */
export function mediaStateOf(facts: MediaFacts): string {
  const live = !Number.isFinite(facts.duration)
  return [
    playingOf(facts),
    live ? `live ${clockOf(facts.currentTime)}` : `${clockOf(facts.currentTime)}/${clockOf(facts.duration)}`,
    facts.muted ? 'muted' : `volume ${percentOf(facts)}%`,
    loopOf(facts),
    ...(facts.rate !== 1 ? [`speed ${facts.rate}×`] : []),
    ...(facts.tracks > 0 ? captionsOf(facts) : []),
    ...(facts.buffering ? ['buffering'] : []),
    ...(facts.failed ? ['failed'] : []),
  ].join(' ')
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
  return [
    ...(playingOf(before) !== playingOf(after) ? [playingOf(after)] : []),
    ...(moved(before.currentTime, after.currentTime) ? [`${clockOf(before.currentTime)} → ${clockOf(after.currentTime)}`] : []),
    ...(before.muted !== after.muted ? [after.muted ? 'muted' : 'unmuted'] : []),
    ...(percentOf(before) !== percentOf(after) ? [`volume ${percentOf(before)}% → ${percentOf(after)}%`] : []),
    ...(before.loop !== after.loop ? [loopOf(after)] : []),
    ...(before.rate !== after.rate ? [`speed ${before.rate}× → ${after.rate}×`] : []),
    ...(captionsOf(before).join() !== captionsOf(after).join() ? captionsOf(after) : []),
    ...(before.failed !== after.failed && after.failed ? ['failed'] : []),
  ]
}

/** The length a fraction rung is a share of: the duration, or a live stream's seekable window. */
function lengthOf(facts: MediaFacts): number {
  if (Number.isFinite(facts.duration)) return facts.duration
  return facts.seekable === null ? 0 : facts.seekable.end - facts.seekable.start
}

const UNITS: Readonly<Record<string, number>> = { hour: 3600, hours: 3600, hr: 3600, hrs: 3600, minute: 60, minutes: 60, min: 60, mins: 60, second: 1, seconds: 1, sec: 1, secs: 1 }

/**
 * The seconds the words name: each number with the unit after it, summed
 * ("1 minute 30 seconds" is 90; "a minute" is one); a number with no unit
 * is seconds. Null when they name none.
 */
export function secondsInWords(words: string): number | null {
  const tokens = words.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter((token) => token !== '')
  let total: number | null = null
  let lastUnitAt = -1
  for (const [index, token] of tokens.entries()) {
    const unit = UNITS[token]
    if (unit === undefined) continue
    // The number is the words between the unit before and this one: up to three, so "twenty five minutes" reads as one.
    const before = tokens.slice(Math.max(lastUnitAt + 1, index - 3), index)
    lastUnitAt = index
    const number = firstNumber(before.join(' ')) ?? (before.at(-1) === 'a' || before.at(-1) === 'an' ? 1 : null)
    if (number === null) continue
    total = (total ?? 0) + number * unit
  }
  return total ?? firstNumber(words)
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
const FASTER = /\b(faster|quicker|speed (?:it |things )?up|double)\b/i
const SLOWER = /\b(slower|slow|half)\b/i

/** The level `volume-N` sets, 0–100: the number the words carry — by that much up or down when they say "by" — else a step up or down as they say; null when they say neither. */
export function volumeTarget(words: string, facts: MediaFacts): number | null {
  const number = firstNumber(words)
  const direction = UP.test(words) ? 1 : DOWN.test(words) ? -1 : 0
  const by = number !== null && direction !== 0 && /\bby\b/i.test(words)
  if (number !== null && number >= 0 && number <= 100 && !by) return number
  if (direction === 0) return null
  return Math.max(0, Math.min(100, percentOf(facts) + direction * (by ? number : VOLUME_STEP)))
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
