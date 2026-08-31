import { describe, expect, it } from 'vitest'
import type { ObservationId, ObservationProducer, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import type { RunEvidenceCheckpoint } from './runContextCompaction'
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
          payload: 'navigated: url=https://www.google.com/search?q=x title="reddit manhwa horizon \u2014 Google Search"',
          sourceUrl: 'https://www.google.com/search?q=x',
        }),
      ],
    })
    const byUrl = new Map(sources.map((source) => [source.url, source]))
    expect(byUrl.get('https://www.reddit.com/r/manhwa/comments/z8sfnn')?.title).toBe(
      'r/manhwa \u2014 Horizon ch. 45 discussion',
    )
    expect(byUrl.get('https://www.google.com/search?q=x')?.title).toBe('reddit manhwa horizon \u2014 Google Search')
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
    const serp = record({
      producer: 'action_outcome',
      payload: 'navigated: url=https://www.google.com/search?q=x title="results"\npage text:\nresult one result two',
      sourceUrl: 'https://www.google.com/search?q=x',
    })
    const reddit = record({
      producer: 'page_read',
      payload: '# Post \u2014 https://www.reddit.com/r/x/comments/1/\npage text:\nshort',
      sourceUrl: 'https://www.reddit.com/r/x/comments/1/',
    })
    // The Reddit page was directly inspected after the SERP navigation —
    // recency of inspection beats the SERP's longer retained digest.
    expect(
      deriveFallbackSources({ records: [serp, reddit] }).map((source) => source.url),
    ).toEqual(['https://www.reddit.com/r/x/comments/1', 'https://www.google.com/search?q=x'])
    // With no direct inspection anywhere, the richer digest wins.
    const a = record({ producer: 'action_outcome', payload: 'page text:\n' + 'a'.repeat(80), sourceUrl: 'https://example.com/a' })
    const b = record({ producer: 'action_outcome', payload: 'page text:\n' + 'b'.repeat(40), sourceUrl: 'https://example.com/b' })
    expect(deriveFallbackSources({ records: [a, b] }).map((source) => source.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })
})
