import { describe, expect, it } from 'vitest'
import { nowPlayingView, songLine, type NowPlaying } from './nowPlaying'

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
      title: 'Bohemian Rhapsody',
      channel: 'Queen Official',
      flags: [],
      fraction: 159 / 369,
      elapsed: '2:39',
      length: '6:09',
      toggle: 'pause',
      glyph: 'pause',
      next: ['Around the World', 'One More Time'],
      state: 'playing',
      cover: null,
      label: 'Now playing: Bohemian Rhapsody by Queen Official',
    })
  })

  it('paused: PAUSED, play as the toggle', () => {
    expect(nowPlayingView({ ...SONG, paused: true })).toMatchObject({ kicker: 'Paused', state: 'paused', cover: 'pause', toggle: 'play', glyph: 'play', label: 'Paused: Bohemian Rhapsody by Queen Official' })
  })

  it('ended: ENDED, the bar full at the song’s length, `play` to hear it again in place of the queue', () => {
    expect(nowPlayingView({ ...SONG, ended: true, paused: false, elapsedS: 368, queued: [] })).toMatchObject({
      kicker: 'Ended',
      fraction: 1,
      elapsed: '6:09',
      toggle: 'play',
      glyph: 'replay',
      next: [],
      state: 'ended',
      cover: 'replay',
    })
  })

  it('starting, the length not yet known: STARTING, an empty bar and a dash for the length', () => {
    expect(nowPlayingView({ ...SONG, elapsedS: 0, durationS: null, channel: '' })).toMatchObject({
      kicker: 'Starting',
      state: 'starting',
      cover: null,
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

describe('nowPlayingView over an ad (#497)', () => {
  it('an ad before the song: STARTING, "An ad first" in the title’s place, the bar and times the ad’s, the song’s title kept off the card', () => {
    const view = nowPlayingView({ ...SONG, elapsedS: 0, durationS: null, ad: { elapsedS: 5, durationS: 120, skippable: false } })
    expect(view).toMatchObject({
      kicker: 'Starting',
      title: 'An ad first',
      state: 'starting',
      cover: null,
      fraction: 5 / 120,
      elapsed: '0:05',
      length: '2:00',
      label: 'An ad first, 0:05 of 2:00',
    })
    expect(JSON.stringify(view)).not.toContain('Bohemian Rhapsody')
    expect(view.channel).toBe('')
  })

  it('an ad whose length is not known yet: a dash for it', () => {
    expect(nowPlayingView({ ...SONG, ad: { elapsedS: 3, durationS: null, skippable: false } })).toMatchObject({ fraction: 0, elapsed: '0:03', length: '–:––', label: 'An ad first, 0:03' })
  })

  it('no ad: the song’s own title', () => {
    expect(nowPlayingView({ ...SONG, ad: null }).title).toBe('Bohemian Rhapsody')
  })
})

describe('songLine (#502): the song named by its title and its channel', () => {
  it('names both', () => {
    expect(songLine({ title: 'Let Down (Remastered)', channel: 'Radiohead' })).toEqual({ title: 'Let Down (Remastered)', channel: 'Radiohead' })
  })

  it('no channel read yet: the title alone', () => {
    expect(songLine({ title: 'Yellow', channel: '' })).toEqual({ title: 'Yellow', channel: '' })
    expect(songLine({ title: 'Yellow', channel: '   ' })).toEqual({ title: 'Yellow', channel: '' })
  })

  it('a channel the title already holds is not repeated, whatever its case and spacing', () => {
    expect(songLine({ title: 'Coldplay - Yellow (Official Video)', channel: 'Coldplay' }).channel).toBe('')
    expect(songLine({ title: 'RADIOHEAD  -  Creep', channel: 'Radio Head' }).channel).toBe('Radio Head')
    expect(songLine({ title: 'radiohead  -  creep', channel: ' Radiohead ' }).channel).toBe('')
  })

  it('a channel found only inside a longer word is still named', () => {
    expect(songLine({ title: 'Fair Weather', channel: 'Air' }).channel).toBe('Air')
    expect(songLine({ title: 'Joey', channel: 'Joe' }).channel).toBe('Joe')
    expect(songLine({ title: 'Air - Sexy Boy', channel: 'Air' }).channel).toBe('')
  })

  it('a channel that only holds the title is still named', () => {
    expect(songLine({ title: 'Yellow', channel: 'Yellow Magic Orchestra' }).channel).toBe('Yellow Magic Orchestra')
  })
})
