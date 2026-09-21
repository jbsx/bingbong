import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { SnapshotRef } from '../browser/snapshot'
import type { ObservationRecord } from '../session/observationLedger'
import {
  createUnseenPhraseRail,
  shownTextsOf,
  unseenPhraseRewriteLine,
  withUnseenPhraseRewrite,
  type ShownText,
  type UnseenPhraseRewrite,
} from './unseenPhraseRail'

const call = (name: string, args: Record<string, unknown>, id = 'c1'): ToolCall => ({ id, name, args })
const navigate = (url: string): ToolCall => call('navigate', { url })
const typed = (text: string, ref = 3): ToolCall => call('type', { ref, text })

const COMMAND = 'Find the June 2013 NASA announcement about Voyager 1 and the "Has Not Yet Left" wording.'
const PAGE_READ = `# Voyager - NASA Science — https://science.nasa.gov/voyager\nviewport 985x575 scroll 0/4000\npage text:\nSeptember 12, 2013: "Voyager 1 Enters Interstellar Space", NASA’s announcement.\nRelated: the plasma-density measurement by Gurnett.`
const SEARCH_INPUT: SnapshotRef = { ref: 3, kind: 'input', role: 'searchbox', label: 'Search the fixture web', inputType: 'search' } as unknown as SnapshotRef
const TEXT_INPUT: SnapshotRef = { ref: 4, kind: 'input', role: 'textbox', label: 'Your name', inputType: 'text' } as unknown as SnapshotRef

function railOver(shown: readonly ShownText[], refs: Record<number, SnapshotRef> = {}) {
  return createUnseenPhraseRail({
    shownTexts: () => shown,
    describeRef: async (ref) => refs[ref],
  })
}

const SHOWN: readonly ShownText[] = [{ text: COMMAND }, { text: PAGE_READ, sourceUrl: 'https://science.nasa.gov/voyager' }]

describe('createUnseenPhraseRail (#267, ADR 0064)', () => {
  it('runs a search quoting a phrase a prior observation showed unchanged', async () => {
    const rail = railOver(SHOWN)
    expect(await rail.rewrite(navigate('https://duckduckgo.com/?q=%22Voyager+1+Enters+Interstellar+Space%22+NASA'))).toBeNull()
  })

  it('runs a search quoting a phrase present only in the command unchanged: the user’s own words are always seen', async () => {
    const rail = railOver([{ text: COMMAND }])
    expect(await rail.rewrite(navigate('NASA Voyager "Has Not Yet Left" June 2013'))).toBeNull()
  })

  it('unquotes a phrase present nowhere, keeps the words, and the head names the phrase', async () => {
    const rail = railOver(SHOWN)
    const rewrite = await rail.rewrite(navigate('https://duckduckgo.com/?q=%22Voyager+1+Has+Not+Yet+Left+the+Solar+System%22+NASA+June+2013'))
    expect(rewrite).not.toBeNull()
    expect(rewrite!.phrases).toEqual(['Voyager 1 Has Not Yet Left the Solar System'])
    expect(rewrite!.query).toBe('Voyager 1 Has Not Yet Left the Solar System NASA June 2013')
    expect(rewrite!.call.args.url).toBe('https://duckduckgo.com/?q=Voyager+1+Has+Not+Yet+Left+the+Solar+System+NASA+June+2013')
    expect(rewrite!.call.id).toBe('c1')
    expect(rewrite!.call.name).toBe('navigate')
    expect(unseenPhraseRewriteLine(rewrite!)).toBe(
      'Rewritten — "Voyager 1 Has Not Yet Left the Solar System" appears in nothing this run was shown, so it ran unquoted: Voyager 1 Has Not Yet Left the Solar System NASA June 2013. Quote only a phrase you were shown — on a page, in the user’s words or in a report.',
    )
  })

  it('matches ignoring case, whitespace runs, quote and dash variants and edge punctuation', async () => {
    const rail = railOver(SHOWN)
    // Case and a whitespace run.
    expect(await rail.rewrite(navigate('"voyager 1   enters interstellar SPACE"'))).toBeNull()
    // Curly apostrophe in the page, straight in the search; a straight quote in the page, curly in the search.
    expect(await rail.rewrite(navigate("\"NASA's announcement\""))).toBeNull()
    expect(await rail.rewrite(navigate('“Voyager 1 Enters Interstellar Space”'))).toBeNull()
    // An en dash where the page printed a hyphen, and edge punctuation on the span.
    expect(await rail.rewrite(navigate('"plasma–density measurement,"'))).toBeNull()
    // One word off is Unseen: no fuzzy match.
    const rewrite = await rail.rewrite(navigate('"Voyager 1 Enters Interstellar Spaces"'))
    expect(rewrite?.phrases).toEqual(['Voyager 1 Enters Interstellar Spaces'])
  })

  it('judges two spans in one search separately, and one head names both', async () => {
    const rail = railOver(SHOWN)
    const rewrite = await rail.rewrite(navigate('https://duckduckgo.com/?q=%22Voyager+1+Enters+Interstellar+Space%22+%22plasma+density+Gurnett%22+%22Voyager+1+Has+Not+Yet+Left%22'))
    expect(rewrite!.phrases).toEqual(['plasma density Gurnett', 'Voyager 1 Has Not Yet Left'])
    expect(rewrite!.query).toBe('"Voyager 1 Enters Interstellar Space" plasma density Gurnett Voyager 1 Has Not Yet Left')
    expect(unseenPhraseRewriteLine(rewrite!)).toMatch(
      /^Rewritten — "plasma density Gurnett" and "Voyager 1 Has Not Yet Left" appear in nothing this run was shown, so they ran unquoted: "Voyager 1 Enters Interstellar Space" plasma density Gurnett Voyager 1 Has Not Yet Left\./,
    )
    const three = await rail.rewrite(navigate('"a b" "c d" "e f"'))
    expect(unseenPhraseRewriteLine(three!)).toMatch(/^Rewritten — "a b", "c d" and "e f" appear in nothing/)
  })

  describe('every search form is rewritten alike, and each keeps its form', () => {
    it('rebuilds a q= Search URL by setting q', async () => {
      const rewrite = await railOver(SHOWN).rewrite(navigate('https://www.bing.com/search?q=%22Kurth+plasma%22+NASA&form=QBLH'))
      expect(rewrite!.call.args.url).toBe('https://www.bing.com/search?q=Kurth+plasma+NASA&form=QBLH')
    })

    it('rebuilds a named-parameter Search URL by setting that parameter, wherever it stands', async () => {
      const rewrite = await railOver(SHOWN).rewrite(navigate('https://collections.rmg.co.uk/objects?query=%22H4+sea+watch%22&page=2'))
      expect(rewrite!.phrases).toEqual(['H4 sea watch'])
      expect(rewrite!.call.args.url).toBe('https://collections.rmg.co.uk/objects?query=H4+sea+watch&page=2')
      // Another parameter ahead of the terms is left as it is.
      const behind = await railOver(SHOWN).rewrite(navigate('https://collections.rmg.co.uk/objects?page=2&Query=%22H4+sea+watch%22'))
      expect(behind!.call.args.url).toBe('https://collections.rmg.co.uk/objects?page=2&Query=H4+sea+watch')
      // As is a q= behind a sort key.
      const engine = await railOver(SHOWN).rewrite(navigate('https://www.bing.com/search?form=QBLH&q=%22Kurth+plasma%22'))
      expect(engine!.call.args.url).toBe('https://www.bing.com/search?form=QBLH&q=Kurth+plasma')
    })

    it('rebuilds a path-form Search URL by replacing its last segment', async () => {
      const rewrite = await railOver(SHOWN).rewrite(navigate('https://www.rmg.co.uk/collections/objects/search/%22H4%20sea%20watch%22%20Harrison'))
      expect(rewrite!.query).toBe('H4 sea watch Harrison')
      expect(rewrite!.call.args.url).toBe('https://www.rmg.co.uk/collections/objects/search/H4%20sea%20watch%20Harrison')
    })

    it('keeps bare terms bare', async () => {
      const rewrite = await railOver(SHOWN).rewrite(navigate('"Voyager 1 Has Not Yet Left" NASA'))
      expect(rewrite!.call.args.url).toBe('Voyager 1 Has Not Yet Left NASA')
    })

    it('rewrites a typed search and keeps its trailing newline', async () => {
      const rail = railOver(SHOWN, { 3: SEARCH_INPUT, 4: TEXT_INPUT })
      const rewrite = await rail.rewrite(typed('"Voyager 1 Has Not Yet Left" NASA\n'))
      expect(rewrite!.query).toBe('Voyager 1 Has Not Yet Left NASA')
      expect(rewrite!.call.args).toEqual({ ref: 3, text: 'Voyager 1 Has Not Yet Left NASA\n' })
      // Text typed into a field that is no search box is not a search.
      expect(await rail.rewrite(typed('"Voyager 1 Has Not Yet Left"\n', 4))).toBeNull()
      // Nor is a type the rail cannot resolve.
      expect(await railOver(SHOWN).rewrite(typed('"Voyager 1 Has Not Yet Left"\n'))).toBeNull()
    })

    it('leaves every other call alone: a plain navigate, a click, a read', async () => {
      const rail = railOver(SHOWN)
      expect(await rail.rewrite(navigate('https://science.nasa.gov/"quoted"/path'))).toBeNull()
      expect(await rail.rewrite(call('click', { ref: 2 }))).toBeNull()
      expect(await rail.rewrite(call('read_page', {}))).toBeNull()
    })
  })

  describe('a Search Echo is not sight', () => {
    const ECHO_URL = 'https://duckduckgo.com/?q=%22Voyager+1+Has+Not+Yet+Left%22+NASA+June+2013&ia=web'
    const ECHO =
      `navigated: url=${ECHO_URL} title="“Voyager 1 Has Not Yet Left” NASA June 2013 at DuckDuckGo"\n` +
      `# "Voyager 1 Has Not Yet Left" NASA June 2013 at DuckDuckGo — ${ECHO_URL}\n` +
      `[1] input "Search" value="“Voyager 1 Has Not Yet Left” NASA June 2013"\n` +
      `[2] link "Voyager 1 status update, March 2013" href="https://www.jpl.nasa.gov/news/voyager-1-status"\n` +
      `page text:\nresults for "Voyager 1 Has Not Yet Left" NASA June 2013\n` +
      `Voyager 1 status update — NASA Jet Propulsion Laboratory, March 20, 2013.`

    it('leaves a phrase present only in a results observation’s title, value= and "results for" lines Unseen', async () => {
      const rail = railOver([{ text: COMMAND }, { text: ECHO, sourceUrl: ECHO_URL }])
      const rewrite = await rail.rewrite(navigate('"Voyager 1 Has Not Yet Left" NASA press release'))
      expect(rewrite?.phrases).toEqual(['Voyager 1 Has Not Yet Left'])
      // The rest of the same observation is still sight.
      expect(await rail.rewrite(navigate('"Voyager 1 status update" 2013'))).toBeNull()
    })

    it('reads the same phrase in a result’s snippet line as seen', async () => {
      const snippet = `${ECHO}\nNASA said on June 27 that Voyager 1 has not yet left the heliosphere.`
      const rail = railOver([{ text: snippet, sourceUrl: ECHO_URL }])
      expect(await rail.rewrite(navigate('"Voyager 1 has not yet left" NASA'))).toBeNull()
    })

    it('reads a title, header or value= line carrying any quoted span of the query as an echo, and any line carrying the whole query, quotes or not', async () => {
      const url = 'https://www.bing.com/search?q=%22June+27%22+Voyager+%22Not+Yet+Left%22'
      // The engine prints the query cut in its title and without its quotes in the box.
      const text = `navigated: url=${url} title="June 27 Voyager - Search"\n# June 27 Voyager — ${url}\n[1] input "Search" value="Not Yet Left"\nresults\nJune 27 Voyager Not Yet Left\nA result: Voyager 1 leaves the heliosphere, said Stone on June 27.`
      const rail = railOver([{ text, sourceUrl: url }])
      expect((await rail.rewrite(navigate('"Not Yet Left" "June 27"')))?.phrases).toEqual(['Not Yet Left'])
      // A phrase the results carried that was no part of the query is sight.
      expect(await rail.rewrite(navigate('"leaves the heliosphere"'))).toBeNull()
    })

    it('reads a "results for" heading carrying one span of a two-span query as an echo', async () => {
      const url = 'http://127.0.0.1:4173/results?q=%22Kurth+plasma%22+%22Voyager+1%22'
      const text = `navigated: url=${url} title="fixture engine results"\npage text:\nno results for "Kurth plasma"\nThe fixture web has no pages about that.`
      const rail = railOver([{ text, sourceUrl: url }])
      expect((await rail.rewrite(navigate('"Kurth plasma"')))?.phrases).toEqual(['Kurth plasma'])
    })

    it('drops a result line that repeats a lone quoted phrase, the one edge ADR 0064 accepts', async () => {
      const url = 'https://duckduckgo.com/?q=%22Voyager+1+Has+Not+Yet+Left%22'
      const text = `navigated: url=${url} title="“Voyager 1 Has Not Yet Left” at DuckDuckGo"\npage text:\nNASA said Voyager 1 has not yet left the heliosphere.`
      const rail = railOver([{ text, sourceUrl: url }])
      expect((await rail.rewrite(navigate('"Voyager 1 Has Not Yet Left"')))?.phrases).toEqual(['Voyager 1 Has Not Yet Left'])
    })

    it('never treats a page that is no Search URL as an echo, whatever it prints', async () => {
      const rail = railOver([{ text: 'Voyager 1 Has Not Yet Left the Solar System — a page heading', sourceUrl: 'https://www.jpl.nasa.gov/news/voyager' }])
      expect(await rail.rewrite(navigate('"Voyager 1 Has Not Yet Left the Solar System"'))).toBeNull()
    })
  })

  it('counts a failed outcome’s text as shown', async () => {
    const rail = railOver([{ text: 'navigate failed: the page "Voyager 1 Has Not Yet Left" timed out' }])
    expect(await rail.rewrite(navigate('"Voyager 1 Has Not Yet Left"'))).toBeNull()
  })

  it('reads sight afresh per call: a phrase shown after a rewrite keeps its quotes next time', async () => {
    const shown: ShownText[] = []
    const rail = createUnseenPhraseRail({ shownTexts: () => shown })
    expect((await rail.rewrite(navigate('"Gurnett plasma"')))?.phrases).toEqual(['Gurnett plasma'])
    shown.push({ text: 'page text:\nGurnett plasma wave data', sourceUrl: 'https://www.jpl.nasa.gov/x' })
    expect(await rail.rewrite(navigate('"Gurnett plasma"'))).toBeNull()
  })

  it('unquotes a lone quoted word the Run never saw', async () => {
    const rewrite = await railOver(SHOWN).rewrite(navigate('"Kurth" Voyager plasma'))
    expect(rewrite?.phrases).toEqual(['Kurth'])
    expect(rewrite?.query).toBe('Kurth Voyager plasma')
  })

  it('makes a span of curly double quotes and never of single quotes; leaves empty, punctuation-only and unmatched quotes alone', async () => {
    const rail = railOver(SHOWN)
    expect((await rail.rewrite(navigate('“Kurth” Voyager')))?.query).toBe('Kurth Voyager')
    expect(await rail.rewrite(navigate("'Kurth' Voyager"))).toBeNull()
    expect(await rail.rewrite(navigate('"" Voyager'))).toBeNull()
    expect(await rail.rewrite(navigate('"..." Voyager'))).toBeNull()
    expect(await rail.rewrite(navigate('"Kurth Voyager'))).toBeNull()
    // A judged span beside an empty one: only the judged span changes.
    expect((await rail.rewrite(navigate('"" "Kurth" Voyager')))?.query).toBe('"" Kurth Voyager')
  })

  it('opens the outcome with the head, failed or not, and leaves a structured result alone', () => {
    const rewrite: UnseenPhraseRewrite = { phrases: ['Kurth'], query: 'Kurth Voyager', call: navigate('Kurth Voyager') }
    const line = unseenPhraseRewriteLine(rewrite)
    expect(withUnseenPhraseRewrite({ ok: true, result: 'navigated' }, rewrite)).toEqual({ ok: true, result: `${line}\nnavigated` })
    expect(withUnseenPhraseRewrite({ ok: false, error: 'refused' }, rewrite)).toEqual({ ok: false, error: `${line}\nrefused` })
    expect(withUnseenPhraseRewrite({ ok: true, result: { data: 1 } }, rewrite)).toEqual({ ok: true, result: { data: 1 } })
  })

  it('survives a sight seam that throws: nothing is seen, so the search runs unquoted', async () => {
    const rail = createUnseenPhraseRail({
      shownTexts: () => {
        throw new Error('ledger gone')
      },
    })
    expect((await rail.rewrite(navigate('"Kurth" Voyager')))?.phrases).toEqual(['Kurth'])
  })
})

describe('shownTextsOf', () => {
  it('hands every ledger record over as text with its source, failed outcomes included, and stringifies a structured payload', () => {
    const records: ObservationRecord[] = [
      { id: 'obs-1', at: 1, producer: 'command', ok: true, payload: COMMAND },
      { id: 'obs-2', at: 2, producer: 'page_read', ok: false, payload: 'read failed: timeout', sourceUrl: 'https://a.example/' },
      { id: 'obs-3', at: 3, producer: 'action_outcome', ok: true, payload: { title: 'Structured' } },
    ] as unknown as ObservationRecord[]
    expect(shownTextsOf(records)).toEqual([
      { text: COMMAND },
      { text: 'read failed: timeout', sourceUrl: 'https://a.example/' },
      { text: '{"title":"Structured"}' },
    ])
  })
})
