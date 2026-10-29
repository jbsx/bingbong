import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NowPlaying } from '../../core/music/nowPlaying'
import { NowPlayingCard } from './NowPlayingCard'

// Now Playing (#344), a card in the Idle Screen's middle Column (#365),
// rendered from the Player's published state in both its forms.

const SONG: NowPlaying = {
  id: 'fJ9rUzIMcZQ',
  title: 'Bohemian Rhapsody',
  channel: 'Queen Official',
  elapsedS: 62,
  durationS: 355,
  paused: false,
  loop: false,
  muted: false,
  ended: false,
  queued: ['Around the World', 'One More Time', 'Digital Love'],
}
const render = (nowPlaying: NowPlaying, form: 'full' | 'small' = 'full'): string => renderToStaticMarkup(createElement(NowPlayingCard, { nowPlaying, form }))
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('the Now Playing card', () => {
  it('full, playing: the thumbnail, the kicker, the title, the channel, the queue, the bar with both times, and the three controls', () => {
    const html = render(SONG)
    expect(html).toContain('src="https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg"')
    expect(html).toContain('idle-music-card--full')
    expect(html).toContain('idle-music-card--playing')
    expect(text(html)).toContain('Now playing')
    expect(text(html)).toContain('Bohemian Rhapsody')
    expect(text(html)).toContain('Queen Official')
    expect(text(html)).toContain('Next Around the World · One More Time · Digital Love')
    expect(text(html)).toContain('1:02')
    expect(text(html)).toContain('5:55')
    expect(html).toMatch(/style="width:17(\.\d+)?%"/)
    expect(html).toContain('aria-label="Previous"')
    expect(html).toContain('aria-label="Pause"')
    expect(html).toContain('aria-label="Skip"')
    expect(html).not.toMatch(/aria-label="Skip" disabled/)
    expect(text(html)).not.toMatch(/Loop|Muted/)
  })

  it('full, paused: PAUSED, a pause glyph over the picture, play as the toggle', () => {
    const html = render({ ...SONG, paused: true })
    expect(html).toContain('idle-music-card--paused')
    expect(text(html)).toContain('Paused')
    expect(html).toContain('idle-music-cover')
    expect(html).toContain('aria-label="Play"')
  })

  it('full, ended: ENDED, the bar full, the way to hear it again in place of the queue, replay as the toggle', () => {
    const html = render({ ...SONG, ended: true, elapsedS: 354, queued: [] })
    expect(text(html)).toContain('Ended')
    expect(html).toContain('style="width:100%"')
    expect(text(html)).toContain('Say “play” or tap to hear it again')
    expect(html).toContain('aria-label="Play again"')
    // Nothing is queued to skip to: the Skip button greys out (2026-10-21 audit); Previous stays live.
    expect(html).toMatch(/aria-label="Skip" disabled=""/)
    expect(html).not.toMatch(/aria-label="Previous" disabled/)
  })

  it('full, starting: STARTING, a dash for the length, no channel yet', () => {
    const html = render({ ...SONG, elapsedS: 0, durationS: null, channel: '', queued: [] })
    expect(text(html)).toContain('Starting')
    expect(text(html)).toContain('–:––')
    expect(html).not.toContain('idle-music-channel')
  })

  it('a channel the title already holds is not repeated (#502), in either form', () => {
    for (const form of ['full', 'small'] as const) {
      const html = render({ ...SONG, title: 'Queen Official - Bohemian Rhapsody' }, form)
      expect(text(html)).toContain('Queen Official - Bohemian Rhapsody')
      expect(html).not.toContain('idle-music-channel')
      expect(html).toContain('aria-label="Now playing: Queen Official - Bohemian Rhapsody"')
    }
  })

  it('over an ad (#497): neither the title nor the channel, in either form', () => {
    for (const form of ['full', 'small'] as const) {
      const html = render({ ...SONG, ad: { elapsedS: 4, durationS: 30, skippable: false } }, form)
      expect(text(html)).toContain('An ad first')
      expect(html).not.toContain('Bohemian Rhapsody')
      expect(html).not.toContain('Queen Official')
    }
  })

  it('flags LOOP and MUTED beside the kicker while they are on', () => {
    expect(text(render({ ...SONG, loop: true, muted: true }))).toMatch(/Now playing Loop Muted/)
  })

  it('small: the thumbnail, the kicker with the times at its right, the title and its channel on one line, the bar and the three controls — no queue', () => {
    for (const song of [SONG, { ...SONG, paused: true }, { ...SONG, ended: true, queued: [] }]) {
      const html = render(song, 'small')
      expect(html).toContain('idle-music-card--small')
      expect(html).toContain('mqdefault.jpg')
      // The artist is named on either road (#502): after the title, on its line.
      expect(text(html)).toContain('Bohemian Rhapsody · Queen Official')
      expect(html).toContain('song-line--row')
      expect(text(html)).toMatch(/\d:\d\d \/ 5:55/)
      expect(html).not.toContain('idle-music-next')
      expect(html).toContain('aria-label="Previous"')
      expect(html).toContain('aria-label="Skip"')
    }
  })
})
