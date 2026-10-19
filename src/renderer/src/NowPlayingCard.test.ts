import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NowPlaying } from '../../core/music/nowPlaying'
import type { TimerState } from '../../core/timer/timer'
import { NowPlayingCard } from './NowPlayingCard'

// The Now Playing card (#344, CONTEXT.md Idle Screen), rendered from the
// Player's published state.

const SONG: NowPlaying = {
  id: 'fJ9rUzIMcZQ',
  title: 'Bohemian Rhapsody',
  channel: 'Queen Official',
  elapsedS: 62,
  durationS: 355,
  paused: false,
  loop: false,
  ended: false,
  queued: ['Around the World', 'One More Time', 'Digital Love'],
}
const OFF: TimerState = { status: 'off' }

const render = (nowPlaying: NowPlaying | null, timer: TimerState = OFF): string => renderToStaticMarkup(createElement(NowPlayingCard, { nowPlaying, timer }))
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('the Now Playing card', () => {
  it('shows the thumbnail, the title, the channel, the progress with elapsed and total, and the next three', () => {
    const html = render(SONG)
    expect(html).toContain('src="https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg"')
    expect(text(html)).toContain('Bohemian Rhapsody')
    expect(text(html)).toContain('Queen Official')
    expect(text(html)).toContain('1:02')
    expect(text(html)).toContain('5:55')
    expect(html).toMatch(/style="width:17(\.\d+)?%"/)
    expect(text(html)).toContain('Around the World')
    expect(text(html)).toContain('One More Time')
    expect(text(html)).toContain('Digital Love')
    expect(html).not.toContain('aria-label="paused"')
    expect(html).not.toContain('aria-label="looping"')
  })

  it('shows a loop glyph when looping and a pause glyph when paused', () => {
    expect(render({ ...SONG, loop: true })).toContain('aria-label="looping"')
    expect(render({ ...SONG, paused: true })).toContain('aria-label="paused"')
  })

  it('shows a song that ended as ended, its bar full', () => {
    const html = render({ ...SONG, ended: true, elapsedS: 354, queued: [] })
    expect(text(html)).toMatch(/Ended/)
    expect(html).toContain('style="width:100%"')
  })

  it('is absent with no song', () => {
    expect(render(null)).toBe('')
  })

  it('gives way to a ringing Timer, and stays beside a running one', () => {
    expect(render(SONG, { status: 'ringing', durationMs: 60_000, rangAt: 1 } as TimerState)).toBe('')
    expect(render(SONG, { status: 'running', durationMs: 60_000, endsAt: 2 } as TimerState)).not.toBe('')
  })
})
