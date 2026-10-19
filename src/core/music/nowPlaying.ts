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
