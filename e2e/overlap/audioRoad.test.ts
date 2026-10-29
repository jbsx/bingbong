import { describe, expect, it } from 'vitest'
import { isAudioSurfaceUrl, readRoads, roadSettings, withRoad } from './audioRoad'
import { checkEnd, type EndState } from './checks'

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><meta charset="utf-8"><title></title><div id="movie_player"><audio preload="auto"></audio></div>')}`
const pane = { url: 'https://duckduckgo.com/?q=radiohead+tour+dates', title: 'radiohead tour dates at DuckDuckGo', text: 'Radiohead tour dates 2026', media: [] }
const song = { playing: true, src: 'https://rr2---sn-cu.googlevideo.com/videoplayback?id=1', position: 12, volume: 1, loop: false }

describe('the road a gate run takes (#509)', () => {
  it('is written into every fresh profile, off as plainly as on: no run reads the default', () => {
    expect(JSON.parse(roadSettings('audio'))).toEqual({ audioOnlyMusic: true })
    expect(JSON.parse(roadSettings('pane'))).toEqual({ audioOnlyMusic: false })
  })

  it('is the audio road unless --road names the pane or both', () => {
    expect(readRoads(undefined)).toEqual(['audio'])
    expect(readRoads('pane')).toEqual(['pane'])
    expect(readRoads('both')).toEqual(['pane', 'audio'])
    expect(readRoads('road')).toBe('--road is pane, audio or both')
  })
})

describe('the overlap gate on the audio road', () => {
  it('knows the audio surface by its page, and nothing else', () => {
    expect(isAudioSurfaceUrl(PAGE)).toBe(true)
    expect(isAudioSurfaceUrl('https://duckduckgo.com/')).toBe(false)
    expect(isAudioSurfaceUrl('data:text/html,<p>hello</p>')).toBe(false)
  })

  it('takes the surface’s media after the pane’s, each named by the song, and the Now Playing title into view', () => {
    const read = withRoad(pane, { title: 'Radiohead - Let Down', media: [song] }, ' Radiohead - Let Down ')
    expect(read.media).toEqual([{ ...song, title: 'Radiohead - Let Down' }])
    expect(read.text).toBe('Radiohead tour dates 2026 Radiohead - Let Down')
    expect(read.url).toBe(pane.url)
  })

  it('leaves the pane’s read as it was with no road read', () => {
    expect(withRoad(pane, undefined, undefined)).toEqual(pane)
    expect(withRoad(pane, undefined, '')).toEqual(pane)
  })

  it('a song on the road is what a person hears: playing, and named by its own title, not the pane’s', async () => {
    const read = withRoad(pane, { title: 'Radiohead - Let Down', media: [song] }, 'Radiohead - Let Down')
    const end: EndState = { ...read, said: [], lines: ['done', 'done'] }
    const never = async (): Promise<boolean> => false
    expect(await checkEnd({ url: { host: 'duckduckgo.com' }, media: { playing: true, has: 'let down' }, view: { has: ['Let Down'] }, lines: ['done', 'done'] }, end, never)).toBeNull()
    expect(await checkEnd({ media: { has: 'creep' } }, end, never)).toBe('the media is not "creep" (Radiohead - Let Down)')
  })
})
