import { describe, expect, it } from 'vitest'
import type { CommandRef } from './command'
import { bestGuess, carriesWordsPastAddress, localMatch } from './localMatch'

// The Local Match (CONTEXT.md, ADR 0076): a Command settled from the
// Utterance and the page alone — the CLI grammar, or a plain verb and a
// label exactly one ref carries. The best guess is the same reading made
// lenient: what fires when Jev does not answer in time.

const REFS: CommandRef[] = [
  { ref: 1, kind: 'link', label: 'Home', href: 'https://example.com/', inputType: null },
  { ref: 2, kind: 'button', label: 'Sign in', href: null, inputType: null },
  { ref: 3, kind: 'input', label: 'Search', href: null, inputType: 'search' },
  { ref: 4, kind: 'link', label: 'Sign in with Google', href: 'https://example.com/google', inputType: null },
  { ref: 5, kind: 'button', label: 'Accept all', href: null, inputType: null },
  { ref: 6, kind: 'link', label: 'Trending', href: 'https://example.com/trending', inputType: null },
]

const SEARCH_URL = 'https://duckduckgo.com/?q=elon+musk+profile&t=h_'
const RESULTS: CommandRef[] = [
  { ref: 1, kind: 'link', label: 'DuckDuckGo home', href: 'https://duckduckgo.com/', inputType: null },
  { ref: 2, kind: 'input', label: 'Search', href: null, inputType: 'search' },
  { ref: 3, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null },
  { ref: 4, kind: 'link', label: 'Ad · Profiles', href: 'https://duckduckgo.com/y.js?ad_provider=bing', inputType: null },
  { ref: 5, kind: 'link', label: 'Elon Musk - Wikipedia', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk', inputType: null },
  { ref: 6, kind: 'link', label: 'Settings', href: 'https://duckduckgo.com/settings', inputType: null },
]

describe('the Local Match: reload (#328)', () => {
  it('reads the grammar and the spoken verb as a reload', () => {
    expect(localMatch('reload', REFS)).toEqual({ verb: 'reload', target: null, slot: null })
    expect(localMatch('refresh the page', REFS)).toEqual({ verb: 'reload', target: null, slot: null })
    expect(localMatch('reload page', REFS)).toEqual({ verb: 'reload', target: null, slot: null })
  })
})

describe('the Local Match: resume (the Last Page)', () => {
  it('reads the grammar and the spoken phrases as a resume, without asking the page', () => {
    expect(localMatch('resume', [])).toEqual({ verb: 'resume', target: null, slot: null })
    expect(localMatch('continue', REFS)).toEqual({ verb: 'resume', target: null, slot: null })
    expect(localMatch('where was I', REFS)).toEqual({ verb: 'resume', target: null, slot: null })
    expect(localMatch('pick up where I left off', REFS)).toEqual({ verb: 'resume', target: null, slot: null })
    expect(localMatch('the last page', REFS)).toEqual({ verb: 'resume', target: null, slot: null })
  })
})

describe('the Local Match: the Nth result on a search page', () => {
  it('reads "the first result" and "second link" as the Nth link that leaves the engine, or its redirect to one', () => {
    expect(localMatch('open the first result', RESULTS, SEARCH_URL)).toEqual({ verb: 'click', target: 3, slot: null })
    expect(localMatch('click on the first link', RESULTS, SEARCH_URL)).toEqual({ verb: 'click', target: 3, slot: null })
    expect(localMatch('open the second one', RESULTS, SEARCH_URL)).toEqual({ verb: 'click', target: 5, slot: null })
    expect(localMatch('click 2nd result', RESULTS, SEARCH_URL)).toEqual({ verb: 'click', target: 5, slot: null })
    expect(localMatch('open the top result', RESULTS, SEARCH_URL)).toEqual({ verb: 'click', target: 3, slot: null })
  })

  it('settles nothing past the last result, or off a search page — Jev reads the page then', () => {
    expect(localMatch('open the third result', RESULTS, SEARCH_URL)).toBeNull()
    expect(localMatch('open the first result', REFS, 'https://example.com/')).toBeNull()
    expect(localMatch('click the first video', REFS, 'https://www.youtube.com/')).toBeNull()
    // The best guess off a search page: the words as an address, which is a search.
    expect(bestGuess('open the first result', REFS, 'https://example.com/')).toEqual({ verb: 'open', target: null, slot: 'the first result' })
  })

  it('does not read a longer phrase as an ordinal', () => {
    expect(localMatch('open the first video on the left', RESULTS, SEARCH_URL)).toBeNull()
  })
})

describe('the Local Match: the CLI grammar', () => {
  it('reads the CLI grammar as Commands, with no page needed', () => {
    expect(localMatch('navigate youtube.com', [])).toEqual({ verb: 'open', target: null, slot: 'youtube.com' })
    expect(localMatch('read', [])).toEqual({ verb: 'read', target: null, slot: null })
    expect(localMatch('click 7', [])).toEqual({ verb: 'click', target: 7, slot: null })
    expect(localMatch('type 3 hello world', [])).toEqual({ verb: 'type', target: 3, slot: 'hello world' })
    expect(localMatch('scroll down', [])).toEqual({ verb: 'scroll_down', target: null, slot: null })
    expect(localMatch('scroll up', [])).toEqual({ verb: 'scroll_up', target: null, slot: null })
    expect(localMatch('press enter 2', [])).toEqual({ verb: 'press', target: null, slot: 'enter', key: { key: 'Enter' }, times: 2 })
    expect(localMatch('press next', [])).toMatchObject({ verb: 'press', key: { key: 'n', shift: true }, times: 1 })
    expect(localMatch('back', [])).toEqual({ verb: 'back', target: null, slot: null })
    expect(localMatch('screenshot /tmp/x.jpg', [])).toEqual({ verb: 'screenshot', target: null, slot: '/tmp/x.jpg' })
    expect(localMatch('help', [])).toEqual({ verb: 'help', target: null, slot: null })
  })

  it('leaves a grammar line that does not parse to the spoken reading', () => {
    // `click sign in` is not `click <ref>`; the spoken reading takes it.
    expect(localMatch('click sign in', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    // `quit` is the CLI harness's alone: no Command.
    expect(localMatch('quit', REFS)).toBeNull()
  })
})

describe('the Local Match: plain verbs', () => {
  it('reads the page-free verbs however they are phrased', () => {
    expect(localMatch('scroll down', REFS)).toMatchObject({ verb: 'scroll_down' })
    expect(localMatch('Scroll down.', REFS)).toMatchObject({ verb: 'scroll_down' })
    expect(localMatch('page up', REFS)).toMatchObject({ verb: 'scroll_up' })
    expect(localMatch('go back', REFS)).toMatchObject({ verb: 'back' })
    expect(localMatch('forward', REFS)).toMatchObject({ verb: 'forward' })
    expect(localMatch('read the page', REFS)).toMatchObject({ verb: 'read' })
    expect(localMatch('clear', REFS)).toMatchObject({ verb: 'clear' })
    expect(localMatch('stop', REFS)).toMatchObject({ verb: 'stop' })
    expect(localMatch('never mind', REFS)).toMatchObject({ verb: 'stop' })
  })

  it('reads press with the key the words name', () => {
    expect(localMatch('press enter', REFS)).toEqual({ verb: 'press', target: null, slot: 'enter', key: { key: 'Enter' }, times: 1 })
    expect(localMatch('hit escape', REFS)).toMatchObject({ verb: 'press', key: { key: 'Escape' } })
    expect(localMatch('press the down arrow', REFS)).toMatchObject({ verb: 'press', slot: 'the down arrow', key: { key: 'ArrowDown' } })
    expect(localMatch('enter', REFS)).toMatchObject({ verb: 'press', key: { key: 'Enter' } })
  })

  it('reads open with the Slot verbatim, and search phrasing as search terms', () => {
    expect(localMatch('open youtube', REFS)).toEqual({ verb: 'open', target: null, slot: 'youtube' })
    expect(localMatch('go to news.ycombinator.com', REFS)).toEqual({ verb: 'open', target: null, slot: 'news.ycombinator.com' })
    expect(localMatch('search for rust async book', REFS)).toEqual({ verb: 'open', target: null, slot: 'rust async book', search: true })
    expect(localMatch('look up weather in berlin', REFS)).toMatchObject({ verb: 'open', slot: 'weather in berlin', search: true })
  })

  it('clicks the one ref whose label the words name — articles and kind words aside', () => {
    expect(localMatch('click sign in', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(localMatch('click the Sign In button', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(localMatch('tap trending', REFS)).toEqual({ verb: 'click', target: 6, slot: null })
    expect(localMatch('press accept all', REFS)).toEqual({ verb: 'click', target: 5, slot: null })
    // `open` of a label exactly one ref carries is a click on this page, not a navigate.
    expect(localMatch('open trending', REFS)).toEqual({ verb: 'click', target: 6, slot: null })
  })

  it('settles an open alone only for an address; words about the page that no ref carries are Jev\'s, and the best guess searches them', () => {
    expect(localMatch("open Elon Musk's latest tweet", REFS)).toBeNull()
    expect(bestGuess("open Elon Musk's latest tweet", REFS)).toEqual({ verb: 'open', target: null, slot: "Elon Musk's latest tweet" })
    expect(localMatch('open youtube dot com', REFS)).toEqual({ verb: 'open', target: null, slot: 'youtube dot com' })
    expect(localMatch('go to https://example.org/a?b=1', REFS)).toEqual({ verb: 'open', target: null, slot: 'https://example.org/a?b=1' })
    expect(localMatch('open localhost:3000', REFS)).toEqual({ verb: 'open', target: null, slot: 'localhost:3000' })
  })

  it('settles an open of an address with words past it (#341): the address alone, the words left for the Task', () => {
    expect(localMatch('go to twitter and open donald trumps profile', REFS)).toEqual({ verb: 'open', target: null, slot: 'twitter' })
    expect(localMatch('open youtube and search for lofi', REFS)).toEqual({ verb: 'open', target: null, slot: 'youtube' })
    expect(localMatch('go to youtube dot com then search for lofi', REFS)).toEqual({ verb: 'open', target: null, slot: 'youtube dot com' })
    expect(carriesWordsPastAddress('go to twitter and open donald trumps profile')).toBe(true)
    expect(carriesWordsPastAddress('open youtube and search for lofi')).toBe(true)
    // The address alone carries nothing past it.
    expect(carriesWordsPastAddress('go to twitter')).toBe(false)
    expect(carriesWordsPastAddress('open youtube dot com')).toBe(false)
  })

  it('reads words past a bare word as an address only when another verb phrase follows it', () => {
    // "the" is address-shaped, "settings" too: neither starts a Task on its own words.
    expect(localMatch('open the menu', REFS)).toBeNull()
    expect(localMatch('open settings menu', REFS)).toBeNull()
    expect(localMatch('open the read me', REFS)).toBeNull()
    expect(carriesWordsPastAddress('open settings menu')).toBe(false)
    expect(carriesWordsPastAddress('scroll down and read')).toBe(false)
  })

  it('leaves a span a ref on the page carries to Jev: the page\'s word, not an address', () => {
    const settings = [...REFS, { ref: 7, kind: 'link' as const, label: 'Account settings', href: 'https://example.com/settings', inputType: null }]
    expect(localMatch('open settings and click save', settings)).toBeNull()
    expect(localMatch('go to trending and scroll down', REFS)).toBeNull()
    expect(localMatch('go to twitter and scroll down', REFS)).toEqual({ verb: 'open', target: null, slot: 'twitter' })
  })

  it('makes no Local Match when the label names no ref, or more than one', () => {
    expect(localMatch('click sign', REFS)).toBeNull()
    expect(localMatch('click the first video', REFS)).toBeNull()
    const twoSearches = [...REFS, { ref: 7, kind: 'button' as const, label: 'Search', href: null, inputType: null }]
    expect(localMatch('click search', twoSearches)).toBeNull()
  })

  it('types the Slot into the one ref the words name, or into the one text field', () => {
    expect(localMatch('type hello in the search box', REFS)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
    expect(localMatch('type rust async book into search', REFS)).toEqual({ verb: 'type', target: 3, slot: 'rust async book' })
    expect(localMatch('type hello', REFS)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
    // A page with two text fields leaves a target-less type to Jev.
    const twoFields = [...REFS, { ref: 7, kind: 'input' as const, label: 'Email', href: null, inputType: 'email' }]
    expect(localMatch('type hello', twoFields)).toBeNull()
    expect(localMatch('type hello in the email field', twoFields)).toEqual({ verb: 'type', target: 7, slot: 'hello' })
  })

  it('makes no Local Match of words with no plain verb', () => {
    expect(localMatch('what is the weather like', REFS)).toBeNull()
    expect(localMatch('the first video please', REFS)).toBeNull()
    expect(localMatch('', REFS)).toBeNull()
  })
})

describe('the best guess: the Local Match made lenient', () => {
  it('is the Local Match where one exists', () => {
    expect(bestGuess('click sign in', REFS)).toEqual(localMatch('click sign in', REFS))
    expect(bestGuess('scroll down', REFS)).toEqual(localMatch('scroll down', REFS))
  })

  it('clicks the ref whose label shares the most words, the first on a tie', () => {
    expect(bestGuess('click sign', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(bestGuess('click the google sign in thing', REFS)).toEqual({ verb: 'click', target: 4, slot: null })
    expect(bestGuess('tap on trending videos', REFS)).toEqual({ verb: 'click', target: 6, slot: null })
  })

  it('drops a click whose words name nothing on the page', () => {
    expect(bestGuess('click the first video', REFS)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('types into the nearest field by words, else the first text field', () => {
    const twoFields = [...REFS, { ref: 7, kind: 'input' as const, label: 'Email address', href: null, inputType: 'email' }]
    expect(bestGuess('type bob at example dot com in the email', twoFields)).toEqual({ verb: 'type', target: 7, slot: 'bob at example dot com' })
    expect(bestGuess('type hello', twoFields)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
    expect(bestGuess('type hello', [])).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('reads words with no plain verb as a search — the Misfire the next Command recovers (ADR 0076)', () => {
    expect(bestGuess('rust async book', REFS)).toEqual({ verb: 'open', target: null, slot: 'rust async book', search: true })
  })

  it('reads nothing as nothing', () => {
    expect(bestGuess('', REFS)).toEqual({ verb: 'none', target: null, slot: null })
  })
})
