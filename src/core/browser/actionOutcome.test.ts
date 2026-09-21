import { describe, expect, it } from 'vitest'
import youtubeHome from './fixtures/youtube-home.json'
import {
  blockedActionHead,
  blockedOrInertAction,
  clickFlagsHead,
  NO_OBSERVABLE_CHANGE,
  PAGE_SIGNATURE_CHANGED,
  wasBlockedOrInert,
  type BlockedAction,
} from './actionOutcome'
import { buildPageSnapshot, coverOf, formatPageSnapshot, formatRefLine, parseCollectedPage } from './snapshot'
import { FakeBrowser } from '../testing/doubles'

// #261 (ADR 0058 note): a Blocked Action and an inert click consumed nothing.
// #264 (ADR 0062): a Blocked Action is one of two facts — Covered, naming
// what sits over the target, or Not Shown. The outcomes below are the
// fix-258-259 pass-2 longitude-watch rounds as they now read, and the
// controller's own lines.

const SNAPSHOT = buildPageSnapshot(parseCollectedPage(youtubeHome))
const SETTLED = formatPageSnapshot(SNAPSHOT)

const REJECT: BlockedAction = { fact: 'covered', cover: { kind: 'ref', line: '[8] button "Reject all cookies"' } }
const NOT_SHOWN: BlockedAction = { fact: 'notShown' }

describe('the Blocked Action heads (#264, ADR 0062)', () => {
  it('names a ref cover by its listing line', () => {
    expect(blockedActionHead('click', 26, REJECT)).toBe('clicked [26]: not clicked — covered by [8] button "Reject all cookies"')
    expect(blockedActionHead('type', 26, REJECT)).toBe('typed [26]: not typed — covered by [8] button "Reject all cookies"')
  })

  it('names a labelled cover by kind and name, with the refs it contains', () => {
    const region: BlockedAction = {
      fact: 'covered',
      cover: { kind: 'labelled', role: 'region', name: 'Cookie consent', contains: ['[8] button "Reject all cookies"', '[9] button "Manage settings"', '[10] button "Allow all cookies"'] },
    }
    expect(blockedActionHead('type', 26, region)).toBe(
      'typed [26]: not typed — covered by region "Cookie consent" with [8] button "Reject all cookies", [9] button "Manage settings", [10] button "Allow all cookies"',
    )
    expect(blockedActionHead('click', 3, { fact: 'covered', cover: { kind: 'labelled', role: 'img', name: 'Banner', contains: [] } })).toBe(
      'clicked [3]: not clicked — covered by img "Banner"',
    )
  })

  it('names an unlabelled cover by its tag', () => {
    expect(blockedActionHead('click', 3, { fact: 'covered', cover: { kind: 'unlabelled', tag: 'div', contains: [] } })).toBe(
      'clicked [3]: not clicked — covered by an unlabelled <div>',
    )
    expect(blockedActionHead('click', 3, { fact: 'covered', cover: { kind: 'unlabelled', tag: 'div', contains: ['[1] button "Close"'] } })).toBe(
      'clicked [3]: not clicked — covered by an unlabelled <div> with [1] button "Close"',
    )
  })

  it('says a Not Shown target is inside a hidden or inert container', () => {
    expect(blockedActionHead('click', 16, NOT_SHOWN)).toBe('clicked [16]: not clicked — [16] is not shown: inside a hidden or inert container')
    expect(blockedActionHead('type', 16, NOT_SHOWN)).toBe('typed [16]: not typed — [16] is not shown: inside a hidden or inert container')
  })

  it('never says overlay', () => {
    for (const action of ['click', 'type'] as const) {
      expect(blockedActionHead(action, 1, REJECT)).not.toMatch(/overlay/i)
      expect(blockedActionHead(action, 1, NOT_SHOWN)).not.toMatch(/overlay/i)
    }
  })
})

describe('coverOf (snapshot.ts): the in-page probe named against the snapshot (#264)', () => {
  const [first, second, third, fourth] = SNAPSHOT.refs

  it('names a ref by its listing line', () => {
    expect(coverOf({ ref: second!.ref }, SNAPSHOT.refs)).toEqual({ kind: 'ref', line: formatRefLine(second!) })
  })

  it('names a labelled or unlabelled cover with at most three contained refs', () => {
    const contains = [first!, second!, third!, fourth!].map((ref) => ref.ref)
    expect(coverOf({ role: 'region', name: 'Cookie consent', contains }, SNAPSHOT.refs)).toEqual({
      kind: 'labelled',
      role: 'region',
      name: 'Cookie consent',
      contains: [first!, second!, third!].map(formatRefLine),
    })
    expect(coverOf({ tag: 'div', contains: [] }, SNAPSHOT.refs)).toEqual({ kind: 'unlabelled', tag: 'div', contains: [] })
  })

  it('drops a number the snapshot does not list, and falls back to the tag when a ref cover is not listed', () => {
    expect(coverOf({ tag: 'div', contains: [9999, first!.ref] }, SNAPSHOT.refs)).toEqual({ kind: 'unlabelled', tag: 'div', contains: [formatRefLine(first!)] })
    expect(coverOf({ ref: 9999 }, SNAPSHOT.refs)).toEqual({ kind: 'unlabelled', tag: 'element', contains: [] })
  })
})

describe('blockedOrInertAction (#261, #264)', () => {
  it('recognises the Covered and Not Shown heads, whatever rides after them', () => {
    expect(blockedOrInertAction('typed [26]: not typed — covered by [8] button "Reject all cookies"')).toBe('covered')
    expect(blockedOrInertAction('clicked [3]: not clicked — covered by an unlabelled <div>; dialog open: "Before you continue"; controls: [1] button "Accept all"')).toBe('covered')
    expect(blockedOrInertAction('clicked [16]: not clicked — [16] is not shown: inside a hidden or inert container')).toBe('notShown')
    expect(blockedOrInertAction(`typed [7]: not typed — [7] is not shown: inside a hidden or inert container\n\nThat action repeats — it will not produce anything new.`)).toBe('notShown')
  })

  it('no longer reads the pre-#264 head: the port never writes it', () => {
    expect(blockedOrInertAction('clicked [16]: not clicked — blocked by overlay')).toBeNull()
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

  it('reads the changes clause too, so a meaningful click whose settled state failed to collect is still not inert', () => {
    expect(blockedOrInertAction('clicked [8]: urlChanged=false dialogOpen=false; page signature changed')).toBeNull()
    expect(blockedOrInertAction('clicked [5]: urlChanged=false dialogOpen=false; checked=false -> true')).toBeNull()
    expect(blockedOrInertAction('clicked [5]: urlChanged=false dialogOpen=false; aria-pressed="false" -> "true", checked=true')).toBeNull()
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
    expect(wasBlockedOrInert({ ok: true, result: blockedActionHead('click', 16, NOT_SHOWN) })).toBe(true)
    expect(wasBlockedOrInert({ ok: true, result: blockedActionHead('type', 26, REJECT) })).toBe(true)
    expect(wasBlockedOrInert({ ok: true, result: 'clicked [4]: urlChanged=false dialogOpen=false; no observable change' })).toBe(true)
    expect(wasBlockedOrInert({ ok: true, result: `clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n${SETTLED}` })).toBe(false)
    expect(wasBlockedOrInert({ ok: false, error: blockedActionHead('click', 16, NOT_SHOWN) })).toBe(false)
    expect(wasBlockedOrInert({ ok: true, result: { structured: true } })).toBe(false)
  })
})

describe('the heads the port produces (#261, #264)', () => {
  it('builds the lines the helper reads', () => {
    expect(`${clickFlagsHead(4, false, false)}${NO_OBSERVABLE_CHANGE}`).toBe('clicked [4]: urlChanged=false dialogOpen=false; no observable change')
    expect(blockedOrInertAction(`${clickFlagsHead(1, false, false)}${PAGE_SIGNATURE_CHANGED}`)).toBeNull()
    for (const action of ['click', 'type'] as const) {
      expect(blockedOrInertAction(blockedActionHead(action, 1, REJECT))).toBe('covered')
      expect(blockedOrInertAction(blockedActionHead(action, 12, NOT_SHOWN))).toBe('notShown')
    }
    expect(blockedOrInertAction(`${clickFlagsHead(1, false, false)}${NO_OBSERVABLE_CHANGE}`)).toBe('inert')
  })

  it('the test double speaks them too: its click is inert, a covered ref is Covered and a hidden ref Not Shown for a click and a type', async () => {
    const browser = new FakeBrowser()
    expect(blockedOrInertAction(await browser.click(4))).toBe('inert')
    browser.coveredRefs.add(26)
    expect(blockedOrInertAction(await browser.click(26))).toBe('covered')
    expect(blockedOrInertAction(await browser.type(26, 'Harrison longitude watch'))).toBe('covered')
    browser.notShownRefs.add(16)
    expect(blockedOrInertAction(await browser.click(16))).toBe('notShown')
    expect(blockedOrInertAction(await browser.type(16, 'Harrison longitude watch'))).toBe('notShown')
    expect(blockedOrInertAction(await browser.type(4, 'x'))).toBeNull()
  })
})
