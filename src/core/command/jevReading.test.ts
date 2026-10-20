import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { CommandPage } from './command'
import { commandQuestions, commandState, dismissPhraseQuestions, doneFacts, doneLine, hopQuestions, onResults, partialQuestions, readCommandAnswers, readDismissChoice, readSteps, readVerdict, slotSpans } from './jevReading'

// One Jev call per Command the Local Match cannot settle (#324, ADR
// 0076): the state is the transcript, the page's address and title and
// its numbered refs — no page text; three Choices are asked in parallel —
// the verb (an action, never a spoken word, #353), the target among the
// refs plus `none`, the Slot among the transcript's contiguous word spans.
// The top Choice is acted on at any confidence; only `none` as the verb
// drops the Utterance.

const PAGE: CommandPage = {
  url: 'https://example.com/',
  title: 'Example',
  refs: [
    { ref: 1, kind: 'link', label: 'Home', href: 'https://example.com/', inputType: null },
    { ref: 2, kind: 'button', label: 'Sign in', href: null, inputType: null },
    { ref: 3, kind: 'input', label: 'Search', href: null, inputType: 'search' },
  ],
}

function choice(label: string, confidence = 0.9): DecisionChoiceAnswer {
  return { type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } }
}

describe('the state Jev reads', () => {
  it('carries the transcript, the page and the numbered refs with label, kind and href — no page text', () => {
    const state = commandState('click the first video', PAGE)
    expect(state).toBe(
      [
        'The user spoke to a web browser: "click the first video"',
        'Page: https://example.com/ — "Example"',
        'Refs (number, kind, label, address):',
        '[1] link "Home" https://example.com/',
        '[2] button "Sign in"',
        '[3] input[search] "Search"',
      ].join('\n'),
    )
  })
})

describe('the state Jev reads with a dialog open (#336)', () => {
  it('gains one line naming the dialog and its text', () => {
    const state = commandState('exit out of this', { ...PAGE, dialog: { text: 'Sign in to X', refs: [2] } })
    expect(state.split('\n')[2]).toBe('A dialog is open: "Sign in to X"')
  })
})

describe('the three questions', () => {
  it('asks the verb among the spoken vocabulary, the target among the refs plus none, the Slot among the word spans', () => {
    const questions = commandQuestions('type hello in search', { ...PAGE, url: 'about:blank' })
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot'])
    expect(questions.verb.type).toBe('choice')
    expect(Object.keys(questions.verb.options)).toEqual(['navigate', 'search', 'click', 'type', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload', 'press', 'read', 'clear', 'stop', 'done', 'none'])
    expect(Object.keys(questions.target.options)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3'])
    expect(questions.target.options['ref-2']).toBe('button "Sign in"')
    expect(Object.keys(questions.slot.options)).toEqual(['none', 's0-0', 's0-1', 's0-2', 's0-3', 's1-1', 's1-2', 's1-3', 's2-2', 's2-3', 's3-3'])
    expect(questions.slot.options['s1-1']).toBe('hello')
    expect(questions.slot.options['s0-3']).toBe('type hello in search')
  })

  it('keeps the Slot spans under the Choice cap by shortening the longest span, never by dropping words', () => {
    const long = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ')
    const spans = slotSpans(long)
    expect(spans.length).toBeLessThanOrEqual(254)
    // Every single word is a span; the longest spans are the ones left out.
    expect(spans.filter((span) => span.start === span.end)).toHaveLength(40)
    expect(Math.max(...spans.map((span) => span.end - span.start + 1))).toBeLessThan(40)
  })
})

describe('reading the answers', () => {
  it('acts on the top choices: the verb, the ref, the span', () => {
    expect(
      readCommandAnswers({ verb: choice('type', 0.4), target: choice('ref-3', 0.3), slot: choice('s1-1', 0.5) }, 'type hello in search', PAGE),
    ).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('drops the Utterance only on a none verb', () => {
    expect(readCommandAnswers({ verb: choice('none', 0.2), target: choice('ref-2'), slot: choice('s0-0') }, 'what time is it', PAGE)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('ignores the answers a verb does not need', () => {
    expect(readCommandAnswers({ verb: choice('scroll_down'), target: choice('ref-2'), slot: choice('s0-1') }, 'scroll down please', PAGE)).toEqual({ verb: 'scroll_down', target: null, slot: null })
    expect(readCommandAnswers({ verb: choice('back'), target: choice('none'), slot: choice('none') }, 'go back', PAGE)).toEqual({ verb: 'back', target: null, slot: null })
  })

  it('reads press through the Slot, Enter when the Slot names no key', () => {
    expect(readCommandAnswers({ verb: choice('press'), target: choice('none'), slot: choice('s1-1') }, 'press escape', PAGE)).toMatchObject({ verb: 'press', slot: 'escape', key: { key: 'Escape' }, times: 1 })
    expect(readCommandAnswers({ verb: choice('press'), target: choice('none'), slot: choice('none') }, 'submit it', PAGE)).toMatchObject({ verb: 'press', key: { key: 'Enter' } })
  })

  it('takes the most probable ref when the target answers none for a verb that needs one', () => {
    const target: DecisionChoiceAnswer = { type: 'choice', choice: 'none', confidence: 0.5, probabilities: { none: 0.5, 'ref-1': 0.1, 'ref-2': 0.35, 'ref-3': 0.05 } }
    expect(readCommandAnswers({ verb: choice('click'), target, slot: choice('none') }, 'click sign', PAGE)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('falls back to the words after the verb when the Slot answers none for a verb that needs one', () => {
    expect(readCommandAnswers({ verb: choice('navigate'), target: choice('none'), slot: choice('none') }, 'please open youtube', PAGE)).toEqual({ verb: 'search', target: null, slot: 'please open youtube' })
    expect(readCommandAnswers({ verb: choice('navigate'), target: choice('none'), slot: choice('none') }, 'open youtube', PAGE)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
    expect(readCommandAnswers({ verb: choice('type'), target: choice('ref-3'), slot: choice('none') }, 'type hello', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('offers the verbs as actions, never a spoken word (#353): navigate and search, no open', () => {
    const questions = commandQuestions('open the tweet', PAGE)
    expect(Object.keys(questions.verb.options)).toEqual(['navigate', 'search', 'click', 'type', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload', 'press', 'read', 'clear', 'stop', 'done', 'none'])
    expect(questions.verb.options).not.toHaveProperty('open')
  })

  it('clicks the ref a search or a navigate names as its target when the words are not an address', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: choice('ref-1', 0.64), slot: choice('none') }, "open elon musk's profile", PAGE)).toEqual({ verb: 'click', target: 1, slot: null })
    expect(readCommandAnswers({ verb: choice('navigate'), target: choice('ref-1', 0.64), slot: choice('none') }, "open elon musk's profile", PAGE)).toEqual({ verb: 'click', target: 1, slot: null })
    // An address-shaped navigate is navigated whatever the target says; a search of words with no ref named searches them off a site.
    expect(readCommandAnswers({ verb: choice('navigate'), target: choice('ref-1'), slot: choice('none') }, 'open youtube', PAGE)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
    expect(readCommandAnswers({ verb: choice('search'), target: choice('none'), slot: choice('none') }, "open elon musk's profile", { ...PAGE, url: 'about:blank' })).toEqual({ verb: 'search', target: null, slot: "elon musk's profile" })
  })

  it('a search of a bare word is a search, not its .com: Jev said search', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: choice('none'), slot: choice('s1-1') }, 'search rust', { ...PAGE, url: 'about:blank' })).toEqual({ verb: 'search', target: null, slot: 'rust' })
  })

  it('drops a click on a page with no refs', () => {
    expect(readCommandAnswers({ verb: choice('click'), target: choice('none'), slot: choice('none') }, 'click it', { ...PAGE, refs: [] })).toEqual({ verb: 'none', target: null, slot: null })
  })
})

describe('the hop reading (#328, ADR 0076 amendment)', () => {
  const SEARCH: CommandPage = {
    url: 'https://duckduckgo.com/?q=latest+elon+musk+tweet',
    title: 'latest elon musk tweet at DuckDuckGo',
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search', href: null, inputType: 'search' },
      { ref: 3, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const LINKS = [
    { label: 'DuckDuckGo home', href: 'https://duckduckgo.com/' },
    { label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk' },
    { label: 'Settings', href: 'https://duckduckgo.com/settings' },
    { label: 'Elon Musk - Wikipedia', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk' },
    { label: 'Elon Musk news', href: 'https://www.reuters.com/elon' },
  ]

  it('offers done among the verbs, at hop 0 too', () => {
    expect(Object.keys(commandQuestions('pull up the latest elon musk tweet', PAGE).verb.options)).toContain('done')
    expect(readCommandAnswers({ verb: choice('done'), target: choice('none'), slot: choice('none') }, 'pull it up', PAGE)).toEqual({ verb: 'done', target: null, slot: null })
  })

  it("offers the whole page's result links on a search landing — not the engine's own, not a ref's again", () => {
    const hop = { hop: 1, visited: [SEARCH.url], actions: ['open latest elon musk tweet'], links: LINKS }
    const target = commandQuestions('pull up the latest elon musk tweet', SEARCH, hop).target
    expect(Object.keys(target.options)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3', 'link-1', 'link-2'])
    expect(target.options['link-1']).toBe('link "Elon Musk - Wikipedia" https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk')
    expect(target.options['link-2']).toBe('link "Elon Musk news" https://www.reuters.com/elon')
    // A result link below the fold is opened at its address.
    expect(readCommandAnswers({ verb: choice('click'), target: choice('link-2'), slot: choice('none') }, 'pull up the latest elon musk tweet', SEARCH, hop)).toEqual({
      verb: 'navigate',
      target: null,
      slot: 'https://www.reuters.com/elon',
    })
  })

  it('offers every page link further down off a search landing, so a link below the fold costs no scroll (owner\'s rule 2026-10-19)', () => {
    const hop = { hop: 1, visited: [], actions: [], links: LINKS }
    const options = commandQuestions('click it', PAGE, hop).target.options
    expect(Object.keys(options).slice(0, 4)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3'])
    expect(Object.keys(options).length).toBeGreaterThan(4)
    expect(commandState('click it', PAGE, hop)).toContain('Links further down the page (name, address):')
  })

  it('never offers an address already visited in the Task, a redirect to one included', () => {
    const hop = { hop: 2, visited: [SEARCH.url, 'https://x.com/elonmusk', 'https://en.wikipedia.org/wiki/Elon_Musk'], actions: [], links: LINKS }
    const target = commandQuestions('pull up the latest elon musk tweet', SEARCH, hop).target
    expect(Object.keys(target.options)).toEqual(['none', 'ref-1', 'ref-2', 'link-1'])
    expect(target.options['link-1']).toContain('reuters')
  })

  it('carries the hop number, the addresses visited and the actions taken in the state', () => {
    const hop = { hop: 1, visited: [SEARCH.url], actions: ['open latest elon musk tweet'], links: LINKS }
    const state = commandState('pull up the latest elon musk tweet', SEARCH, hop)
    expect(state).toContain('This is step 2 of the task. Done so far: open latest elon musk tweet')
    expect(state).toContain(`Pages visited: ${SEARCH.url}`)
    expect(state).toContain('Result links further down the page (name, address):')
    expect(state).toContain('[link-2] link "Elon Musk news" https://www.reuters.com/elon')
  })
})

describe('open past the first hop (#332)', () => {
  const SEARCH: CommandPage = {
    url: "https://duckduckgo.com/?q=elon+musk's+latest+tweet",
    title: "elon musk's latest tweet at DuckDuckGo",
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search', href: null, inputType: 'search' },
      { ref: 3, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const TEXT = "Open elon musk's latest tweet"
  const hop = { hop: 1, visited: [SEARCH.url], actions: ["Searched the web for “elon musk's latest tweet”"], links: [] }
  // The target answer the logged hop 1 gave: none on top, two results close behind.
  const target = (probabilities: Record<string, number>): DecisionChoiceAnswer => ({ type: 'choice', choice: 'none', confidence: probabilities.none ?? 0, probabilities })

  it('opens the most probable offered ref, never searching the words again', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.63, 'ref-3': 0.17, 'ref-1': 0.16 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'click', target: 3, slot: null })
  })

  it('opens a result link further down at its address when it ranks above every ref', () => {
    const links = [{ label: 'Elon Musk news', href: 'https://www.reuters.com/elon' }]
    expect(
      readCommandAnswers({ verb: choice('search'), target: target({ none: 0.6, 'link-1': 0.3, 'ref-3': 0.1 }), slot: choice('s1-4') }, TEXT, SEARCH, { ...hop, links }),
    ).toEqual({ verb: 'navigate', target: null, slot: 'https://www.reuters.com/elon' })
  })

  it('has no next step when the answer gives no offered target any probability', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 1 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 1, 'ref-3': 0 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'none', target: null, slot: null })
    // A visited address is not offered, so its probability counts for nothing.
    const visited = { ...hop, visited: [SEARCH.url, 'https://x.com/elonmusk'] }
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.8, 'ref-3': 0.2 }), slot: choice('s1-4') }, TEXT, SEARCH, visited)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('leaves hop 0 searching the words off a site, and an address navigated at any hop', () => {
    const answers = { verb: choice('search'), target: target({ none: 0.63, 'ref-3': 0.17 }), slot: choice('s1-4') }
    expect(readCommandAnswers(answers, TEXT, SEARCH)).toEqual({ verb: 'search', target: null, slot: "elon musk's latest tweet" })
    expect(readCommandAnswers({ ...answers, verb: choice('navigate'), slot: choice('s1-1') }, 'open x.com/elonmusk', SEARCH, hop)).toEqual({ verb: 'navigate', target: null, slot: 'x.com/elonmusk' })
  })
})

describe('open past the first hop off a search landing (#342): with no target named, the Task ends where it stands', () => {
  // The logged hop 2 of #340's live run: the Task had reached the profile
  // the user asked for, Jev read open over done and named no target.
  const PROFILE: CommandPage = {
    url: 'https://x.com/realDonaldTrump',
    title: 'Donald J. Trump (@realDonaldTrump) / X',
    refs: [
      { ref: 1, kind: 'link', label: 'DonaldJTrump.com', href: 'https://www.donaldjtrump.com/', inputType: null },
      { ref: 2, kind: 'link', label: 'Search', href: 'https://x.com/explore', inputType: null },
    ],
  }
  const TEXT = 'go to donald trumps profile'
  const hop = { hop: 2, visited: ['https://x.com/home', 'https://x.com/realDonaldTrump'], actions: [], links: [], searched: ['x.com'] }
  const target = (probabilities: Record<string, number>, top = 'none'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('reads search, search terms and target none as no next step, though a ref has some probability', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.99, 'ref-1': 0.01 }), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('reads a top target that names nothing offered as no next step too', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ 'ref-9': 0.6, 'ref-2': 0.3 }, 'ref-9'), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('still clicks a ref Jev names as its top target, off a search landing as on one', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ 'ref-2': 0.7, none: 0.3 }, 'ref-2'), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('counts a site’s own search page as a search landing: the most probable offered result is opened there', () => {
    const SITE_SEARCH: CommandPage = { ...PROFILE, url: 'https://x.com/search?q=donald+trump', title: 'donald trump - Search / X' }
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.8, 'ref-1': 0.15 }), slot: choice('s2-4') }, TEXT, SITE_SEARCH, hop)).toEqual({ verb: 'click', target: 1, slot: null })
    const links = [{ label: 'donaldjtrump.com', href: 'https://www.donaldjtrump.com/news' }]
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.7, 'link-1': 0.2, 'ref-1': 0.1 }), slot: choice('s2-4') }, TEXT, SITE_SEARCH, { ...hop, links })).toEqual({
      verb: 'navigate',
      target: null,
      slot: 'https://www.donaldjtrump.com/news',
    })
  })
})

describe("a Web Engine's landing read before its results drew (2026-10-19): a hop opens a result or nothing, never the engine's chrome", () => {
  // The logged hop 1 of "Open Elon Musk's latest tweet": DuckDuckGo's page
  // some 700 ms after the search, its script yet to draw a result. Jev read
  // search with none on top and the Search button at 0.03 — and the hop
  // clicked Search, which re-submitted the words, hop after hop to the cap.
  const EMPTY: CommandPage = {
    url: "https://duckduckgo.com/?q=Elon+Musk%27s+latest+tweet",
    title: "Elon Musk's latest tweet at DuckDuckGo",
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home DuckDuckGo', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search privately', href: null, inputType: 'text' },
      { ref: 3, kind: 'button', label: 'Search', href: null, inputType: null },
      { ref: 5, kind: 'link', label: 'All', href: "https://duckduckgo.com/?q=Elon+Musk%27s+latest+tweet&ia=web", inputType: null },
    ],
  }
  const DRAWN: CommandPage = { ...EMPTY, refs: [...EMPTY.refs, { ref: 7, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null }] }
  const TEXT = "Open Elon Musk's latest tweet"
  // The footer's links leave the engine's host, so the whole page offers them as results.
  const footer = [{ label: 'iOS Browser', href: 'https://apps.apple.com/app/duckduckgo-private-browser/id663592361' }]
  const hop = { hop: 1, visited: [EMPTY.url], actions: ["search Elon Musk's latest tweet (opened duckduckgo.com/?q=Elon+Musk%27s+latest+tweet)"], links: footer }
  const target = (probabilities: Record<string, number>, top = 'none'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })
  const none = { verb: 'none', target: null, slot: null }

  it('reads search with none on top and the Search button barely offered as no next step', () => {
    expect(readCommandAnswers({ verb: choice('search', 0.46), target: target({ none: 0.93, 'ref-3': 0.03, 'ref-2': 0.02 }), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('opens no footer link either: with no result in view, nothing further down is one', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.6, 'link-1': 0.3, 'ref-3': 0.1 }), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('reads click or type with none on top the same way', () => {
    expect(readCommandAnswers({ verb: choice('click'), target: target({ none: 0.8, 'ref-3': 0.15 }), slot: choice('none') }, TEXT, EMPTY, hop)).toEqual(none)
    expect(readCommandAnswers({ verb: choice('type'), target: target({ none: 0.8, 'ref-2': 0.15 }), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('still acts on a ref Jev names as its top target, chrome or not', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ 'ref-3': 0.7, none: 0.3 }, 'ref-3'), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual({ verb: 'click', target: 3, slot: null })
  })

  it('opens the most probable result once the results are drawn, never the chrome ranked above it', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.6, 'ref-3': 0.3, 'ref-7': 0.1 }), slot: choice('s1-4') }, TEXT, DRAWN, hop)).toEqual({ verb: 'click', target: 7, slot: null })
    expect(readCommandAnswers({ verb: choice('click'), target: target({ none: 0.6, 'ref-1': 0.3, 'ref-7': 0.1 }), slot: choice('none') }, TEXT, DRAWN, hop)).toEqual({ verb: 'click', target: 7, slot: null })
  })

  it("leaves a site's own search page as it was: the most probable offered ref, whatever it is", () => {
    const SITE_SEARCH: CommandPage = { url: 'https://x.com/search?q=elon', title: 'elon - Search / X', refs: [{ ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null }] }
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.9, 'ref-2': 0.1 }), slot: choice('s1-4') }, TEXT, SITE_SEARCH, { ...hop, visited: [SITE_SEARCH.url], links: [] })).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('leaves hop 0 as it was: the words are searched', () => {
    expect(readCommandAnswers({ verb: choice('search'), target: target({ none: 0.93, 'ref-3': 0.03 }), slot: choice('s1-4') }, TEXT, EMPTY)).toEqual({ verb: 'search', target: null, slot: "Elon Musk's latest tweet" })
  })
})

describe('click past the first hop off a search landing: with no target named, the Task ends where it stands', () => {
  // The logged hop 3 of "cross out the pop-up": hop 0 closed X's login
  // dialog, then each hop read click over a target of none and clicked the
  // ref Jev barely offered — the login page, Back, then the bio's link.
  const PROFILE: CommandPage = {
    url: 'https://x.com/ElonMusk',
    title: 'Elon Musk (@elonmusk) / X',
    refs: [
      { ref: 2, kind: 'button', label: 'Back', href: null, inputType: null },
      { ref: 11, kind: 'link', label: 'Terafab.AI', href: 'http://terafab.ai/', inputType: null },
      { ref: 50, kind: 'link', label: 'Continue to X', href: 'https://x.com/i/jf/onboarding/web?mode=login', inputType: null },
    ],
  }
  const TEXT = 'cross out the pop-up'
  const hop = { hop: 3, visited: ['https://x.com/ElonMusk'], actions: [], links: [] }
  const target = (probabilities: Record<string, number>, top = 'none'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('reads click with target none as no next step, though a ref has some probability', () => {
    const answers = { verb: choice('click', 0.58), target: target({ none: 0.88, 'ref-11': 0.05, 'ref-50': 0.04, 'ref-2': 0.01 }), slot: choice('none') }
    expect(readCommandAnswers(answers, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers({ ...answers, verb: choice('type') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('still clicks a ref Jev names as its top target', () => {
    expect(readCommandAnswers({ verb: choice('click'), target: target({ 'ref-2': 0.7, none: 0.3 }, 'ref-2'), slot: choice('none') }, TEXT, PROFILE, hop)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('hop 0 clicks no ref Jev gave no probability: never the page\'s first ref (owner\'s rule 2026-10-19)', () => {
    const answers = { verb: choice('click'), target: target({ none: 1 }), slot: choice('none') }
    expect(readCommandAnswers(answers, TEXT, PROFILE)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('a site\'s results the Task\'s own words led to are a landing whatever the parameter is called: the most probable ref stands in for none', () => {
    const answers = { verb: choice('click'), target: target({ none: 0.6, 'ref-11': 0.3 }), slot: choice('none') }
    const results = { ...PROFILE, url: 'https://www.youtube.com/results?search_query=lofi+beats' }
    expect(readCommandAnswers(answers, TEXT, results, { ...hop, terms: ['lofi beats'] })).toEqual({ verb: 'click', target: 11, slot: null })
    expect(readCommandAnswers(answers, TEXT, results, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('leaves hop 0 and a search landing clicking the most probable ref', () => {
    const answers = { verb: choice('click'), target: target({ none: 0.6, 'ref-11': 0.3 }), slot: choice('none') }
    expect(readCommandAnswers(answers, TEXT, PROFILE)).toEqual({ verb: 'click', target: 11, slot: null })
    expect(readCommandAnswers(answers, TEXT, { ...PROFILE, url: 'https://duckduckgo.com/?q=elon+musk' }, hop)).toEqual({ verb: 'click', target: 11, slot: null })
  })
})

describe('the Site Scope (#340): where the words point, asked at hop 0 on a site', () => {
  const X: CommandPage = {
    url: 'https://x.com/home',
    title: 'Home / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Home', href: 'https://x.com/home', inputType: null },
      { ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const TEXT = 'go to donald trumps profile'
  const read = (where: string, target: string | DecisionChoiceAnswer = 'none', verb = 'search') => ({ verb: choice(verb), target: typeof target === 'string' ? choice(target) : target, slot: choice('s2-4'), where: choice(where) })

  it('asks a fourth Choice on a site: on this page, on this site, or elsewhere on the web', () => {
    const questions = commandQuestions(TEXT, X)
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot', 'where'])
    expect('where' in questions && Object.keys(questions.where.options)).toEqual(['page', 'site', 'web'])
    expect('where' in questions && questions.where.options.site).toContain('x.com')
  })

  it('asks no where on a blank page, or on a Web Engine’s results or front page', () => {
    for (const url of ['about:blank', 'https://duckduckgo.com/?q=trump', 'https://www.google.com/']) expect(Object.keys(commandQuestions(TEXT, { ...X, url }))).toEqual(['verb', 'target', 'slot'])
  })

  it('reads search, search terms, no ref and where = site as a search scoped to the site, the Slot kept as the words — a navigate of such words too', () => {
    expect(readCommandAnswers(read('site'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
    expect(readCommandAnswers(read('site', 'none', 'navigate'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
  })

  it('reads where = web as the whole web searched', () => {
    expect(readCommandAnswers(read('web'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile' })
  })

  it('reads where = page as the most probable ref Jev gave any probability, none set aside, never a search (#353)', () => {
    // The logged "Open the tweet." on x.com/ElonMusk: verb open 0.76, target none 0.67 over the top post 0.17, where page 0.64 — and a web search for "the tweet".
    const spread: DecisionChoiceAnswer = { type: 'choice', choice: 'none', confidence: 0.67, probabilities: { none: 0.67, 'ref-2': 0.17, 'ref-1': 0.09 } }
    expect(readCommandAnswers(read('page', spread), 'open the tweet', X)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(readCommandAnswers({ ...read('page', spread, 'navigate'), slot: choice('s1-2') }, 'open the tweet', X)).toEqual({ verb: 'click', target: 2, slot: null })
    // A bare word Jev reads as a navigation is an address, whatever where says: Jev said so.
    expect(readCommandAnswers(read('page', spread, 'navigate'), 'open the tweet', X)).toEqual({ verb: 'navigate', target: null, slot: 'tweet' })
    // No ref given any probability: no Command, and no search either.
    expect(readCommandAnswers(read('page'), TEXT, X)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers(read('page', { type: 'choice', choice: 'none', confidence: 1, probabilities: { none: 1, 'ref-2': 0 } }), TEXT, X)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('keeps a ref chosen a click, and an address-shaped navigate an address, whatever where says', () => {
    expect(readCommandAnswers(read('site', 'ref-2'), 'go to elon musk', X)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(readCommandAnswers({ ...read('site', 'none', 'navigate'), slot: choice('s2-2') }, 'go to youtube', X)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
  })
})

describe('the Site Scope at a later hop (#341): a hop may search once, on a site the Task has not searched', () => {
  const X: CommandPage = {
    url: 'https://x.com/',
    title: 'X. It’s what’s happening / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Sign in', href: 'https://x.com/login', inputType: null },
      { ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const RESULTS: CommandPage = {
    url: 'https://duckduckgo.com/?q=site%3Ax.com+donald+trumps+profile',
    title: 'site:x.com donald trumps profile at DuckDuckGo',
    refs: [{ ref: 3, kind: 'link', label: 'Donald J. Trump (@realDonaldTrump) / X', href: 'https://x.com/realDonaldTrump', inputType: null }],
  }
  const TEXT = 'go to twitter and open donald trumps profile'
  const hop = { hop: 1, visited: ['https://x.com/'], actions: ['open twitter (opened x.com)'], links: [] }
  const read = (where: string, target: DecisionChoiceAnswer = choice('none')) => ({ verb: choice('search'), target, slot: choice('s5-7'), where: choice(where) })
  const target = (probabilities: Record<string, number>): DecisionChoiceAnswer => ({ type: 'choice', choice: 'none', confidence: probabilities.none ?? 0, probabilities })

  it('asks where at a later hop on a site the Task has not searched', () => {
    const questions = commandQuestions(TEXT, X, hop)
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot', 'where'])
    expect('where' in questions && questions.where.options.site).toContain('x.com')
  })

  it('asks no where on a results landing, or on a site the Task has already searched', () => {
    expect(Object.keys(commandQuestions(TEXT, RESULTS, { ...hop, hop: 2 }))).toEqual(['verb', 'target', 'slot'])
    expect(Object.keys(commandQuestions(TEXT, { ...X, url: 'https://x.com/realDonaldTrump' }, { ...hop, hop: 3, searched: ['x.com'] }))).toEqual(['verb', 'target', 'slot'])
  })

  it('reads search, search terms, no ref and where = site at a later hop as a search scoped to the site', () => {
    expect(readCommandAnswers(read('site'), TEXT, X, hop)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
  })

  it('reads where = page or web at a later hop as #332 has it: never a search — the most probable offered result on a landing, no next step off one (#342)', () => {
    for (const where of ['page', 'web']) {
      expect(readCommandAnswers(read(where, target({ none: 0.7, 'ref-3': 0.2 })), TEXT, RESULTS, { ...hop, hop: 2 })).toEqual({ verb: 'click', target: 3, slot: null })
      expect(readCommandAnswers(read(where, target({ none: 0.7, 'ref-2': 0.2 })), TEXT, X, hop)).toEqual({ verb: 'none', target: null, slot: null })
      expect(readCommandAnswers(read(where), TEXT, X, hop)).toEqual({ verb: 'none', target: null, slot: null })
    }
  })

  it('never searches a site twice in one Task, whatever where says', () => {
    expect(readCommandAnswers(read('site', target({ none: 0.7, 'ref-2': 0.2 })), TEXT, X, { ...hop, searched: ['x.com'] })).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers(read('site', choice('ref-2')), TEXT, X, { ...hop, searched: ['x.com'] })).toEqual({ verb: 'click', target: 2, slot: null })
  })
})

describe('the Verdict: a hop is asked whether what was asked for is done', () => {
  const PROFILE: CommandPage = {
    url: 'https://x.com/elonmusk',
    title: 'Elon Musk (@elonmusk) / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee', href: null, inputType: null },
      { ref: 2, kind: 'link', label: '2h', href: 'https://x.com/elonmusk/status/1', inputType: null },
      { ref: 3, kind: 'link', label: 'Log in with username or email', href: 'https://x.com/login', inputType: null },
    ],
  }
  /** The profile with the sign-in sheet over it: its controls first, on the dialog layer. */
  const COVERED: CommandPage = {
    ...PROFILE,
    refs: [
      { ref: 1, kind: 'button', label: 'Close', href: null, inputType: null },
      { ref: 2, kind: 'link', label: 'Log in', href: 'https://x.com/login', inputType: null },
      { ref: 3, kind: 'link', label: 'Sign up', href: 'https://x.com/signup', inputType: null },
      { ref: 4, kind: 'link', label: 'Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee', href: null, inputType: null },
      { ref: 5, kind: 'link', label: 'Log in with username or email', href: 'https://x.com/login', inputType: null },
    ],
    dialog: { text: 'Don’t miss what’s happening', refs: [1, 2, 3] },
  }
  const hop = { hop: 1, visited: [PROFILE.url], actions: ['search Elon Musk (opened x.com/elonmusk)'], links: [] }
  const answer = (choice: string, confidence = 0.9): DecisionChoiceAnswer => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } })
  const three = { verb: answer('click'), target: answer('ref-1'), slot: answer('none') }

  it('asks the outcome at a hop, among yes, in the way and not yet, beside the three and where', () => {
    const questions = hopQuestions('open elon musks latest tweet', PROFILE, hop)
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot', 'where', 'outcome'])
    expect(Object.keys(questions.outcome.options)).toEqual(['yes', 'in_the_way', 'not_yet'])
    expect(questions.outcome.instructions).toContain('if a pop-up, sign-in prompt, cookie notice or challenge covers the page now, choose in_the_way')
    expect(questions.outcome.instructions).toContain('the action they asked for has happened')
  })

  it('asks the dismiss Choice over a pop-up (#354): escape and every dialog control a dismissal may click, with what a close is and what is a way through', () => {
    const covered = {
      ...PROFILE,
      refs: [
        ...PROFILE.refs,
        { ref: 7, kind: 'link' as const, label: 'Log in', href: 'https://x.com/login', inputType: null },
        { ref: 8, kind: 'button' as const, label: 'Sign in', href: null, inputType: null },
        { ref: 9, kind: 'button' as const, label: 'Close', href: null, inputType: null },
        { ref: 10, kind: 'button' as const, label: 'Not now', href: null, inputType: null },
      ],
      dialog: { text: 'Don’t miss what’s happening', refs: [7, 8, 9, 10] },
    }
    const questions = hopQuestions('open elon musks latest tweet', covered, hop)
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot', 'where', 'outcome', 'dismiss'])
    expect(Object.keys(questions.dismiss!.options)).toEqual(['escape', 'ref-9', 'ref-10'])
    expect(questions.dismiss!.instructions).toContain('Which control closes it and leaves the page behind as it was')
    expect(questions.dismiss!.instructions).toContain('Never one that goes through it: sign in, sign up, subscribe, accept, agree, allow, install')
    expect(hopQuestions('open elon musks latest tweet', PROFILE, hop).dismiss).toBeUndefined()
    // Only a way through, or links: nothing to offer beside Escape, so nothing is asked.
    expect(hopQuestions('open elon musks latest tweet', { ...covered, dialog: { text: 'Join', refs: [7, 8] } }, hop).dismiss).toBeUndefined()
    expect(readDismissChoice({ ...three, outcome: answer('in_the_way'), dismiss: answer('ref-10', 0.8) }, covered)).toEqual({ choice: { ref: 10 }, confidence: 0.8 })
    expect(readDismissChoice({ ...three, outcome: answer('in_the_way'), dismiss: answer('escape', 0.6) }, covered)).toEqual({ choice: 'escape', confidence: 0.6 })
    expect(readDismissChoice({ ...three, outcome: answer('in_the_way'), dismiss: answer('ref-8', 0.9) }, covered)).toBeNull()
    expect(readDismissChoice({ ...three, outcome: answer('in_the_way') }, covered)).toBeNull()
  })

  it('asks no outcome at hop 0: a Command is read before anything was done', () => {
    expect(Object.keys(commandQuestions('open elon musks latest tweet', PROFILE))).toEqual(['verb', 'target', 'slot', 'where'])
  })

  it('reads the Verdict with its confidence, null when none was asked or the answer names no outcome', () => {
    expect(readVerdict({ ...three, outcome: answer('in_the_way', 0.85) })).toEqual({ outcome: 'in_the_way', confidence: 0.85 })
    expect(readVerdict(three)).toBeNull()
    expect(readVerdict({ ...three, outcome: answer('maybe') })).toBeNull()
  })

  it('leaves the Command reading as it was: the Verdict is beside the verb, not in it', () => {
    expect(readCommandAnswers({ ...three, outcome: answer('yes') }, 'open elon musks latest tweet', PROFILE, hop)).toEqual({ verb: 'click', target: 1, slot: null })
  })

  describe('"Done so far" in facts', () => {
    const click = { verb: 'click' as const, target: 1, slot: null }
    const CLICKED = 'click "Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee"'

    it('names the address a click opened, as before, and the pop-up that covers it', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: true, opened: 'https://x.com/elonmusk/status/1' }))).toBe(
        `${CLICKED} (opened x.com/elonmusk/status/1; a pop-up covers it: "Close", "Log in" and "Sign up")`,
      )
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, PROFILE, { changed: true, opened: 'https://x.com/elonmusk/status/1' }))).toBe(`${CLICKED} (opened x.com/elonmusk/status/1)`)
    })

    it('tells a click that stayed on its address by what appeared: a pop-up over the page, its controls first', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: true }))).toBe(
        `${CLICKED} (the address did not change; a pop-up appeared over the page: "Close", "Log in" and "Sign up")`,
      )
    })

    it('names what appeared with no pop-up, and says only that the page changed when nothing new is there', () => {
      const more: CommandPage = { ...PROFILE, refs: [...PROFILE.refs, { ref: 4, kind: 'button', label: 'Show more', href: null, inputType: null }] }
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, more, { changed: true }))).toBe(`${CLICKED} (the address did not change; "Show more" appeared)`)
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, PROFILE, { changed: true }))).toBe(`${CLICKED} (the page changed)`)
    })

    it('says the pop-up closed when the page it covered is clear again', () => {
      expect(doneLine(click, COVERED, doneFacts(COVERED, PROFILE, { changed: true }))).toBe('click "Close" (the pop-up closed)')
    })

    it('told again after a re-read found the pop-up gone: it covered the page, and closed (post mortem 2026-10-19)', () => {
      expect(doneLine(click, PROFILE, { changed: true, opened: 'https://x.com/elonmusk/status/1', covered: true, closed: true })).toBe(
        `${CLICKED} (opened x.com/elonmusk/status/1; a pop-up covered it, and closed)`,
      )
      expect(doneLine(click, PROFILE, { changed: true, covered: true, closed: true })).toBe(`${CLICKED} (the address did not change; a pop-up appeared over the page, and closed)`)
    })

    it('keeps nothing changed as it was, whatever the page shows', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: false }))).toBe(`${CLICKED} (nothing changed)`)
    })

    it('names at most three controls, cut at 40 characters, and no pop-up that was already open', () => {
      const wide: CommandPage = { ...COVERED, refs: [...COVERED.refs, { ref: 6, kind: 'button', label: 'A control whose label runs on far past forty characters', href: null, inputType: null }] }
      expect(doneLine(click, COVERED, doneFacts(COVERED, wide, { changed: true }))).toBe('click "Close" (the address did not change; "A control whose label runs on far past…" appeared)')
    })
  })
})

describe('a results page known by the Task\'s words (owner\'s rule 2026-10-19)', () => {
  const hop = (terms: string[]) => ({ hop: 1, visited: [], actions: [], links: [], terms })

  it('an address the Search URL test reads is one, words or none', () => {
    expect(onResults('https://duckduckgo.com/?q=lofi', undefined)).toBe(true)
  })

  it.each([
    ['https://www.youtube.com/results?search_query=lofi+beats', 'lofi beats'],
    ['https://www.amazon.co.uk/s?k=usb+c+cable&ref=nb', 'USB-C cable'],
    ['https://www.ebay.co.uk/sch/i.html?_nkw=film+camera', 'film camera'],
    ['https://example.com/find/garden%20chairs', 'garden chairs'],
  ])('%s carries "%s"', (url, term) => {
    expect(onResults(url, hop([term]))).toBe(true)
    expect(onResults(url, hop([]))).toBe(false)
  })

  it('a page that carries none of the words is no results page', () => {
    expect(onResults('https://www.youtube.com/watch?v=abc', hop(['lofi beats']))).toBe(false)
    expect(onResults('https://www.youtube.com/results?search_query=lofi+beats', hop(['jazz']))).toBe(false)
  })
})

describe('a dismiss phrase over a pop-up (owner\'s rule 2026-10-19)', () => {
  const SHEET: CommandPage = {
    url: 'https://x.com/elonmusk',
    title: 'X',
    refs: [
      { ref: 8, kind: 'button', label: 'Sign in', href: null, inputType: null },
      { ref: 9, kind: 'button', label: 'Close', href: null, inputType: null },
    ],
    dialog: { text: 'Sign in to X', refs: [8, 9] },
  }

  it('asks the Command\'s questions and the dismiss Choice in one call; none with no control to choose', () => {
    expect(Object.keys(dismissPhraseQuestions('close', SHEET)!)).toEqual(['verb', 'target', 'slot', 'where', 'dismiss'])
    expect(dismissPhraseQuestions('close', { ...SHEET, dialog: { text: 'Sign in', refs: [8] } })).toBeNull()
  })

  it('tells Jev to decline a cookie notice\'s optional cookies', () => {
    expect(dismissPhraseQuestions('close', SHEET)!.dismiss.instructions).toContain('continue without accepting')
  })
})

describe('the steps Choice (#364, ADR 0076 "a line is Steps")', () => {
  const BLANK: CommandPage = { ...PAGE, url: 'about:blank' }
  const LINE = 'start the song from the beginning and put it on loop'
  const stepsOf = (text: string) => {
    const questions = commandQuestions(text, BLANK)
    return 'steps' in questions ? questions.steps?.options : undefined
  }

  it('is asked at hop 0 beside the others, one option per conjunction boundary labelled with its two halves, and none', () => {
    expect(Object.keys(commandQuestions(LINE, BLANK))).toEqual(['verb', 'target', 'slot', 'steps'])
    expect(stepsOf(LINE)).toEqual({ none: 'one command: the whole line', w7: 'start the song from the beginning | put it on loop' })
  })

  it('offers each of and, then, and then and a comma once, the conjunction left out of both halves', () => {
    expect(stepsOf('open youtube then search cats')).toEqual({ none: 'one command: the whole line', w3: 'open youtube | search cats' })
    expect(stepsOf('open youtube and then search cats')).toEqual({ none: 'one command: the whole line', w4: 'open youtube | search cats' })
    expect(stepsOf('scroll down, click the first one, and read it')).toEqual({
      none: 'one command: the whole line',
      w2: 'scroll down | click the first one, and read it',
      w7: 'scroll down, click the first one | read it',
    })
    expect(stepsOf('play highs and lows pomme')).toEqual({ none: 'one command: the whole line', w3: 'play highs | lows pomme' })
  })

  it('is not asked for a line with no conjunction, or one that starts or ends on one; nor at a later hop, on a partial, or when left out', () => {
    expect(Object.keys(commandQuestions('scroll down please', BLANK))).toEqual(['verb', 'target', 'slot'])
    expect(Object.keys(commandQuestions('and then', BLANK))).toEqual(['verb', 'target', 'slot'])
    expect(Object.keys(commandQuestions('open youtube and', BLANK))).toEqual(['verb', 'target', 'slot'])
    expect(Object.keys(hopQuestions(LINE, BLANK, { hop: 1, visited: [], actions: [], links: [] }))).not.toContain('steps')
    expect(Object.keys(partialQuestions(LINE, BLANK))).toEqual(['verb', 'target', 'slot', 'complete'])
    expect(Object.keys(commandQuestions(LINE, BLANK, undefined, { steps: false }))).toEqual(['verb', 'target', 'slot'])
  })

  it('reads a boundary as the two Steps, and none or a label it did not offer as one Command', () => {
    const answers = (steps: string) => ({ verb: choice('none'), target: choice('none'), slot: choice('none'), steps: choice(steps) })
    expect(readSteps(answers('w7'), LINE)).toEqual({ at: 7, first: 'start the song from the beginning', rest: 'put it on loop' })
    expect(readSteps(answers('none'), LINE)).toBeNull()
    expect(readSteps(answers('w3'), LINE)).toBeNull()
    expect(readSteps({ verb: choice('none'), target: choice('none'), slot: choice('none') }, LINE)).toBeNull()
  })

  it('tells a Step its place in the line and what the Steps before it did, the line on its own labelled line', () => {
    const state = commandState('put it on loop', BLANK, undefined, { line: LINE, step: 2, of: 2, done: ['Step 1 "start the song from the beginning": restart'] })
    expect(state.split('\n').slice(0, 3)).toEqual([
      'The user spoke to a web browser: "put it on loop"',
      `Step 2 of 2 of the line: ${JSON.stringify(LINE)}`,
      'Done so far: Step 1 "start the song from the beginning": restart',
    ])
  })
})
