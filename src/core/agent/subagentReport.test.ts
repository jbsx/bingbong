import { describe, expect, it } from 'vitest'
import type { MemoryEntry, WorkingMemorySnapshot } from '../session/workingMemory'
import { MAX_SUBAGENT_REPORT_FINDINGS, MAX_SUBAGENT_REPORT_UNRESOLVED, parseSubagentReportSections, selectDelegatedMemory } from './subagentReport'

// The Subagent Report contract (#98): validated structured sections a
// workhorse returns alongside its prose, and delegation's explicit,
// bounded selection of Session Working Memory for a worker to read.

describe('parseSubagentReportSections', () => {
  it('accepts valid findings and unresolved items', () => {
    const parsed = parseSubagentReportSections({
      findings: [
        { subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x', title: 'Review' }] },
        { subject: 'Price', detail: 'Cheapest at $89.' },
      ],
      unresolved: ['Stock check pending', 'Second source needed'],
    })

    expect(parsed.findings).toEqual([
      { subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x', title: 'Review' }] },
      { subject: 'Price', detail: 'Cheapest at $89.', references: [] },
    ])
    expect(parsed.unresolved).toEqual(['Stock check pending', 'Second source needed'])
  })

  it('drops an invalid findings array while keeping valid unresolved items', () => {
    const parsed = parseSubagentReportSections({
      findings: [{ subject: 'Missing detail' }],
      unresolved: ['Still open'],
    })

    expect(parsed.findings).toBeUndefined()
    expect(parsed.unresolved).toEqual(['Still open'])
  })

  it('drops an invalid unresolved array while keeping valid findings', () => {
    const parsed = parseSubagentReportSections({
      findings: [{ subject: 'Fine', detail: 'Kept.', references: [] }],
      unresolved: ['', 'blank entries are not evidence'],
    })

    expect(parsed.findings).toEqual([{ subject: 'Fine', detail: 'Kept.', references: [] }])
    expect(parsed.unresolved).toBeUndefined()
  })

  it('rejects findings over the cap and unresolved over the cap', () => {
    const tooManyFindings = Array.from({ length: MAX_SUBAGENT_REPORT_FINDINGS + 1 }, (_, i) => ({
      subject: `S${i}`,
      detail: 'd',
    }))
    const tooManyUnresolved = Array.from({ length: MAX_SUBAGENT_REPORT_UNRESOLVED + 1 }, (_, i) => `item ${i}`)

    expect(parseSubagentReportSections({ findings: tooManyFindings }).findings).toBeUndefined()
    expect(parseSubagentReportSections({ unresolved: tooManyUnresolved }).unresolved).toBeUndefined()
  })

  it('rejects unknown fields, bad references, and non-http urls inside a finding', () => {
    const extraField = { subject: 's', detail: 'd', surprise: true }
    const badReference = { subject: 's', detail: 'd', references: [{ url: 'not-a-url' }] }
    const ftpReference = { subject: 's', detail: 'd', references: [{ url: 'ftp://x.test/a' }] }

    for (const finding of [extraField, badReference, ftpReference]) {
      expect(parseSubagentReportSections({ findings: [finding] }).findings).toBeUndefined()
    }
  })

  it('canonicalizes and dedupes reference urls', () => {
    const parsed = parseSubagentReportSections({
      findings: [{
        subject: 'Sources',
        detail: 'Two links, one page.',
        references: [
          { url: 'HTTPS://Shop.Test:443/item?b=2&a=1#top' },
          { url: 'https://shop.test/item?a=1&b=2' },
        ],
      }],
    })

    const references = parsed.findings?.[0]?.references ?? []
    expect(references).toHaveLength(1)
    expect(references[0]?.url).toBe('https://shop.test/item?a=1&b=2')
  })

  it('returns nothing for absent or malformed payloads', () => {
    expect(parseSubagentReportSections({})).toEqual({})
    expect(parseSubagentReportSections(null)).toEqual({})
    expect(parseSubagentReportSections('findings')).toEqual({})
    expect(parseSubagentReportSections({ findings: 'many' })).toEqual({})
    expect(parseSubagentReportSections({ unresolved: { 0: 'one' } })).toEqual({})
  })
})

function entry(id: string, subject: string): MemoryEntry {
  return {
    id: id as never,
    sessionId: 'session-1' as never,
    kind: 'constraint',
    subject,
    detail: `${subject} detail`,
    references: [],
    provenance: [],
  }
}

const snapshot: WorkingMemorySnapshot = Object.freeze([
  Object.freeze(entry('memory-1', 'Budget')),
  Object.freeze(entry('memory-2', 'Deadline')),
  Object.freeze(entry('memory-3', 'Ruled out')),
])

describe('selectDelegatedMemory', () => {
  it('picks exactly the requested entries, in snapshot order', () => {
    const selected = selectDelegatedMemory(snapshot, ['memory-3', 'memory-1'])

    expect(selected.map(({ id }) => id)).toEqual(['memory-1', 'memory-3'])
  })

  it('collapses duplicate ids instead of sharing an entry twice', () => {
    const selected = selectDelegatedMemory(snapshot, ['memory-2', 'memory-2'])

    expect(selected.map(({ id }) => id)).toEqual(['memory-2'])
  })

  it('refuses an unknown id — a typo must not silently starve the worker', () => {
    expect(() => selectDelegatedMemory(snapshot, ['memory-1', 'memory-9'])).toThrow(/memory-9/)
  })

  it('refuses selections over the delegation bound', () => {
    const many = Array.from({ length: 11 }, (_, i) => entry(`memory-${i}`, `E${i}`))

    expect(() => selectDelegatedMemory(Object.freeze(many), many.map(({ id }) => id))).toThrow(/at most 10/)
  })

  it('returns a frozen slice and shares nothing beyond the ids', () => {
    const selected = selectDelegatedMemory(snapshot, ['memory-2'])

    expect(Object.isFrozen(selected)).toBe(true)
    expect(selected).toHaveLength(1)
    // The entry itself is the snapshot's frozen object, not a mutable copy.
    expect(selected[0]).toBe(snapshot[1])
  })
})
