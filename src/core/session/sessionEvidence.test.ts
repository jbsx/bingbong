import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import type { MemoryEntryId } from './workingMemory'
import type { ObservationId } from './observationLedger'
import { createSessionEvidence, MAX_CORRECTION_CHARS, MAX_UNCERTAINTY_CHARS } from './sessionEvidence'
import type {
  CandidateDecisionOutcome,
  CandidateStatusChange,
  SessionCandidate,
  SessionEvidenceStore,
} from './sessionEvidence'
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

describe('session evidence counts', () => {
  it('counts what the store holds, without freezing a snapshot to do it (#181)', () => {
    const { evidence } = evidenceHarness()
    expect(evidence.counts()).toEqual({ observations: 0, candidates: 0, contradictions: 0 })

    const observation = evidence.checkpointObservation(webObservation())!.observation
    evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })
    // A grounded disagreement on the same source: retained, not overwritten.
    evidence.checkpointObservation(webObservation('The Acme router costs $49.'))

    expect(evidence.counts()).toEqual({ observations: 2, candidates: 1, contradictions: 1 })
    expect(evidence.counts()).toEqual({
      observations: evidence.snapshot().observations.length,
      candidates: evidence.snapshot().candidates.length,
      contradictions: evidence.snapshot().contradictions.length,
    })
  })

  it('counts nothing once the store is cleared', () => {
    const { evidence } = evidenceHarness()
    evidence.checkpointObservation(webObservation())

    evidence.clear()

    expect(evidence.counts()).toEqual({ observations: 0, candidates: 0, contradictions: 0 })
  })
})

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

  it('enriches a merged duplicate with a later-observed title, never erases one (#144)', () => {
    const { evidence } = evidenceHarness()

    // The first checkpoint carried no title (a Look-grounded citation).
    const first = evidence.checkpointObservation(webObservation())!
    expect(first.observation.references).toEqual([webReference])

    // A later duplicate of the same Observation names the settled title:
    // the merge enriches the retained reference with it.
    const titled = evidence.checkpointObservation({
      ...webObservation(undefined, 'run-2' as RunId),
      references: [{ url: 'https://shop.example/acme-router', title: 'Acme Router Store' }],
    })!
    expect(titled.merged).toBe(true)
    expect(titled.observation.references).toEqual([{ url: 'https://shop.example/acme-router', title: 'Acme Router Store' }])

    // A title-less duplicate cannot strip the title the source earned.
    const plain = evidence.checkpointObservation(webObservation(undefined, 'run-3' as RunId))!
    expect(plain.merged).toBe(true)
    expect(plain.observation.references).toEqual([{ url: 'https://shop.example/acme-router', title: 'Acme Router Store' }])
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

  it('retains contradiction relationships in the snapshot, resolvable from either Observation (#143)', () => {
    const { evidence } = evidenceHarness()
    const cheaper = evidence.checkpointObservation(webObservation('The Acme router costs $39.'))!
    const pricier = evidence.checkpointObservation(webObservation('The Acme router costs $59.'))!

    // Durable Session state, not just a checkpoint disclosure: the pair
    // names both members, so the relationship resolves from whichever
    // side a reader holds — an earlier cited Observation is recognized
    // as contradicted by a later one.
    expect(evidence.snapshot().contradictions).toEqual([
      { earlierObservationId: cheaper.observation.id, laterObservationId: pricier.observation.id },
    ])

    // A third statement from the same source contradicts every retained
    // version before it — one pair per grounded disagreement.
    const costliest = evidence.checkpointObservation(webObservation('The Acme router costs $79.'))!
    expect(evidence.snapshot().contradictions).toEqual([
      { earlierObservationId: cheaper.observation.id, laterObservationId: pricier.observation.id },
      { earlierObservationId: cheaper.observation.id, laterObservationId: costliest.observation.id },
      { earlierObservationId: pricier.observation.id, laterObservationId: costliest.observation.id },
    ])

    // Contradictions are Session Evidence: they vanish with the Session.
    evidence.clear()
    expect(evidence.snapshot().contradictions).toEqual([])
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
      authority: 'model',
      reason: 'cheapest of the two that meets the range',
      supportingObservationIds: [rival.id],
      runId: 'run-2' as RunId,
      subagentId: 'a-1',
    })
    expect(decided(accepted)).toMatchObject({
      status: 'accepted',
      supportingObservationIds: [price.id, rival.id],
      provenance: [{ runId: 'run-1' }, { runId: 'run-2', subagentId: 'a-1' }],
    })

    const rivalCandidate = evidence.addCandidate({
      subject: 'Zeta wifi router',
      supportingObservationIds: [rival.id],
      runId: 'run-2' as RunId,
    })!
    const decide = { authority: 'model' as const, reason: 'over the price ceiling', supportingObservationIds: [rival.id] }
    expect(decided(evidence.setCandidateStatus(rivalCandidate.id, { ...decide, status: 'rejected', runId: 'run-2' as RunId }))).toMatchObject({ status: 'rejected' })
    // Statuses are retained, not replayed — the same verdict again is refused.
    expect(refusedAs(evidence.setCandidateStatus(rivalCandidate.id, { ...decide, status: 'rejected', runId: 'run-3' as RunId }))).toBe('replayed')
    expect(evidence.candidate(rivalCandidate.id)?.status).toBe('rejected')

    const third = evidence.addCandidate({
      subject: 'Used market router',
      supportingObservationIds: [rival.id],
      runId: 'run-3' as RunId,
    })!
    expect(decided(evidence.setCandidateStatus(third.id, { ...decide, status: 'superseded', runId: 'run-3' as RunId }))).toMatchObject({ status: 'superseded' })

    const later = evidence.checkpointObservation(webObservation('A newer listing undercuts both at $31.', 'run-3' as RunId))!.observation
    // Retained statuses stay revisable with fresh support: an accepted
    // Candidate can later be superseded by a better-grounded one — on
    // evidence the acceptance did not already stand on (#208).
    const revised = evidence.setCandidateStatus(candidate!.id, {
      status: 'superseded',
      authority: 'model',
      reason: 'the newer listing undercuts it',
      supportingObservationIds: [later.id],
      runId: 'run-4' as RunId,
    })
    expect(decided(revised)).toMatchObject({
      status: 'superseded',
      supportingObservationIds: [price.id, rival.id, later.id],
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
    expect(refusedAs(evidence.setCandidateStatus('memory-999' as MemoryEntryId, {
      status: 'accepted',
      authority: 'model',
      reason: 'no such Candidate',
      supportingObservationIds: [observation.id],
      runId: 'run-2' as RunId,
    }))).toBe('unknown_candidate')

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
    expect(evidence.snapshot()).toEqual({ observations: [], candidates: [], contradictions: [] })
    expect(evidence.checkpointObservation(webObservation(undefined, 'run-2' as RunId))).toBeNull()
    expect(evidence.observation(observation.id)).toBeNull()
  })

  it('freezes snapshots against mutation', () => {
    const { evidence } = evidenceHarness()
    evidence.checkpointObservation(webObservation())!
    evidence.checkpointObservation(webObservation('The Acme router costs $59.'))!
    const snapshot = evidence.snapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.observations)).toBe(true)
    expect(Object.isFrozen(snapshot.observations[0]!.references)).toBe(true)
    expect(Object.isFrozen(snapshot.contradictions)).toBe(true)
    expect(Object.isFrozen(snapshot.contradictions[0])).toBe(true)
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
    const outcome = evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      authority: 'model',
      reason: 'it is the only one in range',
      supportingObservationIds: [observation.id],
      runId: 'run-2' as RunId,
    })
    expect(decided(outcome).recordedAt).toBe(1_500)
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
      authority: 'model',
      reason: 'no such Candidate',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })
    evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      authority: 'model',
      reason: 'ghost support',
      supportingObservationIds: ['memory-99' as MemoryEntryId],
      runId: 'run-1' as RunId,
    })
    evidence.setCandidateStatus(candidate.id, {
      status: 'accepted',
      authority: 'model',
      reason: 'it is the only one in range',
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

// #210, ADR 0039: the store retains which Candidate an Answer presented
// for inspection. Validation lives here because the Candidate identities
// do — an identity nothing minted, or one that names an Observation, is
// not a subject a later Run can be told it is addressing.
describe('retained Inspection Reference (#210)', () => {
  function presentedHarness() {
    const harness = evidenceHarness(() => 55)
    const observation = harness.evidence.checkpointObservation(webObservation())!.observation
    const candidate = harness.evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!
    return { ...harness, observation, candidate }
  }

  it('retains the Candidate an Answer presented, stamped with the objective it was presented under', () => {
    const { evidence, candidate } = presentedHarness()

    const retained = evidence.presentInspection({
      candidateId: candidate.id,
      objectiveId: 'memory-9' as MemoryEntryId,
      runId: 'run-1' as RunId,
    })

    expect(retained).toEqual({
      candidateId: candidate.id,
      objectiveId: 'memory-9',
      runId: 'run-1',
      presentedAt: 55,
    })
    expect(evidence.inspectionReference()).toEqual(retained)
  })

  it('refuses an identity that is not a live Candidate, leaving the standing subject alone', () => {
    const { evidence, candidate, observation } = presentedHarness()
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })

    // An Observation identity, and one nothing minted: neither is a
    // Candidate, so neither can become the subject — nor quietly unset
    // the one that is.
    expect(evidence.presentInspection({ candidateId: observation.id, runId: 'run-2' as RunId })).toBeNull()
    expect(evidence.presentInspection({ candidateId: 'memory-404' as MemoryEntryId, runId: 'run-2' as RunId })).toBeNull()
    expect(evidence.inspectionReference()?.candidateId).toBe(candidate.id)
  })

  it('adopts the objective in force once, so replacing it can clear the subject', () => {
    const { evidence, candidate } = presentedHarness()
    // The commonest presentation of all: the Run that presents the
    // Candidate is the Run that records the user's objective, so its
    // admission memory held no objective to stamp.
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    expect(evidence.inspectionReference()?.objectiveId).toBeUndefined()

    expect(evidence.scopeInspection('memory-9' as MemoryEntryId)).toMatchObject({ objectiveId: 'memory-9' })
    // Adoption happens once: a later objective does not re-scope a
    // subject that already belongs to one — that is what replacement
    // clearing is for.
    expect(evidence.scopeInspection('memory-11' as MemoryEntryId)).toMatchObject({ objectiveId: 'memory-9' })
    // And it is not a re-presentation: the presenting Run stands.
    expect(evidence.inspectionReference()).toMatchObject({ runId: 'run-1', presentedAt: 55 })
  })

  it('has no subject to scope before one is presented, or after the Session ends', () => {
    const { evidence, candidate } = presentedHarness()
    expect(evidence.scopeInspection('memory-9' as MemoryEntryId)).toBeNull()

    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    evidence.clear()
    expect(evidence.scopeInspection('memory-9' as MemoryEntryId)).toBeNull()
  })

  it('replaces the subject on a new presentation and drops it with the Session', () => {
    const { evidence, candidate, observation } = presentedHarness()
    const second = evidence.addCandidate({
      subject: 'Bolt wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!

    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    evidence.presentInspection({ candidateId: second.id, runId: 'run-2' as RunId })
    expect(evidence.inspectionReference()?.candidateId).toBe(second.id)

    evidence.clear()
    expect(evidence.inspectionReference()).toBeNull()
    expect(evidence.presentInspection({ candidateId: second.id, runId: 'run-3' as RunId })).toBeNull()
  })
})

/** The Candidate a retained decision produced; fails the test when it was refused. */
const decided = (outcome: CandidateDecisionOutcome): SessionCandidate => {
  expect(outcome.ok).toBe(true)
  return (outcome as Extract<CandidateDecisionOutcome, { ok: true }>).candidate
}

/** Why the Session refused a decision. */
const refusedAs = (outcome: CandidateDecisionOutcome): string | undefined =>
  outcome.ok ? undefined : outcome.refusal

describe('Candidate decisions are scoped and authorised in the store (#208, ADR 0039)', () => {
  /** A store whose objective moves, as Working Memory's does across a Session. */
  function scopedHarness(): {
    evidence: SessionEvidenceStore
    objectiveIs(id: MemoryEntryId | undefined): void
  } {
    let next = 0
    let objectiveId: MemoryEntryId | undefined = 'memory-objective-a' as MemoryEntryId
    return {
      evidence: createSessionEvidence({
        sessionId: 'session-1' as SessionId,
        now: () => 0,
        mintId: () => `memory-${++next}` as MemoryEntryId,
        objectiveId: () => objectiveId,
      }),
      objectiveIs: (id) => {
        objectiveId = id
      },
    }
  }

  /** One web Observation, one of the user's own words, and one Candidate resting on the web one. */
  function seeded(evidence: SessionEvidenceStore): {
    web: MemoryEntryId
    user: MemoryEntryId
    later: MemoryEntryId
    candidateId: MemoryEntryId
  } {
    const web = evidence.checkpointObservation(webObservation())!.observation
    const later = evidence.checkpointObservation(webObservation('A newer listing undercuts it.', 'run-1' as RunId))!.observation
    const user = evidence.checkpointObservation({
      sourceKind: 'user',
      text: 'not that one, I want the matte black',
      runId: 'run-1' as RunId,
      originEvent: { producer: 'command', observationId: 'obs-1' as ObservationId },
    })!.observation
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [web.id],
      runId: 'run-1' as RunId,
    })!
    return { web: web.id, user: user.id, later: later.id, candidateId: candidate.id }
  }

  /** A well-typed decision; only the deliberately invalid cases cast. */
  const decide = (fields: CandidateStatusChange): CandidateStatusChange => fields

  it('refuses a decision claiming the user without the user own words behind it', () => {
    const { evidence } = scopedHarness()
    const { web, candidateId } = seeded(evidence)
    expect(refusedAs(evidence.setCandidateStatus(candidateId, decide({
      status: 'rejected',
      authority: 'user',
      reason: 'the user did not want it',
      supportingObservationIds: [web],
      runId: 'run-2' as RunId,
    })))).toBe('unsupported_authority')
    // Refused outright, never downgraded into the model own decision.
    expect(evidence.candidate(candidateId)).toMatchObject({ status: 'active', decisions: [] })
    expect(evidence.candidate(candidateId)!.status).toBe('active')
  })

  it('stamps the objective in force and keeps the user decision against a model revival', () => {
    const { evidence } = scopedHarness()
    const { user, later, candidateId } = seeded(evidence)
    expect(decided(evidence.setCandidateStatus(candidateId, decide({
      status: 'rejected',
      authority: 'user',
      reason: 'not that one, I want the matte black',
      supportingObservationIds: [user],
      runId: 'run-2' as RunId,
    })))).toMatchObject({ status: 'rejected' })
    expect(evidence.candidate(candidateId)!.decisions).toEqual([
      {
        status: 'rejected',
        authority: 'user',
        reason: 'not that one, I want the matte black',
        objectiveId: 'memory-objective-a',
        supportingObservationIds: [user],
        decidedAt: 0,
      },
    ])

    // A later round, new evidence in hand, still may not undo the user.
    const revival = evidence.setCandidateStatus(candidateId, decide({
      status: 'accepted',
      authority: 'model',
      reason: 'it does match after all',
      supportingObservationIds: [later],
      runId: 'run-3' as RunId,
    }))
    expect(refusedAs(revival)).toBe('user_decision_stands')
    // The refusal names the decision that blocks it, so the caller needs
    // no second read to say what stands.
    expect(revival.ok ? null : revival.standing?.reason).toBe('not that one, I want the matte black')
    expect(evidence.candidate(candidateId)!.status).toBe('rejected')
  })

  it('leaves a replacement objective free of the previous objective decision', () => {
    const { evidence, objectiveIs } = scopedHarness()
    const { web, user, candidateId } = seeded(evidence)
    evidence.setCandidateStatus(candidateId, decide({
      status: 'rejected',
      authority: 'user',
      reason: 'not that one, I want the matte black',
      supportingObservationIds: [user],
      runId: 'run-2' as RunId,
    }))

    objectiveIs('memory-objective-b' as MemoryEntryId)
    expect(decided(evidence.setCandidateStatus(candidateId, decide({
      status: 'accepted',
      authority: 'model',
      reason: 'it is right for the new task',
      supportingObservationIds: [web],
      runId: 'run-3' as RunId,
    })))).toMatchObject({ status: 'accepted' })
    // Both decisions stand, each under the objective it was made for.
    expect(evidence.candidate(candidateId)!.decisions.map(({ status, objectiveId }) => [status, objectiveId])).toEqual([
      ['rejected', 'memory-objective-a'],
      ['accepted', 'memory-objective-b'],
    ])
    // And the snapshot carries the objective a reader compares against.
    expect(evidence.snapshot().objectiveId).toBe('memory-objective-b')
  })

  it('carries no objective at all when the Session retained none', () => {
    const { evidence, objectiveIs } = scopedHarness()
    objectiveIs(undefined)
    const { web, candidateId } = seeded(evidence)
    expect(decided(evidence.setCandidateStatus(candidateId, decide({
      status: 'rejected',
      authority: 'model',
      reason: 'over the ceiling',
      supportingObservationIds: [web],
      runId: 'run-2' as RunId,
    })))).toMatchObject({ status: 'rejected' })
    expect(evidence.candidate(candidateId)!.decisions[0]).not.toHaveProperty('objectiveId')
    expect(evidence.snapshot()).not.toHaveProperty('objectiveId')
  })

  it('refuses a decision with no reason and one naming an authority the vocabulary has no room for', () => {
    const { evidence } = scopedHarness()
    const { web, candidateId } = seeded(evidence)
    expect(refusedAs(evidence.setCandidateStatus(candidateId, decide({
      status: 'rejected',
      authority: 'model',
      reason: '   ',
      supportingObservationIds: [web],
      runId: 'run-2' as RunId,
    })))).toBe('invalid')
    expect(refusedAs(evidence.setCandidateStatus(candidateId, {
      status: 'rejected',
      authority: 'boss' as never,
      reason: 'over the ceiling',
      supportingObservationIds: [web],
      runId: 'run-2' as RunId,
    }))).toBe('invalid')
    expect(evidence.candidate(candidateId)!.decisions).toEqual([])
  })
})

describe('the store retains what the user said before the model ran (#211, ADR 0039)', () => {
  /** A store whose objective moves, seeded with a presentable Candidate. */
  function correctionHarness(withoutObjective = false) {
    let next = 0
    let objectiveId: MemoryEntryId | undefined = withoutObjective
      ? undefined
      : ('memory-objective-a' as MemoryEntryId)
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 55,
      mintId: () => `memory-${++next}` as MemoryEntryId,
      objectiveId: () => objectiveId,
    })
    const web = evidence.checkpointObservation(webObservation())!.observation
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [web.id],
      runId: 'run-1' as RunId,
    })!
    /** The user's own words, checkpointed as this Session grounds them. */
    const said = (text: string): MemoryEntryId =>
      evidence.checkpointObservation({
        sourceKind: 'user',
        text,
        runId: 'run-2' as RunId,
        originEvent: { producer: 'command', observationId: 'obs-1' as ObservationId },
      })!.observation.id
    return {
      evidence,
      web: web.id,
      candidate,
      said,
      objectiveIs: (id: MemoryEntryId | undefined) => {
        objectiveId = id
      },
    }
  }

  it('retains the exact wording with the Inspection Reference in force, classifying nothing', () => {
    const { evidence, candidate } = correctionHarness()
    evidence.presentInspection({
      candidateId: candidate.id,
      objectiveId: 'memory-objective-a' as MemoryEntryId,
      runId: 'run-1' as RunId,
    })

    const retained = evidence.retainCorrection({ text: 'not that one; keep looking', runId: 'run-2' as RunId })

    expect(retained).toEqual({
      text: 'not that one; keep looking',
      candidateId: candidate.id,
      objectiveId: 'memory-objective-a',
      runId: 'run-2',
      retainedAt: 55,
    })
    expect(evidence.unresolvedCorrections()).toEqual([retained])
    // Retaining is not yet grounding: the words become Session Evidence
    // only if they outlive the Run that heard them.
    expect(retained).not.toHaveProperty('observationId')
    evidence.groundCorrections()
    expect(evidence.unresolvedCorrections()[0]).toMatchObject({ observationId: 'memory-3' })
    expect(evidence.observation('memory-3' as MemoryEntryId)).toMatchObject({
      sourceKind: 'user',
      text: 'not that one; keep looking',
    })
    // Grounding twice does not mint a second identity for one utterance.
    evidence.groundCorrections()
    expect(evidence.unresolvedCorrections()[0]).toMatchObject({ observationId: 'memory-3' })
    // Retention is not interpretation: nothing was decided, and the
    // Candidate is exactly as active as it was.
    expect(evidence.candidate(candidate.id)).toMatchObject({ status: 'active', decisions: [] })
  })

  it('retains words spoken with no subject, and never invents one', () => {
    const { evidence } = correctionHarness()

    const retained = evidence.retainCorrection({ text: 'only posts from 2023', runId: 'run-2' as RunId })

    expect(retained).toMatchObject({ text: 'only posts from 2023' })
    expect(retained).not.toHaveProperty('candidateId')
  })

  it('does not take a subject left over from a replaced objective', () => {
    const { evidence, candidate, objectiveIs } = correctionHarness()
    evidence.presentInspection({
      candidateId: candidate.id,
      objectiveId: 'memory-objective-a' as MemoryEntryId,
      runId: 'run-1' as RunId,
    })
    objectiveIs('memory-objective-b' as MemoryEntryId)

    expect(evidence.retainCorrection({ text: 'not that one', runId: 'run-3' as RunId })).not.toHaveProperty('candidateId')
  })

  it('adopts the objective the establishing Run records, so its replacement retires the words', () => {
    const { evidence, objectiveIs } = correctionHarness(true)
    const retained = evidence.retainCorrection({ text: 'only posts from 2023', runId: 'run-2' as RunId })
    expect(retained).not.toHaveProperty('objectiveId')

    objectiveIs('memory-objective-a' as MemoryEntryId)
    evidence.scopeCorrections('memory-objective-a' as MemoryEntryId)
    expect(evidence.unresolvedCorrections()).toEqual([{ ...retained, objectiveId: 'memory-objective-a' }])

    objectiveIs('memory-objective-b' as MemoryEntryId)
    expect(evidence.unresolvedCorrections()).toEqual([])
  })

  it('refuses to present a Candidate the user has spoken about until it is resolved', () => {
    const { evidence, candidate } = correctionHarness()
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    evidence.retainCorrection({ text: 'not that one; keep looking', runId: 'run-2' as RunId })

    // A later Run inherits the words: it may not show back the thing the
    // user spoke about as though nothing had been said.
    expect(evidence.presentInspection({ candidateId: candidate.id, runId: 'run-3' as RunId })).toBeNull()
    // Refusing leaves the standing subject exactly where it was — the
    // correction still names it.
    expect(evidence.inspectionReference()).toMatchObject({ candidateId: candidate.id, runId: 'run-1' })
  })

  it('refuses the model its own verdict on a Candidate the user has spoken about', () => {
    const { evidence, candidate, web } = correctionHarness()
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    evidence.retainCorrection({ text: 'not that one; keep looking', runId: 'run-2' as RunId })

    for (const status of ['accepted', 'rejected', 'superseded'] as const) {
      expect(refusedAs(evidence.setCandidateStatus(candidate.id, {
        status,
        authority: 'model',
        reason: 'my own reading of what they meant',
        supportingObservationIds: [web],
        runId: 'run-3' as RunId,
      }))).toBe('correction_unresolved')
    }
    expect(evidence.candidate(candidate.id)).toMatchObject({ status: 'active', decisions: [] })
  })

  it('resolves the words when the user own decision on that Candidate is retained', () => {
    const { evidence, candidate, said } = correctionHarness()
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })
    evidence.retainCorrection({ text: 'not that one; keep looking', runId: 'run-2' as RunId })

    const outcome = evidence.setCandidateStatus(candidate.id, {
      status: 'rejected',
      authority: 'user',
      reason: 'the user ruled it out',
      supportingObservationIds: [said('not that one; keep looking')],
      runId: 'run-2' as RunId,
    })

    expect(decided(outcome)).toMatchObject({ status: 'rejected' })
    expect(evidence.unresolvedCorrections()).toEqual([])
    // And with nothing unresolved, the Candidate may be presented again.
    expect(evidence.presentInspection({ candidateId: candidate.id, runId: 'run-3' as RunId })).not.toBeNull()
  })

  it('resolves words with no Candidate subject when the user own Observation behind them is cited', () => {
    const { evidence, said } = correctionHarness()
    evidence.retainCorrection({ text: 'only posts from 2023', runId: 'run-2' as RunId })

    // The constraint the user corrected is grounded in their own words;
    // the Memory Commit that cites them is what resolves the correction.
    evidence.resolveCorrectionsCiting([said('Only posts from 2023')])

    expect(evidence.unresolvedCorrections()).toEqual([])
  })

  it('resolves nothing on a web Observation that happens to quote the same words', () => {
    const { evidence } = correctionHarness()
    evidence.retainCorrection({ text: 'only posts from 2023', runId: 'run-2' as RunId })
    const web = evidence.checkpointObservation({
      sourceKind: 'web',
      text: 'only posts from 2023',
      references: [{ url: 'https://example.com/thread' }],
      runId: 'run-2' as RunId,
    })!.observation.id

    evidence.resolveCorrectionsCiting([web])

    expect(evidence.unresolvedCorrections()).toHaveLength(1)
  })

  it('drops the retained words with the Session, and refuses every later touch', () => {
    const { evidence, candidate, said } = correctionHarness()
    const words = said('not that one')
    evidence.retainCorrection({ text: 'not that one', runId: 'run-2' as RunId })

    evidence.clear()

    // An ended Session holds nothing, and nothing an old Run does late
    // reaches the store that replaced it: every route in is refused
    // rather than quietly writing into the void.
    expect(evidence.unresolvedCorrections()).toEqual([])
    expect(evidence.retainCorrection({ text: 'nor that one', runId: 'run-3' as RunId })).toBeNull()
    evidence.groundCorrections()
    evidence.scopeCorrections('memory-objective-b' as MemoryEntryId)
    evidence.resolveCorrectionsCiting([words])
    evidence.resolveCorrectionsFrom('run-2' as RunId)
    expect(evidence.unresolvedCorrections()).toEqual([])
    expect(evidence.snapshot()).toMatchObject({ observations: [], candidates: [] })
    expect(evidence.presentInspection({ candidateId: candidate.id, runId: 'run-3' as RunId })).toBeNull()
  })

  it('refuses an utterance past its bound rather than retaining a truncated one', () => {
    const { evidence } = correctionHarness()

    expect(evidence.retainCorrection({ text: '   ', runId: 'run-2' as RunId })).toBeNull()
    expect(evidence.retainCorrection({ text: 'x'.repeat(MAX_CORRECTION_CHARS + 1), runId: 'run-2' as RunId })).toBeNull()
    expect(evidence.unresolvedCorrections()).toEqual([])
  })

  it('resolves a Run own words when it answered, and never the debt it inherited', () => {
    const { evidence } = correctionHarness()
    evidence.retainCorrection({ text: 'not that one; keep looking', runId: 'run-2' as RunId })
    evidence.retainCorrection({ text: 'keep going', runId: 'run-3' as RunId })

    // run-3 answered. Answering its own command is what an Answer is;
    // it is no evidence at all that run-2's unanswered words were dealt
    // with, and those wait for the grounding that discharges them.
    evidence.resolveCorrectionsFrom('run-3' as RunId)

    expect(evidence.unresolvedCorrections().map(({ text }) => text)).toEqual(['not that one; keep looking'])
  })
})

describe('retaining the verification routes a Session watched fail (#212, ADR 0041)', () => {
  it('keeps the route’s own words, stamped with the run and the objective in force', () => {
    const objective: MemoryEntryId = 'memory-objective' as MemoryEntryId
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 7,
      mintId: () => 'memory-1' as MemoryEntryId,
      objectiveId: () => objective,
    })
    const retained = evidence.retainVerificationFailure({
      route: 'vision',
      failure: 'look timed out after 8000ms',
      runId: 'run-1' as RunId,
    })
    expect(retained).toEqual({
      route: 'vision',
      failure: 'look timed out after 8000ms',
      objectiveId: 'memory-objective',
      runId: 'run-1',
      failedAt: 7,
    })
    expect(evidence.verificationFailures()).toEqual([retained])
  })

  it('stamps the Candidate the check was about when the Session holds that subject', () => {
    const { evidence } = evidenceHarness()
    const observation = evidence.checkpointObservation(webObservation())!.observation
    const candidate = evidence.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: 'run-1' as RunId,
    })!
    evidence.presentInspection({ candidateId: candidate.id, runId: 'run-1' as RunId })

    const retained = evidence.retainVerificationFailure({
      route: 'vision',
      failure: 'look timed out after 8000ms',
      runId: 'run-1' as RunId,
    })
    expect(retained!.candidateId).toBe(candidate.id)
  })

  it('refuses a route it does not know and an empty failure, retaining neither', () => {
    const { evidence } = evidenceHarness()
    expect(
      evidence.retainVerificationFailure({
        route: 'telepathy' as never,
        failure: 'nothing came through',
        runId: 'run-1' as RunId,
      }),
    ).toBeNull()
    expect(evidence.retainVerificationFailure({ route: 'vision', failure: '   ', runId: 'run-1' as RunId })).toBeNull()
    expect(evidence.verificationFailures()).toEqual([])
  })

  it('binds a failure spent before the objective existed to the objective that lands after it', () => {
    let objective: MemoryEntryId | undefined = undefined
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => 'memory-1' as MemoryEntryId,
      objectiveId: () => objective,
    })
    // The establishing Run spends the route before its own Memory Commit
    // records the task it was spending it on.
    evidence.retainVerificationFailure({ route: 'vision', failure: 'look timed out', runId: 'run-1' as RunId })
    objective = 'memory-objective' as MemoryEntryId
    evidence.scopeVerificationFailures(objective)
    expect(evidence.verificationFailures()[0]!.objectiveId).toBe('memory-objective')
  })

  it('retires a failure with the objective the user replaced', () => {
    let objective: MemoryEntryId | undefined = 'memory-first' as MemoryEntryId
    const evidence = createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => 'memory-1' as MemoryEntryId,
      objectiveId: () => objective,
    })
    evidence.retainVerificationFailure({ route: 'vision', failure: 'look timed out', runId: 'run-1' as RunId })
    expect(evidence.verificationFailures()).toHaveLength(1)
    objective = 'memory-second' as MemoryEntryId
    // A replacement objective is a different search, and it starts with
    // every route open.
    expect(evidence.verificationFailures()).toEqual([])
  })

  it('drops every retained failure when the Session ends', () => {
    const { evidence } = evidenceHarness()
    evidence.retainVerificationFailure({ route: 'vision', failure: 'look timed out', runId: 'run-1' as RunId })
    evidence.clear()
    expect(evidence.verificationFailures()).toEqual([])
    expect(
      evidence.retainVerificationFailure({ route: 'vision', failure: 'look timed out', runId: 'run-1' as RunId }),
    ).toBeNull()
  })
})
