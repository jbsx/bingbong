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
  type SearchLoopRailDeps,
} from './searchLoopRail'

// Issue #74, run rails: the rail that breaks blind search loops — pure
// token similarity over the streak, advisory nudge first, pre-execution
// refusal second. Issue #82 re-targets the observable to the GUI search
// signature (web_search coexists with q= navigations and typed search box
// queries). See the module header for the full policy.

function search(query: string): ToolCall {
  return { id: 's', name: 'web_search', args: { query } }
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

  it('stays quiet while consecutive searches explore different intents', async () => {
    const rail = createSearchLoopRail()
    expect(await rail.gate(search('mechanical keyboards'))).toEqual({ ok: true })
    expect(await rail.observe(search('mechanical keyboards'), ok)).toBeNull()
    expect(await rail.gate(search('weather london'))).toEqual({ ok: true })
    expect(await rail.observe(search('weather london'), ok)).toBeNull()
  })

  it('nudges on the nth consecutive similar search — advisory, never a refusal', async () => {
    const rail = createSearchLoopRail()
    for (let i = 1; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      expect(await rail.gate(search(`best mechanical keyboards 2026 v${i}`))).toEqual({ ok: true })
      expect(await rail.observe(search(`best mechanical keyboards 2026 v${i}`), ok)).toBeNull()
    }
    const last = `best mechanical keyboards 2026 v${SEARCH_LOOP_NUDGE_AFTER}`
    expect(await rail.gate(search(last))).toEqual({ ok: true })
    const nudge = await rail.observe(search(last), ok)
    expect(nudge).toMatch(/reword|same intent|one intent/i)
    expect(nudge).toMatch(/web_search/)
    expect(nudge).toMatch(/ask_user/)
    expect(nudge).toMatch(/navigate|read|open|href/i)
  })

  it('catches slow drift: each query similar to the previous, not to the first', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('best mechanical keyboards 2026'), ok)
    await rail.observe(search('best mechanical keyboards 2027'), ok)
    // Similar to the previous query, but only 0.5 against the first —
    // anchor-only comparison would reset here and miss the drift loop.
    expect(await rail.observe(search('mechanical keyboards 2027'), ok)).toMatch(/ask_user/)
  })

  it('chains a return to the original wording after drifting away from it (#82)', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('reddit manhwa tier list horizon'), ok)
    // Similar to the previous (0.67) — streak 2.
    await rail.observe(search('reddit manhwa tier list horizon boxer image'), ok)
    // Only 0.56 against the previous query — below no threshold this rail
    // has ever used — but 0.67 against the anchor, so the streak continues.
    expect(await rail.observe(search('reddit manhwa tier list 2023 site'), ok)).toMatch(/ask_user/)
  })

  it('resets the streak when a successful other tool intervenes', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      await rail.observe(search('mechanical keyboards gaming'), ok)
    }
    await rail.observe(other('navigate'), ok)
    expect(await rail.gate(search('mechanical keyboards gaming'))).toEqual({ ok: true })
    expect(await rail.observe(search('mechanical keyboards gaming'), ok)).toBeNull()
  })

  it('keeps the streak when the intervening tool fails — the model is still blind (run 46)', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('mechanical keyboards'), ok)
    await rail.observe(search('mechanical keyboards gaming'), ok)
    expect(await rail.observe(other('navigate'), fail)).toBeNull()
    expect(await rail.observe(search('mechanical keyboards gaming 2026'), ok)).toMatch(/ask_user/)
  })

  it('resets the streak when the model moves to a new search intent', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('mechanical keyboards'), ok)
    await rail.observe(search('mechanical keyboards gaming'), ok)
    await rail.observe(search('mechanical keyboards 2026'), ok)
    expect(await rail.observe(search('weather in london'), ok)).toBeNull()
    expect(await rail.observe(search('weather in tokyo'), ok)).toBeNull()
  })

  it('refuses pre-execution once the consecutive-similar cap is reached, with a reason the model can act on', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      expect(await rail.gate(search(`mechanical keyboards run ${i}`))).toEqual({ ok: true })
      await rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    const refusal = await rail.gate(search('mechanical keyboards run 99'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) {
      expect(refusal.reason).toMatch(/web_search/)
      expect(refusal.reason).toMatch(String(SEARCH_LOOP_REFUSE_AFTER))
      expect(refusal.reason).toMatch(/ask_user|change strategy/i)
    }
  })

  it('lets a genuinely different search through even at the cap — the rail loops on intent, not the tool', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect(await rail.gate(search('train times tokyo osaka'))).toEqual({ ok: true })
  })

  it('clears the cap after a successful other tool call — following the nudge recovers search', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect((await rail.gate(search('mechanical keyboards run 99'))).ok).toBe(false)
    await rail.observe(other('read_page'), ok)
    expect(await rail.gate(search('mechanical keyboards after reading'))).toEqual({ ok: true })
  })

  it('treats a web_search without a usable query as a reset, never a throw', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('mechanical keyboards'), ok)
    await rail.observe(search('mechanical keyboards gaming'), ok)
    expect(await rail.observe({ id: 's', name: 'web_search', args: {} }, fail)).toBeNull()
    expect(await rail.gate({ id: 's', name: 'web_search', args: { query: 7 } })).toEqual({ ok: true })
  })

  it('only rails searches — other tools pass the gate untouched', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.gate(search(`mechanical keyboards run ${i}`))
      await rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect(await rail.gate(other('navigate'))).toEqual({ ok: true })
    expect(await rail.gate(other('look'))).toEqual({ ok: true })
  })
})

describe('createSearchLoopRail GUI search signature (#82)', () => {
  it('counts a q=-carrying navigate as a search observation, not a streak reset', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('reddit manhwa tier list horizon'), ok)
    await rail.observe(search('reddit manhwa tier list horizon boxer'), ok)
    // Run 47's hole: this navigate is the same search reworded — before #82
    // it wiped the streak as a successful "other" tool call.
    const nudge = await rail.observe(
      nav('https://www.google.com/search?q=reddit+manhwa+tier+list+horizon+boxer'),
      ok,
    )
    expect(nudge).toMatch(/ask_user/)
  })

  it('counts plain search-term navigations as searches too', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('best mechanical keyboards 2026'), ok)
    await rail.observe(search('best mechanical keyboard 2026 reddit'), ok)
    expect(await rail.observe(nav('best mechanical keyboards 2026 guide'), ok)).toMatch(/ask_user/)
  })

  it('a successful navigate to a plain URL still resets the streak', async () => {
    const rail = createSearchLoopRail()
    await rail.observe(search('best mechanical keyboards 2026'), ok)
    await rail.observe(search('best mechanical keyboard 2026 reddit'), ok)
    expect(await rail.observe(nav('https://www.reddit.com/r/manhwa/comments/z8sfnn/'), ok)).toBeNull()
    expect(await rail.observe(search('best mechanical keyboards 2026 guide'), ok)).toBeNull()
  })

  it('refuses a q=-carrying navigate at the cap, before it executes', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.observe(nav(`https://www.google.com/search?q=reddit+manhwa+tier+list+run+${i}`), ok)
    }
    const refusal = await rail.gate(nav('https://www.reddit.com/r/manhwa/search/?q=reddit+manhwa+tier+list'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/ask_user/)
  })

  it('lets a genuinely different q= navigate through even at the cap', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.observe(nav(`https://www.google.com/search?q=reddit+manhwa+tier+list+run+${i}`), ok)
    }
    expect(await rail.gate(nav('https://www.google.com/search?q=train+times+tokyo'))).toEqual({ ok: true })
  })

  it('counts text typed into a search input as a search observation', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await rail.observe(type(7, 'reddit manhwa tier list horizon\n'), ok)
    await rail.observe(type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(await rail.observe(type(7, 'reddit manhwa tier list 2023\n'), ok)).toMatch(/ask_user/)
  })

  it('refuses a typed search at the cap, before it executes', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      await rail.observe(type(7, `reddit manhwa tier list run ${i}\n`), ok)
    }
    const refusal = await rail.gate(type(7, 'reddit manhwa tier list once more\n'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/search box/)
  })

  it('a type into an ordinary input is an other tool call — success resets, and the gate never refuses it', async () => {
    const rail = createSearchLoopRail(searchBoxAt)
    await rail.observe(type(7, 'reddit manhwa tier list horizon\n'), ok)
    await rail.observe(type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(await rail.observe(type(8, 'someone@example.com'), ok)).toBeNull()
    expect(await rail.observe(type(7, 'reddit manhwa tier list 2023\n'), ok)).toBeNull()
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
    await rail.observe(first, ok)
    await rail.observe(type(7, 'reddit manhwa tier list horizon boxer\n'), ok)
    expect(describeRefCalls).toBe(2) // one per distinct call, not per gate+observe
  })

  it('without describeRef, typed searches cannot be classified and pass as ordinary calls', async () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER + 1; i += 1) {
      expect(await rail.gate(type(7, `reddit manhwa tier list run ${i}\n`))).toEqual({ ok: true })
      expect(await rail.observe(type(7, `reddit manhwa tier list run ${i}\n`), ok)).toBeNull()
    }
  })
})

describe('createSearchLoopRail replay of failed run 47 (#82)', () => {
  // The actual 80-call sequence from history.db run 47 (the run that
  // motived #74 and whose navigates-to-search-URLs defeated the old rail):
  // 21 web_search calls, 13 navigations to google/reddit search URLs, all
  // one intent reworded ~34 ways. Feed-line projections — 'search "q"' is
  // web_search, '→ url' is navigate, the rest are read/click/scroll. The
  // history entries record no per-call outcome; like the #74-era diagnosis
  // replay, every non-refused call is observed as successful (the run
  // reached round 80, so nothing here ended it).
  function callFrom(entry: string): ToolCall {
    if (entry.startsWith('search "')) {
      return { id: entry, name: 'web_search', args: { query: entry.slice(8, entry.lastIndexOf('"')) } }
    }
    if (entry.startsWith('→ ')) {
      return { id: entry, name: 'navigate', args: { url: entry.slice(2) } }
    }
    if (entry.startsWith('read')) return { id: entry, name: 'read_page', args: {} }
    if (entry.startsWith('click')) return { id: entry, name: 'click', args: {} }
    return { id: entry, name: 'scroll', args: {} }
  }

  it('produces refusals where the pre-#82 rail produced zero', async () => {
    const rail = createSearchLoopRail()
    let refusals = 0
    let nudges = 0
    let searchObservations = 0
    for (const entry of run47Sequence) {
      const call = callFrom(entry)
      const gate = await rail.gate(call)
      if (!gate.ok) {
        refusals += 1
        // The pipeline observes refused calls too (failed outcome) — search
        // observations chain regardless of outcome.
        await rail.observe(call, fail)
        continue
      }
      const url = call.args.url
      if (
        call.name === 'web_search' ||
        (call.name === 'navigate' && typeof url === 'string' && searchQueryFromUrl(url) !== null)
      ) {
        searchObservations += 1
      }
      if ((await rail.observe(call, ok)) !== null) nudges += 1
    }
    expect(run47Sequence).toHaveLength(80)
    // 21 web_search calls plus the 22 navigations the feed shows going to
    // q=-carrying URLs — one merged search stream under the new
    // observable, where the old rail saw 21 searches and 22 resets.
    expect(searchObservations).toBeGreaterThanOrEqual(34)
    expect(nudges).toBeGreaterThanOrEqual(1)
    expect(refusals).toBeGreaterThanOrEqual(3)
  })
})
