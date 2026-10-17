import { describe, expect, it } from 'vitest'
import { PAGE_TERMS_CAP, pageTermsOf } from './pageTerms'

// Page Terms (ADR 0077, #325): the names a page shows right now, ranked
// for the STT bias and the Name Match. Pure text in, phrases out.

describe('pageTermsOf', () => {
  it('takes the runs of capitalised words out of the title, the labels and the viewport text', () => {
    const terms = pageTermsOf({
      title: 'Linus Tech Tips - YouTube',
      labels: ['Linus Tech Tips', 'Subscribe', 'The $5000 Gaming PC Build - Linus Tech Tips', 'Search'],
      text: ['Videos from Linus Tech Tips and Marques Brownlee this week'],
    })
    expect(terms[0]).toBe('linus tech tips')
    expect(terms).toContain('marques brownlee')
    expect(terms).toContain('youtube')
  })

  it('reads a search suggestion list and a video list as names the user may say next', () => {
    const terms = pageTermsOf({
      title: 'YouTube',
      labels: ['linus tech tips', 'Linus Tech Tips', 'Linus Tech Tips laptop', 'Mr Beast', 'NVIDIA RTX 5090 review'],
      text: [],
    })
    expect(terms).toContain('linus tech tips')
    expect(terms).toContain('mr beast')
    expect(terms).toContain('nvidia rtx 5090')
  })

  it('leaves out a single word that only ever opens its text: a sentence starts capitalised whether or not it is a name', () => {
    const terms = pageTermsOf({ title: '', labels: ['Subscribe', 'Sign in', 'Settings'], text: ['Open the panel and read it.'] })
    expect(terms).not.toContain('subscribe')
    expect(terms).not.toContain('open')
    expect(terms).not.toContain('settings')
  })

  it('keeps a single word seen more than once, or seen inside a text', () => {
    const terms = pageTermsOf({ title: '', labels: ['Search', 'Search'], text: ['Posted by Tesla yesterday'] })
    expect(terms).toContain('search')
    expect(terms).toContain('tesla')
  })

  it('cuts a run to four words and drops function words from its edges', () => {
    const terms = pageTermsOf({ title: '', labels: ['The Best Gaming Laptops Of 2025 Ranked By Price'], text: [] })
    expect(terms[0]).toBe('best gaming laptops')
    expect(terms.some((term) => term.startsWith('the '))).toBe(false)
    expect(terms.some((term) => term.split(' ').length > 4)).toBe(false)
  })

  it('ranks by how often a name appears, then by length', () => {
    const terms = pageTermsOf({
      title: '',
      labels: ['Elon Musk', 'Elon Musk', 'Elon Musk', 'Marques Brownlee Reviews', 'Tesla Motors'],
      text: [],
    })
    expect(terms.slice(0, 2)).toEqual(['elon musk', 'marques brownlee reviews'])
  })

  it('stops at the cap', () => {
    const labels = Array.from({ length: 100 }, (_, i) => `Channel Number${i} Official`)
    expect(pageTermsOf({ title: '', labels, text: [] })).toHaveLength(PAGE_TERMS_CAP)
  })

  it('is empty for a page that shows no names', () => {
    expect(pageTermsOf({ title: '', labels: [], text: [] })).toEqual([])
  })
})
