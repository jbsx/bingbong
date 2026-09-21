import { describe, expect, it } from 'vitest'
import youtubeHome from './fixtures/youtube-home.json'
import { blockedActionHead, blockedOrInertAction, clickFlagsHead, NO_OBSERVABLE_CHANGE, wasBlockedOrInert } from './actionOutcome'
import { buildPageSnapshot, formatPageSnapshot, parseCollectedPage } from './snapshot'
import { FakeBrowser } from '../testing/doubles'

// #261 (ADR 0058 note): a Blocked Action and an inert click consumed nothing.
// The outcomes below are the fix-258-259 pass-2 longitude-watch rounds and
// the controller's own lines.

const SETTLED = formatPageSnapshot(buildPageSnapshot(parseCollectedPage(youtubeHome)))

describe('blockedOrInertAction (#261)', () => {
  it('recognises the two blocked heads, whatever rides after them', () => {
    expect(blockedOrInertAction('typed [26]: not typed — blocked by overlay')).toBe('blocked')
    expect(blockedOrInertAction('clicked [16]: not clicked — blocked by overlay')).toBe('blocked')
    expect(blockedOrInertAction('clicked [3]: not clicked — blocked by overlay; dialog open: "Before you continue"; controls: [1] button "Accept all"')).toBe('blocked')
    expect(blockedOrInertAction(`typed [7]: not typed — blocked by overlay\n\nThat action repeats — it will not produce anything new.`)).toBe('blocked')
  })

  it('recognises the inert click: the concise line with no settled state after it, a controls-only line included', () => {
    expect(blockedOrInertAction('clicked [4]: urlChanged=false dialogOpen=false; no observable change')).toBe('inert')
    expect(blockedOrInertAction('clicked [4]: urlChanged=false dialogOpen=false; checked=false')).toBe('inert')
    expect(blockedOrInertAction('clicked [4]: urlChanged=false dialogOpen=false; no observable change; activated directly (outside viewport)')).toBe('inert')
    expect(blockedOrInertAction('clicked [4]: urlChanged=false dialogOpen=false; no observable change\nAuto-vision (no observable change): A consent dialog is open.')).toBe('inert')
  })

  it('does not read a click that changed the page, its element or its URL as inert (pass 2 round 3)', () => {
    expect(blockedOrInertAction(`clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n${SETTLED}`)).toBeNull()
    expect(blockedOrInertAction(`clicked [5]: urlChanged=false dialogOpen=false; checked=false -> true\n${SETTLED}`)).toBeNull()
    // A controls-only line the controller followed with settled state: the page changed.
    expect(blockedOrInertAction(`clicked [5]: urlChanged=false dialogOpen=false; checked=false\n${SETTLED}`)).toBeNull()
    expect(blockedOrInertAction(`clicked [7]: urlChanged=true dialogOpen=false; page signature changed; url=https://x.test/ title="X"\n${SETTLED}`)).toBeNull()
    expect(blockedOrInertAction('clicked [7]: urlChanged=true dialogOpen=false; no observable change')).toBeNull()
    expect(blockedOrInertAction('clicked [7]: urlChanged=false dialogOpen=true; no observable change')).toBeNull()
  })

  it('leaves every other outcome alone', () => {
    expect(blockedOrInertAction('typed [5]: value="x"')).toBeNull()
    expect(blockedOrInertAction('navigated: url=https://x.test/ title="X"')).toBeNull()
    expect(blockedOrInertAction('done')).toBeNull()
    expect(blockedOrInertAction('')).toBeNull()
  })
})

describe('wasBlockedOrInert (#261)', () => {
  it('reads only a successful outcome', () => {
    expect(wasBlockedOrInert({ ok: true, result: 'clicked [16]: not clicked — blocked by overlay' })).toBe(true)
    expect(wasBlockedOrInert({ ok: true, result: 'clicked [4]: urlChanged=false dialogOpen=false; no observable change' })).toBe(true)
    expect(wasBlockedOrInert({ ok: true, result: `clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n${SETTLED}` })).toBe(false)
    expect(wasBlockedOrInert({ ok: false, error: 'clicked [16]: not clicked — blocked by overlay' })).toBe(false)
    expect(wasBlockedOrInert({ ok: true, result: { structured: true } })).toBe(false)
  })
})

describe('the heads the port produces (#261)', () => {
  it('builds the lines the helper reads', () => {
    expect(blockedActionHead('click', 16)).toBe('clicked [16]: not clicked — blocked by overlay')
    expect(blockedActionHead('type', 26)).toBe('typed [26]: not typed — blocked by overlay')
    expect(`${clickFlagsHead(4, false, false)}${NO_OBSERVABLE_CHANGE}`).toBe('clicked [4]: urlChanged=false dialogOpen=false; no observable change')
    expect(blockedOrInertAction(blockedActionHead('click', 1))).toBe('blocked')
    expect(blockedOrInertAction(blockedActionHead('type', 1))).toBe('blocked')
    expect(blockedOrInertAction(`${clickFlagsHead(1, false, false)}${NO_OBSERVABLE_CHANGE}`)).toBe('inert')
  })

  it('the test double speaks them too: its click is inert, and a covered ref blocks a click and a type', async () => {
    const browser = new FakeBrowser()
    expect(blockedOrInertAction(await browser.click(4))).toBe('inert')
    browser.coveredRefs.add(16)
    expect(blockedOrInertAction(await browser.click(16))).toBe('blocked')
    expect(blockedOrInertAction(await browser.type(16, 'Harrison longitude watch'))).toBe('blocked')
    expect(blockedOrInertAction(await browser.type(4, 'x'))).toBeNull()
  })
})
