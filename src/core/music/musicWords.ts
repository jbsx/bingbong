// The Player's exact lines (#343, CONTEXT.md Player): the whole lines the
// CLI grammar settles before anything else, in a millisecond and with Jev
// down. A line with free words — `play <words>`, `queue <words>` — is no
// longer the grammar's (ADR 0079): it goes to Jev, which is offered the
// Player's ops as Capabilities (`capability.ts`) and reads "click play" as
// the page's button. `back` stays browser history and `resume` the Task's
// (ruling 3): music goes back with `previous` and on with a bare `play`.

/** What a music line asks of the Player. A search's words ride beside it as the Command's Slot. */
export type MusicAction =
  /** Search YouTube and play the first video now (`now`), or queue it next (`front`) or last (`end`). */
  | { readonly kind: 'search'; readonly place: 'now' | 'front' | 'end' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'unpause' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'previous' }
  | { readonly kind: 'loop'; readonly on: boolean }
  | { readonly kind: 'restart' }
  /** The element's volume, 0–100. */
  | { readonly kind: 'volume'; readonly to: number }
  | { readonly kind: 'louder' }
  | { readonly kind: 'quieter' }
  | { readonly kind: 'mute'; readonly on: boolean }
  /** Wake the dashboard on the watch page (#344): the one music line that does not keep the Idle Screen up. */
  | { readonly kind: 'show' }
  /** The last `play <words>` picked wrong (#345): the next result of its search (1), or the one before (-1). */
  | { readonly kind: 'correct'; readonly step: 1 | -1 }
  /** The song playing is forgotten: the next `play` of its words searches again (#345). */
  | { readonly kind: 'forget' }

/** A music line: the action, and a search's words as spoken (edge punctuation off). */
export interface MusicLine {
  readonly music: MusicAction
  readonly words: string | null
}

/** The whole lines that are one action, as normalized words. */
const WHOLE_LINES: Readonly<Record<string, MusicAction>> = {
  play: { kind: 'unpause' },
  unpause: { kind: 'unpause' },
  pause: { kind: 'pause' },
  'pause the music': { kind: 'pause' },
  skip: { kind: 'skip' },
  'skip this': { kind: 'skip' },
  'skip this song': { kind: 'skip' },
  next: { kind: 'skip' },
  'next song': { kind: 'skip' },
  'play next': { kind: 'skip' },
  'play the next song': { kind: 'skip' },
  previous: { kind: 'previous' },
  'previous song': { kind: 'previous' },
  'last song': { kind: 'previous' },
  'go back a song': { kind: 'previous' },
  loop: { kind: 'loop', on: true },
  'loop this': { kind: 'loop', on: true },
  'loop this song': { kind: 'loop', on: true },
  'loop on': { kind: 'loop', on: true },
  repeat: { kind: 'loop', on: true },
  'repeat this': { kind: 'loop', on: true },
  'repeat this song': { kind: 'loop', on: true },
  'loop off': { kind: 'loop', on: false },
  'repeat off': { kind: 'loop', on: false },
  'stop looping': { kind: 'loop', on: false },
  'stop repeating': { kind: 'loop', on: false },
  restart: { kind: 'restart' },
  'play from the beginning': { kind: 'restart' },
  'from the beginning': { kind: 'restart' },
  'start over': { kind: 'restart' },
  'from the top': { kind: 'restart' },
  louder: { kind: 'louder' },
  'volume up': { kind: 'louder' },
  quieter: { kind: 'quieter' },
  'volume down': { kind: 'quieter' },
  mute: { kind: 'mute', on: true },
  unmute: { kind: 'mute', on: false },
  'show the video': { kind: 'show' },
  'show me the video': { kind: 'show' },
  'show it': { kind: 'show' },
  'not that one': { kind: 'correct', step: 1 },
  'not this one': { kind: 'correct', step: 1 },
  'next result': { kind: 'correct', step: 1 },
  'the other one': { kind: 'correct', step: 1 },
  'wrong one': { kind: 'correct', step: 1 },
  'wrong song': { kind: 'correct', step: 1 },
  'the one before': { kind: 'correct', step: -1 },
  'forget this song': { kind: 'forget' },
}

/**
 * The whole music lines of more than one word: a partial that is a verb
 * phrase heading one of them ("stop" of "stop looping", "go back" of "go
 * back a song") may yet be music, and is held (Early Fire, #326).
 */
export const MUSIC_PHRASES: readonly string[] = Object.keys(WHOLE_LINES).filter((line) => line.includes(' '))

/** Lower case, apostrophes dropped, letters and digits only, one space between words. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The exact music line the words are, or null for none — never a search:
 * a line with free words is Jev's (ADR 0079). `volume` out of 0–100 is
 * `'invalid'`, for the grammar's error.
 */
export function readMusicLine(line: string): MusicLine | 'invalid' | null {
  const words = normalize(line)
  if (words === '') return null
  const whole = WHOLE_LINES[words]
  if (whole !== undefined) return { music: whole, words: null }
  const volume = /^(?:set the )?volume(?: to)? (\d+)(?: percent)?$/.exec(words)
  if (volume !== null) {
    const to = Number(volume[1])
    return to <= 100 ? { music: { kind: 'volume', to }, words: null } : 'invalid'
  }
  return null
}
