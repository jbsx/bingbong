import { describe, expect, it } from 'vitest'
import { GRAMMAR_ONLY_VERBS, JEV_VERBS, describeCommand, type CommandRef } from './command'
import { carriesWordsPastAddress, headsAnotherVerb, localMatch } from './localMatch'

// The Local Match (CONTEXT.md, ADR 0076, #353): a Command settled from the
// Utterance and the page alone — fixed phrases only: the CLI grammar, the
// control words, an address after an opening phrase, or a plain verb and
// a label exactly one ref carries. Nothing guesses: what it does not
// settle is Jev's, and nothing fires when Jev does not answer.

const REFS: CommandRef[] = [
  { ref: 1, kind: 'link', label: 'Home', href: 'https://example.com/', inputType: null },
  { ref: 2, kind: 'button', label: 'Sign in', href: null, inputType: null },
  { ref: 3, kind: 'input', label: 'Search', href: null, inputType: 'search' },
  { ref: 4, kind: 'link', label: 'Sign in with Google', href: 'https://example.com/google', inputType: null },
  { ref: 5, kind: 'button', label: 'Accept all', href: null, inputType: null },
  { ref: 6, kind: 'link', label: 'Trending', href: 'https://example.com/trending', inputType: null },
]

/** The Known Addresses (ADR 0089): the hosts these tests have landed on. */
const known = (word: string): string | null => ({ youtube: 'youtube.com', twitter: 'twitter.com', bbc: 'bbc.co.uk' } as Record<string, string>)[word.toLowerCase()] ?? null

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
  it('reads the grammar and the spoken word as a resume', () => {
    expect(localMatch('resume', [])).toEqual({ verb: 'resume', target: null, slot: null })
    expect(localMatch('continue', REFS)).toEqual({ verb: 'resume', target: null, slot: null })
  })

  it('leaves a line that reads intent to Jev (ADR 0089): "last page" may as well be back', () => {
    expect(localMatch('where was I', REFS)).toBeNull()
    expect(localMatch('pick up where I left off', REFS)).toBeNull()
    expect(localMatch('the last page', REFS)).toBeNull()
    expect(localMatch('last page', REFS)).toBeNull()
  })
})

describe('the Local Match: a fixed phrase is the whole line (#368)', () => {
  it("reads a control word only when it is the whole Utterance: words past it are Jev's", () => {
    expect(localMatch('stop', REFS)).toMatchObject({ verb: 'stop' })
    expect(localMatch('stop showing captions', REFS)).toBeNull()
    expect(localMatch('stop it', REFS)).toBeNull()
    expect(localMatch('never mind', REFS)).toMatchObject({ verb: 'stop' })
    expect(localMatch('never mind that', REFS)).toBeNull()
  })

  it('reads the grammar\'s bare words the same way: `back`, `read`, `reload` and `resume` take no words past them', () => {
    expect(localMatch('back', REFS)).toMatchObject({ verb: 'back' })
    expect(localMatch('back to the search results', REFS)).toBeNull()
    expect(localMatch('reload', REFS)).toMatchObject({ verb: 'reload' })
    expect(localMatch('reload the comments', REFS)).toBeNull()
    expect(localMatch('read the comments', REFS)).toBeNull()
    expect(localMatch('resume the video', REFS)).toBeNull()
    expect(localMatch('help me find a recipe', REFS)).toBeNull()
  })

  it('matches a listed phrase with words in it as the whole line', () => {
    expect(localMatch('clear', REFS)).toMatchObject({ verb: 'clear' })
    expect(localMatch('clear the field', REFS)).toMatchObject({ verb: 'clear' })
    expect(localMatch('clear the search box', REFS)).toBeNull()
    expect(localMatch('reload the page', REFS)).toMatchObject({ verb: 'reload' })
    expect(localMatch('read the page', REFS)).toMatchObject({ verb: 'read' })
    expect(localMatch('go back', REFS)).toMatchObject({ verb: 'back' })
    expect(localMatch('go back to the results', REFS)).toBeNull()
    expect(localMatch('scroll down a bit', REFS)).toBeNull()
  })

  it('keeps the phrases that take words taking them, settled exactly', () => {
    const save: CommandRef[] = [...REFS, { ref: 9, kind: 'button', label: 'Save', href: null, inputType: null }]
    expect(localMatch('click save', save)).toEqual({ verb: 'click', target: 9, slot: null })
    expect(localMatch('press enter twice', REFS)).toMatchObject({ verb: 'press', key: { key: 'Enter' }, times: 2 })
    expect(localMatch('scroll down', REFS)).toMatchObject({ verb: 'scroll_down' })
    expect(localMatch('open youtube', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    expect(localMatch('set a timer for 5 minutes', REFS)).toEqual({ verb: 'timer', target: null, slot: null, durationMs: 300_000 })
    // The Player's exact lines; `play <words>` stays Jev's, offered the Player's ops (ADR 0079).
    expect(localMatch('play', REFS)).toMatchObject({ verb: 'play' })
    expect(localMatch('next song', REFS)).toMatchObject({ verb: 'play' })
    expect(localMatch('play bohemian rhapsody', REFS)).toBeNull()
    expect(localMatch('stop looping', REFS)).toMatchObject({ verb: 'play' })
  })

  it('still holds a partial that may become another Command (Early Fire, #326)', () => {
    expect(headsAnotherVerb('stop')).toBe(true)
    expect(headsAnotherVerb('scroll')).toBe(true)
    expect(headsAnotherVerb('go back')).toBe(true)
    expect(headsAnotherVerb('clear')).toBe(false)
  })
})

describe('the Local Match: the Timer', () => {
  it('reads the grammar and the spoken lines as a timer, without asking the page', () => {
    expect(localMatch('timer 5m', [])).toEqual({ verb: 'timer', target: null, slot: null, durationMs: 300_000 })
    expect(localMatch('set a timer for ten minutes', REFS)).toEqual({ verb: 'timer', target: null, slot: null, durationMs: 600_000 })
    expect(localMatch('a 2 minute timer', REFS)).toEqual({ verb: 'timer', target: null, slot: null, durationMs: 120_000 })
    expect(localMatch('timer off', REFS)).toEqual({ verb: 'timer', target: null, slot: null })
  })

  it('"cancel the timer" turns it off, while "cancel" alone is still the stop verb', () => {
    expect(localMatch('cancel the timer', REFS)).toEqual({ verb: 'timer', target: null, slot: null })
    expect(localMatch('cancel', REFS)).toEqual({ verb: 'stop', target: null, slot: null })
    expect(localMatch('stop', REFS)).toEqual({ verb: 'stop', target: null, slot: null })
  })
})

describe('the Local Match: the Player (#343)', () => {
  it('reads an exact music line as the `play` verb without asking the page; a line with free words is Jev\'s (ADR 0079)', () => {
    expect(localMatch('play bohemian rhapsody', [])).toBeNull()
    expect(localMatch('Queue daft punk.', REFS)).toBeNull()
    expect(localMatch('play', REFS)).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'unpause' } })
    expect(localMatch('go back a song', REFS)).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'previous' } })
    expect(localMatch('stop looping', REFS)).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'loop', on: false } })
    // Jev reaches the Player through its Appliance Verbs, never as a browser verb.
    expect(GRAMMAR_ONLY_VERBS.has('play')).toBe(false)
    expect(JEV_VERBS).not.toContain('play')
  })

  it('leaves "click play" and "press play" to the page\'s button, `back` to history and "stop" the stop verb', () => {
    const refs: CommandRef[] = [{ ref: 7, kind: 'button', label: 'Play', href: null, inputType: null }]
    expect(localMatch('click play', refs)).toEqual({ verb: 'click', target: 7, slot: null })
    expect(localMatch('press play', refs)).toEqual({ verb: 'click', target: 7, slot: null })
    expect(localMatch('go back', REFS)).toEqual({ verb: 'back', target: null, slot: null })
    expect(localMatch('stop', REFS)).toEqual({ verb: 'stop', target: null, slot: null })
  })

  it('holds a partial that heads a music line of another kind: "stop" may be "stop looping", "go back" "go back a song" (#326)', () => {
    expect(headsAnotherVerb('stop')).toBe(true)
    expect(headsAnotherVerb('go back')).toBe(true)
    expect(headsAnotherVerb('read')).toBe(false)
  })

  it('the Feed\'s action line names the music line', () => {
    expect(describeCommand({ verb: 'play', target: null, slot: 'bohemian rhapsody', music: { kind: 'search', place: 'now' } })).toBe('play bohemian rhapsody')
    expect(describeCommand({ verb: 'play', target: null, slot: 'daft punk', music: { kind: 'search', place: 'front' } })).toBe('play daft punk next')
    expect(describeCommand({ verb: 'play', target: null, slot: 'daft punk', music: { kind: 'search', place: 'end' } })).toBe('queue daft punk')
    // A line with free words is Jev's (ADR 0079): the Local Match settles none.
    expect(localMatch('play bohemian rhapsody', [])).toBeNull()
    expect(describeCommand(localMatch('next song', [])!)).toBe('skip')
    // A click on the pop-up's own text (#416) names the words it landed on.
    expect(describeCommand({ verb: 'click', target: null, slot: null, text: { text: '×', frame: null, node: 1 }, dismiss: true })).toBe('click the text "×" in the pop-up')
    expect(describeCommand(localMatch('play', [])!)).toBe('play')
    expect(describeCommand(localMatch('volume 40', [])!)).toBe('volume 40')
    expect(describeCommand(localMatch('repeat this song', [])!)).toBe('loop')
    expect(describeCommand(localMatch('stop looping', [])!)).toBe('loop off')
  })
})

describe("the Local Match: the Nth result is Jev's (ADR 0089)", () => {
  it('settles no ordinal: which link is a result, and not an ad, is a judgement', () => {
    expect(localMatch('open the first result', RESULTS)).toBeNull()
    expect(localMatch('click on the first link', RESULTS)).toBeNull()
    expect(localMatch('open the second one', RESULTS)).toBeNull()
    expect(localMatch('open the top result', RESULTS)).toBeNull()
    expect(localMatch('open the first result', REFS)).toBeNull()
  })
})

describe('the Local Match: a bare word opens a Known Address (ADR 0089)', () => {
  it('opens the host a word names, as it was landed on', () => {
    expect(localMatch('open bbc', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'bbc.co.uk' })
  })

  it('leaves a bare word no landing named to Jev, never <word>.com', () => {
    expect(localMatch('open youtube', REFS)).toBeNull()
    expect(localMatch('open bluesky', REFS, known)).toBeNull()
    // A host or a URL is an address the words spell out.
    expect(localMatch('open bluesky.app', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'bluesky.app' })
  })
})

describe('the Local Match: a whole line has one reading on every page (ADR 0089)', () => {
  const NEXT: CommandRef[] = [...REFS, { ref: 7, kind: 'link', label: 'Next', href: 'https://example.com/?page=2', inputType: null }]

  it('leaves a whole line a ref\'s label carries to Jev: "next" beside a Next link may be the link', () => {
    expect(localMatch('next', NEXT)).toBeNull()
    expect(localMatch('Next.', NEXT)).toBeNull()
    expect(localMatch('next', REFS)).toMatchObject({ verb: 'play', music: { kind: 'skip' } })
    const back = [...REFS, { ref: 7, kind: 'link' as const, label: 'Back', href: 'https://example.com/', inputType: null }]
    expect(localMatch('back', back)).toBeNull()
    expect(localMatch('go back', back)).toMatchObject({ verb: 'back' })
    const proceed = [...REFS, { ref: 7, kind: 'button' as const, label: 'Continue', href: null, inputType: null }]
    expect(localMatch('continue', proceed)).toBeNull()
  })

  it('keeps a line whose words no label is: a player\'s "Pause (k)" is not "pause"', () => {
    const player = [...REFS, { ref: 7, kind: 'button' as const, label: 'Pause (k)', href: null, inputType: null }]
    expect(localMatch('pause', player)).toMatchObject({ verb: 'play', music: { kind: 'pause' } })
  })

  it('keeps `stop` an abort whatever the page holds: it never waits on an ask', () => {
    const stop = [...REFS, { ref: 7, kind: 'button' as const, label: 'Stop', href: null, inputType: null }]
    expect(localMatch('stop', stop)).toMatchObject({ verb: 'stop' })
  })

  it("leaves the Player's intent lines to Jev, which is offered correct and forget", () => {
    for (const line of ['not that one', 'the other one', 'wrong one', 'show it', 'wrong song', 'the one before', 'next result']) expect(localMatch(line, REFS)).toBeNull()
    expect(localMatch('show the video', REFS)).toMatchObject({ verb: 'play', music: { kind: 'show' } })
    expect(localMatch('forget this song', REFS)).toMatchObject({ verb: 'play', music: { kind: 'forget' } })
  })
})

describe('the Local Match: the CLI grammar', () => {
  it('reads the CLI grammar as Commands, with no page needed', () => {
    expect(localMatch('navigate youtube.com', [])).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
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
    expect(localMatch('press down three times', REFS)).toMatchObject({ verb: 'press', slot: 'down', key: { key: 'ArrowDown' }, times: 3 })
    expect(localMatch('hit tab 2 times', REFS)).toMatchObject({ verb: 'press', key: { key: 'Tab' }, times: 2 })
    expect(localMatch('press enter many times', REFS)).toBeNull()
  })

  it('navigates an address after an opening phrase, and leaves search phrasing to Jev (#353)', () => {
    expect(localMatch('open youtube', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    expect(localMatch('go to news.ycombinator.com', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'news.ycombinator.com' })
    // Search terms are Jev's, whose `where` scopes them: no search phrase is a fixed phrase.
    expect(localMatch('search for rust async book', REFS)).toBeNull()
    expect(localMatch('look up weather in berlin', REFS)).toBeNull()
    expect(localMatch('google rust', REFS)).toBeNull()
  })

  it('clicks the one ref whose label the words name — articles and kind words aside', () => {
    expect(localMatch('click sign in', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(localMatch('click the Sign In button', REFS)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(localMatch('tap trending', REFS)).toEqual({ verb: 'click', target: 6, slot: null })
    expect(localMatch('press accept all', REFS)).toEqual({ verb: 'click', target: 5, slot: null })
    // `open` of a label exactly one ref carries is a click on this page, not a navigate.
    expect(localMatch('open trending', REFS)).toEqual({ verb: 'click', target: 6, slot: null })
  })

  it("settles an open alone only for an address; words about the page that no ref carries are Jev's", () => {
    expect(localMatch("open Elon Musk's latest tweet", REFS)).toBeNull()
    expect(localMatch('open the tweet', REFS)).toBeNull()
    expect(localMatch('open youtube dot com', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'youtube dot com' })
    expect(localMatch('go to https://example.org/a?b=1', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'https://example.org/a?b=1' })
    expect(localMatch('open localhost:3000', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'localhost:3000' })
  })

  it('settles an open of an address with words past it (#341): the address alone, the words left for the Task', () => {
    expect(localMatch('go to twitter and open donald trumps profile', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'twitter.com' })
    expect(localMatch('open youtube and search for lofi', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    // A bare word no landing named is Jev's, with the words past it.
    expect(localMatch('go to bluesky and open the feed', REFS, known)).toBeNull()
    expect(localMatch('go to youtube dot com then search for lofi', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'youtube dot com' })
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

  it("leaves a span a ref on the page carries to Jev: the page's word, not an address", () => {
    const settings = [...REFS, { ref: 7, kind: 'link' as const, label: 'Account settings', href: 'https://example.com/settings', inputType: null }]
    expect(localMatch('open settings and click save', settings)).toBeNull()
    expect(localMatch('go to trending and scroll down', REFS)).toBeNull()
    expect(localMatch('go to twitter and scroll down', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'twitter.com' })
  })

  it("leaves a bare word a ref's label carries to Jev: the page's word, never <word>.com (2026-10-21)", () => {
    const settings = [...REFS, { ref: 7, kind: 'button' as const, label: 'Settings', href: null, inputType: null }, { ref: 8, kind: 'link' as const, label: 'Settings', href: 'https://example.com/settings', inputType: null }]
    // Two Settings refs: no exact-label click, and no settings.com either.
    expect(localMatch('open settings', settings)).toBeNull()
    const comments = [...REFS, { ref: 7, kind: 'button' as const, label: 'Comments section', href: null, inputType: null }]
    expect(localMatch('open comments', comments)).toBeNull()
    // The one ref labelled YouTube is clicked, as before; two refs carrying the word are Jev's; off a page that names it, youtube.com.
    const youtube = [...REFS, { ref: 7, kind: 'link' as const, label: 'YouTube Music', href: 'https://music.youtube.com/', inputType: null }, { ref: 8, kind: 'link' as const, label: 'YouTube Kids', href: 'https://www.youtubekids.com/', inputType: null }]
    expect(localMatch('open youtube', [...REFS, { ref: 7, kind: 'link' as const, label: 'YouTube', href: 'https://www.youtube.com/', inputType: null }])).toEqual({ verb: 'click', target: 7, slot: null })
    expect(localMatch('open youtube', youtube)).toBeNull()
    expect(localMatch('open youtube', REFS, known)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    // A host or a URL is an address whatever the page says.
    expect(localMatch('open youtube.com', youtube)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    expect(localMatch('open youtube dot com', youtube)).toEqual({ verb: 'navigate', target: null, slot: 'youtube dot com' })
  })

  it('makes no Local Match when the label names no ref, or more than one — never the ref sharing the most words', () => {
    expect(localMatch('click sign', REFS)).toBeNull()
    expect(localMatch('click the first video', REFS)).toBeNull()
    expect(localMatch('tap on the sign thing', REFS)).toBeNull()
    expect(localMatch('click the google sign in thing', REFS)).toBeNull()
    const twoSearches = [...REFS, { ref: 7, kind: 'button' as const, label: 'Search', href: null, inputType: null }]
    expect(localMatch('click search', twoSearches)).toBeNull()
  })

  it('types the Slot into the one ref the words name, or into the one text field', () => {
    expect(localMatch('type hello in the search box', REFS)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
    expect(localMatch('type rust async book into search', REFS)).toEqual({ verb: 'type', target: 3, slot: 'rust async book' })
    expect(localMatch('type hello', REFS)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
    // A page with two text fields leaves a target-less type to Jev, as does a field no ref's label is exactly.
    const twoFields = [...REFS, { ref: 7, kind: 'input' as const, label: 'Email address', href: null, inputType: 'email' }]
    expect(localMatch('type hello', twoFields)).toBeNull()
    expect(localMatch('type hello in the email address field', twoFields)).toEqual({ verb: 'type', target: 7, slot: 'hello' })
    expect(localMatch('type hello in the email', twoFields)).toBeNull()
    expect(localMatch('type hello', [])).toBeNull()
  })

  it('makes no Local Match of words with no fixed phrase: they are Jev\'s, never a search (#353)', () => {
    expect(localMatch('what is the weather like', REFS)).toBeNull()
    expect(localMatch('the first video please', REFS)).toBeNull()
    expect(localMatch('rust async book', REFS)).toBeNull()
    expect(localMatch('', REFS)).toBeNull()
  })

  it('reads the typed grammar\'s navigate as a navigate of an address, or a search of words that are none', () => {
    expect(localMatch('navigate youtube.com', REFS)).toEqual({ verb: 'navigate', target: null, slot: 'youtube.com' })
    expect(localMatch('navigate rust async book', REFS)).toEqual({ verb: 'search', target: null, slot: 'rust async book' })
  })
})

describe('the Local Match: menu (#363, ADR 0079)', () => {
  const PLAYER: CommandRef[] = [...REFS, { ref: 7, kind: 'media', label: 'Video player', href: null, inputType: null }]

  it('reads `menu 7` and "right-click <label>" as a menu on the ref, the label exactly one ref carries', () => {
    expect(localMatch('menu 7', [])).toEqual({ verb: 'menu', target: 7, slot: null })
    expect(localMatch('right-click the video player', PLAYER)).toEqual({ verb: 'menu', target: 7, slot: null })
    expect(localMatch('right click on video player', PLAYER)).toEqual({ verb: 'menu', target: 7, slot: null })
  })

  it("leaves a right-click no one ref names to Jev, and names the menu in the Feed's action line", () => {
    expect(localMatch('right-click the player', REFS)).toBeNull()
    expect(localMatch('right-click', PLAYER)).toBeNull()
    expect(describeCommand({ verb: 'menu', target: 7, slot: null }, { url: '', title: '', refs: PLAYER })).toBe('menu [7] "Video player"')
  })

  it('offers Jev the menu verb', () => {
    expect(JEV_VERBS).toContain('menu')
    expect(GRAMMAR_ONLY_VERBS.has('menu')).toBe(false)
  })
})
