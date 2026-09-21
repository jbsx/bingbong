import { describe, expect, it } from 'vitest'
import type { SnapshotRef } from '../browser/snapshot'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import run47Sequence from './fixtures/run47-tool-sequence.json'
import {
  createSearchLoopRail,
  isSearchInputRef,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  searchQueryFromUrl,
  similarQueries,
  type SearchLoopRail,
  type SearchLoopRailDeps,
} from './searchLoopRail'

// Issue #74, run rails: the rail that breaks blind search loops — pure
// token similarity over the streak, advisory nudge first, pre-execution
// refusal second. Issue #82 re-targeted the observable to the GUI search
// signature; #83 deleted web_search, so every observation here is on-screen:
// a q= navigation or text typed into a search box. See the module header.

function search(query: string): ToolCall {
  // The GUI form of one search observation (#83): the query typed into a
  // search input, submitted with the trailing newline.
  return { id: 's', name: 'type', args: { ref: 7, text: `${query}\n` } }
}

function nav(url: string): ToolCall {
  return { id: 'n', name: 'navigate', args: { url } }
}

function type(ref: number, text: string): ToolCall {
  return { id: 't', name: 'type', args: { ref, text } }
}

function other(name: string): ToolCall {
  return { id: 'o', name, args: {} }
}

const ok: ToolResultOutcome = { ok: true, result: 'done' }
const fail: ToolResultOutcome = { ok: false, error: 'boom' }

/** The advisory half of the rail's verdict — what every test before #243 pinned. */
async function noticeOf(rail: SearchLoopRail, call: ToolCall, outcome: ToolResultOutcome): Promise<string | null> {
  return (await rail.observe(call, outcome)).notice
}

function ref(facts: Partial<SnapshotRef> = {}): SnapshotRef {
  return {
    ref: 7,
    kind: 'input',
    label: '',
    inputType: null,
    rect: { x: 0, y: 0, width: 200, height: 32 },
    src: null,
    href: null,
    downloadsFile: false,
    submitsForm: false,
    credentialField: false,
    paymentField: false,
    inForm: false,
    formHasCredential: false,
    formHasPayment: false,
    searchField: false,
    formHasSearch: false,
    ...facts,
  }
}

/** describeRef double whose ref 7 is a search box (ref 8 is an ordinary field). */
const searchBoxAt: SearchLoopRailDeps = {
  describeRef: async (n) => (n === 7 ? ref({ label: 'Search the web' }) : n === 8 ? ref({ label: 'Email' }) : undefined),
}

describe('similarQueries', () => {
  it('matches identical and reworded variants of the same intent', () => {
    expect(similarQueries('best mechanical keyboards 2026', 'best mechanical keyboards 2026')).toBe(true)
    expect(similarQueries('best mechanical keyboards 2026', 'best mechanical keyboard 2026 reddit')).toBe(true)
    expect(similarQueries('Best Mechanical Keyboards 2026?', 'best mechanical keyboards 2026!')).toBe(true)
    expect(similarQueries('weather london', 'london weather')).toBe(true)
  })

  it('matches run 47-style rewordings — dropping and adding terms around a stable core (#82)', () => {
    // Real adjacent pairs from failed run 47; the pre-#82 threshold of 0.6
    // missed these and the streak never chained.
    expect(similarQueries('reddit manhwa tier list image "horizon" "boxer"', 'reddit manhwa tier list "horizon" "boxer" before:2024')).toBe(true)
    expect(similarQueries('manhwa tier list reddit horizon boxer S', 'reddit.com manhwa tier list horizon boxer')).toBe(true)
    expect(similarQueries('horizon boxer tier list', '"tier list" "the horizon" "the boxer"')).toBe(true)
  })

  it('separates genuinely different intents', () => {
    expect(similarQueries('best mechanical keyboards 2026', 'weather in london')).toBe(false)
    expect(similarQueries('weather london', 'weather tokyo')).toBe(false)
    expect(similarQueries('', 'anything at all')).toBe(false)
  })
})

describe('searchQueryFromUrl', () => {
  it('extracts the query from a q=-carrying search URL, decoded', () => {
    expect(searchQueryFromUrl('https://www.google.com/search?q=site%3Areddit.com+manhwa+tier+list')).toBe(
      'site:reddit.com manhwa tier list',
    )
    expect(searchQueryFromUrl('https://www.reddit.com/r/manhwa/search/?q=horizon+boxer+tier+list&sort=top')).toBe(
      'horizon boxer tier list',
    )
    expect(searchQueryFromUrl('https://duckduckgo.com/?q=best+mechanical+keyboards')).toBe('best mechanical keyboards')
  })

  it('treats plain search terms as the search they normalize into', () => {
    expect(searchQueryFromUrl('best mechanical keyboards')).toBe('best mechanical keyboards')
  })

  it('returns null for plain URLs and empty queries', () => {
    expect(searchQueryFromUrl('https://www.reddit.com/r/manhwa/comments/z8sfnn/')).toBeNull()
    expect(searchQueryFromUrl('https://youtube.com/watch?v=abc')).toBeNull()
    expect(searchQueryFromUrl('https://www.google.com/search?q=')).toBeNull()
  })
})

describe('isSearchInputRef', () => {
  it('classifies input refs by type=search or a search label', () => {
    expect(isSearchInputRef(ref({ inputType: 'search', label: '' }))).toBe(true)
    expect(isSearchInputRef(ref({ label: 'Search the web' }))).toBe(true)
    expect(isSearchInputRef(ref({ label: 'Search' }))).toBe(true)
  })

  it('does not fire on the word "research" or non-input refs', () => {
    expect(isSearchInputRef(ref({ label: 'Research keywords' }))).toBe(false)
    expect(isSearchInputRef(ref({ label: 'Email address' }))).toBe(false)
    expect(isSearchInputRef(ref({ kind: 'link', label: 'Search results' }))).toBe(false)
  })
})

describe('createSearchLoopRail', () => {
  it('keeps the refusal tier strictly beyond the nudge tier', () => {
    expect(SEARCH_LOOP_NUDGE_AFTER).toBeGreaterThanOrEqual(2)
    expect(SEARCH_LOOP_REFUSE_AFTER).toBeGreaterThan(SEARCH_LOOP_NUDGE_AFTER)
  })

  it('two searches in a row are free, whatever their terms (ADR 0058)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect(await rail.gate(search('mechanical keyboards'))).toEqual({ ok: true })
    expect((await rail.observe(search('mechanical keyboards'), ok)).observation?.streak).toBe(1)
    expect(await rail.gate(search('weather london'))).toEqual({ ok: true })
    const second = await rail.observe(search('weather london'), ok)
    expect(second.notice).toBeNull()
    expect(second.observation?.streak).toBe(2)
  })

  it('nudges on the nth consecutive search — advisory, never a refusal', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 1; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      expect(await rail.gate(search(`best mechanical keyboards 2026 v${i}`))).toEqual({ ok: true })
      expect(await noticeOf(rail, search(`best mechanical keyboards 2026 v${i}`), ok)).toBeNull()
    }
    const last = `best mechanical keyboards 2026 v${SEARCH_LOOP_NUDGE_AFTER}`
    expect(await rail.gate(search(last))).toEqual({ ok: true })
    const nudge = await noticeOf(rail, search(last), ok)
    // AC6 (#260, ADR 0059): the notice states the rule the rail runs.
    expect(nudge).toContain('nothing opened between them')
    expect(nudge).toContain('a navigate to a search URL or a search box query')
    expect(nudge).not.toMatch(/reword|one intent|q= navigate/)
    expect(nudge).not.toMatch(/web_search|read_url/)
    expect(nudge).toMatch(/ask_user/)
    // AC2: the nudge names the ref — a click by ref is the move the loop
    // exists to provoke, and it works when the printed href is cut (#258).
    expect(nudge).toContain('open a promising result by its ref or its href')
  })

  it('nudges on the third consecutive search when the searches share no words (AC1)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect(await noticeOf(rail, search('mechanical keyboards'), ok)).toBeNull()
    expect(await noticeOf(rail, search('weather in london'), ok)).toBeNull()
    expect(await noticeOf(rail, search('train times tokyo osaka'), ok)).toMatch(/ask_user/)
  })

  it('replays Voyager fix-257 pass 2 rounds 16–19 to streak 4 — four queries whose only shared token is Voyager (AC1)', async () => {
    // The rail under ADR 0048 scored each pair under 0.45 and recorded
    // streak 1, 1, 2, 1: no nudge in a loop the reviewer placed four rounds in.
    const rail = createSearchLoopRail(searchBoxAt)
    const round16 = await rail.observe(nav('https://duckduckgo.com/?q=site%3Ajpl.nasa.gov+Voyager+June+2013+%22has+not+yet%22+OR+%22not+yet+reached%22+status+update'), ok)
    expect(round16.observation?.streak).toBe(1)
    // Round 17 opened with a Look at the results — inspection, never escape.
    expect((await rail.observe(other('look'), ok)).observation).toBeNull()
    const round17 = await rail.observe(nav('https://duckduckgo.com/?q=%22Voyager%22+%22June+27%2C+2013%22+JPL+OR+NASA+%22not+yet%22+interstellar'), ok)
    expect(round17.observation?.streak).toBe(2)
    expect(round17.notice).toBeNull()
    const round18 = await rail.observe(nav('https://duckduckgo.com/?q=%22Voyager+1%22+NASA+June+27+2013+statement+interstellar+space+McComas'), ok)
    expect(round18.observation?.streak).toBe(3)
    expect(round18.notice).toMatch(/ask_user/)
    const round19 = await rail.observe(nav('https://duckduckgo.com/?q=JPL+%222013-107%22+Voyager+status+update+location+date'), ok)
    expect(round19.observation).toEqual({ query: 'JPL "2013-107" Voyager status update location date', signature: 'url', streak: 4 })
    expect(round19.notice).toMatch(/ask_user/)
  })

  it('resets the streak when a successful other tool intervenes', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      await noticeOf(rail, search('mechanical keyboards gaming'), ok)
    }
    await noticeOf(rail, other('navigate'), ok)
    expect(await rail.gate(search('mechanical keyboards gaming'))).toEqual({ ok: true })
    expect(await noticeOf(rail, search('mechanical keyboards gaming'), ok)).toBeNull()
  })

  it('keeps the streak when the intervening tool fails — the model is still blind (run 46)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('mechanical keyboards'), ok)
    await noticeOf(rail, search('mechanical keyboards gaming'), ok)
    expect(await noticeOf(rail, other('navigate'), fail)).toBeNull()
    expect(await noticeOf(rail, search('mechanical keyboards gaming 2026'), ok)).toMatch(/ask_user/)
  })

  it('does not reset the streak when the model moves to a new search intent — only escape does (ADR 0058)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('mechanical keyboards'), ok)
    await noticeOf(rail, search('mechanical keyboards gaming'), ok)
    await noticeOf(rail, search('mechanical keyboards 2026'), ok)
    expect(await noticeOf(rail, search('weather in london'), ok)).toMatch(/ask_user/)
    expect((await rail.observe(search('weather in tokyo'), ok)).observation?.streak).toBe(5)
  })

  it('refuses pre-execution once the consecutive-search cap is reached, with a reason the model can act on', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      expect(await rail.gate(search(`mechanical keyboards run ${i}`))).toEqual({ ok: true })
      await noticeOf(rail, search(`mechanical keyboards run ${i}`), ok)
    }
    const refusal = await rail.gate(search('mechanical keyboards run 99'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) {
      expect(refusal.reason).toContain('consecutive searches with nothing opened between them')
      expect(refusal.reason).toContain('a navigate to a search URL or a search box query')
      expect(refusal.reason).not.toMatch(/similar|one intent|q= navigate/)
      expect(refusal.reason).not.toMatch(/web_search|read_url/)
      expect(refusal.reason).toMatch(String(SEARCH_LOOP_REFUSE_AFTER))
      expect(refusal.reason).toMatch(/ask_user|change strategy/i)
      // AC2: unchanged but where it names the move the nudge names.
      expect(refusal.reason).toContain('open a result by its ref or its href')
    }
  })

  it('refuses a genuinely different search at the cap too — five searches without opening anything is the loop (ADR 0058)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await noticeOf(rail, search(`mechanical keyboards run ${i}`), ok)
    }
    expect((await rail.gate(search('train times tokyo osaka'))).ok).toBe(false)
  })

  it('clears the cap only after escaping — reading between searches is inspection, not escape (run 53)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await noticeOf(rail, search(`mechanical keyboards run ${i}`), ok)
    }
    expect((await rail.gate(search('mechanical keyboards run 99'))).ok).toBe(false)
    // The run-53 shape: read_page between reworded searches kept the rail
    // from ever firing — a read never resets the streak now.
    await noticeOf(rail, other('read_page'), ok)
    expect((await rail.gate(search('mechanical keyboards run 100'))).ok).toBe(false)
    // A failed escape consumed nothing; the streak survives it too.
    await noticeOf(rail, other('click'), fail)
    expect((await rail.gate(search('mechanical keyboards run 101'))).ok).toBe(false)
    // Opening a result is the escape — the cap clears.
    await noticeOf(rail, other('click'), ok)
    expect(await rail.gate(search('mechanical keyboards run 102'))).toEqual({ ok: true })
  })

  it('a blank type into the search box has nothing to chain on — ordinary call, not a search', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('mechanical keyboards'), ok)
    await noticeOf(rail, search('mechanical keyboards gaming'), ok)
    expect(await rail.gate(type(7, '\n'))).toEqual({ ok: true })
    // Failed: leaves the streak alone. Successful: resets like any other tool.
    expect(await noticeOf(rail, type(7, '\n'), fail)).toBeNull()
    expect(await noticeOf(rail, type(7, '\n'), ok)).toBeNull()
    expect(await noticeOf(rail, search('mechanical keyboards gaming 2026'), ok)).toBeNull()
  })

  it('only rails searches — other tools pass the gate untouched', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await noticeOf(rail, search(`mechanical keyboards run ${i}`), ok)
    }
    expect(await rail.gate(other('navigate'))).toEqual({ ok: true })
    expect(await rail.gate(other('look'))).toEqual({ ok: true })
  })
})

describe('createSearchLoopRail GUI search signature (#82)', () => {
  it('counts a q=-carrying navigate as a search observation, not a streak reset', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('reddit manhwa tier list horizon'), ok)
    await noticeOf(rail, search('reddit manhwa tier list horizon boxer'), ok)
    // Run 47's hole: this navigate is the same search reworded — before #82
    // it wiped the streak as a successful "other" tool call.
    const nudge = await noticeOf(rail, 
      nav('https://www.google.com/search?q=reddit+manhwa+tier+list+horizon+boxer'),
      ok,
    )
    expect(nudge).toMatch(/ask_user/)
  })

  it('counts plain search-term navigations as searches too', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('best mechanical keyboards 2026'), ok)
    await noticeOf(rail, search('best mechanical keyboard 2026 reddit'), ok)
    expect(await noticeOf(rail, nav('best mechanical keyboards 2026 guide'), ok)).toMatch(/ask_user/)
  })

  it('a successful navigate to a plain URL still resets the streak', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('best mechanical keyboards 2026'), ok)
    await noticeOf(rail, search('best mechanical keyboard 2026 reddit'), ok)
    expect(await noticeOf(rail, nav('https://www.reddit.com/r/manhwa/comments/z8sfnn/'), ok)).toBeNull()
    expect(await noticeOf(rail, search('best mechanical keyboards 2026 guide'), ok)).toBeNull()
  })

  it('refuses a q=-carrying navigate at the cap, before it executes', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await noticeOf(rail, nav(`https://www.google.com/search?q=reddit+manhwa+tier+list+run+${i}`), ok)
    }
    const refusal = await rail.gate(nav('https://www.reddit.com/r/manhwa/search/?q=reddit+manhwa+tier+list'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/ask_user/)
  })

  it('refuses a genuinely different q= navigate at the cap — the engine and the terms are not the point (ADR 0058)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await noticeOf(rail, nav(`https://www.google.com/search?q=reddit+manhwa+tier+list+run+${i}`), ok)
    }
    expect((await rail.gate(nav('https://www.bing.com/search?q=train+times+tokyo'))).ok).toBe(false)
  })

  it('counts text typed into a search input as a search observation', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, type(7, 'reddit manhwa tier list horizon\n'), ok)
    await noticeOf(rail, type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(await noticeOf(rail, type(7, 'reddit manhwa tier list 2023\n'), ok)).toMatch(/ask_user/)
  })

  it('refuses a typed search at the cap, before it executes', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await noticeOf(rail, type(7, `reddit manhwa tier list run ${i}\n`), ok)
    }
    const refusal = await rail.gate(type(7, 'reddit manhwa tier list once more\n'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/search box/)
  })

  it('a type into an ordinary input is an other tool call — success resets, and the gate never refuses it', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, type(7, 'reddit manhwa tier list horizon\n'), ok)
    await noticeOf(rail, type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(await noticeOf(rail, type(8, 'someone@example.com'), ok)).toBeNull()
    expect(await noticeOf(rail, type(7, 'reddit manhwa tier list 2023\n'), ok)).toBeNull()
  })

  it('types classify via describeRef once per call — the gate result memoizes into observe', async () => {
    let describeRefCalls = 0
    const rail = createSearchLoopRail({
      describeRef: async (n) => {
        describeRefCalls += 1
        return n === 7 ? ref({ label: 'Search' }) : undefined
      },
    })
    const first = type(7, 'reddit manhwa tier list horizon\n')
    await rail.gate(first)
    await noticeOf(rail, first, ok)
    await noticeOf(rail, type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(describeRefCalls).toBe(2) // one per distinct call, not per gate+observe
  })

  it('without describeRef, typed searches cannot be classified and pass as ordinary calls', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER + 1; i += 1) {
      expect(await rail.gate(type(7, `reddit manhwa tier list run ${i}\n`))).toEqual({ ok: true })
      expect(await noticeOf(rail, type(7, `reddit manhwa tier list run ${i}\n`), ok)).toBeNull()
    }
  })
})

describe('createSearchLoopRail — inspection is not escape, one Search Intent across scope (#238, ADR 0048)', () => {
  it('a scroll or a Look between searches continues the streak', async () => {
    for (const inspection of ['scroll', 'look']) {
      const rail = createSearchLoopRail(searchBoxAt)
      await noticeOf(rail, search('harrison longitude watch'), ok)
      await noticeOf(rail, other(inspection), ok)
      await noticeOf(rail, search('harrison longitude watch catalogue'), ok)
      await noticeOf(rail, other(inspection), ok)
      expect(await noticeOf(rail, search('harrison longitude watch collection'), ok), inspection).toMatch(/ask_user/)
    }
  })

  it('a successful click or a navigate to a plain URL between searches resets it', async () => {
    for (const escape of [other('click'), nav('https://www.rmg.co.uk/collections/objects/rmgc-object-79142')]) {
      const rail = createSearchLoopRail(searchBoxAt)
      await noticeOf(rail, search('harrison longitude watch'), ok)
      await noticeOf(rail, search('harrison longitude watch catalogue'), ok)
      await noticeOf(rail, escape, ok)
      expect(await noticeOf(rail, search('harrison longitude watch collection'), ok), escape.name).toBeNull()
    }
  })

  it('a refused scroll changes nothing', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, search('harrison longitude watch'), ok)
    await noticeOf(rail, search('harrison longitude watch catalogue'), ok)
    await noticeOf(rail, other('scroll'), fail)
    expect(await noticeOf(rail, search('harrison longitude watch collection'), ok)).toMatch(/ask_user/)
  })

  it('chains a site: search on an engine to the same terms typed into the site’s own box', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, nav('https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+watch'), ok)
    await noticeOf(rail, type(7, 'Harrison longitude watch\n'), ok)
    expect(await noticeOf(rail, nav('https://duckduckgo.com/?q=science.rmg.co.uk+Harrison+longitude+watch+H4'), ok)).toMatch(/ask_user/)
  })

  it('a search that is nothing but scope is still a search, and repeating it continues the streak (Decision 2)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await noticeOf(rail, nav('https://www.bing.com/search?q=site%3Armg.co.uk'), ok)
    await noticeOf(rail, type(7, 'site:rmg.co.uk\n'), ok)
    expect(await noticeOf(rail, nav('https://duckduckgo.com/?q=site%3Armg.co.uk'), ok)).toMatch(/ask_user/)

    // A scope-only search after a terms search over the same scope continues
    // that streak rather than starting its own (AC2).
    const sharedScope = createSearchLoopRail(searchBoxAt)
    await noticeOf(sharedScope, nav('https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+watch'), ok)
    await noticeOf(sharedScope, type(7, 'site:rmg.co.uk\n'), ok)
    expect(await noticeOf(sharedScope, nav('https://www.bing.com/search?q=site%3Armg.co.uk+Harrison+longitude+watch+H4'), ok)).toMatch(/ask_user/)

    const hostOnly = createSearchLoopRail(searchBoxAt)
    await noticeOf(hostOnly, type(7, 'eurostar.com\n'), ok)
    await noticeOf(hostOnly, type(7, 'eurostar.com\n'), ok)
    expect(await noticeOf(hostOnly, type(7, 'eurostar.com\n'), ok)).toMatch(/ask_user/)
  })
})

describe('createSearchLoopRail — the verdict carries what the rail observed (#243, ADR 0049)', () => {
  it('observes a typed search into a search input with the query as typed and the streak it left', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect(await rail.observe(type(7, 'harrison longitude watch\n'), ok)).toEqual({
      notice: null,
      observation: { query: 'harrison longitude watch', signature: 'input', streak: 1 },
    })
    expect((await rail.observe(type(7, 'harrison longitude watch catalogue\n'), ok)).observation).toEqual({
      query: 'harrison longitude watch catalogue',
      signature: 'input',
      streak: 2,
    })
  })

  it('observes a q= navigate under the url signature, with the decoded query', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect((await rail.observe(nav('https://www.bing.com/search?q=site%3Armg.co.uk+harrison+watch'), ok)).observation).toEqual({
      query: 'site:rmg.co.uk harrison watch',
      signature: 'url',
      streak: 1,
    })
  })

  it('observes a site search submitted as a path segment under the url signature (#260, ADR 0059)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect((await rail.observe(nav('https://www.rmg.co.uk/collections/objects/search/Harrison'), ok)).observation).toEqual({
      query: 'Harrison',
      signature: 'url',
      streak: 1,
    })
    expect((await rail.observe(nav('https://www.rmg.co.uk/search?query=harrison%20marine%20timekeeper'), ok)).observation).toEqual({
      query: 'harrison marine timekeeper',
      signature: 'url',
      streak: 2,
    })
    // The archive's lookup API is no search: a successful one is an opening.
    expect(await rail.observe(nav('http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov&filter=statuscode:200'), ok)).toEqual({ notice: null, observation: null })
    expect((await rail.observe(nav('https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper'), ok)).observation?.streak).toBe(1)
  })

  it('replays the longitude-watch loop of fix-258-259 pass 1 to the nudge at round 12 (#260, AC3)', async () => {
    // Round 4 typed into the museum's search box, which settled on the path
    // form; rounds 5 and 12 composed that form by hand, with a page read and
    // five scrolls of the listing between. Before ADR 0059 each hand-composed
    // search was an opening and the streak never left 1.
    const rail = createSearchLoopRail(searchBoxAt)
    const rounds: [number, ToolCall][] = [
      [4, type(7, 'Harrison sea watch\n')],
      [5, nav('https://www.rmg.co.uk/collections/objects/search/Harrison')],
      [6, other('read_page')],
      [7, other('scroll')],
      [8, other('scroll')],
      [9, other('scroll')],
      [10, other('scroll')],
      [11, other('scroll')],
      [12, nav('https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper')],
    ]
    const verdicts = new Map<number, Awaited<ReturnType<SearchLoopRail['observe']>>>()
    for (const [round, call] of rounds) {
      expect(await rail.gate(call), `round ${round}`).toEqual({ ok: true })
      verdicts.set(round, await rail.observe(call, ok))
    }
    expect([4, 5, 12].map((round) => verdicts.get(round)?.observation?.streak)).toEqual([1, 2, 3])
    expect(verdicts.get(12)?.observation).toMatchObject({ query: 'Harrison timekeeper', signature: 'url' })
    expect(verdicts.get(5)?.notice).toBeNull()
    expect(verdicts.get(12)?.notice).toContain('nothing opened between them')
  })

  it('leaves no observation for a typed non-search, and a successful one still resets', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await rail.observe(type(7, 'harrison longitude watch\n'), ok)
    await rail.observe(type(7, 'harrison longitude watch catalogue\n'), ok)
    expect(await rail.observe(type(8, 'someone@example.com'), ok)).toEqual({ notice: null, observation: null })
    expect((await rail.observe(type(7, 'harrison longitude watch collection\n'), ok)).observation?.streak).toBe(1)
  })

  it('leaves no observation for inspection', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await rail.observe(type(7, 'harrison longitude watch\n'), ok)
    for (const name of ['read_page', 'look', 'scroll']) {
      expect(await rail.observe(other(name), ok), name).toEqual({ notice: null, observation: null })
    }
  })

  it('observes a refused search with the streak the rail advanced to', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.observe(type(7, `harrison longitude watch run ${i}\n`), ok)
    }
    const refused = type(7, 'harrison longitude watch run 99\n')
    const gate = await rail.gate(refused)
    expect(gate.ok).toBe(false)
    const verdict = await rail.observe(refused, { ok: false, error: gate.ok ? '' : gate.reason })
    expect(verdict.observation).toEqual({ query: 'harrison longitude watch run 99', signature: 'input', streak: SEARCH_LOOP_REFUSE_AFTER + 1 })
    expect(verdict.notice).toMatch(/ask_user/)
  })
})

describe('createSearchLoopRail — a Not-found Landing is inspection (#239, ADR 0050)', () => {
  it('continues the streak across a composed navigate that landed not found, and resets on one that landed on a page', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(nav('https://duckduckgo.com/?q=voyager+golden+record+2013'), ok)
    const guess = nav('https://www.nasa.gov/voyager-2013')
    expect(await rail.observe(guess, { ok: true, result: 'navigated: url=https://www.nasa.gov/voyager-2013 title="Page Not Found - NASA"\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.' })).toEqual({ notice: null, observation: null })

    const similar = await rail.observe(nav('https://duckduckgo.com/?q=voyager+golden+record+2013+release'), ok)
    expect(similar.observation?.streak).toBe(2)

    await rail.observe(nav('https://www.nasa.gov/voyager/'), ok)
    expect((await rail.observe(nav('https://duckduckgo.com/?q=voyager+golden+record+2013'), ok)).observation?.streak).toBe(1)
  })
})

describe('createSearchLoopRail — a Blocked Action or an inert click holds the streak (#261, ADR 0058)', () => {
  // fix-258-259 pass 2, the longitude watch on rmg.co.uk. Round 3's click
  // dismissed a consent banner and changed the page signature (escape);
  // rounds 4 and 6 met the header's closed search drawer (Blocked Actions).
  const blockedType: ToolResultOutcome = { ok: true, result: 'typed [7]: not typed — blocked by overlay' }
  const blockedClick: ToolResultOutcome = { ok: true, result: 'clicked [9]: not clicked — blocked by overlay' }
  const inertClick: ToolResultOutcome = { ok: true, result: 'clicked [9]: urlChanged=false dialogOpen=false; no observable change' }
  const changedClick: ToolResultOutcome = {
    ok: true,
    result: 'clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n# Collections — https://www.rmg.co.uk/collections/objects\nviewport 1280x800 scroll 0/4435\nsignature 3f2a91c0',
  }

  it('a blocked type into a search input stays a search, and a blocked click between two searches holds the streak (rounds 4–6)', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect((await rail.observe(type(7, 'Harrison longitude watch'), blockedType)).observation?.streak).toBe(1)
    expect(await rail.observe({ id: 'c', name: 'click', args: { ref: 9 } }, blockedClick)).toEqual({ notice: null, observation: null })
    expect((await rail.observe(type(7, 'Harrison longitude watch\n'), ok)).observation?.streak).toBe(2)
  })

  it('an inert click between two searches holds the streak too', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await rail.observe(type(7, 'Harrison longitude watch'), blockedType)
    await rail.observe({ id: 'c', name: 'click', args: { ref: 9 } }, inertClick)
    expect((await rail.observe(type(7, 'Harrison longitude watch\n'), ok)).observation?.streak).toBe(2)
  })

  it('a click that changed the page signature still resets (round 3), so pass 2 reads 1 → 0 → 1 across rounds 2–4', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    expect((await rail.observe(type(7, 'Harrison longitude watch'), blockedType)).observation?.streak).toBe(1)
    await rail.observe({ id: 'c', name: 'click', args: { ref: 8 } }, changedClick)
    expect((await rail.observe(type(7, 'Harrison longitude watch'), blockedType)).observation?.streak).toBe(1)
  })
})

describe('createSearchLoopRail replay of failed run 47 (#82/#83)', () => {
  // The actual 80-call sequence from history.db run 47 (the run that
  // motived #74 and whose navigates-to-search-URLs defeated the old rail):
  // 21 searches, 13 navigations to google/reddit search URLs, all one
  // intent reworded ~34 ways. Feed-line projections — 'search "q"' was the
  // off-screen web_search then; since #83 every search is on-screen, so it
  // replays as the same query typed into a search box (submitted by the
  // trailing newline). '→ url' is navigate, the rest are read/click/scroll.
  // The history entries record no per-call outcome; like the #74-era
  // diagnosis replay, every non-refused call is observed as successful (the
  // run reached round 80, so nothing here ended it).
  function callFrom(entry: string): ToolCall {
    if (entry.startsWith('search "')) {
      return { id: entry, name: 'type', args: { ref: 7, text: `${entry.slice(8, entry.lastIndexOf('"'))}\n` } }
    }
    if (entry.startsWith('→ ')) {
      return { id: entry, name: 'navigate', args: { url: entry.slice(2) } }
    }
    if (entry.startsWith('read')) return { id: entry, name: 'read_page', args: {} }
    if (entry.startsWith('click')) return { id: entry, name: 'click', args: {} }
    return { id: entry, name: 'scroll', args: {} }
  }

  it('produces refusals under the GUI signature alone', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    let refusals = 0
    let nudges = 0
    let searchObservations = 0
    for (const entry of run47Sequence) {
      const call = callFrom(entry)
      const gate = await rail.gate(call)
      // The pipeline observes refused calls too (failed outcome) — search
      // observations chain regardless of outcome.
      const verdict = await rail.observe(call, gate.ok ? ok : fail)
      if (!gate.ok) refusals += 1
      if (verdict.observation !== null) searchObservations += 1
      if (verdict.notice !== null) nudges += 1
    }
    expect(run47Sequence).toHaveLength(80)
    // 21 typed searches plus the 22 navigations the feed shows going to
    // q=-carrying URLs — one merged search stream under the GUI signature.
    expect(searchObservations).toBeGreaterThanOrEqual(34)
    // The run's searches were similar, so the consecutive rule (ADR 0058)
    // fires everywhere the same-intent rule did and more: its count is a
    // superset (AC1). Under ADR 0048 this replay produced 3 refusals.
    expect(nudges).toBeGreaterThanOrEqual(1)
    expect(refusals).toBeGreaterThanOrEqual(3)
  })
})

