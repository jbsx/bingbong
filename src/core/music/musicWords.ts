// The Player's lines (#343, CONTEXT.md Player): what a typed or spoken line
// asks of the music. Grammar-only, like `timer` (owner's ruling 1): the CLI
// grammar reads them before anything else, so Jev is never offered them,
// and "click play" or "press play" stay the page's button. `back` stays
// browser history and `resume` the Task's (ruling 3): music goes back with
// `previous` and on with a bare `play`.

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
}

/**
 * The whole music lines of more than one word: a partial that is a verb
 * phrase heading one of them ("stop" of "stop looping", "go back" of "go
 * back a song") may yet be music, and is held (Early Fire, #326).
 */
export const MUSIC_PHRASES: readonly string[] = Object.keys(WHOLE_LINES).filter((line) => line.includes(' '))

/** The words that open a search, and where its song goes. */
const SEARCH_HEADS: readonly (readonly [string, 'now' | 'end'])[] = [
  ['play', 'now'],
  ['queue up', 'end'],
  ['queue', 'end'],
  ['add', 'end'],
]

/** What a queued search's words may end with that is not the song: "add X to the queue". */
const QUEUE_TAIL_RE = /\s+to (?:the |my )?queue$/i

/** Lower case, apostrophes dropped, letters and digits only, one space between words. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The line's words past its first `count`, as spoken, the edge punctuation off. */
function wordsPast(line: string, count: number): string {
  return line
    .trim()
    .split(/\s+/)
    .slice(count)
    .join(' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/**
 * The music line the words are, or null for none. `volume` out of 0–100
 * is `'invalid'`, for the grammar's error. "add to …" is the page's ("add to
 * cart"), not a search.
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
  for (const [head, place] of SEARCH_HEADS) {
    if (!words.startsWith(`${head} `)) continue
    const rest = words.slice(head.length + 1)
    if (head === 'add' && /^to\b/.test(rest)) return null
    let spoken = wordsPast(line, head.split(' ').length)
    let at: 'now' | 'front' | 'end' = place
    if (place === 'now' && / next$/.test(rest) && rest !== 'next') {
      spoken = spoken.replace(/\s+next[^\p{L}\p{N}]*$/iu, '')
      at = 'front'
    }
    if (place === 'end') spoken = spoken.replace(QUEUE_TAIL_RE, '')
    return spoken === '' ? null : { music: { kind: 'search', place: at }, words: spoken }
  }
  return null
}
