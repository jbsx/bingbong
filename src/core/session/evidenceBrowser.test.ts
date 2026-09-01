import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import type { MemoryEntryId, MemoryProvenance } from './workingMemory'
import type { ObservationContradiction, SessionCandidate, SessionObservation } from './sessionEvidence'
import {
  candidateMatchesFilter,
  describeObservationProvenance,
  evidenceTotal,
  isDelegatedObservation,
  layoutObservationCards,
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
  it('orders Observations and Candidates newest first — ties broken by latest creation', () => {
    const older = observation({ id: 'memory-1' as MemoryEntryId, observedAt: 100 })
    const tieA = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 500 })
    const tieB = observation({ id: 'memory-3' as MemoryEntryId, observedAt: 500 })
    // Same clock tick: the later-created record still renders first.
    expect(newestFirstObservations([older, tieA, tieB]).map(({ id }) => id)).toEqual(['memory-3', 'memory-2', 'memory-1'])

    const early = candidate({ id: 'memory-4' as MemoryEntryId, recordedAt: 100 })
    const tieEarly = candidate({ id: 'memory-5' as MemoryEntryId, recordedAt: 900 })
    const tieLate = candidate({ id: 'memory-6' as MemoryEntryId, recordedAt: 900 })
    // memory-6 was created after memory-5 within the same tick: it leads.
    expect(newestFirstCandidates([early, tieEarly, tieLate]).map(({ id }) => id)).toEqual(['memory-6', 'memory-5', 'memory-4'])
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

describe('contradiction grouping (#143)', () => {
  const pair = (earlier: string, later: string): ObservationContradiction => ({
    earlierObservationId: earlier as MemoryEntryId,
    laterObservationId: later as MemoryEntryId,
  })

  const groupIds = (groups: readonly (readonly SessionObservation[])[]): string[][] =>
    groups.map((group) => group.map(({ id }) => id))

  it('groups contradictory Observations side by side at the newest member position — neither preferred', () => {
    const older = observation({ id: 'memory-1' as MemoryEntryId, text: 'The Acme router costs $39.', observedAt: 100 })
    const newer = observation({ id: 'memory-2' as MemoryEntryId, text: 'The Acme router costs $59.', observedAt: 200 })
    const unrelated = observation({
      id: 'memory-3' as MemoryEntryId,
      text: 'Shipping is free.',
      observedAt: 300,
      references: [{ url: 'https://shop.example/shipping' }],
    })

    const { groups, contradictedIds } = layoutObservationCards([older, newer, unrelated], [pair('memory-1', 'memory-2')])
    // The disagreement renders as one group at the newest member's
    // position, members newest-first inside it; the untouched
    // Observation stays a singleton in its own place.
    expect(groupIds(groups)).toEqual([['memory-3'], ['memory-2', 'memory-1']])
    // Chip truth resolved from either member of every pair.
    expect([...contradictedIds].sort()).toEqual(['memory-1', 'memory-2'])
  })

  it('clusters whole chains: A contradicted by B and B by C is one group of three', () => {
    const a = observation({ id: 'memory-1' as MemoryEntryId, observedAt: 100 })
    const b = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 200 })
    const c = observation({ id: 'memory-3' as MemoryEntryId, observedAt: 300 })
    const { groups } = layoutObservationCards([a, b, c], [pair('memory-1', 'memory-2'), pair('memory-2', 'memory-3')])
    expect(groupIds(groups)).toEqual([['memory-3', 'memory-2', 'memory-1']])
  })

  it('keeps the chip truth when a filter hides a partner — a hidden card never hides the disagreement', () => {
    const newer = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 200 })
    // Only the later member passed the filter: it renders alone, but it
    // still carries its contradicted state.
    const { groups, contradictedIds } = layoutObservationCards([newer], [pair('memory-1', 'memory-2')])
    expect(groupIds(groups)).toEqual([['memory-2']])
    expect(contradictedIds.has('memory-2' as MemoryEntryId)).toBe(true)
  })

  it('with no contradictions every Observation is its own group and nothing is flagged', () => {
    const first = observation({ id: 'memory-1' as MemoryEntryId, observedAt: 100 })
    const second = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 200 })
    const { groups, contradictedIds } = layoutObservationCards([first, second], [])
    expect(groupIds(groups)).toEqual([['memory-2'], ['memory-1']])
    expect(contradictedIds.size).toBe(0)
  })

  it('breaks newest-first ties inside a group by the same later-creation rule', () => {
    const tieEarly = observation({ id: 'memory-1' as MemoryEntryId, observedAt: 500 })
    const tieLate = observation({ id: 'memory-2' as MemoryEntryId, observedAt: 500 })
    const { groups } = layoutObservationCards([tieEarly, tieLate], [pair('memory-1', 'memory-2')])
    expect(groupIds(groups)).toEqual([['memory-2', 'memory-1']])
  })
})
