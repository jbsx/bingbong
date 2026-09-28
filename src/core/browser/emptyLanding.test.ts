import { describe, expect, it } from 'vitest'
import {
  EMPTY_LANDING_ADVICE,
  classifyEmptyLanding,
  isPageArrival,
  pageReadReturnedText,
  parseEmptyMarker,
  settledOnEmptyLanding,
  showedNoPageText,
} from './emptyLanding'
import { emptyPageReadLine, pageReadPartLine } from './pageText'

// fix-288-290 pass 1, the longitude initial, round 13: rmg.co.uk answers an
// object id it cannot resolve with a 200 and its template around an empty <main>.
const RMG_URL = 'https://www.rmg.co.uk/collections/collections-online/object/rmgc-object-79142'
const RMG_TEMPLATE = [
  `navigated: url=${RMG_URL} title="| Royal Museums Greenwich"`,
  `# | Royal Museums Greenwich — ${RMG_URL}`,
  'viewport 985x575 scroll 0/962',
  'signature 162b2d4d',
  '[1] link "Royal Museums Greenwich" href="https://www.rmg.co.uk/"',
  '[2] button "Menu"',
].join('\n')

const WITH_TEXT = `${RMG_TEMPLATE}\npage text:\nH4, the marine timekeeper John Harrison completed in 1759.`

describe('showedNoPageText (#304)', () => {
  it('is true of a settled page that carries no page text section, whatever its refs or title', () => {
    expect(showedNoPageText(RMG_TEMPLATE)).toBe(true)
    // A PDF, a raw text file: no refs either.
    expect(showedNoPageText('navigated: url=https://example.org/a.pdf title="a.pdf"\n# a.pdf — https://example.org/a.pdf\nviewport 985x575 scroll 0/575\nsignature 00000000')).toBe(true)
  })

  it('is false of a page that showed text, however little', () => {
    expect(showedNoPageText(WITH_TEXT)).toBe(false)
    expect(showedNoPageText(`${RMG_TEMPLATE}\npage text:\nx`)).toBe(false)
  })

  it('is false of an outcome that carries no settled page: nothing says what the page held', () => {
    expect(showedNoPageText(`navigated: url=${RMG_URL} title="| Royal Museums Greenwich"`)).toBe(false)
    expect(showedNoPageText('navigated outcome')).toBe(false)
  })

  it('reads a line of the page that says "page text:" inside a ref as no heading', () => {
    expect(showedNoPageText(`${RMG_TEMPLATE}\n[3] link "page text: a guide" href="https://www.rmg.co.uk/guide"`)).toBe(true)
  })
})

describe('classifyEmptyLanding (#304)', () => {
  it('marks the landing with the host of the page it settled on', () => {
    expect(classifyEmptyLanding({ url: RMG_URL, outcome: RMG_TEMPLATE })).toEqual({ host: 'www.rmg.co.uk', marker: 'EMPTY:no-text www.rmg.co.uk' })
  })

  it('marks nothing on a page that showed text, on about:blank, or on an address with no host', () => {
    expect(classifyEmptyLanding({ url: RMG_URL, outcome: WITH_TEXT })).toBeNull()
    expect(classifyEmptyLanding({ url: 'about:blank', outcome: '# — about:blank\nviewport 985x575 scroll 0/575\nsignature 00000000' })).toBeNull()
    expect(classifyEmptyLanding({ url: 'not a url', outcome: RMG_TEMPLATE })).toBeNull()
  })

  it('marks a results page that showed no text: it is a search still, and the marker says what was shown', () => {
    const url = 'https://www.rmg.co.uk/collections/objects-and-stories/search?t=Harrison%20longitude%20watch'
    expect(classifyEmptyLanding({ url, outcome: RMG_TEMPLATE })?.marker).toBe('EMPTY:no-text www.rmg.co.uk')
  })
})

describe('the marker and the advice (#304)', () => {
  it('states the advice the issue settled, word for word', () => {
    expect(EMPTY_LANDING_ADVICE).toBe('This page showed no text. If it should hold content, read it or Look at it once; otherwise use another source.')
  })

  it('parses the last marker line riding a result, and nothing from prose that names it', () => {
    expect(parseEmptyMarker(`${RMG_TEMPLATE}\nEMPTY:no-text www.rmg.co.uk\n${EMPTY_LANDING_ADVICE}`)).toEqual({ host: 'www.rmg.co.uk' })
    expect(parseEmptyMarker(`${RMG_TEMPLATE}\npage text:\nthe marker is EMPTY:no-text www.rmg.co.uk in the docs`)).toBeNull()
    expect(parseEmptyMarker(RMG_TEMPLATE)).toBeNull()
  })

  it('reads a landing off a successful outcome of a navigation verb only', () => {
    const result = `${RMG_TEMPLATE}\nEMPTY:no-text www.rmg.co.uk\n${EMPTY_LANDING_ADVICE}`
    for (const name of ['navigate', 'back', 'go_forward']) expect(settledOnEmptyLanding(name, { ok: true, result })).toBe(true)
    expect(settledOnEmptyLanding('navigate', { ok: true, result: WITH_TEXT })).toBe(false)
    expect(settledOnEmptyLanding('navigate', { ok: false, error: result })).toBe(false)
    // A page whose own text holds the line was read, and settled nowhere.
    expect(settledOnEmptyLanding('read_page', { ok: true, result: `${WITH_TEXT}\nEMPTY:no-text www.rmg.co.uk` })).toBe(false)
    expect(settledOnEmptyLanding('click', { ok: true, result })).toBe(false)
  })
})

describe('pageReadReturnedText (#304)', () => {
  it('is true of a Page Read that carries text, any part of it', () => {
    expect(pageReadReturnedText(`${WITH_TEXT}\n${pageReadPartLine(1, 1)}`)).toBe(true)
    expect(pageReadReturnedText(`${WITH_TEXT}\n${pageReadPartLine(2, 3)}`)).toBe(true)
  })

  it('is false of a Page Read that says the page has no text', () => {
    expect(pageReadReturnedText(`# | Royal Museums Greenwich — ${RMG_URL}\nviewport 985x575 scroll 0/962\nsignature 162b2d4d\n${emptyPageReadLine()}`)).toBe(false)
  })
})

describe('isPageArrival (#304)', () => {
  it('is a navigation and a step through history', () => {
    for (const name of ['navigate', 'back', 'go_forward']) expect(isPageArrival(name, 'navigated outcome')).toBe(true)
  })

  it('is a click that left for another URL and typing the page changed under, and no other', () => {
    expect(isPageArrival('click', 'clicked [7]: urlChanged=true dialogOpen=false; page signature changed')).toBe(true)
    expect(isPageArrival('click', 'clicked [7]: urlChanged=false dialogOpen=false; page signature changed')).toBe(false)
    expect(isPageArrival('type', 'typed [4]: field unavailable after page change; url=https://duckduckgo.com/?q=h4')).toBe(true)
    expect(isPageArrival('type', 'typed [4]: value="h4"; page changed')).toBe(true)
    expect(isPageArrival('type', 'typed [4]: value="h4"')).toBe(false)
  })

  it('reads the first line alone: the page’s own text follows it', () => {
    const stayed = 'clicked [7]: urlChanged=false dialogOpen=false; page signature changed\nsignature 162b2d4d\npage text:\nthe log says urlChanged=true after page change; page changed'
    expect(isPageArrival('click', stayed)).toBe(false)
    expect(isPageArrival('type', `typed [4]: value="h4"\n${stayed}`)).toBe(false)
  })

  it('is never a read, a Look or a scroll', () => {
    for (const name of ['read_page', 'look', 'scroll', 'ground_visual']) expect(isPageArrival(name, WITH_TEXT)).toBe(false)
  })
})
