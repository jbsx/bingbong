import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import type { ObservationRecord } from '../session/observationLedger'
import {
  evaluateEvidenceCheckpoint,
  evidenceCheckpointMessage,
  excerptSupported,
  findSourceObservation,
  parseEvidenceCitation,
  webEvidenceCommit,
  type EvidenceCommit,
} from './evidenceCheckpoint'

function callOf(args: Record<string, unknown>): ToolCall {
  return { id: 'c1', name: 'record_evidence', args }
}

function evidenceHarness(now = (): number => 0): SessionEvidenceStore {
  let next = 0
  return createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now,
    mintId: () => `memory-${++next}` as MemoryEntryId,
  })
}

/** A page_read-shaped ledger record: ok, text payload, observed source URL. */
function webRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: 'obs-4' as ObservationRecord['id'],
    at: 0,
    producer: 'page_read',
    ok: true,
    payload: 'The Acme router costs $39. Free shipping on orders over $25.',
    sourceUrl: 'https://shop.example/acme-router',
    ...overrides,
  }
}

/** The commit seam over a real store, provenance stamped like the runner's. */
function commitOver(store: SessionEvidenceStore, runId = 'run-1' as RunId): EvidenceCommit {
  return webEvidenceCommit(() => store, runId)
}

const GROUNDED_ARGS = {
  observation: 'The Acme router costs $39.',
  source_url: 'https://shop.example/acme-router',
  excerpt: 'costs $39',
}

describe('parseEvidenceCitation', () => {
  it('accepts the four model-writable fields, normalizing to the citation shape', () => {
    expect(parseEvidenceCitation(GROUNDED_ARGS)).toEqual({
      observation: 'The Acme router costs $39.',
      sourceUrl: 'https://shop.example/acme-router',
      excerpt: 'costs $39',
    })
    expect(parseEvidenceCitation({ ...GROUNDED_ARGS, uncertainty: 'cached cart price' })).toEqual({
      observation: 'The Acme router costs $39.',
      sourceUrl: 'https://shop.example/acme-router',
      excerpt: 'costs $39',
      uncertainty: 'cached cart price',
    })
  })

  it('rejects unknown keys, missing fields, and non-web sources', () => {
    expect(parseEvidenceCitation({ ...GROUNDED_ARGS, candidate: 'x' })).toBeNull()
    expect(parseEvidenceCitation({ excerpt: 'costs $39', source_url: 'https://shop.example/x' })).toBeNull()
    expect(parseEvidenceCitation({ observation: '  ', source_url: 'https://shop.example/x', excerpt: 'y' })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'x', source_url: 'not a url', excerpt: 'y' })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'x', source_url: 'ftp://shop.example/x', excerpt: 'y' })).toBeNull()
  })
})

describe('findSourceObservation', () => {
  it('matches observed sources by canonical URL and prefers the freshest retention', () => {
    const stale = webRecord({ id: 'obs-2' as ObservationRecord['id'], at: 0, payload: 'older text' })
    const fresh = webRecord({ id: 'obs-5' as ObservationRecord['id'], at: 900, payload: 'newer text' })
    expect(findSourceObservation([stale, fresh], 'https://shop.example/acme-router#specs')?.id).toBe('obs-5')
    expect(findSourceObservation([stale, fresh], 'https://SHOP.example/acme-router/')?.id).toBe('obs-5')
  })

  it('ignores failed observations and records without a source URL', () => {
    const failed = webRecord({ ok: false })
    const appState = webRecord({ sourceUrl: undefined })
    expect(findSourceObservation([failed, appState], 'https://shop.example/acme-router')).toBeNull()
    expect(findSourceObservation([webRecord()], 'https://other.example/page')).toBeNull()
  })
})

describe('excerptSupported', () => {
  it('validates the excerpt against the retained text, whitespace and case tolerant', () => {
    expect(excerptSupported(webRecord(), 'the acme router   COSTS $39.')).toBe(true)
    expect(excerptSupported(webRecord(), 'costs $59')).toBe(false)
  })

  it('requires an excerpt for text sources and grounds structured Action Outcomes without one', () => {
    expect(excerptSupported(webRecord(), undefined)).toBe(false)
    const outcome = webRecord({ producer: 'action_outcome', payload: { paused: true, currentTime: 42 } })
    expect(excerptSupported(outcome, undefined)).toBe(true)
    expect(excerptSupported(outcome, '"paused":true')).toBe(true)
    expect(excerptSupported(outcome, '"paused":false')).toBe(false)
  })
})

describe('evaluateEvidenceCheckpoint', () => {
  it('commits a grounded web Observation and returns its Memory Entry identity', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord()],
      commit: commitOver(store),
    })

    expect(outcome).toEqual({
      ok: true,
      entryId: 'memory-1',
      merged: false,
      sourceObservationId: 'obs-4',
      sourceUrl: 'https://shop.example/acme-router',
    })
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      references: [{ url: 'https://shop.example/acme-router' }],
      provenance: [{ runId: 'run-1' }],
    })])
  })

  it('merges an exact duplicate citation into the existing identity', () => {
    const store = evidenceHarness()
    const deps = { records: [webRecord()], commit: commitOver(store) }
    expect(evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), deps)).toMatchObject({ ok: true, entryId: 'memory-1', merged: false })
    // Same grounded statement from a fragment of the same source: one
    // identity, provenance retained — not a second Observation.
    expect(evaluateEvidenceCheckpoint(callOf({
      ...GROUNDED_ARGS,
      source_url: 'https://shop.example/acme-router#reviews',
      excerpt: 'Free shipping',
    }), deps)).toMatchObject({ ok: true, entryId: 'memory-1', merged: true })
    expect(evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), deps)).toMatchObject({ ok: true, entryId: 'memory-1', merged: true })
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('rejects an unobserved source without mutating Session state', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ ...GROUNDED_ARGS, source_url: 'https://other.example' }), {
      records: [webRecord()],
      commit: commitOver(store),
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'unknown_source' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('rejects an unsupported excerpt without mutating Session state', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ ...GROUNDED_ARGS, excerpt: 'costs $59' }), {
      records: [webRecord()],
      commit: commitOver(store),
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(store.snapshot().observations).toEqual([])

    const missing = evaluateEvidenceCheckpoint(callOf({ observation: 'x', source_url: GROUNDED_ARGS.source_url }), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(missing).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('rejects malformed citations before anything runs', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ observation: '', source_url: 'nope' }), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'malformed' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('reports a missing Session seam as a recoverable failure', () => {
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), { records: [webRecord()] })
    expect(outcome).toMatchObject({ ok: false, reason: 'no_session' })
  })

  it('reports a refused store commit (cleared Session, out-of-bounds fields) recoverably', () => {
    const store = evidenceHarness()
    store.clear()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'refused' })
  })
})

describe('evidenceCheckpointMessage', () => {
  it('speaks to the model: identity on success, corrective guidance on failure', () => {
    const store = evidenceHarness()
    const accepted = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(evidenceCheckpointMessage(accepted)).toContain('memory-1')
    expect(evidenceCheckpointMessage(accepted)).toContain('survive')

    const unknown = evaluateEvidenceCheckpoint(callOf({ ...GROUNDED_ARGS, source_url: 'https://nope.example' }), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(evidenceCheckpointMessage(unknown)).toMatch(/record_evidence/i)
    expect(evidenceCheckpointMessage(unknown)).toMatch(/observed/i)
  })
})
