import { describe, expect, it } from 'vitest'
import type { ObservationId, ObservationProducer, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import type { RunEvidenceCheckpoint } from './runContextCompaction'
import { emptyPageReadLine, pageReadPartLine, previewFactLine } from '../browser/pageText'
import {
  deriveFallbackSources,
  MAX_FALLBACK_EXCERPT_CHARS,
  MAX_FALLBACK_SOURCES,
  MAX_FALLBACK_TITLE_CHARS,
} from './fallbackAnswer'

let counter = 0

function record(input: {
  producer: ObservationProducer
  ok?: boolean
  payload: unknown
  sourceUrl?: string
}): ObservationRecord {
  counter += 1
  return {
    id: `obs-${counter}` as ObservationId,
    at: counter,
    producer: input.producer,
    ok: input.ok ?? true,
    payload: input.payload,
    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
  }
}

function sessionObservation(overrides: Partial<SessionObservation> = {}): SessionObservation {
  return {
    id: 'memory-1' as MemoryEntryId,
    sessionId: 'session-1' as never,
    sourceKind: 'web',
    text: 'stored text',
    observedAt: 1,
    references: [],
    provenance: [],
    ...overrides,
  }
}

describe('deterministic fallback sources (#137)', () => {
  it('merges duplicate sources by canonical URL and keeps first-seen ordering among equals', () => {
    const sources = deriveFallbackSources({
      records: [
        record({ producer: 'action_outcome', payload: 'navigated: url=x title="One"', sourceUrl: 'https://EXAMPLE.com/page/#section' }),
        record({ producer: 'action_outcome', payload: 'worked', sourceUrl: 'https://example.com/page' }),
        record({ producer: 'action_outcome', payload: 'worked too', sourceUrl: 'https://example.com/other' }),
      ],
    })
    // The host lowercases, the hash and trailing slash fall away — one
    // merged source — and equally detailed sources follow first observation.
    expect(sources.map((source) => source.url)).toEqual(['https://example.com/page', 'https://example.com/other'])
  })

  it('contributes only successful page-facing observations', () => {
    const sources = deriveFallbackSources({
      records: [
        record({ producer: 'page_read', payload: 'read', ok: false, sourceUrl: 'https://example.com/failed' }),
        record({ producer: 'command', payload: 'the command' }),
        record({ producer: 'page_read', payload: 'read', sourceUrl: 'https://example.com/good' }),
        record({ producer: 'action_outcome', payload: 'record_evidence rejected (excerpt_unsupported): nonsense' }),
      ],
    })
    expect(sources.map((source) => source.url)).toEqual(['https://example.com/good'])
  })

  it('extracts the settled title from the snapshot header and the navigation line', () => {
    const sources = deriveFallbackSources({
      records: [
        record({
          producer: 'page_read',
          payload: '# r/manhwa \u2014 Horizon ch. 45 discussion \u2014 https://www.reddit.com/r/manhwa/comments/z8sfnn/\nviewport 1280x800 scroll 0/900',
          sourceUrl: 'https://www.reddit.com/r/manhwa/comments/z8sfnn/',
        }),
        record({
          producer: 'action_outcome',
          payload: 'navigated: url=https://example.org/horizon title="Horizon \u2014 the reading order"',
          sourceUrl: 'https://example.org/horizon',
        }),
      ],
    })
    const byUrl = new Map(sources.map((source) => [source.url, source]))
    expect(byUrl.get('https://www.reddit.com/r/manhwa/comments/z8sfnn')?.title).toBe(
      'r/manhwa \u2014 Horizon ch. 45 discussion',
    )
    expect(byUrl.get('https://example.org/horizon')?.title).toBe('Horizon \u2014 the reading order')
  })

  it('quotes the page-text digest verbatim, cut before BLOCKER and advisory notes', () => {
    const digest = 'The boxer appears at the end of chapter 45.\nSecond line of page content.'
    const sources = deriveFallbackSources({
      records: [
        record({
          producer: 'page_read',
          payload: `# T \u2014 https://example.com/a\n[1] link "next"\npage text:\n${digest}\nBLOCKER:challenge (example.com)\nnudge text\nAuto-vision (no observable change): note`,
          sourceUrl: 'https://example.com/a',
        }),
      ],
    })
    expect(sources[0]?.excerpt).toBe(digest)
    expect(sources[0]?.excerptKind).toBe('page')
  })

  it('never quotes a fact line as the page\u2019s own text (#290)', () => {
    // Every Page Read ends by naming its part, and a cut preview by naming
    // how much it showed: both are the product's words about the text.
    const excerptOf = (payload: string): string | undefined =>
      deriveFallbackSources({ records: [record({ producer: 'page_read', payload, sourceUrl: 'https://example.com/a' })] })[0]?.excerpt
    const head = '# T \u2014 https://example.com/a\n[1] link "next"'

    expect(excerptOf(`${head}\npage text:\nA short page.\n${pageReadPartLine(1, 1)}`)).toBe('A short page.')
    expect(excerptOf(`${head}\npage text:\nThe closing lines.\n${pageReadPartLine(3, 3)}`)).toBe('The closing lines.')
    expect(excerptOf(`${head}\npage text:\nThe opening lines.\n${previewFactLine(18, 7412, 1)}`)).toBe('The opening lines.')
    // A page with no text has no heading, only the line: nothing to quote.
    expect(excerptOf(`${head}\n${emptyPageReadLine()}`)).toBeUndefined()
  })

  it('keeps a look\u2019s text but labels it as the run\u2019s look, not page text', () => {
    const sources = deriveFallbackSources({
      records: [
        record({
          producer: 'look',
          payload: 'The page shows a login wall covering the article text.',
          sourceUrl: 'https://example.com/walled',
        }),
      ],
    })
    expect(sources[0]?.excerpt).toBe('The page shows a login wall covering the article text.')
    expect(sources[0]?.excerptKind).toBe('look')
  })

  it('never takes a title from a look\u2019s vision prose or from page content', () => {
    // A vision description quoting title-shaped text is a model-authored
    // claim, and a digest quoting an attribute-like string is page
    // content — neither is the settled page title (#137/AC4).
    const sources = deriveFallbackSources({
      records: [
        record({
          producer: 'look',
          payload: 'title="Definitely the real title" says the banner.',
          sourceUrl: 'https://example.com/looked',
        }),
        record({
          producer: 'page_read',
          payload: '# Real Title \u2014 https://example.com/read\npage text:\nthe novel mentions title="junk" in chapter two',
          sourceUrl: 'https://example.com/read',
        }),
      ],
    })
    const byUrl = new Map(sources.map((source) => [source.url, source]))
    expect(byUrl.get('https://example.com/looked')?.title).toBeUndefined()
    expect(byUrl.get('https://example.com/read')?.title).toBe('Real Title')
  })

  it('bounds the excerpt and title deterministically', () => {
    const sources = deriveFallbackSources({
      records: [
        record({
          producer: 'page_read',
          payload: `page text:\n${'x'.repeat(MAX_FALLBACK_EXCERPT_CHARS + 50)}`,
          sourceUrl: 'https://example.com/long',
        }),
      ],
    })
    expect(sources[0]?.excerpt?.length).toBe(MAX_FALLBACK_EXCERPT_CHARS)
    expect(sources[0]?.excerpt?.endsWith('\u2026')).toBe(true)
    const titled = deriveFallbackSources({
      records: [
        record({
          producer: 'action_outcome',
          payload: `navigated: url=https://example.com/t title=${JSON.stringify('t'.repeat(MAX_FALLBACK_TITLE_CHARS + 10))}`,
          sourceUrl: 'https://example.com/t',
        }),
      ],
    })
    expect(titled[0]?.title?.length).toBe(MAX_FALLBACK_TITLE_CHARS)
  })

  it('caps the listed sources, keeping the strongest', () => {
    const records = Array.from({ length: MAX_FALLBACK_SOURCES + 4 }, (_, i) =>
      record({ producer: 'action_outcome', payload: `worked ${i}`, sourceUrl: `https://example.com/p${i}` }),
    )
    // The last page read is the strongest by inspection recency.
    records.push(record({ producer: 'page_read', payload: 'read', sourceUrl: 'https://example.com/inspected' }))
    const sources = deriveFallbackSources({ records })
    expect(sources).toHaveLength(MAX_FALLBACK_SOURCES)
    expect(sources[0]?.url).toBe('https://example.com/inspected')
  })

  it('ranks accepted Session Evidence first and discloses its uncertainty', () => {
    const inspected = record({
      producer: 'page_read',
      payload: '# Later \u2014 https://example.com/later\npage text:\nlater page content',
      sourceUrl: 'https://example.com/later',
    })
    const evidenced = record({
      producer: 'page_read',
      payload: '# Earlier \u2014 https://example.com/earlier\npage text:\nword ' + 'rich '.repeat(50),
      sourceUrl: 'https://example.com/earlier',
    })
    const checkpoint: RunEvidenceCheckpoint = { entryId: 'memory-7' as MemoryEntryId, sourceObservationId: evidenced.id }
    const sources = deriveFallbackSources({
      records: [evidenced, inspected],
      checkpoints: [checkpoint],
      resolveObservation: (id) =>
        id === 'memory-7' ? sessionObservation({ id, uncertainty: 'chapter numbering differs between editions' }) : null,
    })
    expect(sources[0]?.url).toBe('https://example.com/earlier')
    expect(sources[0]?.uncertainty).toBe('chapter numbering differs between editions')
    expect(sources[1]?.url).toBe('https://example.com/later')
    expect(sources[1]?.uncertainty).toBeUndefined()
  })

  it('leaves plain observation once the Session no longer holds the evidence', () => {
    const evidenced = record({
      producer: 'page_read',
      payload: 'read',
      sourceUrl: 'https://example.com/e',
    })
    const checkpoint: RunEvidenceCheckpoint = { entryId: 'memory-9' as MemoryEntryId, sourceObservationId: evidenced.id }
    const sources = deriveFallbackSources({
      records: [evidenced],
      checkpoints: [checkpoint],
      resolveObservation: () => null,
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]?.uncertainty).toBeUndefined()
  })

  it('ranks by inspection recency, then retained richness, then first observation', () => {
    const listing = record({
      producer: 'action_outcome',
      payload: 'navigated: url=https://example.org/threads title="threads"\npage text:\nthread one thread two',
      sourceUrl: 'https://example.org/threads',
    })
    const reddit = record({
      producer: 'page_read',
      payload: '# Post \u2014 https://www.reddit.com/r/x/comments/1/\npage text:\nshort',
      sourceUrl: 'https://www.reddit.com/r/x/comments/1/',
    })
    // The Reddit page was directly inspected after the listing's navigation —
    // recency of inspection beats the listing's longer retained digest.
    expect(
      deriveFallbackSources({ records: [listing, reddit] }).map((source) => source.url),
    ).toEqual(['https://www.reddit.com/r/x/comments/1', 'https://example.org/threads'])
    // With no direct inspection anywhere, the richer digest wins.
    const a = record({ producer: 'action_outcome', payload: 'page text:\n' + 'a'.repeat(80), sourceUrl: 'https://example.com/a' })
    const b = record({ producer: 'action_outcome', payload: 'page text:\n' + 'b'.repeat(40), sourceUrl: 'https://example.com/b' })
    expect(deriveFallbackSources({ records: [a, b] }).map((source) => source.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })
})

describe('pages the fallback Answer never names as a source (#298)', () => {
  const GUIDE = 'https://example.com/guide'

  function guide(): ObservationRecord {
    return record({ producer: 'page_read', payload: `# Guide — ${GUIDE}\npage text:\nthe guide itself`, sourceUrl: GUIDE })
  }

  function evidenceOn(grounding: ObservationRecord) {
    const checkpoint: RunEvidenceCheckpoint = { entryId: 'memory-3' as MemoryEntryId, sourceObservationId: grounding.id }
    return {
      checkpoints: [checkpoint],
      resolveObservation: (id: MemoryEntryId) => (id === 'memory-3' ? sessionObservation({ id }) : null),
    }
  }

  function urls(deps: Parameters<typeof deriveFallbackSources>[0]): readonly string[] {
    return deriveFallbackSources(deps).map((source) => source.url)
  }

  it('leaves out a search results page, however recently it was read', () => {
    const engine = 'https://www.bing.com/search?q=best+manhwa'
    const records = [
      guide(),
      record({
        producer: 'action_outcome',
        payload: `navigated: url=${engine} title="best manhwa - Search"\npage text:\nresult one`,
        sourceUrl: engine,
      }),
      record({ producer: 'page_read', payload: `# best manhwa - Search — ${engine}\npage text:\nresult one result two`, sourceUrl: engine }),
      // A site's own search, in the path form and the named-parameter form.
      record({ producer: 'page_read', payload: 'page text:\nhits', sourceUrl: 'https://example.com/search/manhwa' }),
      record({ producer: 'look', payload: 'a list of hits', sourceUrl: 'https://example.com/find?query=manhwa' }),
    ]
    expect(urls({ records })).toEqual([GUIDE])
  })

  it('leaves out a Not-found Landing, and the reads of the page it landed on', () => {
    const dead = 'https://example.com/gone'
    const records = [
      guide(),
      record({
        producer: 'action_outcome',
        payload: `navigated: url=${dead} title="Example"\npage text:\nHome About Contact\nNOT-FOUND:404 example.com\nThis address names nothing on example.com.`,
        sourceUrl: dead,
      }),
      record({ producer: 'page_read', payload: `# Example — ${dead}\npage text:\nHome About Contact`, sourceUrl: dead }),
    ]
    expect(urls({ records })).toEqual([GUIDE])
  })

  it('leaves out an Unavailable Landing', () => {
    const down = 'https://example.net/report'
    const records = [
      guide(),
      record({
        producer: 'action_outcome',
        payload: `clicked [4] urlChanged=true url=${down}\nUNAVAILABLE:503 example.net\nexample.net could not serve this page right now.`,
        sourceUrl: down,
      }),
    ]
    expect(urls({ records })).toEqual([GUIDE])
  })

  it('names a page the site served on a later arrival, and not one that went down after', () => {
    const retried = 'https://example.net/report'
    const down = `navigated: url=${retried} title="502 Bad Gateway"\nUNAVAILABLE:502 example.net\nadvice`
    const served = `navigated: url=${retried} title="Report"\npage text:\nthe report itself`
    // Acting on the dead page arrives nowhere: it stays the landing it was.
    const typed = record({ producer: 'action_outcome', payload: 'typed [3]: value set', sourceUrl: retried })
    const outcome = (payload: string) => record({ producer: 'action_outcome', payload, sourceUrl: retried })
    expect(urls({ records: [outcome(down), typed] })).toEqual([])
    const sources = deriveFallbackSources({ records: [outcome(down), outcome(served)] })
    expect(sources).toEqual([{ url: retried, title: 'Report', excerpt: 'the report itself', excerptKind: 'page' }])
    expect(urls({ records: [outcome(served), outcome(down)] })).toEqual([])
    const click = `clicked [4]: urlChanged=true dialogOpen=false; url=${retried}\npage text:\nthe report itself`
    expect(urls({ records: [outcome(down), outcome(click)] })).toEqual([retried])
  })

  it('reads the Search URL off any spelling of the address the page was seen under', () => {
    const records = [
      record({ producer: 'page_read', payload: 'page text:\nhits', sourceUrl: 'https://example.com/search/manhwa/' }),
      record({ producer: 'page_read', payload: 'page text:\nhits', sourceUrl: 'https://example.com/search/manhwa' }),
    ]
    expect(urls({ records })).toEqual([])
    expect(urls({ records: [records[0]!] })).toEqual([])
  })

  it('reads a marker from an Action Outcome only, never from what a page or a Look says', () => {
    const quoting = 'https://example.com/status-codes'
    const records = [
      record({ producer: 'page_read', payload: 'page text:\nNOT-FOUND:404 example.com\nis the line a dead page carries', sourceUrl: quoting }),
      record({ producer: 'look', payload: 'UNAVAILABLE:503 example.com', sourceUrl: quoting }),
    ]
    expect(urls({ records })).toEqual([quoting])
  })

  it('keeps such a page when an accepted Observation rests on it, ranked as evidence is', () => {
    const engine = 'https://www.bing.com/search?q=opening+hours'
    const results = record({
      producer: 'page_read',
      payload: `# opening hours - Search — ${engine}\npage text:\nOpen 9 to 5`,
      sourceUrl: engine,
    })
    const dead = 'https://example.com/moved'
    const landing = record({
      producer: 'action_outcome',
      payload: `navigated: url=${dead} title="Moved"\npage text:\nThis page moved to /new\nNOT-FOUND:410 example.com\nadvice`,
      sourceUrl: dead,
    })
    const sources = deriveFallbackSources({ records: [results, landing, guide()], ...evidenceOn(results) })
    expect(sources.map((source) => source.url)).toEqual([engine, GUIDE])
    expect(sources[0]?.excerpt).toBe('Open 9 to 5')
    expect(urls({ records: [landing, guide()], ...evidenceOn(landing) })).toEqual([dead, GUIDE])
  })

  it('leaves the page out again once the Session no longer holds the evidence', () => {
    const results = record({ producer: 'page_read', payload: 'page text:\nresults', sourceUrl: 'https://www.bing.com/search?q=x' })
    expect(urls({ records: [results, guide()], ...evidenceOn(results), resolveObservation: () => null })).toEqual([GUIDE])
  })

  it('names no source when only such pages were seen', () => {
    const records = [
      record({ producer: 'page_read', payload: 'page text:\nresults', sourceUrl: 'https://www.bing.com/search?q=x' }),
      record({
        producer: 'action_outcome',
        payload: 'navigated: url=https://example.com/gone title="Page not found"\nNOT-FOUND:title example.com\nadvice',
        sourceUrl: 'https://example.com/gone',
      }),
    ]
    expect(deriveFallbackSources({ records })).toEqual([])
  })
})
