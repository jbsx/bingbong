import { describe, expect, it } from 'vitest'
import { pagesBehind, startSteps, startUnmet } from './start'

describe('the steps a start takes', () => {
  it('opens the pages behind first, then the page shown, then plays the song, then asks', () => {
    expect(startSteps({ page: { url: 'https://b.example/', behind: ['https://a.example/'] }, music: 'let down by radiohead' })).toEqual([
      { open: 'https://a.example/' },
      { open: 'https://b.example/' },
      { play: 'let down by radiohead' },
    ])
    expect(startSteps({ page: { url: 'https://duckduckgo.com/?q=radiohead+albums' }, asked: 'errand open the album I am thinking of' })).toEqual([
      { open: 'https://duckduckgo.com/?q=radiohead+albums' },
      { ask: 'errand open the album I am thinking of' },
    ])
    expect(startSteps({ music: 'let down by radiohead' })).toEqual([{ play: 'let down by radiohead' }])
  })
})

describe('the pages behind the page shown', () => {
  it('are the real pages a person could step back through, nearest first, stopping at the blank start page', () => {
    const entries = ['about:blank', 'https://a.example/', 'https://b.example/', 'https://c.example/'].map((url) => ({ url }))
    expect(pagesBehind(entries, 3)).toEqual(['https://b.example/', 'https://a.example/'])
    expect(pagesBehind(entries, 1)).toEqual([])
    expect(pagesBehind([{ url: 'https://a.example/' }, { url: 'data:text/html,x' }, { url: 'https://b.example/' }], 2)).toEqual([])
  })
})

describe('a start not met', () => {
  const seen = { url: 'https://b.example/', behind: ['https://a.example/'], heard: true }

  it('is met when the page shown, the pages behind and the song heard are what the start says', () => {
    expect(startUnmet({ page: { url: 'https://b.example/', behind: ['https://a.example/'] }, music: 'x' }, seen)).toBeNull()
    // The pane’s own trailing slash and fragment are the same page.
    expect(startUnmet({ page: { url: 'https://b.example' } }, { ...seen, url: 'https://b.example/#top' })).toBeNull()
  })

  it('names what is missing: another page shown, fewer pages behind, no song heard', () => {
    expect(startUnmet({ page: { url: 'https://b.example/' }, music: 'x' }, { ...seen, url: 'https://www.youtube.com/watch?v=1' })).toBe('the page shown is https://www.youtube.com/watch?v=1, not https://b.example/')
    expect(startUnmet({ page: { url: 'https://b.example/', behind: ['https://a.example/', 'https://z.example/'] } }, seen)).toBe('1 page behind the page shown, not 2')
    expect(startUnmet({ music: 'let down' }, { ...seen, heard: false })).toBe('no song is heard, on the pane or the road')
  })

  it('says nothing of a page or a song the start leaves out', () => {
    expect(startUnmet({ music: 'x' }, { url: 'about:blank', behind: [], heard: true })).toBeNull()
    expect(startUnmet({ page: { url: 'https://b.example/' } }, { ...seen, heard: false })).toBeNull()
  })
})
