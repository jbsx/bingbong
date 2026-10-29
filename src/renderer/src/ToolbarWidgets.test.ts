import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NowPlaying } from '../../core/music/nowPlaying'
import { ToolbarWidgets } from './ToolbarWidgets'

// The Toolbar's song widget (#502): the song Now Playing named by its title
// and its channel beside the pane, whichever road it plays on.

const SONG: NowPlaying = {
  id: 'ddddddddddd',
  title: 'Let Down (Remastered)',
  channel: 'Radiohead',
  elapsedS: 12,
  durationS: 299,
  paused: false,
  loop: false,
  muted: false,
  ended: false,
  queued: [],
}
const render = (nowPlaying: NowPlaying): string => renderToStaticMarkup(createElement(ToolbarWidgets, { timer: { status: 'off' }, nowPlaying }))
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

describe('the Toolbar’s song widget', () => {
  it('names the title and the channel on one line, the channel after a dot', () => {
    const html = render(SONG)
    expect(text(html)).toBe('Let Down (Remastered) · Radiohead')
    expect(html).toContain('<span class="song-line-title toolbar-song-title">Let Down (Remastered)</span>')
    expect(html).toContain('<span class="song-line-channel toolbar-song-channel">Radiohead</span>')
    expect(html).toContain('aria-label="Now playing: Let Down (Remastered) · Radiohead"')
  })

  it('the title alone while no channel is read, or when the title holds it', () => {
    expect(text(render({ ...SONG, channel: '' }))).toBe('Let Down (Remastered)')
    const held = render({ ...SONG, title: 'Radiohead - Let Down', channel: 'radiohead' })
    expect(text(held)).toBe('Radiohead - Let Down')
    expect(held).not.toContain('toolbar-song-channel')
  })

  it('over an ad (#497): the wait’s words, no channel', () => {
    const html = render({ ...SONG, ad: { elapsedS: 3, durationS: null, skippable: false } })
    expect(text(html)).toBe('An ad first')
    expect(html).not.toContain('Radiohead')
  })

  it('paused, the line keeps both and says so in its name', () => {
    expect(render({ ...SONG, paused: true })).toContain('aria-label="Now playing: Let Down (Remastered) · Radiohead, paused"')
  })
})
