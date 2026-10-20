// Now Playing (#344, CONTEXT.md Idle Screen): what the Player publishes
// for the Idle Screen's card — the song it holds, how far in, whether it
// is paused, looping or ended, and what is queued after it. Null when the
// Player holds no song.

/** How many queued titles the card names. */
export const QUEUED_SHOWN = 3

export interface NowPlaying {
  /** The YouTube video: the card's thumbnail is `i.ytimg.com/vi/<id>/mqdefault.jpg`. */
  readonly id: string
  readonly title: string
  /** The channel, as the watch page names it; '' until read. */
  readonly channel: string
  readonly elapsedS: number
  /** Null until the element knows its length. */
  readonly durationS: number | null
  readonly paused: boolean
  readonly loop: boolean
  /** The element is muted (#365). */
  readonly muted: boolean
  /** The song ran out with nothing queued (owner's ruling 4): it stays on the card, and `play` plays it again. */
  readonly ended: boolean
  /** The next queued titles, at most {@link QUEUED_SHOWN}. Not the Calendar's Up Next. */
  readonly queued: readonly string[]
}

/** `i.ytimg.com`'s medium thumbnail for a video. */
export function thumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

/** A playing time as the card shows it: `3:07`, `1:02:03`. */
export function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const s = String(whole % 60).padStart(2, '0')
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** What the Now Playing card (#365) says of a song. */
export interface NowPlayingView {
  readonly kicker: 'Now playing' | 'Paused' | 'Ended' | 'Starting'
  /** What is on beside the kicker. */
  readonly flags: readonly ('Loop' | 'Muted')[]
  /** How far the bar is filled, 0–1. */
  readonly fraction: number
  readonly elapsed: string
  /** The song's length, a dash while the element does not know it. */
  readonly length: string
  /** The music verb the middle control submits. */
  readonly toggle: 'pause' | 'play'
  /** The middle control's glyph: an ended song's `play` plays it again. */
  readonly glyph: 'pause' | 'play' | 'replay'
  /** The queued titles at the card's foot. */
  readonly next: readonly string[]
  /** Ended: the foot says how to hear it again. */
  readonly again: boolean
  readonly label: string
}

/** The card's words, bar and toggle for a song: playing, paused, ended, or starting while its length is unknown. */
export function nowPlayingView(nowPlaying: NowPlaying): NowPlayingView {
  const { title, channel, elapsedS, durationS, paused, loop, muted, ended, queued } = nowPlaying
  const kicker = ended ? 'Ended' : paused ? 'Paused' : durationS === null ? 'Starting' : 'Now playing'
  const flags: ('Loop' | 'Muted')[] = []
  if (loop) flags.push('Loop')
  if (muted) flags.push('Muted')
  return {
    kicker,
    flags,
    fraction: ended ? 1 : durationS !== null && durationS > 0 ? Math.min(1, elapsedS / durationS) : 0,
    elapsed: clockTime(ended && durationS !== null ? durationS : elapsedS),
    length: durationS === null ? '–:––' : clockTime(durationS),
    toggle: paused || ended ? 'play' : 'pause',
    glyph: ended ? 'replay' : paused ? 'play' : 'pause',
    next: ended ? [] : queued,
    again: ended,
    label: `${kicker}: ${title}${channel !== '' ? ` by ${channel}` : ''}`,
  }
}
