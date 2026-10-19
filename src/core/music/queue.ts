// The Queue (CONTEXT.md, #343): one queue, the Player's — the song playing,
// the songs queued after it and the songs played before it, whether it is
// paused and whether it loops. Pure state: the Player in main keeps it in
// step with the watch page's video, and nothing here touches a page. Not
// kept across a restart, as the Timer is not.

/** A YouTube video the Player can open: its id and the title it was found under. */
export interface Song {
  readonly id: string
  readonly title: string
}

export interface Queue {
  /** The song playing, or paused; null when nothing is, or the queue ran out. */
  readonly current: Song | null
  /** The songs queued after it, next first. */
  readonly upNext: readonly Song[]
  /** The songs played before it, the last one last: what `previous` returns to. */
  readonly played: readonly Song[]
  /** The current song loops: the element's `loop` flag, which a new song clears. */
  readonly loop: boolean
  readonly paused: boolean
}

export const EMPTY_QUEUE: Queue = { current: null, upNext: [], played: [], loop: false, paused: false }

/** The songs before, with the current one played. */
function playedWith(queue: Queue): readonly Song[] {
  return queue.current === null ? queue.played : [...queue.played, queue.current]
}

/** `play <words>`: the song plays now in place of the current one; the queue is kept. */
export function playNow(queue: Queue, song: Song): Queue {
  return { current: song, upNext: queue.upNext, played: playedWith(queue), loop: false, paused: false }
}

/**
 * `queue <words>` (`end`) or `play <words> next` (`front`): the song joins
 * the queue without interrupting the one playing — and plays now when
 * nothing is. `position` is where it sits, 1 the next.
 */
export function enqueue(queue: Queue, song: Song, place: 'end' | 'front'): { queue: Queue; position: number; playsNow: boolean } {
  if (queue.current === null) return { queue: playNow(queue, song), position: 0, playsNow: true }
  const upNext = place === 'front' ? [song, ...queue.upNext] : [...queue.upNext, song]
  return { queue: { ...queue, upNext }, position: place === 'front' ? 1 : upNext.length, playsNow: false }
}

/**
 * `skip`, or the song's end: the next queued song plays; with none queued
 * the Player stops — nothing is current, and nothing else plays (no
 * YouTube autoplay, owner's ruling 4).
 */
export function advance(queue: Queue): { queue: Queue; next: Song | null } {
  const [next, ...rest] = queue.upNext
  if (next === undefined) return { queue: { ...queue, current: null, played: playedWith(queue), loop: false, paused: false }, next: null }
  return { queue: { current: next, upNext: rest, played: playedWith(queue), loop: false, paused: false }, next }
}

/** `previous`: the song before plays again, the current one queued next; null when nothing was played before. */
export function previous(queue: Queue): { queue: Queue; song: Song | null } {
  const song = queue.played.at(-1)
  if (song === undefined) return { queue, song: null }
  const upNext = queue.current === null ? queue.upNext : [queue.current, ...queue.upNext]
  return { queue: { current: song, upNext, played: queue.played.slice(0, -1), loop: false, paused: false }, song }
}

/** `play` once the queue ran out (#344): the song that ended plays again from the start, taken back off the songs played. */
export function replay(queue: Queue, song: Song): Queue {
  const played = queue.played.at(-1)?.id === song.id ? queue.played.slice(0, -1) : queue.played
  return { current: song, upNext: queue.upNext, played, loop: false, paused: false }
}

/** A correction (#345): the song plays in the wrong pick's place, which is not counted as played. */
export function replaceCurrent(queue: Queue, song: Song): Queue {
  return { ...queue, current: song, loop: false, paused: false }
}

export function pause(queue: Queue): Queue {
  return { ...queue, paused: true }
}

export function unpause(queue: Queue): Queue {
  return { ...queue, paused: false }
}

export function setLoop(queue: Queue, loop: boolean): Queue {
  return { ...queue, loop }
}

/** Where a queued song sits, as its Answer says it: "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(position: number): string {
  const tens = position % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][position % 10] ?? 'th')
  return `${position}${suffix}`
}

/** The current song failed to open: it is dropped, never played, and never returned to. */
export function dropCurrent(queue: Queue): Queue {
  return { ...queue, current: null, loop: false, paused: false }
}
