import { describe, expect, it } from 'vitest'
import type { SessionEvidencePayload } from '../session/evidenceIpcChannels'
import type { MemoryEntryId } from '../session/workingMemory'
import type { EndedSession, SessionEvidenceAcceptance } from '../session/sessionRuntime'
import type { RunId, SessionId } from '../session/sessionIdentity'
import {
  evidenceAcceptedEntry,
  evidenceAnsweredEntry,
  evidenceBroadcastEntry,
  evidenceRequesterOf,
  sessionEvidenceEndEntry,
} from './evidenceStoreTrace'

const SESSION = 'session-1' as SessionId

const ACCEPTANCE: SessionEvidenceAcceptance = {
  sessionId: SESSION,
  generation: 2,
  change: 'observation',
  entryId: 'memory-3' as MemoryEntryId,
  counts: { observations: 2, candidates: 1, contradictions: 1 },
  merged: false,
  contradicted: ['memory-1' as MemoryEntryId],
}

function payload(overrides: Partial<SessionEvidencePayload['snapshot']> = {}): SessionEvidencePayload {
  return {
    sessionId: SESSION,
    generation: 2,
    snapshot: { observations: [], candidates: [], contradictions: [], ...overrides },
  } as SessionEvidencePayload
}

describe('evidenceAcceptedEntry', () => {
  it('records the counts the store held, the merge, and what the change contradicts', () => {
    expect(evidenceAcceptedEntry(ACCEPTANCE)).toEqual({
      kind: 'evidence_accepted',
      sessionId: SESSION,
      generation: 2,
      change: 'observation',
      entryId: 'memory-3',
      counts: { observations: 2, candidates: 1, contradictions: 1 },
      merged: false,
      contradicted: ['memory-1'],
    })
  })

  it('keeps the merged flag, so a duplicate that added no Observation is not read as a lost one', () => {
    const entry = evidenceAcceptedEntry({ ...ACCEPTANCE, merged: true, contradicted: [] })
    expect(entry).toMatchObject({ merged: true, contradicted: [] })
  })

  it('names a Candidate change by its own entry', () => {
    const entry = evidenceAcceptedEntry({
      ...ACCEPTANCE,
      change: 'candidate',
      entryId: 'memory-9' as MemoryEntryId,
      merged: false,
      contradicted: [],
    })
    expect(entry).toMatchObject({ change: 'candidate', entryId: 'memory-9' })
  })
})

describe('evidenceAnsweredEntry', () => {
  it('names the requester, the Session answered, and the counts it was given', () => {
    const answered = evidenceAnsweredEntry({
      requester: 'feed_panel',
      payload: payload({ observations: [{ id: 'memory-1' }] as never, contradictions: [{}] as never }),
    })

    expect(answered).toEqual({
      kind: 'evidence_answered',
      sessionId: SESSION,
      generation: 2,
      requester: 'feed_panel',
      answered: 'session',
      counts: { observations: 1, candidates: 0, contradictions: 1 },
    })
  })

  it('distinguishes "no Session" from a live Session holding nothing', () => {
    const none = evidenceAnsweredEntry({ requester: 'dashboard', payload: null })
    const empty = evidenceAnsweredEntry({ requester: 'dashboard', payload: payload() })

    expect(none).toEqual({ kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' })
    expect(none).not.toHaveProperty('counts')
    expect(none).not.toHaveProperty('sessionId')
    expect(empty).toMatchObject({ answered: 'session', counts: { observations: 0, candidates: 0, contradictions: 0 } })
  })
})

describe('evidenceBroadcastEntry', () => {
  it('names the renderers alive to receive the signal', () => {
    expect(
      evidenceBroadcastEntry({
        change: { sessionId: SESSION, generation: 2 },
        renderers: ['dashboard', 'feed_panel'],
      }),
    ).toEqual({
      kind: 'evidence_broadcast',
      sessionId: SESSION,
      generation: 2,
      renderers: ['dashboard', 'feed_panel'],
    })
  })

  it('records a signal nobody was alive to hear', () => {
    const entry = evidenceBroadcastEntry({ change: { sessionId: SESSION, generation: 2 }, renderers: [] })
    expect(entry).toMatchObject({ renderers: [] })
  })
})

describe('sessionEvidenceEndEntry', () => {
  it('records the final counts and the end reason', () => {
    const ended: EndedSession = {
      sessionId: SESSION,
      generation: 2,
      reason: 'lapsed',
      startedAt: 1_000,
      endedAt: 2_000,
      acceptedRunIds: ['run-1' as RunId],
      liveRunIds: [],
      evidence: { observations: 4, candidates: 2, contradictions: 0 },
    }

    expect(sessionEvidenceEndEntry(ended)).toEqual({
      kind: 'session_evidence_end',
      sessionId: SESSION,
      generation: 2,
      counts: { observations: 4, candidates: 2, contradictions: 0 },
      reason: 'lapsed',
    })
  })
})

describe('evidenceRequesterOf', () => {
  it('names the overlay only when the overlay itself asked', () => {
    expect(evidenceRequesterOf(7, 7)).toBe('feed_panel')
    expect(evidenceRequesterOf(4, 7)).toBe('dashboard')
  })

  it('names the dashboard when there is no overlay to be', () => {
    expect(evidenceRequesterOf(7, null)).toBe('dashboard')
  })
})
