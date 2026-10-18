import { describe, expect, it } from 'vitest'
import { SPOKEN_FAILURES, failureLineOf, spokenFailureOf } from './spokenFailure'
import { blockedActionHead } from '../browser/actionOutcome'
import { consentDismissalLine, consentRetryNote } from '../browser/dialogPolicy'

// A failure speaks one line (#327, ADR 0076): a Command whose action fails,
// or whose landing is a Blocked Action, a consent wall, a Blocker, or an
// empty, not-found or unavailable page, speaks one fixed line naming what
// happened — never the raw error. Everything else stays silent.

const PAGE = (url: string, title: string, text = 'Some words on the page.'): string =>
  `navigated: url=${url} title=${JSON.stringify(title)}\n# ${title} — ${url}\nviewport 985x575 scroll 0/2000\nsignature 1a2b3c4d\npage text:\n${text}`
const EMPTY_PAGE = (url: string): string => `navigated: url=${url} title="Home"\n# Home — ${url}\nviewport 985x575 scroll 0/575\nsignature 1a2b3c4d`

describe('spokenFailureOf', () => {
  it('names an action that failed', () => {
    expect(spokenFailureOf({ tool: 'navigate', outcome: { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED at https://nope.example/' } })).toBe('failed')
    expect(spokenFailureOf({ tool: 'click', outcome: { ok: false, error: 'ref 9 is stale' } })).toBe('failed')
  })

  it('names a Blocked Action, and a consent wall that kept the target covered', () => {
    const covered = `${blockedActionHead('click', 4, { fact: 'covered', cover: { kind: 'ref', line: '[2] button "Close"' } })}`
    expect(spokenFailureOf({ tool: 'click', outcome: { ok: true, result: covered } })).toBe('blocked')
    const notShown = blockedActionHead('type', 4, { fact: 'notShown' })
    expect(spokenFailureOf({ tool: 'type', outcome: { ok: true, result: notShown } })).toBe('blocked')
    const walled = `${covered}; ${consentDismissalLine(7, 'Accept all')} ${consentRetryNote(4, 'stillBlocked')}`
    expect(spokenFailureOf({ tool: 'click', outcome: { ok: true, result: walled } })).toBe('consent')
  })

  it('names the page a landing settled on', () => {
    const land = (url: string, title: string, result = PAGE(url, title)) => spokenFailureOf({ tool: 'navigate', outcome: { ok: true, result }, url, title })
    expect(land('https://accounts.example.com/signin', 'Sign in')).toBe('blocker')
    expect(land('https://example.com/x', 'Just a moment...')).toBe('blocker')
    expect(land('https://example.com/missing', 'Page Not Found')).toBe('notFound')
    expect(land('https://example.com/down', '503 Service Unavailable')).toBe('unavailable')
    expect(land('https://example.com/', 'Home', EMPTY_PAGE('https://example.com/'))).toBe('empty')
  })

  it('reads the landing line when the address and title are not passed, and a step back lands as a navigation', () => {
    const result = PAGE('https://example.com/missing', 'Page Not Found').replace('navigated:', 'went back:')
    expect(spokenFailureOf({ tool: 'back', outcome: { ok: true, result } })).toBe('notFound')
    expect(spokenFailureOf({ tool: 'forward', outcome: { ok: true, result } })).toBe('notFound')
  })

  it('names a click that arrived on such a page, and never a read of one', () => {
    const arrived = `clicked [7]: urlChanged=true dialogOpen=false; page signature changed; arrived at another page\n${PAGE('https://example.com/gone', '404')}`
    expect(spokenFailureOf({ tool: 'click', outcome: { ok: true, result: arrived }, url: 'https://example.com/gone', title: '404' })).toBe('notFound')
    expect(spokenFailureOf({ tool: 'read_page', outcome: { ok: true, result: '# 404' }, url: 'https://example.com/gone', title: '404' })).toBeNull()
  })

  it('is silent for every success: a landing on a page with text, a click, a type, a scroll, a step back', () => {
    const ok = (tool: string, result: string, url?: string, title?: string) =>
      spokenFailureOf({ tool, outcome: { ok: true, result }, ...(url ? { url } : {}), ...(title ? { title } : {}) })
    expect(ok('navigate', PAGE('https://example.com/', 'Example'), 'https://example.com/', 'Example')).toBeNull()
    expect(ok('click', 'clicked [3]: urlChanged=false dialogOpen=false; checked=false -> true')).toBeNull()
    expect(ok('type', 'typed [3]: value="hello"')).toBeNull()
    expect(ok('scroll', 'scrolled down: 0 -> 575')).toBeNull()
    expect(ok('back', PAGE('https://example.com/', 'Example').replace('navigated:', 'went back:'))).toBeNull()
    expect(ok('press', 'pressed Enter')).toBeNull()
  })

  it('speaks lines that carry no error text, address or status code (AC4)', () => {
    for (const line of Object.values(SPOKEN_FAILURES)) {
      expect(line).not.toMatch(/\d{3}|https?:|www\.|\.com|error|ERR_/i)
      expect(line.length).toBeLessThan(60)
    }
  })
})

// The words a thrown failure is told in (#329): on the Feed, the Peek Card
// and the spoken line, a plain sentence for the user — never the
// ref-protocol wording meant for a model, nor a raw Chromium code.
describe('failureLineOf', () => {
  it('says a missing ref is no item on this page, whether it never existed or the page moved on', () => {
    expect(failureLineOf('click', 'ref 999 refused: it no longer names the element you were shown. Continue from the page below\n# Page — https://example.com/')).toBe("There's no item 999 on this page.")
    expect(failureLineOf('type', 'ref 4 refused: it no longer names the element you were shown; the page could not be re-read')).toBe("There's no item 4 on this page.")
    expect(failureLineOf('click', 'ref 7 no longer resolves at the visually grounded point')).toBe("There's no item 7 on this page.")
  })

  it('says a refused navigation cannot be opened, and names the common network failures plainly', () => {
    expect(failureLineOf('navigate', "ERR_UNSAFE_PORT (-312) loading 'http://127.0.0.1:1/'")).toBe("That address can't be opened.")
    expect(failureLineOf('navigate', 'cannot navigate to: ""')).toBe("That address can't be opened.")
    expect(failureLineOf('navigate', 'net::ERR_NAME_NOT_RESOLVED at https://nope.example/')).toBe("That site can't be found.")
    expect(failureLineOf('navigate', "ERR_INTERNET_DISCONNECTED (-106) loading 'https://example.com/'")).toBe("There's no internet connection.")
    expect(failureLineOf('navigate', "ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:9/'")).toBe("That site isn't answering.")
  })

  it('says a failed Page Read could not read the page', () => {
    expect(failureLineOf('read_page', 'page evaluation failed: TypeError: Cannot read properties of null')).toBe("This page can't be read right now.")
  })

  it('falls back to the plain failure line for anything else', () => {
    expect(failureLineOf('scroll', 'something odd happened')).toBe(SPOKEN_FAILURES.failed)
  })

  it('never carries an error code, a ref protocol phrase or an address', () => {
    const errors: [string, string][] = [
      ['click', 'ref 3 refused: it no longer names the element you were shown. Continue from the page below'],
      ['navigate', "ERR_SSL_PROTOCOL_ERROR (-107) loading 'https://bad.example/'"],
      ['read_page', 'page element collector is unavailable'],
      ['press', "pressKey: unsupported key 'Hyper'"],
      ['screenshot', 'EACCES: permission denied, open /shots/screenshot-1.jpg'],
    ]
    for (const [tool, error] of errors) {
      expect(failureLineOf(tool, error)).not.toMatch(/ERR_|refused|you were shown|Continue from|https?:|\/shots|EACCES|-\d{3}/)
    }
  })
})
