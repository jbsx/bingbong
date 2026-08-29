import { describe, expect, it } from 'vitest'
import type { MemoryEntry, WorkingMemorySnapshot } from '../session/workingMemory'
import type { ObservationRecord } from '../session/observationLedger'
import { memoryEntry } from '../testing/doubles'
import {
  droppedFindingsNote,
  MAX_SUBAGENT_REPORT_FINDINGS,
  MAX_SUBAGENT_REPORT_UNRESOLVED,
  parseSubagentReportSections,
  selectDelegatedMemory,
  validateReportFindings,
} from './subagentReport'

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

function frozen(entry: MemoryEntry): MemoryEntry {
  return Object.freeze({ ...entry, references: Object.freeze([...entry.references]), provenance: Object.freeze([...entry.provenance]) })
}

const snapshot: WorkingMemorySnapshot = Object.freeze([
  frozen(memoryEntry('memory-1', { subject: 'Budget', detail: 'Budget detail' })),
  frozen(memoryEntry('memory-2', { subject: 'Deadline', detail: 'Deadline detail' })),
  frozen(memoryEntry('memory-3', { subject: 'Ruled out', detail: 'Ruled out detail' })),
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
    const many = Array.from({ length: 11 }, (_, i) => memoryEntry(`memory-${i}`, { subject: `E${i}`, detail: `E${i} detail` }))

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

describe('validateReportFindings (#123)', () => {
  const observed = (id: string, url: string, ok = true): ObservationRecord => ({
    id: id as ObservationRecord['id'],
    at: 0,
    producer: 'page_read',
    ok,
    payload: 'page text',
    sourceUrl: url,
  })
  const finding = (subject: string, ...urls: string[]) => ({
    subject,
    detail: `${subject} detail`,
    references: urls.map((url) => ({ url })),
  })

  it('keeps findings whose every reference the worker observed, canonically', () => {
    const records = [observed('w1', 'https://reviews.test/x'), observed('w2', 'https://reviews.test/y')]

    const validated = validateReportFindings(
      [finding('Winner', 'https://reviews.test/x#details'), finding('Both', 'https://reviews.test/x', 'https://REVIEWS.test/y/')],
      records,
    )

    expect(validated).toEqual({ findings: [finding('Winner', 'https://reviews.test/x#details'), finding('Both', 'https://reviews.test/x', 'https://REVIEWS.test/y/')], dropped: 0 })
  })

  it('drops findings citing unobserved sources, reference-less findings, and failed observations', () => {
    const records = [observed('w1', 'https://reviews.test/x'), observed('w2', 'https://blocked.test/wall', false)]

    const validated = validateReportFindings(
      [
        finding('Grounded', 'https://reviews.test/x'),
        finding('Guessed', 'https://never-opened.test/a'),
        finding('Mixed', 'https://reviews.test/x', 'https://never-opened.test/a'),
        finding('NoRefs'),
        finding('FailedSource', 'https://blocked.test/wall'),
      ],
      records,
    )

    expect(validated.findings).toEqual([finding('Grounded', 'https://reviews.test/x')])
    expect(validated.dropped).toBe(4)
  })

  it('the drop note states the count honestly', () => {
    expect(droppedFindingsNote(1)).toMatch(/^1 finding dropped — the cited source was not observed/)
    expect(droppedFindingsNote(2)).toMatch(/^2 findings dropped — the cited sources were not observed/)
  })
})
