import { describe, expect, it } from 'vitest'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import { appendAnswerSources, deriveAnswerSources, scrubAnswerText } from './answerEvidence'

const entryId = (id: string): MemoryEntryId => id as MemoryEntryId

const observation = (id: MemoryEntryId, urls: string[], title?: string): SessionObservation => ({
  id,
  sessionId: 'session-1' as never,
  sourceKind: 'web',
  text: 'text',
  observedAt: 0,
  references: urls.map((url) => ({ url, ...(title ? { title } : {}) })),
  provenance: [{ runId: 'run-1' as never }],
})

describe('deriveAnswerSources', () => {
  it('derives source links from cited evidence, in citation order, deduplicated by URL', () => {
    const byId = new Map([
      [entryId('memory-2'), observation(entryId('memory-2'), ['https://shop.example/a', 'https://shop.example/b'], 'Shop')],
      [entryId('memory-1'), observation(entryId('memory-1'), ['https://shop.example/a'])],
      [entryId('memory-3'), observation(entryId('memory-3'), ['https://reviews.example/x'])],
    ])
    expect(deriveAnswerSources([entryId('memory-2'), entryId('memory-1'), entryId('memory-3')], (id) => byId.get(id) ?? null)).toEqual([
      { url: 'https://shop.example/a', title: 'Shop' },
      { url: 'https://shop.example/b', title: 'Shop' },
      { url: 'https://reviews.example/x' },
    ])
  })

  it('skips unknown identities silently — unresolved citations contribute nothing', () => {
    expect(deriveAnswerSources([entryId('memory-9')], () => null)).toEqual([])
    expect(deriveAnswerSources(undefined, () => null)).toEqual([])
    // User Observations carry no web references: no links derived.
    const userWords = { ...observation(entryId('memory-4'), []), sourceKind: 'user' as const }
    expect(deriveAnswerSources([entryId('memory-4')], (id) => (id === entryId('memory-4') ? userWords : null))).toEqual([])
  })
})

describe('scrubAnswerText', () => {
  it('never exposes internal identities: memory-N and obs-N tokens are scrubbed (#122)', () => {
    expect(scrubAnswerText('Cheapest per memory-2 and obs-4.')).not.toMatch(/memory-\d|obs-\d/)
    expect(scrubAnswerText('Cheapest (memory-2).')).toBe('Cheapest ().')
    expect(scrubAnswerText('Double  spaces  after memory-7 drops.')).not.toMatch(/ {2}/)
    // URLs legitimately containing id-shaped segments survive untouched.
    expect(scrubAnswerText('See https://shop.example/memory-2/specs.')).toContain('https://shop.example/memory-2/specs')
  })

  it('tidies the holes scrubbed tokens leave behind (#122)', () => {
    // A list of ids collapses to empty parens, not orphaned commas.
    expect(scrubAnswerText('Cheapest (memory-1, obs-2).')).toBe('Cheapest ().')
    expect(scrubAnswerText('Between memory-1, memory-2, and memory-3 it wins.')).toBe(
      'Between, and it wins.',
    )
    expect(scrubAnswerText('Ranking [memory-3].')).toBe('Ranking [].')
  })

  it('is the live text alone: no Sources block rides it (#141)', () => {
    expect(scrubAnswerText('Plain answer.')).toBe('Plain answer.')
    expect(scrubAnswerText('Found it.')).not.toContain('Sources:')
  })
})

describe('appendAnswerSources', () => {
  it('appends only the derived source links the text does not already carry', () => {
    const recorded = appendAnswerSources('The Acme router costs $39 at [the shop](https://shop.example/a).', [
      { url: 'https://shop.example/a' },
      { url: 'https://reviews.example/x', title: 'Reviews' },
    ])
    expect(recorded).toContain('[the shop](https://shop.example/a)')
    expect(recorded.match(/shop\.example\/a\)/g)).toHaveLength(1)
    expect(recorded.endsWith('Sources:\n- [Reviews](https://reviews.example/x)')).toBe(true)
  })

  it('adds nothing when every derived link is already present', () => {
    const text = 'See [Reviews](https://reviews.example/x).'
    expect(appendAnswerSources(text, [{ url: 'https://reviews.example/x' }])).toBe(text)
  })

  it('uses the page title as the link label when one exists', () => {
    expect(appendAnswerSources('Found it.', [{ url: 'https://reviews.example/x', title: 'Reviews' }]).endsWith(
      'Sources:\n- [Reviews](https://reviews.example/x)',
    )).toBe(true)
    expect(appendAnswerSources('Found it.', [{ url: 'https://reviews.example/x' }]).endsWith(
      'Sources:\n- [reviews.example](https://reviews.example/x)',
    )).toBe(true)
  })
})
