import { describe, expect, it } from 'vitest'
import { isRealPage, lastPageFrom, lastPageLabel, sanitizeLastPage } from './lastPage'

describe('the Last Page', () => {
  it('ignores the blank boot page and error pages', () => {
    expect(isRealPage('about:blank')).toBe(false)
    expect(isRealPage('')).toBe(false)
    expect(isRealPage('chrome-error://chromewebdata/')).toBe(false)
    expect(isRealPage('https://youtube.com/')).toBe(true)
  })

  it('follows a navigation and lets the title arrive after the address', () => {
    const arrived = lastPageFrom(null, { url: 'https://youtube.com/', title: '' }, 10)
    expect(arrived).toEqual({ url: 'https://youtube.com/', title: '', at: 10 })
    const titled = lastPageFrom(arrived, { url: 'https://youtube.com/', title: 'YouTube' }, 20)
    expect(titled).toEqual({ url: 'https://youtube.com/', title: 'YouTube', at: 20 })
    // The same page again, same title: the record stands (one write per change).
    expect(lastPageFrom(titled, { url: 'https://youtube.com/', title: 'YouTube' }, 30)).toBe(titled)
  })

  it('keeps the title when the pane names the page by its address', () => {
    const titled = { url: 'https://youtube.com/', title: 'YouTube', at: 20 }
    expect(lastPageFrom(titled, { url: 'https://youtube.com/', title: 'https://youtube.com/' }, 30)).toBe(titled)
    expect(lastPageFrom(null, { url: 'https://youtube.com/', title: 'https://youtube.com/' }, 30)).toEqual({ url: 'https://youtube.com/', title: '', at: 30 })
  })

  it('moves to a new page and keeps the old one when the pane goes blank', () => {
    const titled = { url: 'https://youtube.com/', title: 'YouTube', at: 20 }
    expect(lastPageFrom(titled, { url: 'https://example.com/', title: 'Example' }, 30)).toEqual({ url: 'https://example.com/', title: 'Example', at: 30 })
    expect(lastPageFrom(titled, { url: 'about:blank', title: '' }, 30)).toBe(titled)
  })

  it('reads a persisted record back and rejects anything else', () => {
    expect(sanitizeLastPage({ url: 'https://x.com/a', title: 'A', at: 5 })).toEqual({ url: 'https://x.com/a', title: 'A', at: 5 })
    expect(sanitizeLastPage({ url: 'https://x.com/a' })).toEqual({ url: 'https://x.com/a', title: '', at: 0 })
    expect(sanitizeLastPage({ url: 'about:blank', title: '', at: 5 })).toBeNull()
    expect(sanitizeLastPage('https://x.com/a')).toBeNull()
    expect(sanitizeLastPage(null)).toBeNull()
  })

  it('labels a page by its title, or its host without www', () => {
    expect(lastPageLabel({ url: 'https://www.youtube.com/watch?v=1', title: 'A video' })).toEqual({ title: 'A video', host: 'youtube.com' })
    expect(lastPageLabel({ url: 'https://www.youtube.com/', title: '' })).toEqual({ title: 'youtube.com', host: 'youtube.com' })
  })
})
