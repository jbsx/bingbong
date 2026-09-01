import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import type { MemoryEntryId } from './workingMemory'
import type { ObservationId } from './observationLedger'
import { createSessionEvidence, MAX_UNCERTAINTY_CHARS } from './sessionEvidence'
import type { SessionEvidenceStore } from './sessionEvidence'
function evidenceHarness(now = (): number => 0): { evidence: SessionEvidenceStore; ids: string[] } {
  const minted: string[] = []
  let next = 0
  return {
    ids: minted,
    evidence: createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now,
      mintId: () => {
        const id = `memory-${++next}`
        minted.push(id)
        return id as MemoryEntryId
      },
    }),
  }
}

const webReference = { url: 'https://shop.example/acme-router' }

function webObservation(text = 'The Acme router costs $39.', runId = 'run-1' as RunId) {
  return { sourceKind: 'web' as const, text, references: [webReference], runId }
}

describe('session evidence', () => {
  it('checkpoints grounded Observations with source kind, time, uncertainty, references, and provenance', () => {
    let at = 500
    const { evidence } = evidenceHarness(() => at)
    const result = evidence.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      uncertainty: 'price shown in a cached cart',
      references: [webReference],
      runId: 'run-1' as RunId,
      subagentId: 'a-2',
    })

    expect(result).toEqual({
      observation: {
        id: 'memory-1',
        sessionId: 'session-1',
        sourceKind: 'web',
        text: 'The Acme router costs $39.',
        observedAt: 500,
        uncertainty: 'price shown in a cached cart',
        // Uncertain evidence is volatile by derivation (#123).
        volatile: true,
        references: [webReference],
        provenance: [{ runId: 'run-1', subagentId: 'a-2' }],
      },
      merged: false,
      contradicts: [],
    })
    expect(Object.isFrozen(result!.observation)).toBe(true)

    at = 900
    const user = evidence.checkpointObservation({
      sourceKind: 'user',
      text: 'No, the blue one.',
      observedAt: 850,
      runId: 'run-1' as RunId,
    })
    expect(user!.observation.observedAt).toBe(850)
    expect(user!.observation.references).toEqual([])
    expect(user!.observation.uncertainty).toBeUndefined()
  })

  it('merges exact duplicate Observations into one identity and accumulates provenance', () => {
    let at = 500
    const { evidence, ids } = evidenceHarness(() => at)
    const first = evidence.checkpointObservation(webObservation())!

    at = 900
    const second = evidence.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router  costs $39. ',
      references: [{ url: 'https://shop.example/acme-router#specs' }],
      runId: 'run-2' as RunId,
    })!

    expect(second.merged).toBe(true)
    expect(second.observation.id).toBe(first.observation.id)
    expect(second.observation.observedAt).toBe(500)
    expect(second.observation.provenance).toEqual([{ runId: 'run-1' }, { runId: 'run-2' }])
    expect(evidence.snapshot().observations).toHaveLength(1)
    expect(ids).toEqual(['memory-1'])

    const reobserved = evidence.checkpointObservation(webObservation(undefined, 'run-3' as RunId))!
    expect(reobserved.observation.provenance).toEqual([{ runId: 'run-1' }, { runId: 'run-2' }, { runId: 'run-3' }])
    expect(evidence.snapshot().observations).toHaveLength(1)
  })

  it('keeps contradictory Observations distinct instead of overwriting them', () => {
    const { evidence } = evidenceHarness()
    const cheaper = evidence.checkpointObservation(webObservation('The Acme router costs $39.'))!
    const pricier = evidence.checkpointObservation(webObservation('The Acme router costs $59.'))!

    expect(cheaper.observation.id).not.toBe(pricier.observation.id)
    const observations = evidence.snapshot().observations
    expect(observations.map(({ text }) => text)).toEqual([
      'The Acme router costs $39.',
      'The Acme router costs $59.',
    ])
    expect(evidence.observation(cheaper.observation.id)?.text).toBe('The Acme router costs $39.')
  })

  it('discloses contradictions at commit: same source, different statement (#122)', () => {
    const { evidence } = evidenceHarness()
    const cheaper = evidence.checkpointObservation(webObservation('The Acme router costs $39.'))!
    expect(cheaper.contradicts).toEqual([])

    // Same canonical source, a different statement: the second commit
    // names the first — both remain stored, neither overwrites.
    const pricier = evidence.checkpointObservation(webObservation('The Acme router costs $59.'))!
    expect(pricier.contradicts).toEqual([cheaper.observation.id])

    // An unrelated source never contradicts; an exact duplicate merges
    // rather than contradicting.
    const elsewhere = evidence.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router costs $59.',
      references: [{ url: 'https://mirror.example/acme' }],
      runId: 'run-1' as RunId,
    })!
    expect(elsewhere.contradicts).toEqual([])
    const duplicate = evidence.checkpointObservation(webObservation('The Acme router costs $59.', 'run-2' as RunId))!
    expect(duplicate.merged).toBe(true)
    expect(duplicate.contradicts).toEqual([])
    expect(evidence.snapshot().observations).toHaveLength(3)
  })

  it('retains User Observations with exact text and event provenance (#122)', () => {
    const { evidence } = evidenceHarness()
    const result = evidence.checkpointObservation({
      sourceKind: 'user',
      text: 'No, the blue one.',
      runId: 'run-1' as RunId,
      originEvent: { producer: 'ask_user', observationId: 'obs-3' as ObservationId },
    })

    expect(result).toMatchObject({
      observation: {
        id: 'memory-1',
        sourceKind: 'user',
        text: 'No, the blue one.',
        references: [],
        originEvent: { producer: 'ask_user', observationId: 'obs-3' },
        provenance: [{ runId: 'run-1' }],
      },
      merged: false,
      contradicts: [],
    })
    // Exact text survives verbatim: user words are never paraphrased.
    expect(evidence.observation(result!.observation.id)?.text).toBe('No, the blue one.')

    // The same user words again merge into the one identity; the origin
    // event of the first retention stands.
    const again = evidence.checkpointObservation({
      sourceKind: 'user',
      text: 'No, the blue one.',
      runId: 'run-2' as RunId,
      originEvent: { producer: 'ask_user', observationId: 'obs-9' as ObservationId },
    })
    expect(again!.merged).toBe(true)
    expect(again!.observation.id).toBe(result!.observation.id)
    expect(again!.observation.provenance).toEqual([{ runId: 'run-1' }, { runId: 'run-2' }])
  })

  it('tracks Candidates through active, accepted, rejected, and superseded status with supporting Observations', () => {
    const { evidence } = evidenceHarness()
    const price = evidence.checkpointObservation(webObservation())!.observation
    const rival = evidence.checkpointObservation(webObservation('The Zeta router costs $45.', 'run-1' as RunId))!.observation

    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      detail: 'Cheapest matte-black option.',
      supportingObservationIds: [price.id],
      references: [webReference],
      runId: 'run-1' as RunId,
    })
    expect(candidate).toMatchObject({
      id: 'memory-3',
      sessionId: 'session-1',
      status: 'active',
      supportingObservationIds: [price.id],
      provenance: [{ runId: 'run-1' }],
    })

    const accepted = evidence.setCandidateStatus(candidate!.id, {
      status: 'accepted',
      supportingObservationIds: [rival.id],
      runId: 'run-2' as RunId,
      subagentId: 'a-1',
    })
    expect(accepted).toMatchObject({
      status: 'accepted',
      supportingObservationIds: [price.id, rival.id],
      provenance: [{ runId: 'run-1' }, { runId: 'run-2', subagentId: 'a-1' }],
    })

    const rivalCandidate = evidence.addCandidate({
      subject: 'Zeta wifi router',
      supportingObservationIds: [rival.id],
      runId: 'run-2' as RunId,
    })!
    expect(evidence.setCandidateStatus(rivalCandidate.id, { status: 'rejected', supportingObservationIds: [rival.id], runId: 'run-2' as RunId })).toMatchObject({ status: 'rejected' })
    expect(evidence.setCandidateStatus(rivalCandidate.id, { status: 'rejected', supportingObservationIds: [rival.id], runId: 'run-3' as RunId })).toBeNull()
    expect(evidence.candidate(rivalCandidate.id)?.status).toBe('rejected')

    const third = evidence.addCandidate({
      subject: 'Used market router',
      supportingObservationIds: [rival.id],
      runId: 'run-3' as RunId,
    })!
    expect(evidence.setCandidateStatus(third.id, { status: 'superseded', supportingObservationIds: [rival.id], runId: 'run-3' as RunId })).toMatchObject({ status: 'superseded' })

    // Retained statuses stay revisable with fresh support: an accepted
    // Candidate can later be superseded by a better-grounded one.
    const revised = evidence.setCandidateStatus(candidate!.id, {
      status: 'superseded',
      supportingObservationIds: [rival.id],
      runId: 'run-4' as RunId,
    })
    expect(revised).toMatchObject({
      status: 'superseded',
      supportingObservationIds: [price.id, rival.id],
      provenance: [{ runId: 'run-1' }, { runId: 'run-2', subagentId: 'a-1' }, { runId: 'run-4' }],
    })
    expect(evidence.snapshot().candidates.map(({ status }) => status)).toEqual(['superseded', 'rejected', 'superseded'])
  })

  it('rejects Assessments without valid Observation support', () => {
    const { evidence } = evidenceHarness()
    const observation = evidence.checkpointObservation(webObservation())!.observation
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!

    expect(evidence.hasObservationSupport([observation.id])).toBe(true)
    expect(evidence.hasObservationSupport([observation.id, candidate.id])).toBe(false)
    expect(evidence.hasObservationSupport(['memory-999' as MemoryEntryId])).toBe(false)
    expect(evidence.hasObservationSupport([])).toBe(false)
  })

  it('refuses malformed checkpoints and candidates without minting identities', () => {
    const { evidence, ids } = evidenceHarness()
    expect(evidence.checkpointObservation({ ...webObservation(), sourceKind: 'dream' as never })).toBeNull()
    expect(evidence.checkpointObservation({ ...webObservation(), text: '   ' })).toBeNull()
    expect(evidence.checkpointObservation({ ...webObservation(), uncertainty: 'x'.repeat(MAX_UNCERTAINTY_CHARS + 1) })).toBeNull()
    expect(evidence.checkpointObservation({ ...webObservation(), references: Array.from({ length: 11 }, () => webReference) })).toBeNull()
    expect(evidence.checkpointObservation({ ...webObservation(), runId: '' as RunId })).toBeNull()

    const observation = evidence.checkpointObservation(webObservation())!.observation
    expect(evidence.addCandidate({ subject: '', supportingObservationIds: [observation.id], runId: 'run-1' as RunId })).toBeNull()
    expect(evidence.addCandidate({ subject: 'No support', supportingObservationIds: [], runId: 'run-1' as RunId })).toBeNull()
    expect(evidence.addCandidate({
      subject: 'Ghost support',
      supportingObservationIds: ['memory-999' as MemoryEntryId],
      runId: 'run-1' as RunId,
    })).toBeNull()
    expect(evidence.setCandidateStatus('memory-999' as MemoryEntryId, {
      status: 'accepted',
      supportingObservationIds: [observation.id],
      runId: 'run-2' as RunId,
    })).toBeNull()

    expect(ids).toEqual(['memory-1'])
    expect(evidence.snapshot().candidates).toEqual([])
  })

  it('clears and seals: Session Reset and Lapse drop every form and refuse later mutation', () => {
    const { evidence } = evidenceHarness()
    const observation = evidence.checkpointObservation(webObservation())!.observation
    evidence.addCandidate({ subject: 'Acme wifi router', supportingObservationIds: [observation.id], runId: 'run-1' as RunId })

    evidence.clear()
    evidence.clear()

    expect(evidence.cleared).toBe(true)
    expect(evidence.snapshot()).toEqual({ observations: [], candidates: [] })
    expect(evidence.checkpointObservation(webObservation(undefined, 'run-2' as RunId))).toBeNull()
    expect(evidence.observation(observation.id)).toBeNull()
  })

  it('freezes snapshots against mutation', () => {
    const { evidence } = evidenceHarness()
    evidence.checkpointObservation(webObservation())!
    const snapshot = evidence.snapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.observations)).toBe(true)
    expect(Object.isFrozen(snapshot.observations[0]!.references)).toBe(true)
  })

  it('marks declared-volatile and uncertain Observations volatile; durable ones carry no flag (#123)', () => {
    const { evidence } = evidenceHarness()
    const durable = evidence.checkpointObservation(webObservation('Durable fact.'))!.observation
    const declared = evidence.checkpointObservation({ ...webObservation('Stock is 3 units.'), volatile: true })!.observation
    const uncertain = evidence.checkpointObservation({
      ...webObservation('Price may have changed.'),
      uncertainty: 'seen in a cached cart',
    })!.observation

    expect(durable.volatile).toBeUndefined()
    expect(declared.volatile).toBe(true)
    expect(uncertain.volatile).toBe(true)
  })

  it('a volatile duplicate merge turns the shared Observation volatile (#123)', () => {
    const { evidence } = evidenceHarness()
    const first = evidence.checkpointObservation(webObservation('Stock is 3 units.'))!.observation
    expect(first.volatile).toBeUndefined()

    const merged = evidence.checkpointObservation({ ...webObservation('Stock is 3 units.'), volatile: true })!
    expect(merged.merged).toBe(true)
    expect(merged.observation.id).toBe(first.id)
    expect(merged.observation.volatile).toBe(true)
    expect(evidence.snapshot().observations).toHaveLength(1)
  })

  // #142: Candidates carry Session-bound recording time — the complete
  // Evidence Browser's deterministic newest-first ordering key — and every
  // retained Candidate change (creation or decision) is the same change
  // signal the Evidence Browser rides as accepted Observations.
  it('stamps Candidates with Session-clock recording time at creation', () => {
    let at = 1_000
    const { evidence } = evidenceHarness(() => at)
    const observation = evidence.checkpointObservation(webObservation())!.observation

    at = 1_500
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!
    expect(candidate.recordedAt).toBe(1_500)

    // A later decision moves the status but never rewrites the record's
    // creation time — ordering stays deterministic under live updates.
    at = 2_000
    const decided = evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      supportingObservationIds: [observation.id],
      runId: 'run-2' as RunId,
    })!
    expect(decided.recordedAt).toBe(1_500)
  })

  it('notifies retained Candidate changes — creation and decision — but never refused or post-clear ones', () => {
    const changed: Array<{ id: string; status: string }> = []
    let next = 0
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
      onCandidateChanged: (candidate) => changed.push({ id: candidate.id, status: candidate.status }),
    })

    const observation = evidence.checkpointObservation(webObservation())!.observation
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!
    // Refused creations and unknown-target decisions never notify.
    evidence.addCandidate({ subject: 'Ghost support', supportingObservationIds: ['memory-99' as MemoryEntryId], runId: 'run-1' as RunId })
    evidence.setCandidateStatus('memory-99' as MemoryEntryId, {
      status: 'accepted',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })
    evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      supportingObservationIds: ['memory-99' as MemoryEntryId],
      runId: 'run-1' as RunId,
    })
    evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      supportingObservationIds: [observation.id],
      runId: 'run-2' as RunId,
    })!
    evidence.clear()
    evidence.addCandidate({ subject: 'Post-clear', supportingObservationIds: [observation.id], runId: 'run-2' as RunId })

    expect(changed).toEqual([
      { id: 'memory-2', status: 'active' },
      { id: 'memory-2', status: 'accepted' },
    ])
  })

  it('a throwing Candidate observer cannot fail the retained change (#142)', () => {
    let next = 0
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
      onCandidateChanged: () => {
        throw new Error('observer exploded')
      },
    })
    const observation = evidence.checkpointObservation(webObservation())!.observation
    expect(evidence.addCandidate({ subject: 'Acme wifi router', supportingObservationIds: [observation.id], runId: 'run-1' as RunId })).not.toBeNull()
    expect(evidence.snapshot().candidates).toHaveLength(1)
  })

  // #139: accepted Observations — new or exact-duplicate merged — are the
  // one change signal the Evidence Browser rides; refused checkpoints stay
  // invisible, and a cleared (Session-ended) store never fires again.
  it('notifies accepted Observations, merged or new, but never refused or post-clear ones', () => {
    const accepted: Array<{ id: string; merged: boolean }> = []
    let next = 0
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
      onObservationAccepted: (result) => accepted.push({ id: result.observation.id, merged: result.merged }),
    })

    evidence.checkpointObservation(webObservation())
    evidence.checkpointObservation(webObservation(undefined, 'run-2' as RunId))
    // Refused: an unknown source kind and an empty statement never notify.
    evidence.checkpointObservation({ ...webObservation(), sourceKind: 'dream' as never })
    evidence.checkpointObservation({ ...webObservation('') })
    evidence.clear()
    evidence.checkpointObservation(webObservation(undefined, 'run-3' as RunId))

    expect(accepted).toEqual([
      { id: 'memory-1', merged: false },
      { id: 'memory-1', merged: true },
    ])
  })
})
