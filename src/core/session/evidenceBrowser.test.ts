import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import type { MemoryEntryId, MemoryProvenance } from './workingMemory'
import type { SessionCandidate, SessionObservation } from './sessionEvidence'
import {
  candidateMatchesFilter,
  describeObservationProvenance,
  evidenceTotal,
  isDelegatedObservation,
  newestFirstCandidates,
  newestFirstObservations,
  observationMatchesFilter,
  sourceLabel,
} from './evidenceBrowser'

function observation(overrides: Partial<SessionObservation> = {}): SessionObservation {
  return {
    id: 'memory-1' as MemoryEntryId,
    sessionId: 'session-1' as SessionId,
    sourceKind: 'web',
    text: 'The Acme router costs $39.',
    observedAt: 1_000,
    references: [{ url: 'https://shop.example/acme-router' }],
    provenance: [{ runId: 'run-1' as RunId }],
    ...overrides,
  }
}

function candidate(overrides: Partial<SessionCandidate> = {}): SessionCandidate {
  return {
    id: 'memory-9' as MemoryEntryId,
    sessionId: 'session-1' as SessionId,
    subject: 'Acme wifi router',
    status: 'active',
    recordedAt: 2_000,
    supportingObservationIds: ['memory-1' as MemoryEntryId],
    references: [],
    provenance: [{ runId: 'run-1' as RunId }],
    ...overrides,
  }
}

describe('evidence browser projection (#142)', () => {
  it('orders Observations and Candidates newest first, deterministically on ties', () => {
    const older = observation({ id: 'memory-1' as MemoryEntryId, observedAt: 100 })
    const tieA = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 500 })
    const tieB = observation({ id: 'memory-3' as MemoryEntryId, observedAt: 500 })
    expect(newestFirstObservations([older, tieA, tieB]).map(({ id }) => id)).toEqual(['memory-2', 'memory-3', 'memory-1'])

    const early = candidate({ id: 'memory-4' as MemoryEntryId, recordedAt: 100 })
    const late = candidate({ id: 'memory-5' as MemoryEntryId, recordedAt: 900 })
    expect(newestFirstCandidates([early, late]).map(({ id }) => id)).toEqual(['memory-5', 'memory-4'])
  })

  it('filters Observations by source kind; delegated is provenance-derived presentation', () => {
    const web = observation()
    const delegated = observation({
      id: 'memory-2' as MemoryEntryId,
      provenance: [{ runId: 'run-1' as RunId, subagentId: 'a-1' }],
    })
    const user = observation({ id: 'memory-3' as MemoryEntryId, sourceKind: 'user', references: [], provenance: [] })
    const vision = observation({ id: 'memory-4' as MemoryEntryId, sourceKind: 'vision', references: [], provenance: [] })
    const action = observation({ id: 'memory-5' as MemoryEntryId, sourceKind: 'action', references: [], provenance: [] })

    const all = [web, delegated, user, vision, action]
    expect(all.filter((entry) => observationMatchesFilter(entry, 'all'))).toHaveLength(5)
    expect(all.filter((entry) => observationMatchesFilter(entry, 'web'))).toEqual([web, delegated])
    expect(all.filter((entry) => observationMatchesFilter(entry, 'user'))).toEqual([user])
    expect(all.filter((entry) => observationMatchesFilter(entry, 'vision'))).toEqual([vision])
    expect(all.filter((entry) => observationMatchesFilter(entry, 'action'))).toEqual([action])
    // Delegated evidence keeps its grounding source kind — the filter is
    // presentation only, so the delegated card still matches 'web'.
    expect(all.filter((entry) => observationMatchesFilter(entry, 'delegated'))).toEqual([delegated])
    expect(delegated.sourceKind).toBe('web')
  })

  it('treats empty-string subagent provenance as not delegated', () => {
    expect(isDelegatedObservation(observation({ provenance: [{ runId: 'run-1' as RunId }] }))).toBe(false)
    expect(isDelegatedObservation(
      observation({ provenance: [{ runId: 'run-1' as RunId, subagentId: '' }] }),
    )).toBe(false)
  })

  it('filters Candidates by status', () => {
    const active = candidate()
    const accepted = candidate({ id: 'memory-10' as MemoryEntryId, status: 'accepted' })
    const rejected = candidate({ id: 'memory-11' as MemoryEntryId, status: 'rejected' })
    const superseded = candidate({ id: 'memory-12' as MemoryEntryId, status: 'superseded' })
    const all = [active, accepted, rejected, superseded]

    expect(all.filter((entry) => candidateMatchesFilter(entry, 'all'))).toHaveLength(4)
    expect(all.filter((entry) => candidateMatchesFilter(entry, 'active'))).toEqual([active])
    expect(all.filter((entry) => candidateMatchesFilter(entry, 'accepted'))).toEqual([accepted])
    expect(all.filter((entry) => candidateMatchesFilter(entry, 'rejected'))).toEqual([rejected])
    expect(all.filter((entry) => candidateMatchesFilter(entry, 'superseded'))).toEqual([superseded])
  })

  it('counts every current Observation and Candidate regardless of any filter', () => {
    expect(evidenceTotal([], [])).toBe(0)
    expect(evidenceTotal([observation(), observation({ id: 'memory-2' as MemoryEntryId })], [candidate()])).toBe(3)
  })

  it('labels sources by title, falling back to the hostname', () => {
    expect(sourceLabel({ url: 'https://shop.example/acme-router', title: 'Acme router' })).toBe('Acme router')
    expect(sourceLabel({ url: 'https://shop.example:8443/acme-router#specs' })).toBe('shop.example')
    expect(sourceLabel({ url: 'not a url' })).toBe('not a url')
  })

  it('describes provenance human-readably — never a Run, Subagent, or Memory Entry id', () => {
    const single: readonly MemoryProvenance[] = [{ runId: 'run-abc' as RunId }]
    expect(describeObservationProvenance(observation({ provenance: single }))).toBe('observed once')

    const merged = observation({
      provenance: [{ runId: 'run-abc' as RunId }, { runId: 'run-def' as RunId }],
    })
    expect(describeObservationProvenance(merged)).toBe('observed by 2 runs')

    const delegated = observation({
      provenance: [{ runId: 'run-abc' as RunId, subagentId: 'a-3' }, { runId: 'run-def' as RunId }],
    })
    expect(describeObservationProvenance(delegated)).toBe('via a delegated subagent · observed by 2 runs')

    const soloDelegated = observation({ provenance: [{ runId: 'run-abc' as RunId, subagentId: 'a-3' }] })
    expect(describeObservationProvenance(soloDelegated)).toBe('via a delegated subagent')

    for (const described of [
      describeObservationProvenance(merged),
      describeObservationProvenance(delegated),
      describeObservationProvenance(soloDelegated),
    ]) {
      expect(described).not.toMatch(/run-|a-3|memory-/)
    }
  })

  it('describes User Observations by the user event that supplied the exact text', () => {
    const command = observation({
      sourceKind: 'user',
      references: [],
      provenance: [{ runId: 'run-1' as RunId }],
      originEvent: { producer: 'command', observationId: 'obs-1' as never },
    })
    expect(describeObservationProvenance(command)).toBe("the user's command")

    const askUser = observation({
      sourceKind: 'user',
      references: [],
      provenance: [{ runId: 'run-1' as RunId }, { runId: 'run-2' as RunId }],
      originEvent: { producer: 'ask_user', observationId: 'obs-4' as never },
    })
    expect(describeObservationProvenance(askUser)).toBe("the user's ask_user answer · observed by 2 runs")

    const steering = observation({
      sourceKind: 'user',
      references: [],
      provenance: [{ runId: 'run-1' as RunId }],
      originEvent: { producer: 'steering', observationId: 'obs-7' as never },
    })
    expect(describeObservationProvenance(steering)).toBe("the user's steering directive")
    expect(describeObservationProvenance(steering)).not.toContain('obs-7')
  })
})
