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
  findGroundingObservation,
  findSourceObservation,
  findUserEventObservation,
  parseEvidenceCitation,
  subagentEvidenceCommit,
  userEvidenceCommit,
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

/** A user-event-shaped ledger record: the command, an ask_user answer, or a Steering Directive. */
function userRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: 'obs-2' as ObservationRecord['id'],
    at: 0,
    producer: 'ask_user',
    ok: true,
    payload: 'No, the blue one.',
    ...overrides,
  }
}

const USER_ARGS = { kind: 'user', observation: 'No, the blue one.' }

describe('parseEvidenceCitation', () => {
  it('accepts the four model-writable fields, normalizing to the citation shape', () => {
    expect(parseEvidenceCitation(GROUNDED_ARGS)).toEqual({
      kind: 'web',
      observation: 'The Acme router costs $39.',
      sourceUrl: 'https://shop.example/acme-router',
      excerpt: 'costs $39',
    })
    expect(parseEvidenceCitation({ ...GROUNDED_ARGS, uncertainty: 'cached cart price' })).toEqual({
      kind: 'web',
      observation: 'The Acme router costs $39.',
      sourceUrl: 'https://shop.example/acme-router',
      excerpt: 'costs $39',
      uncertainty: 'cached cart price',
    })
  })

  it('parses a user citation: exact user text, no source URL or excerpt (#122)', () => {
    expect(parseEvidenceCitation(USER_ARGS)).toEqual({
      kind: 'user',
      observation: 'No, the blue one.',
    })
    expect(parseEvidenceCitation({ ...USER_ARGS, uncertainty: 'answer was terse' })).toEqual({
      kind: 'user',
      observation: 'No, the blue one.',
      uncertainty: 'answer was terse',
    })
  })

  it('rejects unknown keys, missing fields, and non-web sources', () => {
    expect(parseEvidenceCitation({ ...GROUNDED_ARGS, candidate: 'x' })).toBeNull()
    expect(parseEvidenceCitation({ excerpt: 'costs $39', source_url: 'https://shop.example/x' })).toBeNull()
    expect(parseEvidenceCitation({ observation: '  ', source_url: 'https://shop.example/x', excerpt: 'y' })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'x', source_url: 'not a url', excerpt: 'y' })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'x', source_url: 'ftp://shop.example/x', excerpt: 'y' })).toBeNull()
  })

  it('rejects citations that mix user and web fields or carry an unknown kind', () => {
    expect(parseEvidenceCitation({ ...USER_ARGS, source_url: 'https://shop.example/x' })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'x', source_url: 'https://shop.example/x', excerpt: 'y', kind: 'user' })).toBeNull()
    expect(parseEvidenceCitation({ ...USER_ARGS, kind: 'dream' })).toBeNull()
    expect(parseEvidenceCitation({ kind: 'user' })).toBeNull()
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

describe('findUserEventObservation', () => {
  it('matches the exact user text against command, ask_user, and steering events, freshest first (#122)', () => {
    const command = userRecord({ id: 'obs-1' as ObservationRecord['id'], producer: 'command', payload: 'Find a blue mug' })
    const answer = userRecord({ id: 'obs-3' as ObservationRecord['id'], at: 100, payload: 'No, the blue one.' })
    const repeat = userRecord({ id: 'obs-7' as ObservationRecord['id'], at: 900, producer: 'ask_user', payload: 'No, the blue one.' })
    const directive = userRecord({ id: 'obs-8' as ObservationRecord['id'], producer: 'steering', payload: 'Use Paris instead.' })
    const records = [command, answer, repeat, directive]

    expect(findUserEventObservation(records, 'No, the blue one.')?.id).toBe('obs-7')
    expect(findUserEventObservation(records, 'Find a blue mug')?.id).toBe('obs-1')
    expect(findUserEventObservation(records, 'Use Paris instead.')?.id).toBe('obs-8')
    // Trim-tolerant, but the words themselves must be the user's exact ones.
    expect(findUserEventObservation(records, ' No, the blue one. ')?.id).toBe('obs-7')
    expect(findUserEventObservation(records, 'no, the blue one')).toBeNull()
    expect(findUserEventObservation(records, 'the blue one, actually')).toBeNull()
  })

  it('ignores failed events and non-user producers', () => {
    const unanswered = userRecord({ ok: false, payload: 'unanswered (timeout)' })
    const page = webRecord({ producer: 'page_read', payload: 'No, the blue one.' })
    expect(findUserEventObservation([unanswered, page], 'No, the blue one.')).toBeNull()
    expect(findUserEventObservation([unanswered, page], 'unanswered (timeout)')).toBeNull()
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
      contradicts: [],
    })
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      references: [{ url: 'https://shop.example/acme-router' }],
      provenance: [{ runId: 'run-1' }],
    })])
  })

  it('commits a User Observation with exact text and event provenance (#122)', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(USER_ARGS), {
      records: [userRecord()],
      commitUser: userEvidenceCommit(() => store, 'run-1' as RunId),
    })

    expect(outcome).toEqual({
      ok: true,
      entryId: 'memory-1',
      merged: false,
      sourceObservationId: 'obs-2',
      originProducer: 'ask_user',
      contradicts: [],
    })
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      sourceKind: 'user',
      text: 'No, the blue one.',
      references: [],
      originEvent: { producer: 'ask_user', observationId: 'obs-2' },
      provenance: [{ runId: 'run-1' }],
    })])
  })

  it('rejects a user citation whose text no observed user event supplied (#122)', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ ...USER_ARGS, observation: 'the blue one, actually' }), {
      records: [userRecord()],
      commitUser: userEvidenceCommit(() => store, 'run-1' as RunId),
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'user_text_unverified' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('reports a missing user commit seam as no_session (#122)', () => {
    const outcome = evaluateEvidenceCheckpoint(callOf(USER_ARGS), { records: [userRecord()] })
    expect(outcome).toMatchObject({ ok: false, reason: 'no_session' })
  })

  it('discloses a contradiction the commit retained instead of overwriting (#122)', () => {
    const store = evidenceHarness()
    const deps = { records: [webRecord()], commit: commitOver(store) }
    expect(evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), deps)).toMatchObject({ ok: true, contradicts: [] })

    // Same source, a different price: retained, and the outcome names
    // the earlier Observation it contradicts.
    const contradicted = evaluateEvidenceCheckpoint(callOf({
      observation: 'The Acme router costs $59.',
      source_url: 'https://shop.example/acme-router',
      excerpt: 'costs',
    }), deps)
    expect(contradicted).toMatchObject({ ok: true, entryId: 'memory-2', contradicts: ['memory-1'] })
    expect(store.snapshot().observations).toHaveLength(2)
    expect(evidenceCheckpointMessage(contradicted)).toMatch(/contradict/i)
    expect(evidenceCheckpointMessage(contradicted)).toContain('memory-1')
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
    expect(missing).toMatchObject({ ok: false, reason: 'excerpt_required' })
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

  it('names the user event a User Observation is grounded in (#122)', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(USER_ARGS), {
      records: [userRecord()],
      commitUser: userEvidenceCommit(() => store, 'run-1' as RunId),
    })
    const message = evidenceCheckpointMessage(outcome)
    expect(message).toContain('memory-1')
    expect(message).toMatch(/ask_user/i)
    expect(message).toContain('obs-2')
  })
})

describe('subagent citations (#123)', () => {
  const SUBAGENT_ARGS = {
    kind: 'subagent',
    agent_id: 'a-2',
    observation: 'The rival router costs $29.',
    source_url: 'https://rival.example/router',
  }

  /** A worker-report-shaped record: the hidden provenance a report carried. */
  function workerRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
    return {
      id: 'wobs-3' as ObservationRecord['id'],
      at: 0,
      producer: 'page_read',
      ok: true,
      payload: 'The rival router costs $29. Ships in 2 days.',
      sourceUrl: 'https://rival.example/router',
      ...overrides,
    }
  }

  it('parses a subagent citation: agent id plus the source the worker observed', () => {
    expect(parseEvidenceCitation(SUBAGENT_ARGS)).toEqual({
      kind: 'subagent',
      observation: 'The rival router costs $29.',
      agentId: 'a-2',
      sourceUrl: 'https://rival.example/router',
    })
    expect(parseEvidenceCitation({ ...SUBAGENT_ARGS, excerpt: 'costs $29', uncertainty: 'promo may vary', volatile: true })).toEqual({
      kind: 'subagent',
      observation: 'The rival router costs $29.',
      agentId: 'a-2',
      sourceUrl: 'https://rival.example/router',
      excerpt: 'costs $29',
      uncertainty: 'promo may vary',
      volatile: true,
    })
  })

  it('rejects subagent citations without an agent id, and web/user citations carrying one', () => {
    expect(parseEvidenceCitation({ ...SUBAGENT_ARGS, agent_id: '' })).toBeNull()
    expect(parseEvidenceCitation({ ...SUBAGENT_ARGS, agent_id: 7 })).toBeNull()
    expect(parseEvidenceCitation({ observation: 'The rival router costs $29.', source_url: 'https://rival.example/router', agent_id: 'a-2' })).toBeNull() // a web citation carrying agent_id
    expect(parseEvidenceCitation({ ...GROUNDED_ARGS, agent_id: 'a-2' })).toBeNull()
    expect(parseEvidenceCitation({ ...USER_ARGS, agent_id: 'a-2' })).toBeNull()
    expect(parseEvidenceCitation({ ...SUBAGENT_ARGS, volatile: 'yes' })).toBeNull()
  })

  it('commits a selected finding with Run and Subagent provenance, trust rules unchanged (#123)', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(SUBAGENT_ARGS), {
      records: [],
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: (agentId) => (agentId === 'a-2' ? [workerRecord()] : null),
    })

    expect(outcome).toEqual({
      ok: true,
      entryId: 'memory-1',
      merged: false,
      sourceObservationId: 'wobs-3',
      sourceUrl: 'https://rival.example/router',
      agentId: 'a-2',
      contradicts: [],
    })
    // Stored exactly like a direct web checkpoint — one Observation, web
    // source kind — except the provenance carries the worker too.
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      sourceKind: 'web',
      text: 'The rival router costs $29.',
      references: [{ url: 'https://rival.example/router' }],
      provenance: [{ runId: 'run-1', subagentId: 'a-2' }],
    })])
    const message = evidenceCheckpointMessage(outcome)
    expect(message).toContain('memory-1')
    expect(message).toContain('a-2')
  })

  it('merges a subagent checkpoint into an identical direct one, accumulating both provenance', () => {
    const store = evidenceHarness()
    const direct = evaluateEvidenceCheckpoint(callOf({
      observation: 'The rival router costs $29.',
      source_url: 'https://rival.example/router',
      excerpt: 'costs $29',
    }), { records: [workerRecord()], commit: commitOver(store) })
    expect(direct).toMatchObject({ ok: true, entryId: 'memory-1' })

    const viaWorker = evaluateEvidenceCheckpoint(callOf(SUBAGENT_ARGS), {
      records: [],
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [workerRecord()],
    })
    expect(viaWorker).toMatchObject({ ok: true, entryId: 'memory-1', merged: true })
    expect(store.snapshot().observations).toHaveLength(1)
    expect(store.snapshot().observations[0]?.provenance).toEqual([{ runId: 'run-1' }, { runId: 'run-1', subagentId: 'a-2' }])
  })

  it('rejects an unknown agent and a source that worker never observed', () => {
    const store = evidenceHarness()
    const deps = {
      records: [],
      commitSubagent: (agentId: string) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: (agentId: string) => (agentId === 'a-2' ? [workerRecord()] : null),
    }

    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, agent_id: 'a-9' }), deps)).toMatchObject({ ok: false, reason: 'unknown_agent' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, source_url: 'https://other.example/x' }), deps)).toMatchObject({ ok: false, reason: 'unknown_source' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('validates an offered excerpt against what the worker retained; omission is allowed', () => {
    const store = evidenceHarness()
    const deps = {
      records: [],
      commitSubagent: (agentId: string) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [workerRecord()],
    }

    // The citing model saw the report, not the tool results: no excerpt
    // demanded, but a wrong one never grounds.
    expect(evaluateEvidenceCheckpoint(callOf(SUBAGENT_ARGS), deps)).toMatchObject({ ok: true, entryId: 'memory-1' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, excerpt: 'costs $59' }), deps)).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, excerpt: 'costs $29' }), deps)).toMatchObject({ ok: true, merged: true })
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('marks declared-volatile subagent findings volatile (#123)', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, volatile: true }), {
      records: [],
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [workerRecord()],
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.volatile).toBe(true)
  })
})

describe('retained page titles (#144)', () => {
  /** A page_read-shaped payload carrying the snapshot header (#144): `# Title — url` above the digest. */
  const SNAPSHOT_PAYLOAD = [
    '# Acme Router Store — https://shop.example/acme-router',
    'viewport 800x600 scroll 0/0',
    'signature 1a2b3c4d',
    'page text:',
    'The Acme router costs $39. Free shipping on orders over $25.',
  ].join('\n')

  it('retains the settled title the grounding observation already named — no extra round', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord({ payload: SNAPSHOT_PAYLOAD })],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([
      { url: 'https://shop.example/acme-router', title: 'Acme Router Store' },
    ])
  })

  it('retains the navigation outcome title shape too', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord({
        producer: 'action_outcome',
        payload: `navigated: url=https://shop.example/acme-router title=${JSON.stringify('Acme Router Store')}\n${SNAPSHOT_PAYLOAD}`,
      })],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([
      { url: 'https://shop.example/acme-router', title: 'Acme Router Store' },
    ])
  })

  it('never parses a Look for a title — vision text is a model-authored claim', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord({
        producer: 'look',
        payload: 'The page reads title="Not The Title" and the Acme router costs $39.',
      })],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([{ url: 'https://shop.example/acme-router' }])
  })

  it('recovers the title an earlier observation of the source named when the latest is a Look', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [
        webRecord({
          id: 'obs-2' as ObservationRecord['id'],
          at: 0,
          producer: 'action_outcome',
          payload: `navigated: url=https://shop.example/acme-router title=${JSON.stringify('Acme Router Store')}\n# Acme Router Store — https://shop.example/acme-router\npage text:\nThe Acme router costs $39.`,
        }),
        webRecord({
          id: 'obs-9' as ObservationRecord['id'],
          at: 500,
          producer: 'look',
          payload: 'A router listing. The Acme router costs $39.',
        }),
      ],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'obs-9' })
    expect(store.snapshot().observations[0]?.references).toEqual([
      { url: 'https://shop.example/acme-router', title: 'Acme Router Store' },
    ])
  })

  it('treats the browser\'s URL-shaped stand-in as no title — the label falls back to the hostname', () => {
    const store = evidenceHarness()
    const url = 'https://shop.example/acme-router'
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord({
        payload: `# ${url} — ${url}\nviewport 800x600 scroll 0/0\nsignature 1a2b3c4d\npage text:\nThe Acme router costs $39.`,
      })],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([{ url }])

    const withScheme = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord({
        payload: `navigated: url=${url} title=${JSON.stringify(url)}\n# ${url} — ${url}\npage text:\nThe Acme router costs $39.`,
      })],
      commit: commitOver(store),
    })
    expect(withScheme).toMatchObject({ ok: true, merged: true })
    expect(store.snapshot().observations[0]?.references).toEqual([{ url }])
  })

  it('omits the title when no observed state named one', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [webRecord()],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([{ url: 'https://shop.example/acme-router' }])
  })

  it('follows the same no-extra-round path for delegated evidence: the worker\'s observed title', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({
      kind: 'subagent',
      agent_id: 'a-2',
      observation: 'The rival router costs $29.',
      source_url: 'https://rival.example/router',
    }), {
      records: [],
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [{
        id: 'wobs-3' as ObservationRecord['id'],
        at: 0,
        producer: 'page_read',
        ok: true,
        payload: '# Rival Router Review — https://rival.example/router\npage text:\nThe rival router costs $29. Ships in 2 days.',
        sourceUrl: 'https://rival.example/router',
      }],
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]?.references).toEqual([
      { url: 'https://rival.example/router', title: 'Rival Router Review' },
    ])
  })
})

describe('evidence grading faults (#179)', () => {
  /** The page read, then a Look of the same page that retains only vision text. */
  const PAGE_READ = webRecord({ id: 'obs-2' as ObservationRecord['id'], at: 0 })
  const LATER_LOOK = webRecord({
    id: 'obs-9' as ObservationRecord['id'],
    at: 500,
    producer: 'look',
    payload: 'A router listing page with a large product photo.',
  })

  describe('findGroundingObservation', () => {
    it('takes the newest retained record for the source whose text carries the excerpt', () => {
      expect(findGroundingObservation([PAGE_READ, LATER_LOOK], 'https://shop.example/acme-router', 'costs $39')).toEqual({
        ok: true,
        record: PAGE_READ,
      })
      // Still freshest-wins among the records that do support it.
      const reread = webRecord({ id: 'obs-11' as ObservationRecord['id'], at: 900 })
      expect(findGroundingObservation([PAGE_READ, LATER_LOOK, reread], 'https://shop.example/acme-router', 'costs $39')).toEqual({
        ok: true,
        record: reread,
      })
    })

    it('separates an unobserved source, a missing excerpt, and an unsupported one', () => {
      expect(findGroundingObservation([PAGE_READ], 'https://other.example/x', 'costs $39')).toEqual({ ok: false, reason: 'unknown_source' })
      expect(findGroundingObservation([PAGE_READ, LATER_LOOK], 'https://shop.example/acme-router', undefined)).toEqual({
        ok: false,
        reason: 'excerpt_required',
        producers: ['page_read', 'look'],
      })
      expect(findGroundingObservation([PAGE_READ, LATER_LOOK], 'https://shop.example/acme-router', 'costs $59')).toEqual({
        ok: false,
        reason: 'excerpt_unsupported',
        producers: ['page_read', 'look'],
      })
    })

    it('grounds a structured Action Outcome without an excerpt, even behind a newer text record', () => {
      const outcome = webRecord({ producer: 'action_outcome', payload: { paused: true } })
      expect(findGroundingObservation([outcome], 'https://shop.example/acme-router', undefined)).toEqual({ ok: true, record: outcome })
      // The rule is the newest record that supports the citation, not the
      // newest record: a Look cannot shadow the outcome that grounds itself.
      expect(findGroundingObservation([outcome, LATER_LOOK], 'https://shop.example/acme-router', undefined)).toEqual({
        ok: true,
        record: outcome,
      })
    })
  })

  it('rejects a missing excerpt as excerpt_required, saying it is missing rather than wrong', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ observation: 'x', source_url: GROUNDED_ARGS.source_url }), {
      records: [webRecord()],
      commit: commitOver(store),
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_required' })
    expect(outcome.ok ? '' : outcome.error).toContain('no excerpt')
    expect(outcome.ok ? '' : outcome.error).not.toContain('does not appear')
    expect(evidenceCheckpointMessage(outcome)).toContain('record_evidence rejected (excerpt_required)')
    expect(store.snapshot().observations).toEqual([])
  })

  it('grounds a web citation with no excerpt against a structured Action Outcome', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ observation: 'The video is paused.', source_url: GROUNDED_ARGS.source_url }), {
      records: [webRecord({ producer: 'action_outcome', payload: { paused: true, currentTime: 42 } })],
      commit: commitOver(store),
    })
    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'obs-4' })
  })

  it('grounds an excerpt copied from the page read after a later Look of the same URL', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(GROUNDED_ARGS), {
      records: [PAGE_READ, LATER_LOOK],
      commit: commitOver(store),
    })

    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'obs-2' })
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('names the producers checked when no retained record carries the excerpt', () => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ ...GROUNDED_ARGS, excerpt: 'costs $59' }), {
      records: [PAGE_READ, LATER_LOOK],
      commit: commitOver(store),
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(outcome.ok ? '' : outcome.error).toContain('page read, look')
    expect(store.snapshot().observations).toEqual([])
  })

  it('lets a subagent citation with no excerpt ground, and un-shadows one that has an excerpt', () => {
    const store = evidenceHarness()
    const workerRead: ObservationRecord = {
      id: 'wobs-3' as ObservationRecord['id'],
      at: 0,
      producer: 'page_read',
      ok: true,
      payload: 'The rival router costs $29. Ships in 2 days.',
      sourceUrl: 'https://rival.example/router',
    }
    const workerLook: ObservationRecord = {
      ...workerRead,
      id: 'wobs-8' as ObservationRecord['id'],
      at: 500,
      producer: 'look',
      payload: 'A product page with a router photo.',
    }
    const deps = {
      records: [],
      commitSubagent: (agentId: string) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [workerRead, workerLook],
    }
    const args = { kind: 'subagent', agent_id: 'a-2', observation: 'The rival router costs $29.', source_url: 'https://rival.example/router' }

    expect(evaluateEvidenceCheckpoint(callOf(args), deps)).toMatchObject({ ok: true, sourceObservationId: 'wobs-8' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...args, excerpt: 'costs $29' }), deps)).toMatchObject({ ok: true, sourceObservationId: 'wobs-3' })
    const wrong = evaluateEvidenceCheckpoint(callOf({ ...args, excerpt: 'costs $59' }), deps)
    expect(wrong).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(wrong.ok ? '' : wrong.error).toContain('page read, look')
  })
})

describe('a malformed citation is told every defect and shown the call to send (#241)', () => {
  /** The fields a correction names, in the order it names them. */
  const namedFields = (message: string): string[] => [...message.matchAll(/^- (\w+):/gm)].map((match) => match[1]!)
  /** The corrected call a correction shows, read back from its JSON block. */
  const correctedCall = (message: string): Record<string, unknown> | undefined => {
    const block = /```json\n([\s\S]*?)\n```/.exec(message)
    return block === null ? undefined : (JSON.parse(block[1]!) as Record<string, unknown>)
  }
  const VERDICT = 'Graded as corrected, it would still be refused: '
  const PLACEHOLDER = expect.stringMatching(/^<.+>$/)

  const PI_CASE_CONSTRAINT =
    'the camera must fit the unmodified camera lid of the official Raspberry Pi Zero Case, the one intended for Camera Module 2. I cannot alter the lid or mount the camera outside it.'
  const EUROSTAR_CONSTRAINT = 'Do not book, buy, log in or contact anyone.'
  const EUROSTAR_COMMAND = userRecord({
    id: 'obs-1' as ObservationRecord['id'],
    producer: 'command',
    payload: `What are Eurostar's luggage rules for two 70cm suitcases, a daypack and a guitar? ${EUROSTAR_CONSTRAINT}`,
  })
  const CAMERA_SOFTWARE = 'https://www.raspberrypi.com/documentation/computers/camera_software.html'
  const LEGACY_STACK =
    'This guide no longer covers the legacy camera stack which was available in Bullseye and earlier Raspberry Pi OS releases. The legacy camera stack, using applications like raspivid, raspistill and the …'
  const CAMERA_SOFTWARE_READ = webRecord({ sourceUrl: CAMERA_SOFTWARE, payload: `Camera software\n${LEGACY_STACK}` })
  const CAMERA_ACCESSORIES = 'https://www.raspberrypi.com/documentation/accessories/camera.html'

  interface Row {
    readonly where: string
    readonly args: Record<string, unknown>
    readonly records: ObservationRecord[]
    readonly workers?: Record<string, ObservationRecord[]>
    readonly fields: string[]
    readonly corrected: Record<string, unknown>
    /** The grounding class the corrected call would still meet; absent when it grounds. */
    readonly verdict?: string
  }

  // One row per Baseline mistake, arguments as the Run Traces carried them.
  const rows: Row[] = [
    {
      where: 'baseline-1 r2: kind "user" carrying an excerpt that holds the user\'s words',
      args: {
        excerpt: PI_CASE_CONSTRAINT,
        kind: 'user',
        observation:
          'New hard constraint added by the user for the Pi Zero v1.3 camera objective: the camera must fit the unmodified camera lid of the official Raspberry Pi Zero Case (the lid intended for Camera Module 2)…',
      },
      records: [userRecord({ producer: 'steering', payload: PI_CASE_CONSTRAINT })],
      fields: ['observation', 'excerpt'],
      corrected: { kind: 'user', observation: PI_CASE_CONSTRAINT },
    },
    {
      where: 'baseline-2 r20: kind "user" carrying an excerpt, beside a glossed observation',
      args: {
        kind: 'user',
        excerpt: EUROSTAR_CONSTRAINT,
        observation:
          "User's constraint on the luggage-rules task: no booking, buying, logging in, or contacting anyone — research official rules only. Load in question: two 70cm suitcases + one small daypack + acoustic gu…",
      },
      records: [EUROSTAR_COMMAND],
      fields: ['excerpt'],
      corrected: {
        kind: 'user',
        observation:
          "User's constraint on the luggage-rules task: no booking, buying, logging in, or contacting anyone — research official rules only. Load in question: two 70cm suitcases + one small daypack + acoustic gu…",
      },
      verdict: 'user_text_unverified',
    },
    {
      where: 'baseline-2 r21: the retry, still carrying the excerpt and a gloss after the words',
      args: {
        excerpt: EUROSTAR_CONSTRAINT,
        kind: 'user',
        observation:
          'Do not book, buy, log in or contact anyone. — user constraint for the Eurostar luggage task (adult, London–Paris, Eurostar Standard, two 70cm suitcases + small daypack + acoustic guitar in 90cm case).',
      },
      records: [EUROSTAR_COMMAND],
      fields: ['excerpt'],
      corrected: {
        kind: 'user',
        observation:
          'Do not book, buy, log in or contact anyone. — user constraint for the Eurostar luggage task (adult, London–Paris, Eurostar Standard, two 70cm suitcases + small daypack + acoustic guitar in 90cm case).',
      },
      verdict: 'user_text_unverified',
    },
    {
      where: 'baseline-3 r12: observation missing, the excerpt grounded',
      args: { kind: 'web', excerpt: LEGACY_STACK, source_url: CAMERA_SOFTWARE },
      records: [CAMERA_SOFTWARE_READ],
      fields: ['observation'],
      corrected: { kind: 'web', excerpt: LEGACY_STACK, source_url: CAMERA_SOFTWARE, observation: PLACEHOLDER },
    },
    {
      where: 'baseline-3 r12, again: observation missing, the excerpt not in what was read',
      args: {
        kind: 'web',
        excerpt: 'From Raspberry Pi OS Bookworm onwards, the camera capture applications are named rpicam-*.',
        source_url: CAMERA_SOFTWARE,
      },
      records: [CAMERA_SOFTWARE_READ],
      fields: ['observation'],
      corrected: {
        kind: 'web',
        excerpt: 'From Raspberry Pi OS Bookworm onwards, the camera capture applications are named rpicam-*.',
        source_url: CAMERA_SOFTWARE,
        observation: PLACEHOLDER,
      },
      verdict: 'excerpt_unsupported',
    },
    {
      where: 'baseline-3 r24: agent_id without kind "subagent"',
      args: {
        agent_id: 'a-1',
        observation:
          'Official Raspberry Pi camera docs: all Pi cameras use the standard 15-pin connector at the camera end; Pi 5, all Pi Zero models (incl. v1.3), and CM IO boards use the mini 22-pin connector, requiring …',
        source_url: CAMERA_ACCESSORIES,
      },
      records: [],
      workers: { 'a-1': [webRecord({ id: 'wobs-2' as ObservationRecord['id'], sourceUrl: CAMERA_ACCESSORIES })] },
      fields: ['kind'],
      corrected: {
        kind: 'subagent',
        agent_id: 'a-1',
        observation:
          'Official Raspberry Pi camera docs: all Pi cameras use the standard 15-pin connector at the camera end; Pi 5, all Pi Zero models (incl. v1.3), and CM IO boards use the mini 22-pin connector, requiring …',
        source_url: CAMERA_ACCESSORIES,
      },
    },
  ]

  it.each(rows)('$where', ({ args, records, workers, fields, corrected, verdict }) => {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(args), {
      records,
      commit: commitOver(store),
      commitUser: userEvidenceCommit(() => store, 'run-1' as RunId),
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: (agentId) => workers?.[agentId] ?? null,
    })

    // The outcome names what refused the call, whatever the grounding line says.
    expect(outcome).toMatchObject({ ok: false, reason: 'malformed' })
    const message = evidenceCheckpointMessage(outcome)
    expect(namedFields(message)).toEqual(fields)
    expect(correctedCall(message)).toEqual(corrected)
    expect(parseEvidenceCitation(correctedCall(message)!)).not.toBeNull()
    if (verdict === undefined) expect(message).not.toContain(VERDICT)
    else expect(message).toContain(`${VERDICT}record_evidence rejected (${verdict}): `)
    expect(store.snapshot().observations).toEqual([])
  })

  it('names every defect at once in field order, and grades nothing without a source to grade', () => {
    const outcome = evaluateEvidenceCheckpoint(callOf({ excerpt: 7, agent_id: '', note: 'x', volatile: 'true' }), {
      records: [webRecord()],
      commit: commitOver(evidenceHarness()),
    })
    const message = evidenceCheckpointMessage(outcome)

    expect(namedFields(message)).toEqual(['kind', 'observation', 'source_url', 'excerpt', 'agent_id', 'volatile', 'note'])
    expect(correctedCall(message)).toEqual({
      kind: 'subagent',
      agent_id: PLACEHOLDER,
      volatile: true,
      observation: PLACEHOLDER,
      source_url: PLACEHOLDER,
    })
    expect(message).not.toContain(VERDICT)
  })

  it('never grades a user citation on a placeholder standing in for the words', () => {
    const outcome = evaluateEvidenceCheckpoint(callOf({ kind: 'user', source_url: 'https://shop.example/x' }), {
      records: [userRecord()],
    })
    const message = evidenceCheckpointMessage(outcome)

    expect(namedFields(message)).toEqual(['observation', 'source_url'])
    expect(correctedCall(message)).toEqual({ kind: 'user', observation: PLACEHOLDER })
    expect(message).not.toContain(VERDICT)
  })

  it('shows an unparseable source_url replaced, and a string volatile as the boolean it spells', () => {
    const outcome = evaluateEvidenceCheckpoint(
      callOf({ observation: 'The Acme router costs $39.', source_url: 'not a url', excerpt: 'costs $39', volatile: 'false' }),
      { records: [webRecord()], commit: commitOver(evidenceHarness()) },
    )
    const message = evidenceCheckpointMessage(outcome)

    expect(namedFields(message)).toEqual(['source_url', 'volatile'])
    expect(correctedCall(message)).toEqual({
      observation: 'The Acme router costs $39.',
      source_url: PLACEHOLDER,
      excerpt: 'costs $39',
      volatile: false,
    })
    expect(message).not.toContain(VERDICT)
  })
})
