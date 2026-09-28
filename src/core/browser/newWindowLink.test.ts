import { describe, expect, it } from 'vitest'
import {
  deniedAddressesIn,
  formatOpenAddress,
  isNavigableAddress,
  judgeWindowOpens,
  MAX_OPEN_ADDRESS_LENGTH,
  popupBlockedLine,
} from './newWindowLink'

describe('judgeWindowOpens', () => {
  it('follows an open whose address is the clicked link’s', () => {
    expect(judgeWindowOpens(['https://a.test/page'], ['https://a.test/page'])).toEqual({
      followed: 'https://a.test/page',
      denied: [],
    })
  })

  it('follows on either address: the one the snapshot showed or the one the link carries after the click', () => {
    const judged = judgeWindowOpens(['https://a.test/redirect?to=page'], ['https://a.test/page', 'https://a.test/redirect?to=page'])

    expect(judged.followed).toBe('https://a.test/redirect?to=page')
  })

  it('denies an open to some other address', () => {
    expect(judgeWindowOpens(['https://ads.test/win'], ['https://a.test/page'])).toEqual({
      followed: null,
      denied: ['https://ads.test/win'],
    })
  })

  it('denies every open when the click was on no link', () => {
    expect(judgeWindowOpens(['https://a.test/page'], [null, null])).toEqual({
      followed: null,
      denied: ['https://a.test/page'],
    })
  })

  it('follows the first that matches and denies the rest, in order', () => {
    const judged = judgeWindowOpens(
      ['https://ads.test/first', 'https://a.test/page', 'https://a.test/page', 'https://ads.test/last'],
      ['https://a.test/page'],
    )

    expect(judged).toEqual({
      followed: 'https://a.test/page',
      denied: ['https://ads.test/first', 'https://a.test/page', 'https://ads.test/last'],
    })
  })

  it('compares addresses as the Composed Address rail does: the fragment is no part of the endpoint', () => {
    expect(judgeWindowOpens(['https://a.test/page#top'], ['https://a.test/page']).followed).toBe('https://a.test/page#top')
  })

  it('never follows a target that is no address to navigate to', () => {
    const script = 'javascript:void(0)'

    expect(judgeWindowOpens([script], [script])).toEqual({ followed: null, denied: [script] })
  })
})

describe('isNavigableAddress', () => {
  it('takes http and https, and nothing else', () => {
    expect(isNavigableAddress('https://a.test/')).toBe(true)
    expect(isNavigableAddress('http://a.test/')).toBe(true)
    expect(isNavigableAddress('data:text/html,<b>x</b>')).toBe(false)
    expect(isNavigableAddress('javascript:void(0)')).toBe(false)
    expect(isNavigableAddress('about:blank')).toBe(false)
    expect(isNavigableAddress('')).toBe(false)
  })
})

describe('formatOpenAddress', () => {
  it('prints an address of 1,000 characters whole', () => {
    const address = `https://a.test/${'p'.repeat(985)}`
    expect(address).toHaveLength(1_000)

    expect(formatOpenAddress(address)).toBe(address)
  })

  it('prints an address of exactly the cap whole, and cuts one over it', () => {
    const atCap = `https://a.test/${'p'.repeat(MAX_OPEN_ADDRESS_LENGTH - 15)}`
    const over = `${atCap}p`

    expect(formatOpenAddress(atCap)).toBe(atCap)
    expect(formatOpenAddress(over)).toBe(`${over.slice(0, MAX_OPEN_ADDRESS_LENGTH - 1)}…`)
    expect(formatOpenAddress(over)).toHaveLength(MAX_OPEN_ADDRESS_LENGTH)
  })

  it('prints a target that is no address as its scheme and a short cut', () => {
    const data = `data:text/html,${'<b>x</b>'.repeat(200)}`

    expect(formatOpenAddress(data)).toBe(`${data.slice(0, 39)}…`)
    expect(formatOpenAddress(data).startsWith('data:text/html,')).toBe(true)
    expect(formatOpenAddress('javascript:void(0)')).toBe('javascript:void(0)')
    expect(formatOpenAddress('about:blank')).toBe('about:blank')
  })
})

describe('deniedAddressesIn', () => {
  it('reads the address of each denied popup an outcome reports', () => {
    const text = `clicked [3]: urlChanged=false dialogOpen=false; no observable change; ${popupBlockedLine('https://a.test/one')}; ${popupBlockedLine('https://b.test/two?x=1')}`

    expect(deniedAddressesIn(text)).toEqual(['https://a.test/one', 'https://b.test/two?x=1'])
  })

  it('reads them from a page read’s footer lines', () => {
    const text = `# page — https://a.test/\n[1] button "Open"\n${popupBlockedLine('https://a.test/one')}\n${popupBlockedLine('https://a.test/two')}`

    expect(deniedAddressesIn(text)).toEqual(['https://a.test/one', 'https://a.test/two'])
  })

  it('leaves out a cut address and a target that is no address', () => {
    const over = `https://a.test/${'p'.repeat(MAX_OPEN_ADDRESS_LENGTH)}`
    const text = `${popupBlockedLine(over)}; ${popupBlockedLine('data:text/html,<b>x</b>')}; ${popupBlockedLine('about:blank')}`

    expect(deniedAddressesIn(text)).toEqual([])
  })
})
