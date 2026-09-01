import { describe, expect, it } from 'vitest'
import type { SessionId } from './sessionIdentity'
import type { MemoryEntryId } from './workingMemory'
import type { SessionCandidate, SessionObservation } from './sessionEvidence'
import { createEvidenceView } from './evidenceView'
import type { SessionEvidencePayload } from './evidenceIpcChannels'

// The Evidence Browser's renderer-side view model (#139): one projection
// over the Session boundary. Its two laws: the snapshot is always read
// whole from main (never patched from notifications), and any response or
// notification of a foreign Session identity or generation is discarded —
// evidence is Session-ephemeral and never crosses the boundary.

const observation = (id: string, text: string, observedAt = 0): SessionObservation =>
  ({ id: id as MemoryEntryId, sessionId: 'session-a' as SessionId, sourceKind: 'web', text, observedAt, references: [], provenance: [] }) as SessionObservation

const candidate = (id: string): SessionCandidate =>
  ({ id: id as MemoryEntryId, sessionId: 'session-a' as SessionId, subject: 'Acme router', status: 'active', recordedAt: 0, supportingObservationIds: [], references: [], provenance: [] }) as SessionCandidate

const payload = (
  sessionId: string,
  generation: number,
  observations: SessionObservation[] = [],
  candidates: SessionCandidate[] = [],
): SessionEvidencePayload => ({ sessionId: sessionId as SessionId, generation, snapshot: { observations, candidates } })

describe('evidence view', () => {
  it('applies the authoritative snapshot whole, with the Session identity and generation', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'The Acme router costs $39.')], [candidate('memory-2')]))

    expect(view.state()).toEqual({
      identity: { sessionId: 'session-a', generation: 0 },
      observations: [observation('memory-1', 'The Acme router costs $39.')],
      candidates: [candidate('memory-2')],
    })
  })

  it('clears everything on its own Session end — evidence is Session-ephemeral', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'Seen.')]))
    view.onSessionEnded({ sessionId: 'session-a' as SessionId, generation: 0 })

    expect(view.state()).toEqual({ identity: null, observations: [], candidates: [] })

    // A foreign or stale end never clears another Session's evidence.
    view.applyResponse(payload('session-b', 0, [observation('memory-9', 'Other session.')]))
    view.onSessionEnded({ sessionId: 'session-a' as SessionId, generation: 0 })
    view.onSessionEnded({ sessionId: 'session-b' as SessionId, generation: 3 })
    expect(view.state().observations).toHaveLength(1)
  })

  it('discards responses of a foreign Session identity or generation', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 1, [observation('memory-1', 'Current session.')]))

    view.applyResponse(payload('session-b', 1, [observation('memory-8', 'Foreign session.')]))
    view.applyResponse(payload('session-a', 2, [observation('memory-9', 'Foreign generation.')]))

    expect(view.state().observations.map(({ id }) => id)).toEqual(['memory-1'])
    expect(view.state().identity).toEqual({ sessionId: 'session-a', generation: 1 })
  })

  it('reads on a matching change notification, or when no Session is known yet; discards foreign ones', () => {
    const view = createEvidenceView()
    expect(view.shouldRead({ sessionId: 'session-a' as SessionId, generation: 0 })).toBe(true)

    view.applyResponse(payload('session-a', 0))
    expect(view.shouldRead({ sessionId: 'session-a' as SessionId, generation: 0 })).toBe(true)
    expect(view.shouldRead({ sessionId: 'session-b' as SessionId, generation: 0 })).toBe(false)
    expect(view.shouldRead({ sessionId: 'session-a' as SessionId, generation: 1 })).toBe(false)
  })

  it('a null response is the definitive no-Session state', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'Seen.')]))
    view.applyResponse(null)

    expect(view.state()).toEqual({ identity: null, observations: [], candidates: [] })
    // With no Session known, a change notification is read again — it may
    // prove a Session went live between the response and now.
    expect(view.shouldRead({ sessionId: 'session-b' as SessionId, generation: 0 })).toBe(true)
  })

  it('never resurrects an ended Session: a read that crossed a clear is dead', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'Seen.')]))

    // The read is issued, then the Session ends before main answers — the
    // late response must not bring the ended Session's Observations back.
    const staleRead = view.beginRead()
    view.onSessionEnded({ sessionId: 'session-a' as SessionId, generation: 0 })
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'Seen.')]), staleRead)
    expect(view.state()).toEqual({ identity: null, observations: [], candidates: [] })

    // A read issued after the clear applies normally.
    const freshRead = view.beginRead()
    view.applyResponse(payload('session-b', 0, [observation('memory-2', 'Next Session.')]), freshRead)
    expect(view.state().observations.map(({ id }) => id)).toEqual(['memory-2'])

    // Same guard across an adoption that replaced the identity.
    const crossedRead = view.beginRead()
    view.onAdopted({ sessionId: 'session-c' as SessionId, generation: 0 })
    view.applyResponse(payload('session-b', 0, [observation('memory-2', 'Next Session.')]), crossedRead)
    expect(view.state().identity).toEqual({ sessionId: 'session-c', generation: 0 })
    expect(view.state().observations).toHaveLength(0)
  })

  it('a re-adoption adopts the live Session and drops stale evidence of another', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-a', 0, [observation('memory-1', 'First session.')]))

    // Main's adoption answer is authoritative now: a different identity
    // replaces the held one, and its stale evidence drops with it — the
    // following read fills the new Session's state from the authority.
    view.onAdopted({ sessionId: 'session-b' as SessionId, generation: 0 })
    expect(view.state()).toEqual({ identity: { sessionId: 'session-b', generation: 0 }, observations: [], candidates: [] })

    // The same identity (a reloaded renderer's re-adoption) keeps the
    // applied snapshot…
    view.applyResponse(payload('session-b', 0, [observation('memory-4', 'Second session.')]))
    view.onAdopted({ sessionId: 'session-b' as SessionId, generation: 0 })
    expect(view.state().observations).toHaveLength(1)

    // …and a stale re-adoption of the same Session's ended generation
    // never rewinds it. (A different Session's adoption answer is
    // main's freshest word and replaces the held identity — last wins.)
    view.onAdopted({ sessionId: 'session-b' as SessionId, generation: 1 })
    view.onAdopted({ sessionId: 'session-b' as SessionId, generation: 0 })
    expect(view.state().identity).toEqual({ sessionId: 'session-b', generation: 1 })
  })

  it('a session_started only opens an unheld view — foreign and stale starts never rewind it (ADR 0005)', () => {
    const view = createEvidenceView()
    view.applyResponse(payload('session-b', 0, [observation('memory-4', 'Live session.')]))

    // A foreign Session's start never wipes another Session's evidence.
    view.onSessionStarted({ sessionId: 'session-a' as SessionId, generation: 1 })
    expect(view.state().observations).toHaveLength(1)

    // The same identity is a no-op — the applied snapshot stands.
    view.onSessionStarted({ sessionId: 'session-b' as SessionId, generation: 0 })
    expect(view.state().observations).toHaveLength(1)

    // An unheld view opens on its Session's start, empty.
    view.onSessionEnded({ sessionId: 'session-b' as SessionId, generation: 0 })
    view.onSessionStarted({ sessionId: 'session-c' as SessionId, generation: 0 })
    expect(view.state()).toEqual({ identity: { sessionId: 'session-c', generation: 0 }, observations: [], candidates: [] })
  })
})
