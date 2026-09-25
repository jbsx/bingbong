import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import { evidenceCheckpointEvent } from '../trace/evidenceCheckpointTrace'
import type { ObservationRecord } from '../session/observationLedger'
import {
  evaluateEvidenceCheckpoint,
  evidenceCheckpointMessage,
  excerptSupported,
  findGroundingObservation,
  findSourceObservation,
  findUserEventObservation,
  NEAREST_LABEL,
  NO_NEAREST,
  parseEvidenceCitation,
  PASSAGE_LABEL,
  subagentEvidenceCommit,
  unsupportedPassages,
  userEvidenceCommit,
  webEvidenceCommit,
  type EvidenceCommit,
} from './evidenceCheckpoint'

/** The Notice a kind "subagent" citation's acceptance carries when it offered an excerpt (#272), as the spec words it. */
const SUBAGENT_EXCERPT_NOTICE =
  'Notice: record_evidence stored the finding without its excerpt. A kind "subagent" citation is grounded by the ' +
  "Subagent's own observation of source_url; its report is the Subagent's words, never page text, so no excerpt is " +
  'checked or kept on this kind. Cite agent_id and one of the evidence URLs its findings carry, with no excerpt.'

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
    // Whitespace and case tolerant, and the words may sit inside what was
    // said (#253, ADR 0054) — but they must be the user's own words.
    expect(findUserEventObservation(records, ' No, the blue one. ')?.id).toBe('obs-7')
    expect(findUserEventObservation(records, 'no, the blue one')?.id).toBe('obs-7')
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

  it('drops an offered excerpt, whatever it holds, and grounds on the Subagent\'s freshest retention (#272)', () => {
    const store = evidenceHarness()
    const deps = {
      records: [],
      commitSubagent: (agentId: string) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations: () => [workerRecord()],
    }

    // No excerpt is ever checked on this kind: a wrong one is dropped like a right one.
    expect(evaluateEvidenceCheckpoint(callOf(SUBAGENT_ARGS), deps)).toMatchObject({ ok: true, entryId: 'memory-1' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, excerpt: 'costs $59' }), deps)).toMatchObject({ ok: true, merged: true, correction: SUBAGENT_EXCERPT_NOTICE })
    expect(evaluateEvidenceCheckpoint(callOf({ ...SUBAGENT_ARGS, excerpt: 'costs $29' }), deps)).toMatchObject({ ok: true, merged: true, correction: SUBAGENT_EXCERPT_NOTICE })
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
        unsupported: [],
      })
      // (#257) the failing passage is named; a scrap of nine characters anchors no quotation.
      expect(findGroundingObservation([PAGE_READ, LATER_LOOK], 'https://shop.example/acme-router', 'costs $59')).toEqual({
        ok: false,
        reason: 'excerpt_unsupported',
        producers: ['page_read', 'look'],
        unsupported: [{ passage: 'costs $59', nearest: null }],
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

  it('grounds a subagent citation on the freshest retention, excerpt or none (#272)', () => {
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

    // (b) An excerpt verbatim in the page read no longer picks the read
    // over the later Look: it is dropped, never checked.
    expect(evaluateEvidenceCheckpoint(callOf(args), deps)).toMatchObject({ ok: true, sourceObservationId: 'wobs-8' })
    expect(evaluateEvidenceCheckpoint(callOf({ ...args, excerpt: 'costs $29' }), deps)).toMatchObject({
      ok: true,
      sourceObservationId: 'wobs-8',
      correction: SUBAGENT_EXCERPT_NOTICE,
    })
  })
})

describe('a kind "subagent" citation takes no excerpt (#272)', () => {
  const SOURCE = 'https://www.raspberrypi.com/documentation/accessories/camera.html'
  /** The Subagent's retained read of the page it cites: its words, never the report's. */
  const WORKER_READ: ObservationRecord = {
    id: 'wobs-5' as ObservationRecord['id'],
    at: 100,
    producer: 'page_read',
    ok: true,
    payload: 'Camera Module 3 ships with a 150 mm ribbon cable for the standard 15-pin connector.',
    sourceUrl: SOURCE,
  }
  const ARGS = {
    kind: 'subagent',
    agent_id: 'a-1',
    observation: 'Camera Module 3 needs the 22-pin adapter cable on a Pi Zero.',
    source_url: SOURCE,
  }
  /** A passage verbatim from the Subagent's report: its paraphrase, which the page never held. */
  const REPORT_PASSAGE = 'Pi Zero boards need the 22-pin to 15-pin adapter cable for Camera Module 3'

  function cite(args: Record<string, unknown>) {
    const store = evidenceHarness()
    const call = callOf(args)
    const workerObservations = (agentId: string) => (agentId === 'a-1' ? [WORKER_READ] : null)
    const outcome = evaluateEvidenceCheckpoint(call, {
      records: [],
      commitSubagent: (agentId) => subagentEvidenceCommit(() => store, 'run-1' as RunId, agentId),
      workerObservations,
    })
    return { outcome, store, event: evidenceCheckpointEvent({ call, outcome, records: [], workerObservations }) }
  }

  it('(a) applies a passage copied from the report, grounded on the Subagent\'s retention, with the Notice and no stored excerpt', () => {
    const { outcome, store } = cite({ ...ARGS, excerpt: REPORT_PASSAGE })

    expect(outcome).toEqual({
      ok: true,
      entryId: 'memory-1',
      merged: false,
      sourceObservationId: 'wobs-5',
      sourceUrl: SOURCE,
      agentId: 'a-1',
      contradicts: [],
      correction: SUBAGENT_EXCERPT_NOTICE,
    })
    const stored = store.snapshot().observations
    expect(stored).toEqual([expect.objectContaining({ text: ARGS.observation, references: [{ url: SOURCE }] })])
    expect(JSON.stringify(stored)).not.toContain(REPORT_PASSAGE)
  })

  it('(b) applies an excerpt verbatim in the Subagent\'s page read the same way', () => {
    const { outcome, store } = cite({ ...ARGS, excerpt: 'ships with a 150 mm ribbon cable' })

    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'wobs-5', agentId: 'a-1', correction: SUBAGENT_EXCERPT_NOTICE })
    expect(JSON.stringify(store.snapshot().observations)).not.toContain('150 mm ribbon')
  })

  it('(c) applies a citation with no excerpt and no Notice', () => {
    const { outcome } = cite(ARGS)

    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'wobs-5', agentId: 'a-1' })
    expect(outcome).not.toHaveProperty('correction')
  })

  it('(d) refuses a source the Subagent never observed, excerpt or none, without quoting its page text', () => {
    const elsewhere = { ...ARGS, source_url: 'https://www.bing.com/search?q=pi+zero+camera' }
    for (const args of [elsewhere, { ...elsewhere, excerpt: REPORT_PASSAGE }]) {
      const { outcome, store } = cite(args)
      expect(outcome).toMatchObject({ ok: false, reason: 'unknown_source' })
      expect(evidenceCheckpointMessage(outcome)).not.toContain('ribbon cable')
      expect(store.snapshot().observations).toEqual([])
    }
    expect(cite({ ...ARGS, agent_id: 'a-9', excerpt: REPORT_PASSAGE }).outcome).toMatchObject({ ok: false, reason: 'unknown_agent' })
  })

  it('(e) the trace event carries the Notice and the agent id', () => {
    const { event } = cite({ ...ARGS, excerpt: REPORT_PASSAGE })

    expect(event).toMatchObject({ outcome: 'accepted', matched: true, agentId: 'a-1', correction: SUBAGENT_EXCERPT_NOTICE })
    // Grading never compared the excerpt, so the event records none as compared.
    expect(event).not.toHaveProperty('excerpt')
    expect(cite(ARGS).event).not.toHaveProperty('correction')
  })
})

describe("the user's words match by containment (#253, ADR 0054)", () => {
  // The Pi follow-up command, and the four fix-252 citations of it that
  // were refused though the words the Run heard were inside every one.
  const PI_FOLLOW_UP =
    'One more requirement: the camera must fit the unmodified camera lid of the official Raspberry Pi Zero Case, the one intended for Camera Module 2. I cannot alter the lid or mount the camera outside it. Does the Camera Module 3 solution still meet all my requirements? Explain what changes and what does not.'
  const COMMAND = userRecord({ id: 'obs-1' as ObservationRecord['id'], producer: 'command', payload: PI_FOLLOW_UP })

  function cite(args: Record<string, unknown>, records: ObservationRecord[] = [COMMAND]) {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf(args), {
      records,
      commitUser: userEvidenceCommit(() => store, 'run-1' as RunId),
    })
    return { outcome, texts: store.snapshot().observations.map((observation) => observation.text) }
  }

  const accepted: { where: string; args: Record<string, unknown> }[] = [
    { where: 'fix-252-2: the words wrapped in quotes', args: { kind: 'user', observation: `"${PI_FOLLOW_UP}"` } },
    {
      where: 'fix-252-3: the words behind a "verbatim:" lead-in',
      args: { kind: 'user', observation: `New hard requirement added by the user, verbatim: "${PI_FOLLOW_UP}"` },
    },
    {
      where: 'fix-252-1: a paraphrase, with the words in a stray excerpt',
      args: {
        excerpt: PI_FOLLOW_UP,
        kind: 'user',
        observation:
          'User added a hard constraint: the camera must fit the unmodified official Zero Case camera lid (the one for Camera Module 2), no altering or mounting outside; asks whether the Camera Module 3 solution still meets all requirements and what changes vs. what does not.',
      },
    },
    { where: 'fix-252-3: the words in both the observation and a stray excerpt', args: { excerpt: PI_FOLLOW_UP, kind: 'user', observation: PI_FOLLOW_UP } },
    { where: 'one sentence of what the user said', args: { kind: 'user', observation: 'I cannot alter the lid or mount the camera outside it.' } },
  ]

  it.each(accepted)('accepts $where, storing the utterance itself', ({ args }) => {
    const { outcome, texts } = cite(args)
    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'obs-1', originProducer: 'command' })
    expect(texts).toEqual([PI_FOLLOW_UP])
    // The model is told the canonical shape it should have sent.
    expect(outcome.ok ? outcome.correction : undefined).toMatch(/kind "user"/)
  })

  it('names the stray excerpt it ignored', () => {
    const { outcome } = cite({ excerpt: PI_FOLLOW_UP, kind: 'user', observation: PI_FOLLOW_UP })
    expect(outcome.ok ? outcome.correction : undefined).toMatch(/excerpt/)
  })

  it('carries no Notice when the citation already held exactly the words', () => {
    const { outcome } = cite({ kind: 'user', observation: PI_FOLLOW_UP })
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.ok ? outcome.correction : 'rejected').toBeUndefined()
  })

  it('still refuses words no user event said, and a stray excerpt that holds none of them', () => {
    expect(cite({ kind: 'user', observation: 'The user now wants a Camera Module 2 instead.' }).outcome).toMatchObject({
      ok: false,
      reason: 'user_text_unverified',
    })
    const stray = cite({ kind: 'user', observation: 'The user wants a Camera Module 2.', excerpt: 'wants a Camera Module 2 now' })
    expect(stray.outcome).toMatchObject({ ok: false, reason: 'malformed' })
    expect(stray.texts).toEqual([])
  })

  it('refuses a scrap too short to be the words, and a match that cuts a word in two', () => {
    expect(cite({ kind: 'user', observation: 'lid' }).outcome).toMatchObject({ ok: false, reason: 'user_text_unverified' })
    expect(cite({ kind: 'user', observation: 'amera must fit' }).outcome).toMatchObject({ ok: false, reason: 'user_text_unverified' })
  })
})

describe('an excerpt is every passage verbatim (#253, ADR 0054)', () => {
  // The eight fix-252 excerpt_unsupported calls, as the Run Traces carried
  // them, graded against what those Runs retained from each source.
  const RMG = 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142'
  const RMG_READ = webRecord({
    id: 'obs-10' as ObservationRecord['id'],
    sourceUrl: RMG,
    payload: [
      `# H4 | Royal Museums Greenwich — ${RMG}`,
      'page text:',
      'H4',
      'For more information about using images from our Collection, please contact RMG Images.',
      'Object details',
      'ID: | ZAA0037',
      'Collection: | Timekeeping',
      'Type: | Marine timekeeper',
      'Materials: | Brass; Steel Silver Diamond Ruby Enamel Copper Glass',
      'Display location: | Not on display',
      'Creator: | Harrison, John',
      'Places: | Greenwich',
      'Date made: | 1759',
      'Exhibition: | Time and Longitude; Ships, Clocks & Stars: The Quest for Longitude',
      'People: | Royal Greenwich Observatory',
      'Credit: | National Maritime Museum, Greenwich, London',
      'Measurements: | Dial diameter: 102 mm;Overall: 165 mm x 124 mm x 28 mm x 1.45 kg',
      'Parts: | H4 Carrying case for H4 and K1 (ZAA0037.1) Three fragments of mainspring removed from H4 (Mainspring) (ZAA0037.2) Pins (ZAA0037.3) Winding key (ZAA0037.4) Movement (ZAA0037.5) Pair case, dial and hands for H4 (ZAA0037.6) Historic label from H4 (ZAA0037.7) Thumbnail catch (ZAA0037.8)',
    ].join('\n'),
  })

  const EUROSTAR = 'https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage'
  const EUROSTAR_READ = webRecord({
    id: 'obs-6' as ObservationRecord['id'],
    sourceUrl: EUROSTAR,
    payload: `our luggage rules at Eurostar, including sizes, allowances and what you can bring on board.
How many bags can you take?
With a standard ticket, you can bring:
2 x pieces of luggage.
1 x small item of hand luggage (like a handbag or backpack).
Children can also bring 1 bag and 1 piece of hand luggage. Folded pushchairs and prams are welcome too – just make sure they're folded down and pop them in the luggage rack for the journey.
Size limits and dimensions
Size limits depend on your route. On routes to and from London, you can bring a bag up to a maximum length of 85cm, and on all other routes, 75cm.
Is there a weight limit?
Unlike airlines, there's no strict weight limit per bag. If you can carry it safely yourself, you're good to go.
Eurostar luggage allowance by travel class`,
  })

  const VOYAGER = 'https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/'
  const VOYAGER_READ = webRecord({
    id: 'obs-18' as ObservationRecord['id'],
    sourceUrl: VOYAGER,
    payload: `the disappearance of charged particles from inside the heliosphere.
Scientists have seen two of the three signs of interstellar arrival they expected to see: charged particles disappearing as they zoom out along the solar magnetic field, and cosmic rays from far outside zooming in. Scientists have not yet seen the third sign, an abrupt change in the direction of the magnetic field, which would indicate the presence of the interstellar magnetic field.
"This strange, last region before interstellar space is coming into focus, thanks to Voyager 1, humankind's most distant scout," said Ed Stone, Voyager project scientist at the California Institute of Technology in Pasadena. "If you looked at the cosmic ray and energetic particle data in isolation, you might think Voyager had reached interstellar space, but the team feels Voyager 1 has not yet gotten there because we are still within the domain of the sun's magnetic field." Scientists do not know exactly how far Voyager 1 has to go to reach interstellar space.`,
  })

  const CAMERA = 'https://www.raspberrypi.com/documentation/computers/camera_software.html'
  const CAMERA_READ_1 = webRecord({
    id: 'obs-8' as ObservationRecord['id'],
    at: 100,
    sourceUrl: CAMERA,
    payload: `Quality Camera, and will never support any newer camera modules. Nothing in this document is applicable to the legacy camera stack.
Edit this on GitHub
NOTE | From Raspberry Pi OS Bookworm onwards, the camera capture applications are named rpicam-*.
Raspberry Pi supplies a small set of example rpicam-apps. These CLI applications, built on top of libcamera, capture images and video from a camera.
These applications include:
rpicam-hello: A "hello world"-equivalent for cameras, which starts a camera preview stream and displays it on the screen.
rpicam-jpeg: Runs a preview window, then captures high-resolution still images.
rpicam-still: Emulates many of the features of the original raspistill application.
rpicam-vid: Captures video.`,
  })
  const CAMERA_READ_2 = webRecord({
    id: 'obs-9' as ObservationRecord['id'],
    at: 200,
    sourceUrl: CAMERA,
    payload: `The Raspberry Pi implementation of libcamera supports the following cameras:
Official cameras: OV5647 (V1) IMX219 (V2) IMX708 (V3) IMX477 (HQ) IMX500 (AI) IMX296 (GS)
Third-party sensors: IMX290 IMX327 IMX378 IMX519 OV9281 VD55G1 VD55G4 VD56G3 VD65G4 VD66GY`,
  })

  const ZERO_CASE = 'https://www.raspberrypi.com/products/raspberry-pi-zero-case/'
  const ZERO_CASE_READ = webRecord({
    id: 'obs-4' as ObservationRecord['id'],
    sourceUrl: ZERO_CASE,
    payload: `Specifications
The Raspberry Pi Zero Case has been designed to fit Raspberry Pi Zero, Raspberry Pi Zero W, and Raspberry Pi Zero 2 W.
The case consists of two parts. It has a standard base featuring a cut-out to allow access to the GPIO, and a choice of three lids: a plain lid, a GPIO lid (allowing access to the GPIO from above), and a camera lid (which, when used with the short camera cable supplied, allows the standard and NoIR variants of Raspberry Pi Camera Modules 1 and 2 to fit neatly inside it; note that Camera Module 3 is not mechanically compatible with the camera lid).
Kit includes the following:
1 x short camera cable`,
  })

  function checkpoint(records: ObservationRecord[], sourceUrl: string, excerpt: string) {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ observation: 'A fact the excerpt grounds.', source_url: sourceUrl, excerpt }), {
      records,
      commit: commitOver(store),
    })
    return { outcome, store }
  }

  const accepted: { where: string; records: ObservationRecord[]; url: string; excerpt: string; grounds: string }[] = [
    {
      where: 'fix-252-1 longitude watch: table rows with rows skipped',
      records: [RMG_READ],
      url: RMG,
      excerpt:
        'ID: | ZAA0037\nType: | Marine timekeeper\nCreator: | Harrison, John\nDate made: | 1759\nMeasurements: | Dial diameter: 102 mm;Overall: 165 mm x 124 mm x 28 mm x 1.45 kg\nParts: | H4 Carrying case for H4 and K1 (ZAA0037.1)',
      grounds: 'obs-10',
    },
    {
      where: 'fix-252-1 longitude watch, again: the heading and the whole parts row',
      records: [RMG_READ],
      url: RMG,
      excerpt:
        'Object details\nID: | ZAA0037\nCollection: | Timekeeping\nType: | Marine timekeeper\nCreator: | Harrison, John\nDate made: | 1759\nMeasurements: | Dial diameter: 102 mm;Overall: 165 mm x 124 mm x 28 mm x 1.45 kg\nParts: | H4 Carrying case for H4 and K1 (ZAA0037.1) Three fragments of mainspring removed from H4 (Mainspring) (ZAA0037.2) Pins (ZAA0037.3) Winding key (ZAA0037.4) Movement (ZAA0037.5) Pair case, dial and hands for H4 (ZAA0037.6) Historic label from H4 (ZAA0037.7) Thumbnail catch (ZAA0037.8)',
      grounds: 'obs-10',
    },
    {
      where: 'fix-252-1 longitude watch, a third time: the parts row cut short',
      records: [RMG_READ],
      url: RMG,
      excerpt:
        'ID: | ZAA0037\nType: | Marine timekeeper\nCreator: | Harrison, John\nDate made: | 1759\nMeasurements: | Dial diameter: 102 mm;Overall: 165 mm x 124 mm x 28 mm x 1.45 kg\nParts: | H4 Carrying case for H4 and K1 (ZAA0037.1) Three fragments of mainspring removed from H4 (Mainspring) (ZAA0037.2)',
      grounds: 'obs-10',
    },
    {
      where: 'fix-252 Eurostar luggage: sentences skipped between the passages',
      records: [EUROSTAR_READ],
      url: EUROSTAR,
      excerpt:
        "With a standard ticket, you can bring:\n2 x pieces of luggage.\n1 x small item of hand luggage (like a handbag or backpack).\n\nSize limits and dimensions\nSize limits depend on your route. On routes to and from London, you can bring a bag up to a maximum length of 85cm, and on all other routes, 75cm.\n\nIs there a weight limit?\nUnlike airlines, there's no strict weight limit per bag. If you can carry it safely yourself, you're good to go.",
      grounds: 'obs-6',
    },
    {
      where: 'fix-252 Voyager: a single dropped comma',
      records: [VOYAGER_READ],
      url: VOYAGER,
      excerpt:
        'Scientists have seen two of the three signs of interstellar arrival they expected to see: charged particles disappearing as they zoom out along the solar magnetic field and cosmic rays from far outside zooming in. Scientists have not yet seen the third sign, an abrupt change in the direction of the magnetic field, which would indicate the presence of the interstellar magnetic field.',
      grounds: 'obs-18',
    },
    {
      where: 'fix-252-3 Pi camera: a passage from each of two page reads',
      records: [CAMERA_READ_1, CAMERA_READ_2],
      url: CAMERA,
      excerpt:
        'From Raspberry Pi OS Bookworm onwards, the camera capture applications are named rpicam-*. | rpicam-still: Emulates many of the features of the original raspistill application. | Official cameras: OV5647 (V1) IMX219 (V2) IMX708 (V3) IMX477 (HQ) IMX500 (AI) IMX296 (GS)',
      // No one read holds every passage: the newest read holding one grounds it.
      grounds: 'obs-9',
    },
    {
      where: 'fix-252 Voyager, again: a quoted sentence skipped behind "..."',
      records: [VOYAGER_READ],
      url: VOYAGER,
      excerpt:
        'Scientists have not yet seen the third sign, an abrupt change in the direction of the magnetic field, which would indicate the presence of the interstellar magnetic field. ... "If you looked at the cosmic ray and energetic particle data in isolation, you might think Voyager had reached interstellar space, but the team feels Voyager 1 has not yet gotten there because we are still within the domain of the sun\'s magnetic field."',
      grounds: 'obs-18',
    },
  ]

  it.each(accepted)('accepts $where', ({ records, url, excerpt, grounds }) => {
    const { outcome, store } = checkpoint(records, url, excerpt)
    expect(outcome).toMatchObject({ ok: true, sourceObservationId: grounds })
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('refuses the paraphrased lead-in on a verbatim tail (fix-252 Pi camera)', () => {
    const { outcome, store } = checkpoint(
      [ZERO_CASE_READ],
      ZERO_CASE,
      'In addition to the Zero camera cable, the case includes a camera lid (which, when used with the short camera cable supplied, allows the standard and NoIR variants of Raspberry Pi Camera Modules 1 and 2 to fit neatly inside it; note that Camera Module 3 is not mechanically compatible with the camera lid).',
    )
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(store.snapshot().observations).toEqual([])
  })

  it('refuses an excerpt made only of fragments too short to verify, saying so rather than that it is absent', () => {
    const { outcome } = checkpoint([RMG_READ], RMG, 'ID: | H4 | mm')
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(outcome.ok ? '' : outcome.error).toContain('too short to verify')
    expect(outcome.ok ? '' : outcome.error).not.toContain('does not appear')
  })

  it('refuses an invented short value beside a real passage, and accepts the real one', () => {
    const acme = webRecord()
    expect(checkpoint([acme], GROUNDED_ARGS.source_url, 'The Acme router costs\n$99').outcome).toMatchObject({
      ok: false,
      reason: 'excerpt_unsupported',
    })
    expect(checkpoint([acme], GROUNDED_ARGS.source_url, 'The Acme router costs\n$39').outcome).toMatchObject({ ok: true })
  })

  it('never reads one number as another when punctuation is stripped', () => {
    const listing = webRecord({ payload: 'Rated 4.5 stars, ships in 1-2 days, from -5°C.' })
    const url = GROUNDED_ARGS.source_url
    expect(checkpoint([listing], url, 'Rated 45 stars').outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(checkpoint([listing], url, 'ships in 12 days').outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(checkpoint([listing], url, 'from 5°C').outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    // A dropped comma, or a range dash for a hyphen, is still the same text.
    expect(checkpoint([listing], url, 'Rated 4.5 stars ships in 1–2 days').outcome).toMatchObject({ ok: true })
  })

  it('refuses the whole excerpt when any one passage is not on the page', () => {
    const { outcome } = checkpoint([RMG_READ], RMG, 'Type: | Marine timekeeper\nWeight: | about a kilogram and a half')
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
  })

  it('grounds every passage in the cited source only, never in another page the run read', () => {
    const elsewhere = webRecord({ ...CAMERA_READ_2, id: 'obs-12' as ObservationRecord['id'], sourceUrl: ZERO_CASE })
    const { outcome } = checkpoint(
      [CAMERA_READ_1, elsewhere],
      CAMERA,
      'rpicam-still: Emulates many of the features of the original raspistill application. | Official cameras: OV5647 (V1) IMX219 (V2)',
    )
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
  })

  it('tells a refused excerpt to copy every passage verbatim', () => {
    const { outcome } = checkpoint([RMG_READ], RMG, 'Weight: | about a kilogram and a half')
    expect(outcome.ok ? '' : outcome.error).toContain('every passage verbatim')
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
  // The three kind "user" rows whose stray excerpt held the user's words
  // are accepted since #253 and live in its containment tests.
  const rows: Row[] = [
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
    {
      where: 'a subagent citation without its kind, carrying an excerpt (#272)',
      args: {
        agent_id: 'a-1',
        observation: 'All Pi Zero models use the mini 22-pin camera connector.',
        source_url: CAMERA_ACCESSORIES,
        excerpt: 'Pi Zero boards need the 22-pin adapter cable',
      },
      records: [],
      workers: { 'a-1': [webRecord({ id: 'wobs-2' as ObservationRecord['id'], sourceUrl: CAMERA_ACCESSORIES })] },
      fields: ['kind', 'excerpt'],
      corrected: {
        kind: 'subagent',
        agent_id: 'a-1',
        observation: 'All Pi Zero models use the mini 22-pin camera connector.',
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
    const outcome = evaluateEvidenceCheckpoint(callOf({ excerpt: 7, uncertainty: 7, agent_id: '', note: 'x', volatile: 'true' }), {
      records: [webRecord()],
      commit: commitOver(evidenceHarness()),
    })
    const message = evidenceCheckpointMessage(outcome)

    // The tool's declared order: agent_id before uncertainty, undeclared keys last.
    expect(namedFields(message)).toEqual(['kind', 'observation', 'source_url', 'excerpt', 'agent_id', 'uncertainty', 'volatile', 'note'])
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

describe('a refused excerpt names the passage that failed (#257, ADR 0054)', () => {
  // The two fix-253-256 clusters, as the Run Traces and event files carried
  // them: each Run retried one source in three consecutive rounds, editing
  // the joiner or the reference markers while the real defect stayed. The
  // records are what those Runs retained from each source.
  const DRAWING = 'https://pip-assets.raspberrypi.com/categories/1205-design-files/documents/RP-008149-DS-1-camera-module-2-mechanical-drawing.pdf'
  const DRAWING_NAVIGATE = webRecord({
    id: 'obs-20' as ObservationRecord['id'],
    at: 100,
    producer: 'action_outcome',
    sourceUrl: DRAWING,
    payload: `navigated: url=${DRAWING} title="Allegro"\n#  — ${DRAWING}\nviewport 1280x747 scroll 0/747\nsignature adeed002`,
  })
  const DRAWING_LOOK_1 = webRecord({ id: 'obs-21' as ObservationRecord['id'], at: 200, producer: 'look', sourceUrl: DRAWING, payload: '25 × 23.862 × 2' })
  const DRAWING_LOOK_2 = webRecord({
    id: 'obs-22' as ObservationRecord['id'],
    at: 300,
    producer: 'look',
    sourceUrl: DRAWING,
    payload:
      'The image shows a mechanical drawing with various dimension callouts. The vertical height dimension callout (thickness/height of the assembled camera module) is 5.5 mm. Other numeric dimension callouts visible are: 25, 13.8, 2, 2, 4.7, 14.5, 23.862, 12.5, 8.5, and 20.8.\n\n[region 0,50,100,50 clamped to 15,58,70,35 (at most a quarter of the viewport) shown at 3x; a smaller region is magnified more, up to 4x]',
  })
  const DRAWING_RECORDS = [DRAWING_NAVIGATE, DRAWING_LOOK_1, DRAWING_LOOK_2]
  /** The look answer with ", in mm" interpolated from the model's own question. */
  const INTERPOLATED =
    'The vertical height dimension callout (thickness/height of the assembled camera module, in mm) is 5.5 mm. Other numeric dimension callouts visible are: 25, 13.8, 2, 2, 4.7, 14.5, 23.862, 12.5, 8.5, and 20.8.'

  const VOYAGER = 'https://en.wikipedia.org/wiki/Voyager_1'
  const VOYAGER_READ_A = webRecord({
    id: 'obs-30' as ObservationRecord['id'],
    at: 400,
    sourceUrl: VOYAGER,
    payload: [
      'Ed Roelof, a space scientist at Johns Hopkins University and principal investigator for the Low-Energy Charged Particle instrument on the spacecraft, declared that "most scientists involved with Voyager 1 would agree that [these two criteria] have been sufficiently satisfied".[87] However, the last criterion for officially declaring that Voyager 1 had crossed the boundary, the expected change in magnetic field direction (from that of the Sun to that of the interstellar field beyond), had not been observed (the field had changed direction by only 2 degrees),[82] which suggested to some that the nature of the edge of the heliosphere had been misjudged.',
      'On September 12, 2013, NASA confirmed that Voyager 1 had reached the interstellar medium in August 2012 as previously observed. The generally accepted date of arrival is August 25, 2012 (approximately 10 days before the 35th anniversary of its launch), the date durable changes in the density of energetic particles were first detected.[83][84][85] By this point, most space scientists had abandoned the hypothesis that a change in magnetic field direction must accompany a crossing of the heliopause;[84] a new model of the heliopause predicted that no such change would be found.[96]',
    ].join('\n'),
  })
  const VOYAGER_READ_B = webRecord({
    id: 'obs-31' as ObservationRecord['id'],
    at: 500,
    sourceUrl: VOYAGER,
    payload: [
      'A key finding that persuaded many scientists that the heliopause had been crossed was an indirect measurement of an 80-fold increase in electron density, based on the frequency of plasma oscillations observed beginning on April 9, 2013,[84] triggered by a solar outburst that had occurred in March 2012.[81] Electron density is expected to be two orders of magnitude higher outside the heliopause than within.[83]',
      "Weaker sets of oscillations measured in October and November 2012[93][97] provided additional data. An indirect measurement was required because Voyager 1's plasma spectrometer had stopped working in 1980.[85] In September 2013, NASA released recordings of audio transductions of these plasma waves, the first to be measured in interstellar space.[98]",
    ].join('\n'),
  })
  const VOYAGER_RECORDS = [VOYAGER_READ_A, VOYAGER_READ_B]
  const VOYAGER_PASSAGE_1 =
    '"the last criterion for officially declaring that Voyager 1 had crossed the boundary, the expected change in magnetic field direction (from that of the Sun to that of the interstellar field beyond), had not been observed (the field had changed direction by only 2 degrees)"'
  const VOYAGER_PASSAGE_2 =
    '"On September 12, 2013, NASA confirmed that Voyager 1 had reached the interstellar medium in August 2012 as previously observed. The generally accepted date of arrival is August 25, 2012"'
  /** Round 23: the page's reference markers stripped, every word kept. */
  const VOYAGER_PASSAGE_3_STRIPPED =
    '"A key finding that persuaded many scientists that the heliopause had been crossed was an indirect measurement of an 80-fold increase in electron density, based on the frequency of plasma oscillations observed beginning on April 9, 2013, triggered by a solar outburst that had occurred in March 2012. Electron density is expected to be two orders of magnitude higher outside the heliopause than within. Weaker sets of oscillations measured in October and November 2012 provided additional data. An indirect measurement was required because Voyager 1\'s plasma spectrometer had stopped working in 1980."'
  /** Round 24: the markers restored and the "Electron density" sentence deleted. */
  const VOYAGER_PASSAGE_3_CUT =
    '"A key finding that persuaded many scientists that the heliopause had been crossed was an indirect measurement of an 80-fold increase in electron density, based on the frequency of plasma oscillations observed beginning on April 9, 2013,[84] triggered by a solar outburst that had occurred in March 2012.[81] Weaker sets of oscillations measured in October and November 2012[93][97] provided additional data. An indirect measurement was required because Voyager 1\'s plasma spectrometer had stopped working in 1980.[85]"'

  function checkpoint(records: ObservationRecord[], sourceUrl: string, excerpt: string) {
    const store = evidenceHarness()
    const outcome = evaluateEvidenceCheckpoint(callOf({ observation: 'A fact the excerpt grounds.', source_url: sourceUrl, excerpt }), {
      records,
      commit: commitOver(store),
    })
    return { outcome, store, error: outcome.ok ? '' : outcome.error }
  }

  /** The passages a refusal names, each with the retained text it quotes (null when it quotes none). */
  function named(error: string): { passage: string; nearest: string | null }[] {
    const entries: { passage: string; nearest: string | null }[] = []
    const lines = error.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (!line.startsWith(PASSAGE_LABEL)) continue
      const next = lines[index + 1] ?? ''
      entries.push({
        passage: line.slice(PASSAGE_LABEL.length),
        nearest: next.startsWith(NEAREST_LABEL) ? next.slice(NEAREST_LABEL.length) : null,
      })
    }
    return entries
  }

  it('names the interpolated passage beside the look answer it came from, and only that passage (fix-253-256-2 Pi camera, rounds 22–24)', () => {
    const retries = [`25 × 23.862 × 2 … ${INTERPOLATED}`, `25 × 23.862 × 2\n${INTERPOLATED}`, `25 × 23.862 × 2 … The image shows a mechanical drawing with various dimension callouts. ${INTERPOLATED}`]
    for (const excerpt of retries) {
      const { outcome, error, store } = checkpoint(DRAWING_RECORDS, DRAWING, excerpt)
      expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
      expect(store.snapshot().observations).toEqual([])
      const entries = named(error)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.passage).toContain('camera module, in mm) is 5.5 mm')
      // The retained span shows the parenthesis as the look answered it.
      expect(entries[0]!.nearest).toContain('(thickness/height of the assembled camera module) is 5.5 mm')
      expect(entries[0]!.nearest).not.toContain(', in mm')
      expect(error).toContain("checked its action outcome, look")
    }
  })

  it('accepts the retry whose only difference is the stripped reference markers (fix-253-256-2 Voyager, round 23)', () => {
    const { outcome, store } = checkpoint(VOYAGER_RECORDS, VOYAGER, [VOYAGER_PASSAGE_1, VOYAGER_PASSAGE_2, VOYAGER_PASSAGE_3_STRIPPED].join(' … '))
    expect(outcome).toMatchObject({ ok: true, sourceObservationId: 'obs-31' })
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('names the passage with the deleted sentence beside the retained text that still holds it (fix-253-256-2 Voyager, round 24)', () => {
    const { outcome, error } = checkpoint(VOYAGER_RECORDS, VOYAGER, [VOYAGER_PASSAGE_1, VOYAGER_PASSAGE_2, VOYAGER_PASSAGE_3_CUT].join(' … '))
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    const entries = named(error)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.passage).toContain('March 2012.[81] Weaker sets')
    expect(entries[0]!.nearest).toContain('Electron density is expected to be two orders of magnitude higher outside the heliopause than within.')
    // The retained text is quoted as the page said it, never lowercased or re-spaced.
    expect(entries[0]!.nearest).toContain('A key finding that persuaded')
  })

  it('names a passage with no anchor at all, with no quotation', () => {
    const { outcome, error } = checkpoint([webRecord()], GROUNDED_ARGS.source_url, 'Free shipping on orders over $25\nNothing like this was ever seen')
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(named(error)).toEqual([{ passage: 'Nothing like this was ever seen', nearest: NO_NEAREST }])
    expect(error).toContain(`${NEAREST_LABEL}${NO_NEAREST}`)
  })

  it('names every failing passage, and a refusal always names at least one', () => {
    const { error } = checkpoint([webRecord()], GROUNDED_ARGS.source_url, 'The Acme router costs $49 | shipping is never free | Free shipping on orders over $25')
    expect(named(error).map((entry) => entry.passage)).toEqual(['The Acme router costs $49', 'shipping is never free'])
    expect(named(error)[0]!.nearest).toContain('The Acme router costs $39')
    expect(unsupportedPassages(['The Acme router costs $39.'], 'The Acme router costs $39')).toEqual([])
  })

  it('refuses an excerpt that is nothing but reference markers naming it, never with an empty list', () => {
    const { outcome, error } = checkpoint([webRecord()], GROUNDED_ARGS.source_url, '[84][85][86]')
    expect(outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    expect(error).not.toContain('too short')
    expect(named(error)).toEqual([{ passage: '[84][85][86]', nearest: NO_NEAREST }])
    // A scrap of punctuation beside a real passage is still tolerated.
    expect(checkpoint([webRecord()], GROUNDED_ARGS.source_url, 'The Acme router costs $39\n—').outcome).toMatchObject({ ok: true })
  })

  it('keeps the joiner advice out of the refusal', () => {
    const { error } = checkpoint([webRecord()], GROUNDED_ARGS.source_url, 'shipping is never free')
    expect(error).not.toContain('may be joined')
    expect(error).toContain('copy every passage verbatim')
  })

  describe('reference-marker tolerance', () => {
    const page = webRecord({ payload: 'oscillations observed beginning on April 9, 2013,[84] triggered by a solar outburst that had occurred in March 2012.[81] Weaker sets of oscillations measured in October and November 2012[93][97] provided additional data.[note 3][a] The field had changed direction by only 2 degrees[citation needed] by then.' })
    const url = GROUNDED_ARGS.source_url

    it('accepts an excerpt with the markers stripped by the model', () => {
      expect(checkpoint([page], url, 'observed beginning on April 9, 2013, triggered by a solar outburst that had occurred in March 2012. Weaker sets of oscillations measured in October and November 2012 provided additional data. The field had changed direction').outcome).toMatchObject({ ok: true })
    })

    it('accepts an excerpt carrying markers the retained text does not', () => {
      const plain = webRecord({ payload: 'observed beginning on April 9, 2013, triggered by a solar outburst that had occurred in March 2012.' })
      expect(checkpoint([plain], url, 'observed beginning on April 9, 2013,[84] triggered by a solar outburst[12] that had occurred in March 2012.[81]').outcome).toMatchObject({ ok: true })
    })

    it('treats [citation needed], [note 3] and [a] as markers too', () => {
      expect(checkpoint([page], url, 'provided additional data. The field had changed direction by only 2 degrees by then.').outcome).toMatchObject({ ok: true })
      expect(checkpoint([page], url, 'provided additional data.[note 3][a] The field had changed direction by only 2 degrees[citation needed] by then.').outcome).toMatchObject({ ok: true })
    })

    it('still refuses a passage whose words differ once the markers are gone', () => {
      expect(checkpoint([page], url, 'observed beginning on April 9, 2013, caused by a solar outburst').outcome).toMatchObject({ ok: false, reason: 'excerpt_unsupported' })
    })
  })
})
