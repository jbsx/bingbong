import { describe, expect, it } from 'vitest'
import {
  createObservationLedger,
  type ObservationId,
  type ObservationRecord,
} from './observationLedger'
import type { SessionGeneration } from './sessionIdentity'

function observationId(value: string): ObservationId {
  return value as ObservationId
}

describe('observation ledger', () => {
  it('mints stable sequential identities for every accepted observation', () => {
    const clock = { now: () => 0 }
    const generation = 3
    const ledger = createObservationLedger({
      now: () => clock.now(),
      generation,
      isCurrentGeneration: (candidate) => candidate === generation,
    })

    const first = ledger.record({ producer: 'command', ok: true, payload: 'find pizza' })
    clock.now = () => 12
    const second = ledger.record({
      producer: 'page_read',
      ok: true,
      payload: 'url: https://example.com\ntitle: Example',
      sourceUrl: 'https://example.com',
    })

    expect(first).toEqual({
      id: observationId('obs-1'),
      at: 0,
      producer: 'command',
      ok: true,
      payload: 'find pizza',
    } satisfies ObservationRecord)
    expect(second).toEqual({
      id: observationId('obs-2'),
      at: 12,
      producer: 'page_read',
      ok: true,
      payload: 'url: https://example.com\ntitle: Example',
      sourceUrl: 'https://example.com',
    } satisfies ObservationRecord)
  })

  it('retains the same identities across later retrievals', () => {
    const ledger = createObservationLedger({ now: () => 0, generation: 0, isCurrentGeneration: () => true })
    const recorded = ledger.record({ producer: 'action_outcome', ok: false, payload: 'ref 7 not found' })
    expect(recorded).not.toBeNull()

    // Rounds of further work land after it; the earlier identity is unchanged.
    ledger.record({ producer: 'look', ok: true, payload: 'a search results page' })
    expect(ledger.get(recorded!.id)).toBe(recorded)
    expect(ledger.snapshot()).toEqual([
      recorded,
      expect.objectContaining({ id: observationId('obs-2'), producer: 'look' }),
    ])
  })

  it('disappears when closed: no further records, nothing retrievable', () => {
    const ledger = createObservationLedger({ now: () => 0, generation: 0, isCurrentGeneration: () => true })
    const recorded = ledger.record({ producer: 'command', ok: true, payload: 'x' })

    ledger.close()

    expect(ledger.closed).toBe(true)
    expect(ledger.record({ producer: 'steering', ok: true, payload: 'no, the red one' })).toBeNull()
    expect(ledger.snapshot()).toEqual([])
    expect(ledger.get(recorded!.id)).toBeNull()
    ledger.close() // idempotent
    expect(ledger.closed).toBe(true)
  })

  it('refuses records from a stale Session generation without minting identities', () => {
    let generation: SessionGeneration = 1
    const ledger = createObservationLedger({
      now: () => 0,
      generation: 0,
      isCurrentGeneration: (candidate) => candidate === generation,
    })
    expect(ledger.record({ producer: 'subagent_report', ok: true, payload: 'findings…' })).toBeNull()

    // The refused attempt consumed no identity: the next accepted record is obs-1.
    generation = 0
    const accepted = ledger.record({ producer: 'subagent_report', ok: true, payload: 'findings…' })
    expect(accepted!.id).toBe(observationId('obs-1'))
  })

  it('freezes records and snapshots against mutation', () => {
    const ledger = createObservationLedger({ now: () => 0, generation: 0, isCurrentGeneration: () => true })
    const recorded = ledger.record({ producer: 'command', ok: true, payload: 'x' })
    expect(Object.isFrozen(recorded)).toBe(true)
    expect(Object.isFrozen(ledger.snapshot())).toBe(true)
  })
})
