import { describe, expect, it } from 'vitest'
import { SPOKEN_FAILURES, spokenFailureOf } from './spokenFailure'
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
