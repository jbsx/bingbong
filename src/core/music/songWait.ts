// A song's wait before it sounds (#507): the audio road's lookup, its
// stream's served time, or the watch page opened instead. The Player says
// when each began and, once known, when the stream is served; the Wait
// Card and the Status Capsule read these words and this clock alone, so
// they never show two counts (ui.md 2, 9; ruling 3 on #507).

/** A song as a wait names it: what the Wait Card shows — its picture by id, its title and channel. */
export interface WaitingSong {
  readonly id: string
  readonly title: string
  readonly channel?: string
}

/** The song a played search will pick, named by the words asked until it does: no picture, no channel yet. */
export interface AskedSong {
  readonly title: string
}

/**
 * The wait a song is in: `lookup` while its stream is looked up — from the
 * Command firing, the song first named by the words searched (`AskedSong`)
 * until the search picks it, the Receipt's (#507 review) — `served`
 * once the lookup said when YouTube serves it (`until`, wall-clock ms),
 * `fallback` while its watch page opens instead. `since` (wall-clock ms) is
 * when the wait began; every kind of one song's wait keeps it.
 */
export type SongWait =
  | { readonly kind: 'lookup'; readonly song: WaitingSong | AskedSong; readonly since: number }
  | { readonly kind: 'fallback'; readonly song: WaitingSong; readonly since: number }
  | { readonly kind: 'served'; readonly song: WaitingSong; readonly since: number; readonly until: number }

/** The video a wait is for, by id: null while the search has only the words asked. */
export const waitedFor = (song: WaitingSong | AskedSong): string | null => ('id' in song ? song.id : null)

const up = (from: number, now: number): number => Math.floor(Math.max(0, now - from) / 1000)

/**
 * The wait in words with its seconds: "Finding the audio, 2s" counting up,
 * "Playing in 4s" counting down to the served time — then "Starting, 0s"
 * counting up from it until the first sound, since a count that stands
 * still reads as frozen — or "The watch page instead, 3s".
 */
export function songWaitWords(wait: SongWait, now: number): string {
  const { words, count } = songWaitParts(wait, now)
  return `${words} ${count}`
}

/** {@link songWaitWords} in its two parts: the words, which a short line may cut, and the count, which it never does (#462). */
export function songWaitParts(wait: SongWait, now: number): { words: string; count: string } {
  switch (wait.kind) {
    case 'lookup':
      return { words: 'Finding the audio,', count: `${up(wait.since, now)}s` }
    case 'fallback':
      return { words: 'The watch page instead,', count: `${up(wait.since, now)}s` }
    case 'served':
      return now < wait.until ? { words: 'Playing in', count: `${Math.ceil((wait.until - now) / 1000)}s` } : { words: 'Starting,', count: `${up(wait.until, now)}s` }
  }
}

/**
 * Where the Wait Card draws (#507, ruling 1): on whatever surface is up —
 * the Idle Screen's own DOM; over the browsing pane, its own view (renderer
 * DOM cannot composite above the pane); over Settings or the Weight page,
 * the dashboard's DOM, no native view covering it.
 */
export type WaitCardSurface = 'none' | 'idle' | 'pane' | 'dashboard'

export function waitCardSurface(wait: SongWait | null, idle: boolean, view: 'dashboard' | 'settings' | 'weight'): WaitCardSurface {
  if (wait === null) return 'none'
  if (idle) return 'idle'
  return view === 'dashboard' ? 'pane' : 'dashboard'
}

/** The Wait Card's fold (#507): the last `song_wait` the Player told, null once it ended. */
export function songWaitAfter(last: SongWait | null, event: { type: string; wait?: SongWait | null }): SongWait | null {
  return event.type === 'song_wait' ? (event.wait ?? null) : last
}

/** Milliseconds until {@link songWaitWords} next changes: each surface ticks on it, so all turn their second together. */
export function songWaitTick(wait: SongWait, now: number): number {
  const from = wait.kind === 'served' ? wait.until : wait.since
  const into = (((now - from) % 1000) + 1000) % 1000
  return 1000 - into
}
