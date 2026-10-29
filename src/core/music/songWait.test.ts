import { describe, expect, it } from 'vitest'
import { songWaitAfter, songWaitTick, songWaitWords, waitCardSurface, type SongWait } from './songWait'

const SONG = { id: 'abc', title: 'Bohemian Rhapsody', channel: 'Queen Official' }
const SINCE = 1_000_000

describe('songWaitWords (#507): the one wording of a song’s wait, the card’s and the Capsule’s', () => {
  it('counts the lookup up from its start: "Finding the audio, Ns"', () => {
    const wait: SongWait = { kind: 'lookup', song: SONG, since: SINCE }
    expect(songWaitWords(wait, SINCE)).toBe('Finding the audio, 0s')
    expect(songWaitWords(wait, SINCE + 2_400)).toBe('Finding the audio, 2s')
  })

  it('counts down to the served time once known: "Playing in Ns", never below 1 before it', () => {
    const wait: SongWait = { kind: 'served', song: SONG, since: SINCE, until: SINCE + 6_000 }
    expect(songWaitWords(wait, SINCE + 2_000)).toBe('Playing in 4s')
    expect(songWaitWords(wait, SINCE + 2_001)).toBe('Playing in 4s')
    expect(songWaitWords(wait, SINCE + 5_999)).toBe('Playing in 1s')
  })

  it('past the served time, before the first sound: "Starting, Ns" counting up from it — a count never stands still', () => {
    const wait: SongWait = { kind: 'served', song: SONG, since: SINCE, until: SINCE + 6_000 }
    expect(songWaitWords(wait, SINCE + 6_000)).toBe('Starting, 0s')
    expect(songWaitWords(wait, SINCE + 7_100)).toBe('Starting, 1s')
  })

  it('names the fallback: the watch page instead, its seconds the whole wait’s', () => {
    const wait: SongWait = { kind: 'fallback', song: SONG, since: SINCE }
    expect(songWaitWords(wait, SINCE + 3_500)).toBe('The watch page instead, 3s')
  })
})

describe('the Wait Card’s surface and fold (#507, ruling 1)', () => {
  const wait: SongWait = { kind: 'lookup', song: SONG, since: SINCE }

  it('shows on whatever surface is up: the Idle Screen, over the pane, or over Settings and the Weight page', () => {
    expect(waitCardSurface(wait, true, 'dashboard')).toBe('idle')
    expect(waitCardSurface(wait, false, 'dashboard')).toBe('pane')
    expect(waitCardSurface(wait, false, 'settings')).toBe('dashboard')
    expect(waitCardSurface(null, false, 'dashboard')).toBe('none')
  })

  it('holds the last wait told until its end, and nothing else moves it', () => {
    expect(songWaitAfter(null, { type: 'song_wait', wait })).toEqual(wait)
    expect(songWaitAfter(wait, { type: 'status' })).toEqual(wait)
    expect(songWaitAfter(wait, { type: 'song_wait', wait: null })).toBeNull()
  })
})

describe('songWaitTick (#507): when the words next change, so every surface turns its second at the same instant', () => {
  it('counting up, the next whole second from the start', () => {
    expect(songWaitTick({ kind: 'lookup', song: SONG, since: SINCE }, SINCE + 2_400)).toBe(600)
  })

  it('counting down, the next whole second before the served time', () => {
    expect(songWaitTick({ kind: 'served', song: SONG, since: SINCE, until: SINCE + 6_000 }, SINCE + 2_300)).toBe(700)
  })
})
