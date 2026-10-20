import { describe, expect, it } from 'vitest'
import { nowPlayingView, type NowPlaying } from './nowPlaying'

// What the Now Playing card (#365) says of the Player's state: its kicker,
// flags, bar, times, the one control that toggles, and its foot.

const SONG: NowPlaying = {
  id: 'fJ9rUzIMcZQ',
  title: 'Bohemian Rhapsody',
  channel: 'Queen Official',
  elapsedS: 159,
  durationS: 369,
  paused: false,
  loop: false,
  muted: false,
  ended: false,
  queued: ['Around the World', 'One More Time'],
}

describe('nowPlayingView', () => {
  it('playing: NOW PLAYING, the bar as far as the song has run, both times, pause as the toggle, the queue after it', () => {
    expect(nowPlayingView(SONG)).toEqual({
      kicker: 'Now playing',
      flags: [],
      fraction: 159 / 369,
      elapsed: '2:39',
      length: '6:09',
      toggle: 'pause',
      glyph: 'pause',
      next: ['Around the World', 'One More Time'],
      again: false,
      label: 'Now playing: Bohemian Rhapsody by Queen Official',
    })
  })

  it('paused: PAUSED, play as the toggle', () => {
    expect(nowPlayingView({ ...SONG, paused: true })).toMatchObject({ kicker: 'Paused', toggle: 'play', glyph: 'play', label: 'Paused: Bohemian Rhapsody by Queen Official' })
  })

  it('ended: ENDED, the bar full at the song’s length, `play` to hear it again in place of the queue', () => {
    expect(nowPlayingView({ ...SONG, ended: true, paused: false, elapsedS: 368, queued: [] })).toMatchObject({
      kicker: 'Ended',
      fraction: 1,
      elapsed: '6:09',
      toggle: 'play',
      glyph: 'replay',
      next: [],
      again: true,
    })
  })

  it('starting, the length not yet known: STARTING, an empty bar and a dash for the length', () => {
    expect(nowPlayingView({ ...SONG, elapsedS: 0, durationS: null, channel: '' })).toMatchObject({
      kicker: 'Starting',
      fraction: 0,
      elapsed: '0:00',
      length: '–:––',
      label: 'Starting: Bohemian Rhapsody',
    })
  })

  it('flags LOOP and MUTED while they are on', () => {
    expect(nowPlayingView({ ...SONG, loop: true }).flags).toEqual(['Loop'])
    expect(nowPlayingView({ ...SONG, muted: true }).flags).toEqual(['Muted'])
    expect(nowPlayingView({ ...SONG, loop: true, muted: true }).flags).toEqual(['Loop', 'Muted'])
  })
})
