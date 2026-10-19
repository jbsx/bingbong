import { normalizeWords } from '../command/command'
import type { Song } from './queue'

// Remembered Songs (#345, CONTEXT.md Player, ADR 0077 amendment): a song
// that stayed is a name that worked. When the pick of a `play <words>`
// plays past the stay threshold with no correction and no `skip`, the
// Slot's words — normalized as the Name Match normalizes them — point at
// its video, and the next `play` of the same words opens it with no
// results page. One video per Slot, the latest stay winning; no fuzzy
// match beyond normalizing, that being the Name Match's job through the
// title, which joins the Learned Terms trimmed of its noise. Pure state:
// the store in main keeps it in a file beside the Learned Terms.

/** How long a pick must play, in seconds, before it counts as having stayed. */
export const STAY_S = 30

/** The ledger's ceiling, the oldest stay evicted: as many as the Learned Terms hold. */
const MAX_REMEMBERED = 500

/** A Learned Term is at most four words (learnedTerms.ts). */
const MAX_TERM_WORDS = 4

export interface RememberedSong {
  /** The Slot, normalized. */
  readonly words: string
  readonly id: string
  readonly title: string
  /** Epoch ms of the stay. */
  readonly at: number
}

export interface RememberedSongs {
  readonly songs: readonly RememberedSong[]
}

export const EMPTY_REMEMBERED_SONGS: RememberedSongs = { songs: [] }

/** Whether a pick played this many seconds has stayed. */
export function stayed(seconds: number): boolean {
  return seconds >= STAY_S
}

/** The video these words were remembered against; null for none. */
export function recallSong(state: RememberedSongs, words: string): Song | null {
  const key = normalizeWords(words)
  const found = state.songs.find((song) => song.words === key)
  return found === undefined ? null : { id: found.id, title: found.title }
}

/** The pick stayed: its words point at it from now on, in place of any video they pointed at before. */
export function rememberSong(state: RememberedSongs, words: string, song: Song, at: number): RememberedSongs {
  const key = normalizeWords(words)
  if (key === '') return state
  const songs = [...state.songs.filter((remembered) => remembered.words !== key), { words: key, id: song.id, title: song.title, at }]
  return { songs: songs.slice(-MAX_REMEMBERED) }
}

/** A correction: these words point at nothing again. */
export function forgetWords(state: RememberedSongs, words: string): RememberedSongs {
  const key = normalizeWords(words)
  return state.songs.some((song) => song.words === key) ? { songs: state.songs.filter((song) => song.words !== key) } : state
}

/** `forget this song`: no words point at this video any more; whether any did. */
export function forgetVideo(state: RememberedSongs, id: string): { songs: RememberedSongs; forgot: boolean } {
  const songs = state.songs.filter((song) => song.id !== id)
  return songs.length === state.songs.length ? { songs: state, forgot: false } : { songs: { songs }, forgot: true }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Anything (the file) as a valid ledger: an entry it cannot vouch for is dropped, never defaulted. */
export function sanitizeRememberedSongs(raw: unknown): RememberedSongs {
  if (!isRecord(raw) || !Array.isArray(raw.songs)) return EMPTY_REMEMBERED_SONGS
  const songs: RememberedSong[] = []
  for (const entry of raw.songs) {
    if (!isRecord(entry)) continue
    const { words, id, title, at } = entry
    if (typeof words !== 'string' || typeof id !== 'string' || typeof title !== 'string' || typeof at !== 'number') continue
    if (words === '' || words !== normalizeWords(words) || !/^[\w-]{11}$/.test(id)) continue
    if (songs.some((song) => song.words === words)) continue
    songs.push({ words, id, title, at })
  }
  return { songs: songs.slice(-MAX_REMEMBERED) }
}

/** The dashes between an artist and a song. */
const DASH_RE = /\s+[-–—]\s+/

/**
 * A song's title as it is said: the bracketed noise (`(Official Video)`,
 * `[unreleased]`), everything past a pipe (`| prod. x`), and a featured
 * or producing credit (`ft. …`, `prod. …`) up to the next dash dropped,
 * and the quotes round it.
 */
export function trimSongTitle(title: string): string {
  return title
    .replace(/\s*[|｜].*$/s, '')
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/(^|\s)(?:ft\.?|feat\.?|featuring|prod\.?(?:\s+by)?)\s+[^-–—]*/gi, ' ')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-–—]+|[\s-–—]+$/g, '')
}

/**
 * What a song that stayed teaches the Learned Terms: its trimmed title,
 * and each side of an artist–song dash, every one that fits a Learned
 * Term's four words — so "play midnight drive" decodes against the song's
 * own spelling without its artist.
 */
export function songTerms(title: string): string[] {
  const parts = trimSongTitle(title)
    .split(DASH_RE)
    .filter((part) => part !== '')
  const candidates = parts.length > 1 ? [parts.join(' '), ...parts] : parts
  const fits = (term: string): boolean => term.split(/\s+/).length <= MAX_TERM_WORDS
  return [...new Set(candidates.filter(fits))]
}
