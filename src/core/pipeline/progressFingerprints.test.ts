import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import {
  actionFingerprint,
  isSearchInputRef,
  pageFingerprint,
  queryIntentFingerprint,
  searchQueryFromUrl,
  similarQueries,
  urlFingerprint,
} from './progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'

// Issue #125, ADR 0027 prefactor: the search-loop signatures generalized
// into one deterministic fingerprint module — query intent, URL, targeted
// action, and settled page state. Pure functions only; nothing here refuses
// a call. The no-progress rails that consume these fingerprints are #126.

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

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `${name}-${JSON.stringify(args)}`, name, args }
}

describe('queryIntentFingerprint (#125 AC1: equivalent queries normalize consistently)', () => {
  it('folds case, punctuation, word order, and light plurals into one intent', () => {
    expect(queryIntentFingerprint('best mechanical keyboards 2026')).toBe(queryIntentFingerprint('Best Mechanical Keyboards 2026!'))
    expect(queryIntentFingerprint('best mechanical keyboards 2026')).toBe(queryIntentFingerprint('2026 keyboards mechanical best'))
    expect(queryIntentFingerprint('weather london')).toBe(queryIntentFingerprint('Weather, London?'))
    expect(queryIntentFingerprint('keyboard')).toBe(queryIntentFingerprint('keyboards'))
  })

  it('separates genuinely different intents and stays deterministic', () => {
    expect(queryIntentFingerprint('weather london')).not.toBe(queryIntentFingerprint('weather tokyo'))
    expect(queryIntentFingerprint('best keyboards')).toBe(queryIntentFingerprint('best keyboards'))
    expect(queryIntentFingerprint('')).toBeNull()
    expect(queryIntentFingerprint('   ')).toBeNull()
  })

  it('keeps the rail same-intent test intact — similarQueries now lives here', () => {
    expect(similarQueries('best mechanical keyboards 2026', 'best mechanical keyboard 2026 reddit')).toBe(true)
    expect(similarQueries('reddit manhwa tier list image "horizon" "boxer"', 'reddit manhwa tier list "horizon" "boxer" before:2024')).toBe(true)
    expect(similarQueries('best mechanical keyboards 2026', 'weather in london')).toBe(false)
    expect(similarQueries('', 'anything at all')).toBe(false)
  })
})

describe('urlFingerprint (#125 AC1: equivalent URLs normalize consistently)', () => {
  it('normalizes scheme/host case, default ports, hashes, trailing slashes, and parameter order', () => {
    const canonical = urlFingerprint('https://www.example.com/articles/keyboard-guide/')
    expect(urlFingerprint('HTTPS://WWW.EXAMPLE.COM/articles/keyboard-guide/')).toEqual(canonical)
    expect(urlFingerprint('https://www.example.com:443/articles/keyboard-guide')).toEqual(canonical)
    expect(urlFingerprint('https://www.example.com/articles/keyboard-guide/#section')).toEqual(canonical)
    expect(urlFingerprint('https://www.example.com/articles/keyboard-guide?b=2&a=1')).toEqual(
      urlFingerprint('https://www.example.com/articles/keyboard-guide?a=1&b=2'),
    )
  })

  it('folds well-known tracking parameters', () => {
    expect(urlFingerprint('https://example.com/a?utm_source=x&utm_medium=y').url).toBe(urlFingerprint('https://example.com/a').url)
    expect(urlFingerprint('https://example.com/a?fbclid=abc').url).toBe(urlFingerprint('https://example.com/a').url)
    expect(urlFingerprint('https://example.com/a?gclid=abc').url).toBe(urlFingerprint('https://example.com/a').url)
  })

  it('keeps pagination and content parameters distinct — pagination is real progression', () => {
    expect(urlFingerprint('https://example.com/list?page=2').url).not.toBe(urlFingerprint('https://example.com/list?page=1').url)
    expect(urlFingerprint('https://example.com/list?page=2').url).not.toBe(urlFingerprint('https://example.com/list').url)
    expect(urlFingerprint('https://example.com/list?start=30').url).not.toBe(urlFingerprint('https://example.com/list?start=0').url)
  })

  it('normalizes plain search terms and bare domains the way the browser does', () => {
    expect(urlFingerprint('best mechanical keyboards').url).toBe(urlFingerprint('https://duckduckgo.com/?q=best+mechanical+keyboards').url)
    expect(urlFingerprint('example.com/a').url).toBe(urlFingerprint('https://example.com/a').url)
  })

  it('is stable for unparseable input', () => {
    expect(urlFingerprint('not a url at all').url).toBe(urlFingerprint('not a url at all').url)
    expect(urlFingerprint('not a url at all').source).toBe(urlFingerprint('not a url at all').source)
  })
})

describe('urlFingerprint source identity (#125 AC3: alternate representations are one source)', () => {
  it('collapses first-party print, reader, JSON, RSS, and AMP representations of one page', () => {
    const article = urlFingerprint('https://example.com/news/keyboard-guide')
    expect(urlFingerprint('https://example.com/news/keyboard-guide.html').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide.json').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide.rss').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?print=1').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?printable=true').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?output=amp').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?outputType=amp').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?format=json').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?reader=1').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/amp/news/keyboard-guide').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide/amp').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide/print').source).toBe(article.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide/reader').source).toBe(article.source)
  })

  it('marks exactly the URLs whose representation markers were folded', () => {
    expect(urlFingerprint('https://example.com/a?print=1').alternate).toBe(true)
    expect(urlFingerprint('https://example.com/a.json').alternate).toBe(true)
    expect(urlFingerprint('https://example.com/amp/a').alternate).toBe(true)
    expect(urlFingerprint('https://example.com/a?reader=1').alternate).toBe(true)
    expect(urlFingerprint('https://example.com/a').alternate).toBe(false)
    expect(urlFingerprint('https://example.com/a?page=2').alternate).toBe(false)
  })

  it('never collapses across hosts — a third-party AMP cache or mirror is a different source', () => {
    expect(urlFingerprint('https://google.com/amp/s/example.com/a').source).not.toBe(urlFingerprint('https://example.com/a').source)
    expect(urlFingerprint('https://mirror.example.org/a').source).not.toBe(urlFingerprint('https://example.com/a').source)
  })

  it('states the restored Mirror rule whole: first-party representations one source, a third-party mirror distinct (#140, ADR 0009)', () => {
    const original = urlFingerprint('https://example.com/news/keyboard-guide')
    // First-party alternate representations of the page are the same source…
    expect(urlFingerprint('https://example.com/news/keyboard-guide.json').source).toBe(original.source)
    expect(urlFingerprint('https://example.com/news/keyboard-guide?print=1').source).toBe(original.source)
    // …while a third-party mirror of the same material is a distinct source.
    expect(urlFingerprint('https://mirror.example.org/news/keyboard-guide').source).not.toBe(original.source)
  })

  it('keeps different articles and paginated views of one listing distinct sources of content', () => {
    expect(urlFingerprint('https://example.com/news/a').source).not.toBe(urlFingerprint('https://example.com/news/b').source)
    expect(urlFingerprint('https://example.com/list?page=2').source).not.toBe(urlFingerprint('https://example.com/list?page=3').source)
  })

  it('keeps the exact-URL identity distinct even where the source identity collapses', () => {
    expect(urlFingerprint('https://example.com/a.json').url).not.toBe(urlFingerprint('https://example.com/a').url)
  })
})

describe('actionFingerprint (#125 AC1: equivalent targeted actions normalize consistently)', () => {
  it('normalizes navigations through the URL fingerprint', () => {
    expect(actionFingerprint(call('navigate', { url: 'https://EXAMPLE.com/a/' }))).toBe(
      actionFingerprint(call('navigate', { url: 'https://example.com/a' })),
    )
    expect(actionFingerprint(call('navigate', { url: 'https://example.com/a?utm_source=x' }))).toBe(
      actionFingerprint(call('navigate', { url: 'https://example.com/a' })),
    )
  })

  it('normalizes search navigations by query intent, across engines and input forms', () => {
    const typed = actionFingerprint(call('navigate', { url: 'https://www.google.com/search?q=best+mechanical+keyboards' }))
    expect(actionFingerprint(call('navigate', { url: 'https://duckduckgo.com/?q=Best+Mechanical+Keyboards!' }))).toBe(typed)
    expect(actionFingerprint(call('navigate', { url: 'best mechanical keyboards' }))).toBe(typed)
    expect(actionFingerprint(call('navigate', { url: 'https://www.google.com/search?q=weather+tokyo' }))).not.toBe(typed)
  })

  it('normalizes typed text case and whitespace but preserves order and punctuation — form text is not a search query', () => {
    expect(actionFingerprint(call('type', { ref: 7, text: 'John Smith' }))).toBe(
      actionFingerprint(call('type', { ref: 7, text: '  john smith ' })),
    )
    expect(actionFingerprint(call('type', { ref: '7', text: 'john smith' }))).toBe(
      actionFingerprint(call('type', { ref: 7, text: 'john smith' })),
    )
    expect(actionFingerprint(call('type', { ref: 8, text: 'john smith' }))).not.toBe(
      actionFingerprint(call('type', { ref: 7, text: 'john smith' })),
    )
    // Order and punctuation are identity in form text: reordering a name or
    // mangling an email is a genuinely different action, not a repeat.
    expect(actionFingerprint(call('type', { ref: 7, text: 'Jane Doe' }))).not.toBe(
      actionFingerprint(call('type', { ref: 7, text: 'Doe, Jane' })),
    )
    expect(actionFingerprint(call('type', { ref: 7, text: 'jane.doe@x.com' }))).not.toBe(
      actionFingerprint(call('type', { ref: 7, text: 'doe.jane@x.com' })),
    )
    // The trailing submit newline is the gesture, not the text: retyping
    // the same text with or without it is the same targeted action.
    expect(actionFingerprint(call('type', { ref: 7, text: 'hello\n' }))).toBe(
      actionFingerprint(call('type', { ref: 7, text: 'hello' })),
    )
  })

  it('fingerprints clicks by target ref, scrolls by direction, and media by action', () => {
    expect(actionFingerprint(call('click', { ref: '7' }))).toBe(actionFingerprint(call('click', { ref: 7 })))
    expect(actionFingerprint(call('click', { ref: 7 }))).not.toBe(actionFingerprint(call('click', { ref: 8 })))
    expect(actionFingerprint(call('scroll', { direction: 'down' }))).not.toBe(actionFingerprint(call('scroll', { direction: 'up' })))
    expect(actionFingerprint(call('media_control', { action: 'seek', offset: 10 }))).not.toBe(
      actionFingerprint(call('media_control', { action: 'seek', offset: 20 })),
    )
    expect(actionFingerprint(call('media_control', { action: 'play_pause' }))).toBe(
      actionFingerprint(call('media_control', { action: 'play_pause' })),
    )
  })

  it('is deterministic for targetless and unknown tools', () => {
    expect(actionFingerprint(call('read_page'))).toBe(actionFingerprint(call('read_page')))
    expect(actionFingerprint(call('back'))).toBe(actionFingerprint(call('back')))
    expect(actionFingerprint(call('ask_user', { question: 'Which one?' }))).toBe(
      actionFingerprint(call('ask_user', { question: 'Which one?' })),
    )
    expect(actionFingerprint(call('ask_user', { question: 'Which one?' }))).not.toBe(
      actionFingerprint(call('ask_user', { question: 'Or another?' })),
    )
  })
})

describe('pageFingerprint (#125 AC2: meaningful page progression is distinguished)', () => {
  const base = {
    url: 'https://example.com/articles/guide',
    title: 'The guide',
    textDigest: 'Intro paragraph.\nSecond paragraph.',
    scrollY: 0,
    dialogOpen: false,
    dialogText: '',
  }

  it('is identical for identical settled state and deterministic across calls', () => {
    expect(pageFingerprint(base)).toEqual(pageFingerprint(base))
    expect(pageFingerprint(base).state).toBe(pageFingerprint({ ...base }).state)
  })

  it('distinguishes meaningful content changes', () => {
    const changed = pageFingerprint({ ...base, textDigest: 'Intro paragraph.\nA different paragraph entirely.' })
    expect(changed.content).not.toBe(pageFingerprint(base).content)
    expect(changed.state).not.toBe(pageFingerprint(base).state)
  })

  it('distinguishes dialog changes', () => {
    const dialog = pageFingerprint({ ...base, dialogOpen: true, dialogText: 'Accept cookies?' })
    expect(dialog.content).not.toBe(pageFingerprint(base).content)
    const otherDialog = pageFingerprint({ ...base, dialogOpen: true, dialogText: 'Sign in to continue' })
    expect(otherDialog.content).not.toBe(dialog.content)
  })

  it('distinguishes scroll progression while keeping content identity stable', () => {
    const scrolled = pageFingerprint({ ...base, scrollY: 800 })
    const scrolledAgain = pageFingerprint({ ...base, scrollY: 1600 })
    expect(scrolled.state).not.toBe(pageFingerprint(base).state)
    expect(scrolledAgain.state).not.toBe(scrolled.state)
    expect(scrolled.content).toBe(pageFingerprint(base).content)
  })

  it('ignores sub-pixel scroll jitter and within-bucket drift', () => {
    expect(pageFingerprint({ ...base, scrollY: 800.2 }).state).toBe(pageFingerprint({ ...base, scrollY: 800 }).state)
    // Position is quantized to 50px buckets like media time is to seconds:
    // drift inside one bucket folds, movement crossing buckets reads as
    // progression (sticky headers and anchoring shift a few dozen pixels;
    // a keyboard nudge or wheel notch moves ~100).
    expect(pageFingerprint({ ...base, scrollY: 810 }).state).toBe(pageFingerprint({ ...base, scrollY: 800 }).state)
    expect(pageFingerprint({ ...base, scrollY: 900 }).state).not.toBe(pageFingerprint({ ...base, scrollY: 800 }).state)
  })

  it('distinguishes pagination', () => {
    const page2 = pageFingerprint({ ...base, url: 'https://example.com/list?page=2', textDigest: 'Results 11–20.' })
    const page3 = pageFingerprint({ ...base, url: 'https://example.com/list?page=3', textDigest: 'Results 21–30.' })
    expect(page2.source).not.toBe(page3.source)
    expect(page2.state).not.toBe(page3.state)
  })

  it('distinguishes media progression (playback time, pause, volume) independently of page content', () => {
    const playing = pageFingerprint({ ...base, media: { paused: false, currentTime: 42.8, volume: 0.65 } })
    const later = pageFingerprint({ ...base, media: { paused: false, currentTime: 61.2, volume: 0.65 } })
    const paused = pageFingerprint({ ...base, media: { paused: true, currentTime: 61.2, volume: 0.65 } })
    const louder = pageFingerprint({ ...base, media: { paused: false, currentTime: 61.2, volume: 0.9 } })
    expect(later.state).not.toBe(playing.state)
    expect(paused.state).not.toBe(later.state)
    expect(louder.state).not.toBe(later.state)
    expect(later.content).toBe(playing.content)
  })

  it('treats sub-second media drift as the same progression bucket', () => {
    expect(
      pageFingerprint({ ...base, media: { paused: false, currentTime: 42.1, volume: 0.65 } }).state,
    ).toBe(pageFingerprint({ ...base, media: { paused: false, currentTime: 42.9, volume: 0.65 } }).state)
  })

  it('treats absent and no-element media identically', () => {
    expect(pageFingerprint({ ...base }).state).toBe(pageFingerprint({ ...base, media: null }).state)
  })
})

describe('pageFingerprint alternate representations (#125 AC3)', () => {
  it('does not count a URL-only alternate-representation change as new page state', () => {
    const human = pageFingerprint({
      url: 'https://example.com/news/keyboard-guide',
      title: 'Keyboard guide',
      textDigest: 'The full article text.',
      scrollY: 0,
      dialogOpen: false,
      dialogText: '',
    })
    const print = pageFingerprint({
      url: 'https://example.com/news/keyboard-guide?print=1',
      title: 'Keyboard guide',
      textDigest: 'The full article text.',
      scrollY: 0,
      dialogOpen: false,
      dialogText: '',
    })
    const json = pageFingerprint({
      url: 'https://example.com/news/keyboard-guide.json',
      title: 'Keyboard guide',
      textDigest: 'The full article text.',
      scrollY: 0,
      dialogOpen: false,
      dialogText: '',
    })
    expect(print.source).toBe(human.source)
    expect(print.content).toBe(human.content)
    expect(print.state).toBe(human.state)
    expect(json.state).toBe(human.state)
  })

  it('still distinguishes genuinely different material on the same host', () => {
    const a = pageFingerprint({ url: 'https://example.com/news/a', title: 'A', textDigest: 'Text A', scrollY: 0, dialogOpen: false, dialogText: '' })
    const b = pageFingerprint({ url: 'https://example.com/news/b', title: 'B', textDigest: 'Text B', scrollY: 0, dialogOpen: false, dialogText: '' })
    expect(a.state).not.toBe(b.state)
  })
})

describe('search-loop signatures generalized here (#125 AC4)', () => {
  it('keeps searchQueryFromUrl behavior — q= extraction and plain-term normalization', () => {
    expect(searchQueryFromUrl('https://www.google.com/search?q=site%3Areddit.com+manhwa+tier+list')).toBe(
      'site:reddit.com manhwa tier list',
    )
    expect(searchQueryFromUrl('best mechanical keyboards')).toBe('best mechanical keyboards')
    expect(searchQueryFromUrl('https://youtube.com/watch?v=abc')).toBeNull()
    expect(searchQueryFromUrl('https://www.google.com/search?q=')).toBeNull()
  })

  it('keeps isSearchInputRef behavior — type=search or a search label', () => {
    expect(isSearchInputRef(ref({ inputType: 'search', label: '' }))).toBe(true)
    expect(isSearchInputRef(ref({ label: 'Search the web' }))).toBe(true)
    expect(isSearchInputRef(ref({ label: 'Research keywords' }))).toBe(false)
    expect(isSearchInputRef(ref({ kind: 'link', label: 'Search results' }))).toBe(false)
  })
})
