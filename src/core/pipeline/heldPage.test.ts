import { describe, expect, it } from 'vitest'
import type { SessionObservation } from '../session/sessionEvidence'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { HELD_PAGE_INSTRUCTION, HELD_PAGE_NOTICE_OBSERVATIONS, heldPageNotice, landedOnAnotherPage } from './heldPage'

// #240, ADR 0051: the Held Page Notice's words, and what counts as landing.
// A Held Page still loads; the outcome that lands on it names what the
// Session already holds from it, and the reads that follow do not repeat it.

function observation(id: string, text: string, extra: Partial<SessionObservation> = {}): SessionObservation {
  return {
    id: id as MemoryEntryId,
    sessionId: 'session-1' as SessionId,
    sourceKind: 'web',
    text,
    observedAt: 0,
    references: [{ url: 'https://rail.example/luggage' }],
    provenance: [{ runId: 'run-1' as RunId }],
    ...extra,
  }
}

describe('the Held Page Notice text (AC3)', () => {
  it('lists every held Observation as id: text, marks the volatile ones, and ends on the fixed sentence', () => {
    const notice = heldPageNotice([
      observation('memory-1', 'Standard fare: two cases and one bag.'),
      observation('memory-2', 'Bikes need a reservation.', { volatile: true }),
      observation('memory-3', 'Folding bikes travel free.', { provenance: [{ runId: 'run-1' as RunId, subagentId: 'a-1' }] }),
    ])

    expect(notice).toBe(
      [
        'Session Evidence already holds 3 Observations from this page:',
        'memory-1: Standard fare: two cases and one bag.',
        'memory-2 (volatile): Bikes need a reservation.',
        'memory-3: Folding bikes travel free.',
        HELD_PAGE_INSTRUCTION,
      ].join('\n'),
    )
    expect(HELD_PAGE_INSTRUCTION).toBe('Cite these rather than re-recording them, and read this page only for what they do not state.')
  })

  it('names one Observation in the singular', () => {
    expect(heldPageNotice([observation('memory-1', 'One fact.')])).toBe(
      ['Session Evidence already holds 1 Observation from this page:', 'memory-1: One fact.', HELD_PAGE_INSTRUCTION].join('\n'),
    )
  })

  it('caps the list at eight and counts the rest', () => {
    const held = Array.from({ length: 11 }, (_, index) => observation(`memory-${index + 1}`, `Fact ${index + 1}.`))
    const lines = heldPageNotice(held)!.split('\n')

    expect(HELD_PAGE_NOTICE_OBSERVATIONS).toBe(8)
    expect(lines[0]).toBe('Session Evidence already holds 11 Observations from this page:')
    expect(lines.slice(1, 9)).toEqual(held.slice(0, 8).map((entry) => `${entry.id}: ${entry.text}`))
    expect(lines[9]).toBe('and 3 more in Session Evidence.')
    expect(lines[10]).toBe(HELD_PAGE_INSTRUCTION)
  })

  it('says nothing when the Session holds nothing from the page', () => {
    expect(heldPageNotice([])).toBeNull()
  })
})

describe('landing on another page (AC2)', () => {
  it('is a move of the page by the store’s own canonical URL — no new URL rule (ADR 0051)', () => {
    expect(landedOnAnotherPage('https://search.example/?q=luggage', 'https://rail.example/luggage')).toBe(true)
    // A fragment, a trailing slash or a reordered query is the same page.
    expect(landedOnAnotherPage('https://rail.example/luggage', 'https://rail.example/luggage/#premier')).toBe(false)
    expect(landedOnAnotherPage('https://rail.example/luggage?a=1&b=2', 'https://rail.example/luggage?b=2&a=1')).toBe(false)
    // An alternate rendering is another page to the store, as it is to a checkpoint.
    expect(landedOnAnotherPage('https://rail.example/luggage/print', 'https://rail.example/luggage')).toBe(true)
  })

  it('counts the first page a Run settles on as a landing, and a page that is no web address as none', () => {
    expect(landedOnAnotherPage(null, 'https://rail.example/luggage')).toBe(true)
    expect(landedOnAnotherPage('about:blank', 'https://rail.example/luggage')).toBe(true)
    expect(landedOnAnotherPage('https://rail.example/luggage', null)).toBe(false)
    expect(landedOnAnotherPage('https://rail.example/luggage', 'about:blank')).toBe(false)
  })
})
